import { randomUUID } from "node:crypto";

import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "json-canonicalize";

import { canonicalizeEvidence, canonicalizeStorageCommitment } from "./canonical";
import { computeIdentityKey, type ChainWriteProgress, type ChainWriteRequest, type ChainWriteResult, type RegistryProofLockRecord } from "./chain";
import type { SubjectCheckReport } from "./checks";
import { OperationJournalError, type OperationJournal, type OperationRecord, type PaidStage, type PublicWriteOutcome } from "./operation-journal";
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
  idempotencyKey?: string;
}>;
export type DeterministicStageResult = Readonly<{
  checks: readonly DeterministicCheck[]; report?: SubjectCheckReport;
  evidenceSubject: EvidenceEnvelopeV1["subject"]; codeRisk: number; omissions: readonly string[];
}>;
export type ComputeStageResult = Readonly<{
  proofs: readonly ComputeProof[]; behavioralScore: number; codeRisk: number;
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
  kind: "SEALED";
  stage: "SEALED"; identity: ResolvedAgentIdentity; subject: ClassifiedSubject;
  envelope: EvidenceEnvelopeV1; storage: StorageCommitment; chain: ChainWriteResult;
  proofLock: RegistryProofLockRecord; writeOutcome?: Extract<PublicWriteOutcome, { status: "SEALED" }>;
}>;
export type ExistingOperationResult = Readonly<{ kind: "EXISTING_OPERATION"; operation: Readonly<{
  recoveryId: string; phase: OperationRecord["phase"]; writeOutcome?: PublicWriteOutcome;
}> }>;
export type RunnerTerminalResult = RunnerResult | ExistingOperationResult;
export type PaidCostController = Readonly<{
  reserve(stage: PaidStage): void; reconcile(stage: PaidStage, disposition: "CONSUMED" | "RELEASED"): void;
}>;

export type ProofLockRunnerDependencies = Readonly<{
  validateIdentity(input: AgentIdentity, signal?: AbortSignal): Promise<ResolvedAgentIdentity>;
  classifySubject(identity: ResolvedAgentIdentity, signal?: AbortSignal): Promise<ClassifiedSubject>;
  runDeterministicChecks(identity: ResolvedAgentIdentity, subject: ClassifiedSubject, signal?: AbortSignal): Promise<DeterministicStageResult>;
  runCompute(identity: ResolvedAgentIdentity, subject: ClassifiedSubject, deterministic: DeterministicStageResult,
    signal?: AbortSignal, costs?: PaidCostController): Promise<ComputeStageResult>;
  buildEvidenceEnvelope(context: RunnerContext, signal?: AbortSignal): Promise<EvidenceEnvelopeV1>;
  uploadStorage(canonical: CanonicalEvidenceResult, signal?: AbortSignal): Promise<unknown>;
  verifyStorage(upload: unknown, canonical: CanonicalEvidenceResult, signal?: AbortSignal): Promise<StorageCommitment>;
  writeChain(input: RunnerChainInput, signal?: AbortSignal, report?: (progress: ChainWriteProgress) => void): Promise<ChainWriteResult>;
  readChainBack(input: RunnerChainInput, write: ChainWriteResult, signal?: AbortSignal): Promise<RegistryProofLockRecord>;
  operationJournal?: OperationJournal;
  costSchedule?: Readonly<Record<PaidStage, number>>;
}>;

export type RunnerProgress = Readonly<{ type: "chain"; progress: ChainWriteProgress }>
  | Readonly<{ type: "admission"; state: "ACCEPTED" | "DEDUPLICATED"; recoveryId: string; idempotencyKey: string }>;

export class ProofLockStageError extends Error {
  constructor(readonly stage: RunnerStage, message: string, readonly cause?: unknown,
    readonly outcome?: PublicWriteOutcome, readonly code?: string) {
    super(message);
    this.name = "ProofLockStageError";
  }
}

export function createProofLockRunner(dependencies: ProofLockRunnerDependencies) {
  return Object.freeze({
    run: (input: RunnerInput, report?: (stage: RunnerStage) => void, signal?: AbortSignal,
      reportProgress?: (progress: RunnerProgress) => void) => run(input, dependencies, report, signal, reportProgress),
  });
}

