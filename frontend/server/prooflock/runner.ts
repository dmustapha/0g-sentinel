import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "json-canonicalize";

import { canonicalizeEvidence, canonicalizeStorageCommitment } from "./canonical";
import { computeIdentityKey, type ChainWriteRequest, type ChainWriteResult, type RegistryProofLockRecord } from "./chain";
import type { SubjectCheckReport } from "./checks";
import type { ClassifiedSubject } from "./subject/classify";
import type {
  AgentIdentity, Bytes32, ComputeProof, DeterministicCheck, EvidenceEnvelopeV1,
  HexAddress, ResolvedAgentIdentity, StorageCommitment,
} from "./types";

export const PROOFLOCK_RUNNER_STAGES = [
  "VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS",
  "RUNNING_COMPUTE", "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE",
  "VERIFYING_STORAGE", "WRITING_CHAIN", "READING_CHAIN_BACK", "SEALED",
] as const;

export type RunnerStage = (typeof PROOFLOCK_RUNNER_STAGES)[number];
export type RunnerInput = Readonly<{
  identity: AgentIdentity; registryAddress: HexAddress; policyVersion: number; scanner: HexAddress; scannerSoftwareVersion: string;
  validForSeconds: number; mode: "SEAL" | "RESEAL"; expectedPriorVersion?: bigint; previousProofId?: Bytes32;
}>;
export type DeterministicStageResult = Readonly<{
  checks: readonly DeterministicCheck[]; report?: SubjectCheckReport;
  evidenceSubject: EvidenceEnvelopeV1["subject"]; codeRisk: number; omissions: readonly string[];
}>;
export type ComputeStageResult = Readonly<{
  proofs: readonly ComputeProof[]; behavioralScore: number;
  verdict: EvidenceEnvelopeV1["verdict"];
}>;
export type CanonicalEvidenceResult = Readonly<{
  envelope: EvidenceEnvelopeV1; canonicalBytes: Uint8Array; envelopeDigest: Bytes32;
}>;
export type RunnerContext = Readonly<{
  input: RunnerInput; identity: ResolvedAgentIdentity; subject: ClassifiedSubject;
  deterministic: DeterministicStageResult; compute: ComputeStageResult; computeRoot: Bytes32;
}>;
export type RunnerChainInput = ChainWriteRequest;
export type RunnerResult = Readonly<{
  stage: "SEALED"; identity: ResolvedAgentIdentity; subject: ClassifiedSubject;
  envelope: EvidenceEnvelopeV1; storage: StorageCommitment; chain: ChainWriteResult;
  proofLock: RegistryProofLockRecord;
}>;

export type ProofLockRunnerDependencies = Readonly<{
  validateIdentity(input: AgentIdentity): Promise<ResolvedAgentIdentity>;
  classifySubject(identity: ResolvedAgentIdentity): Promise<ClassifiedSubject>;
  runDeterministicChecks(identity: ResolvedAgentIdentity, subject: ClassifiedSubject): Promise<DeterministicStageResult>;
  runCompute(identity: ResolvedAgentIdentity, subject: ClassifiedSubject, deterministic: DeterministicStageResult): Promise<ComputeStageResult>;
  buildEvidenceEnvelope(context: RunnerContext): Promise<EvidenceEnvelopeV1>;
  uploadStorage(canonical: CanonicalEvidenceResult): Promise<unknown>;
  verifyStorage(upload: unknown, canonical: CanonicalEvidenceResult): Promise<StorageCommitment>;
  writeChain(input: RunnerChainInput): Promise<ChainWriteResult>;
  readChainBack(input: RunnerChainInput, write: ChainWriteResult): Promise<RegistryProofLockRecord>;
}>;

export class ProofLockStageError extends Error {
  constructor(readonly stage: RunnerStage, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ProofLockStageError";
  }
}

export function createProofLockRunner(dependencies: ProofLockRunnerDependencies) {
  return Object.freeze({
    run: (input: RunnerInput, report?: (stage: RunnerStage) => void) => run(input, dependencies, report),
  });
}

async function run(
  rawInput: RunnerInput,
  dependencies: ProofLockRunnerDependencies,
  report?: (stage: RunnerStage) => void,
): Promise<RunnerResult> {
  const input = validateRunnerInput(rawInput);
  const execute = executor(report);
  const identity = await execute("VALIDATING_IDENTITY", () => dependencies.validateIdentity(input.identity));
  assertResolvedBinding(input.identity, identity);
  const subject = await execute("CLASSIFYING_SUBJECT", () => dependencies.classifySubject(identity));
  assertSubjectBinding(identity, subject);
  const deterministic = await execute("RUNNING_DETERMINISTIC_CHECKS", () => dependencies.runDeterministicChecks(identity, subject));
  assertDeterministic(subject, deterministic);
  const compute = await execute("RUNNING_COMPUTE", () => dependencies.runCompute(identity, subject, deterministic));
  const computeRoot = computeProofRoot(compute.proofs);
  const context = Object.freeze({ input, identity, subject, deterministic, compute, computeRoot });
  const canonical = await execute("CANONICALIZING_EVIDENCE", async () => {
    const envelope = await dependencies.buildEvidenceEnvelope(context);
    assertEnvelopeBinding(context, envelope);
    return makeCanonicalEvidence(envelope);
  });
  const upload = await execute("UPLOADING_STORAGE", () => dependencies.uploadStorage(canonical));
  const storage = await execute("VERIFYING_STORAGE", () => dependencies.verifyStorage(upload, canonical));
  assertStorageBinding(canonical, storage);
  let chainInput!: RunnerChainInput;
  const chain = await execute("WRITING_CHAIN", () => {
    chainInput = createChainInput(context, canonical, storage);
    return dependencies.writeChain(chainInput);
  });
  const proofLock = await execute("READING_CHAIN_BACK", () => dependencies.readChainBack(chainInput, chain));
  assertReadback(chainInput, chain, proofLock);
  safeReport(report, "SEALED");
  return Object.freeze({ stage: "SEALED", identity, subject, envelope: canonical.envelope, storage, chain, proofLock });
}