async function run(
  rawInput: RunnerInput,
  dependencies: ProofLockRunnerDependencies,
  report?: (stage: RunnerStage) => void,
  signal?: AbortSignal,
  reportProgress?: (progress: RunnerProgress) => void,
): Promise<RunnerTerminalResult> {
  const validated = validateRunnerInput(rawInput);
  const input = Object.freeze({ ...validated, idempotencyKey: validated.idempotencyKey ?? `auto-${randomUUID()}` });
  const stableDigest = requestDigest(input);
  const journal = dependencies.operationJournal;
  try {
    const existing = journal?.lookup(input.idempotencyKey, stableDigest);
    if (existing) {
      safeProgress(reportProgress, { type: "admission", state: "DEDUPLICATED", recoveryId: existing.operation.recoveryId,
        idempotencyKey: existing.operation.idempotencyKey });
      return existingResult(existing.operation);
    }
  } catch (error) {
    if (error instanceof OperationJournalError) throw new ProofLockStageError("VALIDATING_IDENTITY",
      "Operation admission was rejected", error, undefined, error.code);
    throw error;
  }
  const execute = executor(report, signal);
  const identity = await execute("VALIDATING_IDENTITY", () => signal
    ? dependencies.validateIdentity(input.identity, signal) : dependencies.validateIdentity(input.identity));
  assertResolvedBinding(input.identity, identity);
  const subject = await execute("CLASSIFYING_SUBJECT", () => signal
    ? dependencies.classifySubject(identity, signal) : dependencies.classifySubject(identity));
  assertSubjectBinding(identity, subject);
  const deterministic = await execute("RUNNING_DETERMINISTIC_CHECKS", () => signal
    ? dependencies.runDeterministicChecks(identity, subject, signal) : dependencies.runDeterministicChecks(identity, subject));
  assertDeterministic(subject, deterministic);
  let admission: ReturnType<OperationJournal["begin"]> | undefined;
  try { admission = journal?.begin(operationAdmission(input, identity, subject, stableDigest,
    reservedBudget(subject, dependencies.costSchedule))); }
  catch (error) {
    if (error instanceof OperationJournalError) throw new ProofLockStageError("RUNNING_COMPUTE",
      "Operation admission was rejected", error, undefined, error.code);
    throw error;
  }
  if (admission) safeProgress(reportProgress, { type: "admission", state: admission.kind,
    recoveryId: admission.operation.recoveryId, idempotencyKey: admission.operation.idempotencyKey });
  if (admission?.kind === "DEDUPLICATED") return existingResult(admission.operation);
  const operation = admission?.operation;
  const costs = costController(journal, operation, dependencies.costSchedule);
  const paid = executor(report);
  let chainInput: RunnerChainInput | undefined;
  let chain: ChainWriteResult | undefined;
  const writeState: { attempted: boolean; finalized: boolean; reverted: boolean; transactionHash?: Bytes32 } = {
    attempted: false, finalized: false, reverted: false };
  try {
    const compute = await paid("RUNNING_COMPUTE", () => dependencies.runCompute(identity, subject, deterministic, undefined, costs));
    assertCompute(subject, deterministic, compute);
    const computeRoot = computeProofRoot(compute.proofs);
    journalOperation(journal, operation, "compute", { computeRoot, commitments: computeCommitments(compute.proofs) });
    const context = Object.freeze({ input, identity, subject, deterministic, compute, computeRoot });
    const canonical = await paid("CANONICALIZING_EVIDENCE", async () => {
      const envelope = await dependencies.buildEvidenceEnvelope(context);
      assertEnvelopeBinding(context, envelope);
      return makeCanonicalEvidence(envelope);
    });
    costs.reserve("STORAGE");
    const upload = await paid("UPLOADING_STORAGE", async () => {
      try { return await dependencies.uploadStorage(canonical); }
      finally { costs.reconcile("STORAGE", "CONSUMED"); }
    });
    const storage = await paid("VERIFYING_STORAGE", () => dependencies.verifyStorage(upload, canonical));
    assertStorageBinding(canonical, storage);
    const artifactHash = storageArtifactHash(storage);
    journalOperation(journal, operation, "storage", { storageRoot: storage.storageRoot,
      uploadTxHash: storage.uploadTxHash, artifactHash, envelopeDigest: storage.envelopeDigest,
      retrievedDigest: storage.retrievedDigest, finalizedAtBlock: storage.finalizedAtBlock,
      retrievalVerified: true, networkProofVerified: false });
    chainInput = createChainInput(context, canonical, storage);
    journalOperation(journal, operation, "chain", chainInput);
    costs.reserve("REGISTRY");
    const onChainProgress = (progress: ChainWriteProgress) => {
      applyChainProgress(journal, operation, progress, writeState);
      safeProgress(reportProgress, Object.freeze({ type: "chain", progress }));
    };
    chain = await paid("WRITING_CHAIN", async () => {
      let completed = false;
      try { const result = await dependencies.writeChain(chainInput!, undefined, onChainProgress); completed = true; return result; }
      finally { costs.reconcile("REGISTRY", writeState.attempted || completed ? "CONSUMED" : "RELEASED"); }
    });
    writeState.finalized = true; writeState.transactionHash = chain.transactionHash;
    const proofLock = await paid("READING_CHAIN_BACK", () => dependencies.readChainBack(chainInput!, chain!));
    assertReadback(chainInput, chain, proofLock);
    const outcome = operation ? sealedOutcome(operation, chainInput, chain) : undefined;
    if (operation && outcome) journal!.complete(operation.recoveryId, outcome);
    safeReport(report, "SEALED");
    return Object.freeze({ kind: "SEALED", stage: "SEALED", identity, subject, envelope: canonical.envelope, storage, chain, proofLock,
      ...(outcome?.status === "SEALED" ? { writeOutcome: outcome } : {}) });
  } catch (error) {
    if (!operation) throw error;
    const outcome = writeOutcome(operation, chainInput, chain, writeState);
    try { journal!.complete(operation.recoveryId, outcome); } catch (journalError) {
      if (!(error instanceof ProofLockStageError)) error = journalError;
    }
    const stageError = error instanceof ProofLockStageError ? error
      : new ProofLockStageError("RUNNING_COMPUTE", "ProofLock paid ceremony stopped", error);
    // Server-side diagnostic (never streamed to the client): surface the real cause of a stopped
    // ceremony so serverless write failures are debuggable. Safe: printed to server logs only.
    try {
      const cause = (stageError.cause ?? error) as { message?: string; stack?: string; code?: string } | undefined;
      console.error("[prooflock-ceremony-error]", stageError.stage, stageError.code ?? "",
        cause?.code ?? "", cause?.message ?? String(cause), cause?.stack?.split("\n").slice(0, 4).join(" | "));
    } catch { /* logging must never mask the original error */ }
    throw new ProofLockStageError(stageError.stage, stageError.message, stageError.cause, outcome, stageError.code);
  }
}