function assertReadback(
  input: RunnerChainInput,
  chain: ChainWriteResult,
  record: RegistryProofLockRecord,
): void {
  const expectedVersion = input.mode === "SEAL" ? 1n : input.expectedPriorVersion! + 1n;
  const expected = {
    identityKey: input.identityKey, subject: input.subject, envelopeDigest: input.envelopeDigest,
    storageRoot: input.storageRoot, computeRoot: input.computeRoot, artifactHash: input.artifactHash,
    runtimeCodeHash: input.runtimeCodeHash, version: expectedVersion,
    policyVersion: input.policyVersion, behavioralScore: input.behavioralScore,
    codeRisk: input.codeRisk, coverage: input.coverage, state: 1, stateReason: 0,
  };
  const mismatch = Object.entries(expected).some(([key, value]) => !sameValue(record[key as keyof typeof record], value));
  if (chain.expectedVersion !== expectedVersion || mismatch
    || record.validUntil - record.issuedAt !== BigInt(input.validForSeconds)) {
    throw new ProofLockStageError("READING_CHAIN_BACK", "Injected chain readback is not exact");
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function makeCanonicalEvidence(envelope: EvidenceEnvelopeV1): CanonicalEvidenceResult {
  const canonical = canonicalizeEvidence(envelope);
  const canonicalBytes = new TextEncoder().encode(canonical);
  return Object.freeze({ envelope, canonicalBytes, envelopeDigest: keccak256(canonicalBytes) as Bytes32 });
}

function executor(report?: (stage: RunnerStage) => void) {
  return async <T>(stage: RunnerStage, operation: () => Promise<T>): Promise<T> => {
    try { safeReport(report, stage); return await operation(); }
    catch (error) {
      if (error instanceof ProofLockStageError) throw error;
      throw new ProofLockStageError(stage, `ProofLock stopped at ${stage}`, error);
    }
  };
}

function safeReport(report: ((stage: RunnerStage) => void) | undefined, stage: RunnerStage): void {
  try { report?.(stage); } catch { /* Status reporting cannot control proof side effects. */ }
}

function validateRunnerInput(input: RunnerInput): RunnerInput {
  try {
    if (!input || !Number.isSafeInteger(input.policyVersion) || input.policyVersion < 1 || input.policyVersion > 4_294_967_295) throw new Error();
    if (input.validForSeconds !== 7 * 86400) throw new Error();
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.registryAddress) || /^0x0{40}$/i.test(input.registryAddress)) throw new Error();
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.scanner) || /^0x0{40}$/i.test(input.scanner)) throw new Error();
    if (!input.scannerSoftwareVersion.trim() || input.scannerSoftwareVersion.length > 128) throw new Error();
    if (input.mode === "RESEAL" && (!input.expectedPriorVersion || input.expectedPriorVersion < 1n)) throw new Error();
    if (input.mode === "RESEAL" && (!input.previousProofId || !/^0x[0-9a-fA-F]{64}$/.test(input.previousProofId) || /^0x0{64}$/i.test(input.previousProofId))) throw new Error();
    if (input.mode === "SEAL" && (input.expectedPriorVersion !== undefined || input.previousProofId !== undefined)) throw new Error();
    if (input.mode !== "SEAL" && input.mode !== "RESEAL") throw new Error();
    return Object.freeze(input);
  } catch (error) {
    throw new ProofLockStageError("VALIDATING_IDENTITY", "Invalid operator runner input", error);
  }
}

function assertResolvedBinding(requested: AgentIdentity, resolved: ResolvedAgentIdentity): void {
  if (requested.namespace !== resolved.identity.namespace || requested.chainId !== resolved.identity.chainId
    || requested.registryAddress.toLowerCase() !== resolved.identity.registryAddress.toLowerCase()
    || requested.agentId !== resolved.identity.agentId) {
    throw new ProofLockStageError("VALIDATING_IDENTITY", "Resolver returned a different ERC-8004 identity");
  }
}