function operationAdmission(input: RunnerInput, identity: ResolvedAgentIdentity, subject: ClassifiedSubject,
  inputDigest: Bytes32, reservedCostUnits: number) {
  const identityKey = computeIdentityKey(identity.identity);
  return Object.freeze({ idempotencyKey: input.idempotencyKey!, inputDigest, identityKey, operator: input.scanner,
    subject: subject.address, expectedVersion: (input.mode === "SEAL" ? 1n : input.expectedPriorVersion! + 1n).toString(),
    policyVersion: input.policyVersion, runtimeCodeHash: subject.runtimeCodeHash, reservedCostUnits });
}

function requestDigest(input: RunnerInput): Bytes32 {
  const canonical = canonicalize({ identity: input.identity, mode: input.mode,
    expectedPriorVersion: input.expectedPriorVersion?.toString(), previousProofId: input.previousProofId,
    registryAddress: input.registryAddress, scanner: input.scanner, scannerSoftwareVersion: input.scannerSoftwareVersion,
    policyVersion: input.policyVersion, validForSeconds: input.validForSeconds });
  if (typeof canonical !== "string") throw new ProofLockStageError("VALIDATING_IDENTITY", "Operation request could not be committed");
  return keccak256(toUtf8Bytes(canonical)) as Bytes32;
}
function existingResult(operation: OperationRecord): ExistingOperationResult { return Object.freeze({ kind: "EXISTING_OPERATION",
  operation: Object.freeze({ recoveryId: operation.recoveryId, phase: operation.phase,
    ...(operation.terminalOutcome ? { writeOutcome: operation.terminalOutcome } : {}) }) }); }
function reservedBudget(subject: ClassifiedSubject, configured?: Readonly<Record<PaidStage, number>>): number {
  const schedule = configured ?? { COMPUTE_BEHAVIORAL: 1, COMPUTE_CONTRACT: 1, STORAGE: 1, REGISTRY: 1 };
  return schedule.COMPUTE_BEHAVIORAL + schedule.STORAGE + schedule.REGISTRY
    + (subject.kind === "EOA" ? 0 : schedule.COMPUTE_CONTRACT);
}

function computeCommitments(proofs: readonly ComputeProof[]) {
  return Object.freeze(proofs.map((proof) => Object.freeze({ purpose: proof.purpose,
    provider: proof.provider, model: proof.model, proofClass: proof.proofClass,
    processResponseVerified: proof.processResponseVerified, receiptDigest: proof.receiptDigest,
    requestDigest: proof.requestDigest, responseDigest: proof.responseDigest,
    signedTextSha256: proof.signedTextSha256, requestSha256: proof.requestSha256,
    rawResponseSha256: proof.rawResponseSha256, responseHeadersSha256: proof.responseHeadersSha256 })));
}
function storageArtifactHash(storage: StorageCommitment): Bytes32 {
  return keccak256(toUtf8Bytes(canonicalizeStorageCommitment(storage))) as Bytes32;
}
function journalOperation(journal: OperationJournal | undefined, operation: OperationRecord | undefined,
  phase: "compute" | "storage" | "chain", value: unknown): void {
  if (!journal || !operation) return;
  if (phase === "compute") journal.recordCompute(operation.recoveryId, value as Parameters<OperationJournal["recordCompute"]>[1]);
  else if (phase === "storage") journal.recordStorage(operation.recoveryId, value as Parameters<OperationJournal["recordStorage"]>[1]);
  else journal.recordChainInput(operation.recoveryId, value as RunnerChainInput);
}
function applyChainProgress(journal: OperationJournal | undefined, operation: OperationRecord | undefined,
  progress: ChainWriteProgress, state: { attempted: boolean; finalized: boolean; reverted: boolean; transactionHash?: Bytes32 }): void {
  if (progress.phase === "SUBMISSION_ATTEMPTED") { if (journal && operation) journal.recordSubmissionAttempt(operation.recoveryId); state.attempted = true; }
  else if (progress.phase === "HASH_KNOWN") { state.transactionHash = progress.transactionHash;
    if (journal && operation) journal.recordTransactionHash(operation.recoveryId, progress.transactionHash); }
  else if (progress.phase === "FINALIZED") { state.finalized = true; state.transactionHash = progress.transactionHash;
    if (journal && operation) journal.recordFinalized(operation.recoveryId, progress); }
  else if (progress.phase === "REVERTED") { state.reverted = true; state.transactionHash = progress.transactionHash; }
}

function costController(journal: OperationJournal | undefined, operation: OperationRecord | undefined,
  configured?: Readonly<Record<PaidStage, number>>): PaidCostController {
  const schedule = configured ?? { COMPUTE_BEHAVIORAL: 1, COMPUTE_CONTRACT: 1, STORAGE: 1, REGISTRY: 1 };
  return Object.freeze({ reserve: (stage: PaidStage) => { if (journal && operation) journal.reserveCost(operation.recoveryId, stage, schedule[stage]); },
    reconcile: (stage: PaidStage, disposition: "CONSUMED" | "RELEASED") => {
      if (journal && operation) journal.reconcileCost(operation.recoveryId, stage, disposition);
    } });
}