function assertSubjectBinding(identity: ResolvedAgentIdentity, subject: ClassifiedSubject): void {
  if (identity.agentWallet.toLowerCase() !== subject.address.toLowerCase()
    || identity.sourceBlockNumber !== subject.sourceBlockNumber
    || identity.sourceBlockHash !== subject.sourceBlockHash) {
    throw new ProofLockStageError("CLASSIFYING_SUBJECT", "Subject is not bound to the resolved identity block");
  }
}

function assertDeterministic(subject: ClassifiedSubject, result: DeterministicStageResult): void {
  if (!Number.isSafeInteger(result.codeRisk) || result.codeRisk < 0 || result.codeRisk > 2 || result.checks.length === 0) {
    throw new ProofLockStageError("RUNNING_DETERMINISTIC_CHECKS", "Invalid deterministic stage result");
  }
  if (result.evidenceSubject.address.toLowerCase() !== subject.address.toLowerCase()
    || result.evidenceSubject.kind !== subject.kind || result.evidenceSubject.runtimeCodeHash !== subject.runtimeCodeHash) {
    throw new ProofLockStageError("RUNNING_DETERMINISTIC_CHECKS", "Deterministic evidence subject mismatch");
  }
}

function assertEnvelopeBinding(context: RunnerContext, envelope: EvidenceEnvelopeV1): void {
  const expectedIdentity = context.identity;
  const identityMatches = envelope.identity.agentId === expectedIdentity.identity.agentId
    && envelope.identity.registryAddress.toLowerCase() === expectedIdentity.identity.registryAddress.toLowerCase()
    && envelope.identity.owner.toLowerCase() === expectedIdentity.owner.toLowerCase()
    && envelope.identity.agentWallet.toLowerCase() === expectedIdentity.agentWallet.toLowerCase()
    && envelope.identity.registrationDigest === expectedIdentity.registrationDigest
    && envelope.identity.registrationUri === expectedIdentity.agentURI;
  const sourceMatches = envelope.source.blockNumber === expectedIdentity.sourceBlockNumber
    && envelope.source.blockHash === expectedIdentity.sourceBlockHash;
  const operatorMatches = envelope.policyVersion === context.input.policyVersion
    && envelope.scanner.address.toLowerCase() === context.input.scanner.toLowerCase()
    && envelope.scanner.softwareVersion === context.input.scannerSoftwareVersion;
  const evidenceMatches = equivalent(envelope.subject, context.deterministic.evidenceSubject)
    && equivalent(envelope.deterministicChecks, context.deterministic.checks)
    && equivalent(envelope.computeProofs, context.compute.proofs)
    && equivalent(envelope.verdict, context.compute.verdict)
    && equivalent(envelope.omissions, context.deterministic.omissions);
  const previousMatches = context.input.mode === "SEAL"
    ? envelope.previousProofId === undefined
    : envelope.previousProofId === context.input.previousProofId;
  if (!identityMatches || !sourceMatches || !operatorMatches || !evidenceMatches || !previousMatches) {
    throw new ProofLockStageError("CANONICALIZING_EVIDENCE", "Evidence envelope is not bound to runner inputs");
  }
}

function equivalent(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

function assertStorageBinding(canonical: CanonicalEvidenceResult, storage: StorageCommitment): void {
  if (storage.retrievalVerified !== true || storage.envelopeDigest !== canonical.envelopeDigest
    || storage.retrievedDigest !== canonical.envelopeDigest) {
    throw new ProofLockStageError("VERIFYING_STORAGE", "Storage commitment is not bound to canonical evidence");
  }
}

function createChainInput(
  context: RunnerContext,
  canonical: CanonicalEvidenceResult,
  storage: StorageCommitment,
): RunnerChainInput {
  const artifactHash = keccak256(toUtf8Bytes(canonicalizeStorageCommitment(storage))) as Bytes32;
  return Object.freeze({
    registryAddress: context.input.registryAddress.toLowerCase() as HexAddress, mode: context.input.mode,
    expectedPriorVersion: context.input.expectedPriorVersion,
    identityKey: computeIdentityKey(context.identity.identity), subject: context.subject.address,
    envelopeDigest: canonical.envelopeDigest, storageRoot: storage.storageRoot,
    computeRoot: context.computeRoot, artifactHash, runtimeCodeHash: context.subject.runtimeCodeHash,
    validForSeconds: context.input.validForSeconds, policyVersion: context.input.policyVersion,
    behavioralScore: context.compute.behavioralScore, codeRisk: context.deterministic.codeRisk, coverage: 0x7f,
  });
}

export function computeProofRoot(proofs: readonly ComputeProof[]): Bytes32 {
  if (proofs.length < 1 || proofs.length > 2) {
    throw new ProofLockStageError("RUNNING_COMPUTE", "Invalid Compute proof count");
  }
  const ordered = [...proofs].sort((left, right) => left.purpose.localeCompare(right.purpose));
  const receipts = ordered.map((proof) => proof.receiptDigest);
  if (new Set(receipts).size !== receipts.length) {
    throw new ProofLockStageError("RUNNING_COMPUTE", "Duplicate Compute proof receipt");
  }
  return keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [receipts])) as Bytes32;
}