function safeProgress(report: ((progress: RunnerProgress) => void) | undefined, progress: RunnerProgress): void {
  try { report?.(progress); } catch { /* client status reporting is observational */ }
}
function writeOutcome(operation: OperationRecord, chainInput: RunnerChainInput | undefined,
  chain: ChainWriteResult | undefined, state: { attempted: boolean; finalized: boolean; reverted: boolean; transactionHash?: Bytes32 }): PublicWriteOutcome {
  const transactionHash = chain?.transactionHash ?? state.transactionHash;
  if (state.reverted && transactionHash) return Object.freeze({ status: "REVERTED", recoveryId: operation.recoveryId, transactionHash });
  if ((chain || state.finalized) && transactionHash && chainInput) return Object.freeze({
    status: "FINALIZED_READBACK_UNAVAILABLE", recoveryId: operation.recoveryId, transactionHash,
    identityKey: chainInput.identityKey, version: (chain?.expectedVersion
      ?? (chainInput.mode === "SEAL" ? 1n : chainInput.expectedPriorVersion! + 1n)).toString(),
  });
  if (state.attempted) return Object.freeze({ status: "SUBMISSION_OUTCOME_UNKNOWN",
    recoveryId: operation.recoveryId, ...(transactionHash ? { transactionHash } : {}) });
  return Object.freeze({ status: "NOT_BROADCAST", recoveryId: operation.recoveryId });
}
function sealedOutcome(operation: OperationRecord, input: RunnerChainInput, chain: ChainWriteResult): PublicWriteOutcome {
  return Object.freeze({ status: "SEALED", recoveryId: operation.recoveryId, transactionHash: chain.transactionHash,
    identityKey: input.identityKey, version: chain.expectedVersion.toString() });
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
  if (chain.expectedVersion !== expectedVersion || chain.signer.toLowerCase() !== input.scanner.toLowerCase() || mismatch
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

function executor(report?: (stage: RunnerStage) => void, signal?: AbortSignal) {
  return async <T>(stage: RunnerStage, operation: () => Promise<T>): Promise<T> => {
    try {
      signal?.throwIfAborted();
      safeReport(report, stage);
      const result = await operation();
      signal?.throwIfAborted();
      return result;
    }
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
    if (!input) throw new Error();
    const snapshot = { ...input, identity: Object.freeze({ ...input.identity }) };
    if (!Number.isSafeInteger(snapshot.policyVersion) || snapshot.policyVersion < 1 || snapshot.policyVersion > 4_294_967_295) throw new Error();
    if (snapshot.validForSeconds !== 7 * 86400) throw new Error();
    if (!/^0x[0-9a-fA-F]{40}$/.test(snapshot.registryAddress) || /^0x0{40}$/i.test(snapshot.registryAddress)) throw new Error();
    if (!/^0x[0-9a-fA-F]{40}$/.test(snapshot.scanner) || /^0x0{40}$/i.test(snapshot.scanner)) throw new Error();
    if (!snapshot.scannerSoftwareVersion.trim() || snapshot.scannerSoftwareVersion.length > 128) throw new Error();
    if (snapshot.mode === "RESEAL" && (typeof snapshot.expectedPriorVersion !== "bigint"
      || snapshot.expectedPriorVersion < 1n || snapshot.expectedPriorVersion >= 1n << 64n)) throw new Error();
    if (snapshot.mode === "RESEAL" && (!snapshot.previousProofId || !/^0x[0-9a-fA-F]{64}$/.test(snapshot.previousProofId) || /^0x0{64}$/i.test(snapshot.previousProofId))) throw new Error();
    if (snapshot.mode === "SEAL" && (snapshot.expectedPriorVersion !== undefined || snapshot.previousProofId !== undefined)) throw new Error();
    if (snapshot.mode !== "SEAL" && snapshot.mode !== "RESEAL") throw new Error();
    return Object.freeze({ ...snapshot,
      registryAddress: snapshot.registryAddress.toLowerCase() as HexAddress,
      scanner: snapshot.scanner.toLowerCase() as HexAddress,
      ...(snapshot.previousProofId ? { previousProofId: snapshot.previousProofId.toLowerCase() as Bytes32 } : {}),
    });
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

function assertCompute(
  subject: ClassifiedSubject,
  deterministic: DeterministicStageResult,
  result: ComputeStageResult,
): void {
  const score = result.behavioralScore;
  const expectedLabel = score < 30 ? "SAFE" : score < 60 ? "CAUTION" : "FLAGGED";
  if (!Number.isSafeInteger(score) || score < 0 || score > 100
    || result.verdict.riskScore !== score || result.verdict.label !== expectedLabel
    || !Number.isSafeInteger(result.codeRisk) || result.codeRisk < 0 || result.codeRisk > 2
    || result.codeRisk < deterministic.codeRisk || result.verdict.codeRisk !== result.codeRisk
    || (subject.kind === "EOA" && result.codeRisk !== 0)) {
    throw new ProofLockStageError("RUNNING_COMPUTE", "Compute verdict violates the fixed risk policy");
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
    registryAddress: context.input.registryAddress.toLowerCase() as HexAddress,
    scanner: context.input.scanner.toLowerCase() as HexAddress, mode: context.input.mode,
    expectedPriorVersion: context.input.expectedPriorVersion, previousProofId: context.input.previousProofId,
    identityKey: computeIdentityKey(context.identity.identity), subject: context.subject.address,
    envelopeDigest: canonical.envelopeDigest, storageRoot: storage.storageRoot,
    computeRoot: context.computeRoot, artifactHash, runtimeCodeHash: context.subject.runtimeCodeHash,
    validForSeconds: context.input.validForSeconds, policyVersion: context.input.policyVersion,
    behavioralScore: context.compute.behavioralScore,
    codeRisk: context.compute.codeRisk, coverage: 0x7f,
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
