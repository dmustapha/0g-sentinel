import { lstatSync, mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { Interface, JsonRpcProvider, Wallet, getAddress, isAddress,
  keccak256, toUtf8Bytes, ZeroAddress } from "ethers";
import { canonicalize } from "json-canonicalize";
import { z } from "zod";

import { canonicalizeEvidence } from "./canonical";
import { createEthersRegistryChainAdapter, computeIdentityKey, readProofLockBack,
  writeProofLock, type RegistryChainAdapter } from "./chain";
import { runSubjectChecks, toEvidenceSubject, type SubjectCheckReport } from "./checks";
import { createProductionStrictComputeDependencies, runStrictCompute } from "./compute/strict-broker";
import { buildDriftFingerprint, type DriftFingerprint } from "./drift";
import { createErc8004Adapter, resolveAgentIdentity } from "./identity/erc8004";
import { createProductionReadDependencies } from "./read-api";
import type { DeterministicStageResult, ProofLockRunnerDependencies, RunnerContext } from "./runner";
import { createEthersFinalityAdapter, createFileUploadJournal, createZeroGStorageAdapter,
  persistVerifiedEvidence } from "./storage";
import { classifySubject, type ClassifiedSubject, type SubjectChainAdapter } from "./subject/classify";
import { ERC8004_IDENTITY_REGISTRY, type AgentIdentity, type Bytes32,
  type EvidenceEnvelopeV1, type HexAddress, type ResolvedAgentIdentity } from "./types";

const MAINNET_RPC = "https://evmrpc.0g.ai";
const MAINNET_INDEXER = "https://indexer-storage-turbo.0g.ai";
const MAINNET_FLOW = "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526";
const ROLE_INTERFACE = new Interface([
  "function SCANNER_ROLE() view returns (bytes32)",
  "function GUARDIAN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
]);
const scoreSchema = z.object({ riskScore: z.number().int().min(0).max(100) }).passthrough();
type Environment = Record<string, string | undefined>;

export type ProductionOperatorConfig = Readonly<{
  rpcUrl: string; storageIndexer: string; flowAddress: HexAddress; registryAddress: HexAddress;
  scannerAddress: HexAddress; guardianAddress: HexAddress; scannerPrivateKey: string;
  guardianPrivateKey: string; scannerSoftwareVersion: string; policyVersion: number;
  computeProvider: HexAddress; computeModel: string; stateDirectory: string;
  spendAuthorized: true; confirmations: number; timeoutMs: number;
}>;

export type ProductionOperatorBinding = Readonly<{
  registryAddress: HexAddress; scanner: HexAddress; scannerSoftwareVersion: string;
  policyVersion: number; validForSeconds: 604800;
}>;

type Composition = Readonly<{
  runner: ProofLockRunnerDependencies;
  drift: Readonly<{
    chainAdapter: RegistryChainAdapter; registryAddress: HexAddress; confirmations: number; timeoutMs: number;
    readSealedSnapshot(identityKey: Bytes32): Promise<Readonly<{ identityKey: Bytes32; version: bigint; fingerprint: DriftFingerprint }>>;
    resolveCurrentFingerprint(identityKey: Bytes32): Promise<DriftFingerprint>;
  }>;
}>;

let compositionPromise: Promise<Composition> | undefined;

export function readProductionOperatorConfig(
  env: Environment = process.env,
  nodeVersion = process.versions.node,
): ProductionOperatorConfig {
  requireNode24(nodeVersion);
  const scannerPrivateKey = required(env, "SENTINEL_0G_PRIVATE_KEY");
  const guardianPrivateKey = required(env, "PROOFLOCK_GUARDIAN_PRIVATE_KEY");
  const scannerAddress = address(env, "PROOFLOCK_SCANNER_ADDRESS");
  const guardianAddress = address(env, "PROOFLOCK_GUARDIAN_ADDRESS");
  bindKey(scannerPrivateKey, scannerAddress, "scanner signing key");
  bindKey(guardianPrivateKey, guardianAddress, "guardian signing key");
  if (scannerAddress.toLowerCase() === guardianAddress.toLowerCase()) {
    throw new Error("ProofLock scanner and guardian signing keys must remain distinct");
  }
  return Object.freeze({
    rpcUrl: exactUrl(env, "ZERO_G_RPC", MAINNET_RPC, "mainnet RPC"),
    storageIndexer: exactUrl(env, "ZERO_G_STORAGE_INDEXER", MAINNET_INDEXER, "mainnet Storage indexer"),
    flowAddress: exactAddress(env, "PROOFLOCK_STORAGE_FLOW_ADDRESS", MAINNET_FLOW),
    registryAddress: address(env, "PROOFLOCK_REGISTRY_V2_ADDRESS"),
    scannerAddress, guardianAddress, scannerPrivateKey, guardianPrivateKey,
    scannerSoftwareVersion: boundedText(env, "PROOFLOCK_SCANNER_SOFTWARE_VERSION", 128),
    policyVersion: integer(env, "PROOFLOCK_POLICY_VERSION", 1, 4_294_967_295),
    computeProvider: address(env, "PROOFLOCK_COMPUTE_PROVIDER"),
    computeModel: boundedText(env, "PROOFLOCK_COMPUTE_MODEL", 256),
    stateDirectory: durableDirectory(env),
    spendAuthorized: spendConsent(env),
    confirmations: integer(env, "PROOFLOCK_CHAIN_CONFIRMATIONS", 3, 64),
    timeoutMs: integer(env, "PROOFLOCK_TRANSACTION_TIMEOUT_MS", 1, 120_000),
  });
}

export function readProductionOperatorBinding(env: Environment = process.env): ProductionOperatorBinding {
  const config = readProductionOperatorConfig(env);
  return Object.freeze({ registryAddress: config.registryAddress, scanner: config.scannerAddress,
    scannerSoftwareVersion: config.scannerSoftwareVersion, policyVersion: config.policyVersion,
    validForSeconds: 604800 });
}

export async function createProofLockDependencies(): Promise<ProofLockRunnerDependencies> {
  return (await productionComposition()).runner;
}

export async function createProofLockDriftOperator(): Promise<Composition["drift"]> {
  return (await productionComposition()).drift;
}

async function productionComposition(): Promise<Composition> {
  compositionPromise ??= compose(readProductionOperatorConfig());
  return compositionPromise;
}

async function compose(config: ProductionOperatorConfig): Promise<Composition> {
  const provider = new JsonRpcProvider(config.rpcUrl, 16661, { staticNetwork: true });
  await requireMainnet(provider);
  const scanner = new Wallet(config.scannerPrivateKey, provider);
  const guardian = new Wallet(config.guardianPrivateKey, provider);
  await Promise.all([
    requireRole(provider, config.registryAddress, "SCANNER_ROLE", config.scannerAddress),
    requireRole(provider, config.registryAddress, "GUARDIAN_ROLE", config.guardianAddress),
  ]);
  const subjectAdapter = subjectChainAdapter(provider);
  const scannerChain = createEthersRegistryChainAdapter(provider, scanner, config.registryAddress);
  const guardianChain = createEthersRegistryChainAdapter(provider, guardian, config.registryAddress);
  const state = createState(config, provider, scanner);
  const snapshots = new Map<Bytes32, EvidenceEnvelopeV1>();
  return Object.freeze({
    runner: runnerDependencies(config, provider, subjectAdapter, scannerChain, state),
    drift: driftDependencies(config, provider, subjectAdapter, guardianChain, state.reads, snapshots),
  });
}

function createState(config: ProductionOperatorConfig, provider: JsonRpcProvider, scanner: Wallet) {
  const compute = createProductionStrictComputeDependencies({ privateKey: config.scannerPrivateKey,
    rpcUrl: config.rpcUrl, stateDirectory: join(config.stateDirectory, "compute") });
  const storage = createZeroGStorageAdapter({ indexerRpc: config.storageIndexer,
    chainRpc: config.rpcUrl, expectedFlowAddress: config.flowAddress, signer: scanner });
  return Object.freeze({
    compute,
    storage: Object.freeze({ storage, chain: createEthersFinalityAdapter(provider),
      journal: createFileUploadJournal(join(config.stateDirectory, "storage-journal")) }),
    reads: createProductionReadDependencies(process.env),
  });
}

function runnerDependencies(
  config: ProductionOperatorConfig,
  provider: JsonRpcProvider,
  subjectAdapter: SubjectChainAdapter,
  chain: RegistryChainAdapter,
  state: ReturnType<typeof createState>,
): ProofLockRunnerDependencies {
  return Object.freeze({
    validateIdentity: (identity) => resolveAgentIdentity(identity,
      { adapter: createErc8004Adapter(provider), finalityConfirmations: config.confirmations }),
    classifySubject: (identity) => classifyResolved(subjectAdapter, identity),
    runDeterministicChecks: (_identity, subject) => deterministicResult(subjectAdapter, subject),
    runCompute: (identity, subject, deterministic) => computeResult(config, state.compute,
      identity, subject, deterministic),
    buildEvidenceEnvelope: (context) => Promise.resolve(evidenceEnvelope(context)),
    uploadStorage: (canonical) => persistVerifiedEvidence(canonical, state.storage,
      { confirmations: config.confirmations, receiptTimeoutMs: config.timeoutMs,
        expectedFlowAddress: config.flowAddress }),
    verifyStorage: (upload) => Promise.resolve(upload as Awaited<ReturnType<typeof persistVerifiedEvidence>>),
    writeChain: (input) => writeProofLock(chain, input,
      { confirmations: config.confirmations, timeoutMs: config.timeoutMs }),
    readChainBack: (input, write) => readProofLockBack(chain, input, write),
  });
}

function driftDependencies(
  config: ProductionOperatorConfig,
  provider: JsonRpcProvider,
  subjectAdapter: SubjectChainAdapter,
  chainAdapter: RegistryChainAdapter,
  reads: ReturnType<typeof createProductionReadDependencies>,
  snapshots: Map<Bytes32, EvidenceEnvelopeV1>,
): Composition["drift"] {
  return Object.freeze({
    chainAdapter, registryAddress: config.registryAddress,
    confirmations: config.confirmations, timeoutMs: config.timeoutMs,
    readSealedSnapshot: async (identityKey) => {
      const record = await chainAdapter.getProofLock(identityKey);
      const verified = await reads.verifyStoredEvidence(record, new AbortController().signal);
      const envelope = parseEnvelope(verified.envelope, identityKey);
      snapshots.set(identityKey, envelope);
      return Object.freeze({ identityKey, version: record.version, fingerprint: envelopeFingerprint(envelope) });
    },
    resolveCurrentFingerprint: async (identityKey) => {
      const envelope = snapshots.get(identityKey) ?? await recoverEnvelope(identityKey, chainAdapter, reads);
      snapshots.delete(identityKey);
      const identity = await resolveAgentIdentity(envelope.identity,
        { adapter: createErc8004Adapter(provider), finalityConfirmations: config.confirmations });
      const subject = await classifyResolved(subjectAdapter, identity);
      const report = await runSubjectChecks(subjectAdapter, subject, sourceBlock(subject));
      return resolvedFingerprint(identity, toEvidenceSubject(subject, report), config.policyVersion);
    },
  });
}

async function recoverEnvelope(
  identityKey: Bytes32,
  chain: RegistryChainAdapter,
  reads: ReturnType<typeof createProductionReadDependencies>,
): Promise<EvidenceEnvelopeV1> {
  const record = await chain.getProofLock(identityKey);
  const verified = await reads.verifyStoredEvidence(record, new AbortController().signal);
  return parseEnvelope(verified.envelope, identityKey);
}

async function classifyResolved(
  adapter: SubjectChainAdapter,
  identity: ResolvedAgentIdentity,
): Promise<ClassifiedSubject> {
  return classifySubject(adapter, identity.agentWallet, {
    number: BigInt(identity.sourceBlockNumber), hash: identity.sourceBlockHash,
  });
}

async function deterministicResult(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
): Promise<DeterministicStageResult> {
  const report = await runSubjectChecks(adapter, subject, sourceBlock(subject));
  const findings = reportFindings(report);
  return Object.freeze({
    checks: [Object.freeze({ id: checkId(report), version: "1", status: report.status,
      inputDigest: digest({ address: subject.address, runtimeCodeHash: subject.runtimeCodeHash,
        block: sourceBlock(subject) }), outputDigest: digest(report), findings })],
    report, evidenceSubject: toEvidenceSubject(subject, report),
    codeRisk: report.status === "FAIL" ? 2 : report.status === "WARN" ? 1 : 0,
    omissions: subject.kind === "EOA" ? ["Contract code analysis is not applicable to an EOA."] : [],
  });
}

async function computeResult(
  config: ProductionOperatorConfig,
  dependencies: ReturnType<typeof createProductionStrictComputeDependencies>,
  identity: ResolvedAgentIdentity,
  subject: ClassifiedSubject,
  deterministic: DeterministicStageResult,
) {
  const context = canonicalize({ identity: identity.identity, subject: deterministic.evidenceSubject,
    deterministicChecks: deterministic.checks });
  if (typeof context !== "string") throw new Error("Compute context could not be canonicalized");
  const behavioral = await runStrictCompute(computeInput(config, "behavioral-risk", context), dependencies);
  const score = parseRiskScore(behavioral.content);
  const proofs = [behavioral.proof];
  if (subject.kind !== "EOA") {
    const code = await runStrictCompute(computeInput(config, "contract-risk", context), dependencies);
    proofs.push(code.proof);
  }
  const label = score < 30 ? "SAFE" as const : score < 60 ? "CAUTION" as const : "FLAGGED" as const;
  return Object.freeze({ proofs: Object.freeze(proofs), behavioralScore: score,
    verdict: Object.freeze({ riskScore: score, label }) });
}

function computeInput(
  config: ProductionOperatorConfig,
  purpose: "behavioral-risk" | "contract-risk",
  context: string,
) {
  const systemPrompt = purpose === "behavioral-risk"
    ? "Return strict JSON with integer riskScore 0-100 for policy-scoped onchain behavioral admission."
    : "Return strict JSON with integer riskScore 0-100 for the supplied deterministic contract evidence.";
  return Object.freeze({ chainId: 16661 as const, purpose, provider: config.computeProvider,
    model: config.computeModel, systemPrompt, userMessage: context,
    spendAuthorized: config.spendAuthorized, timeoutMs: config.timeoutMs });
}

function evidenceEnvelope(context: RunnerContext): EvidenceEnvelopeV1 {
  const executable = context.subject.kind !== "EOA";
  return Object.freeze({
    schema: "sentinel.prooflock/evidence-v1", proofClass: "COMPUTE_VERIFIED",
    schemaVersion: 1, policyVersion: context.input.policyVersion,
    coverage: Object.freeze({ preStorageMask: 0x5f, requiredSealMask: 0x7f,
      identityValidated: true, subjectClassified: true, deterministicChecksRun: true,
      behavioralComputeVerified: true,
      codeCompute: executable ? Object.freeze({ status: "VERIFIED" as const })
        : Object.freeze({ status: "NOT_APPLICABLE" as const, reason: "EOA has no runtime bytecode." }),
      evidenceStorage: "PENDING_EXTERNAL_COMMITMENT", policyEvaluated: true }),
    identity: Object.freeze({ ...context.identity.identity, owner: context.identity.owner,
      agentWallet: context.identity.agentWallet, registrationUri: context.identity.agentURI,
      registrationDigest: context.identity.registrationDigest }),
    source: Object.freeze({ blockNumber: context.identity.sourceBlockNumber,
      blockHash: context.identity.sourceBlockHash }),
    subject: context.deterministic.evidenceSubject,
    deterministicChecks: Object.freeze([...context.deterministic.checks]),
    computeProofs: Object.freeze([...context.compute.proofs]), verdict: context.compute.verdict,
    omissions: Object.freeze([...context.deterministic.omissions]),
    scanner: Object.freeze({ address: context.input.scanner,
      softwareVersion: context.input.scannerSoftwareVersion }),
    ...(context.input.previousProofId ? { previousProofId: context.input.previousProofId } : {}),
  });
}

function parseEnvelope(value: unknown, identityKey: Bytes32): EvidenceEnvelopeV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored evidence is invalid");
  const envelope = value as EvidenceEnvelopeV1;
  if (envelope.schema !== "sentinel.prooflock/evidence-v1"
    || computeIdentityKey(envelope.identity) !== identityKey
    || digestCanonicalEnvelope(envelope) === `0x${"00".repeat(32)}`) {
    throw new Error("Stored evidence identity binding is invalid");
  }
  return envelope;
}

function digestCanonicalEnvelope(envelope: EvidenceEnvelopeV1): Bytes32 {
  return keccak256(new TextEncoder().encode(canonicalizeEvidence(envelope))) as Bytes32;
}

function envelopeFingerprint(envelope: EvidenceEnvelopeV1): DriftFingerprint {
  return resolvedFingerprint({ owner: envelope.identity.owner, agentWallet: envelope.identity.agentWallet,
    registrationDigest: envelope.identity.registrationDigest } as ResolvedAgentIdentity,
  envelope.subject, envelope.policyVersion);
}

function resolvedFingerprint(
  identity: Pick<ResolvedAgentIdentity, "owner" | "agentWallet" | "registrationDigest">,
  subject: EvidenceEnvelopeV1["subject"],
  policyVersion: number,
): DriftFingerprint {
  return buildDriftFingerprint({ owner: identity.owner, agentWallet: identity.agentWallet,
    registrationDigest: identity.registrationDigest, subjectKind: subject.kind,
    runtimeCodeHash: subject.runtimeCodeHash,
    ...(subject.delegationTarget ? { delegationTarget: subject.delegationTarget,
      delegationCodeHash: subject.delegationCodeHash! } : {}),
    ...(subject.proxyImplementation ? { proxyImplementation: subject.proxyImplementation,
      proxyImplementationCodeHash: subject.proxyImplementationCodeHash! } : {}),
    policyVersion });
}

function subjectChainAdapter(provider: JsonRpcProvider): SubjectChainAdapter {
  const adapter: SubjectChainAdapter = {
    getBlock: async (number) => {
      const block = await provider.getBlock(Number(number));
      return block?.hash ? { number: BigInt(block.number), hash: block.hash } : null;
    },
    getCode: (address, blockTag) => provider.getCode(address, Number(blockTag)),
    getStorage: (address, slot, blockTag) => provider.getStorage(address, slot, Number(blockTag)),
    call: (transaction, blockTag) => provider.call({ ...transaction, blockTag: Number(blockTag) }),
    getTransactionCount: async (address, blockTag) => BigInt(await provider.getTransactionCount(address, Number(blockTag))),
    getBalance: (address, blockTag) => provider.getBalance(address, Number(blockTag)),
  };
  return Object.freeze(adapter);
}

async function requireMainnet(provider: JsonRpcProvider): Promise<void> {
  if ((await provider.getNetwork()).chainId !== 16661n) throw new Error("Production operator requires 0G mainnet chain 16661");
  const code = await provider.getCode(ERC8004_IDENTITY_REGISTRY);
  if (code === "0x") throw new Error("Canonical ERC-8004 Identity Registry is unavailable");
}

async function requireRole(
  provider: JsonRpcProvider,
  registry: HexAddress,
  roleMethod: "SCANNER_ROLE" | "GUARDIAN_ROLE",
  account: HexAddress,
): Promise<void> {
  if (await provider.getCode(registry) === "0x") throw new Error("ProofLock RegistryV2 is unavailable");
  const roleRaw = await provider.call({ to: registry, data: ROLE_INTERFACE.encodeFunctionData(roleMethod) });
  const role = ROLE_INTERFACE.decodeFunctionResult(roleMethod, roleRaw)[0];
  const hasRaw = await provider.call({ to: registry, data: ROLE_INTERFACE.encodeFunctionData("hasRole", [role, account]) });
  if (ROLE_INTERFACE.decodeFunctionResult("hasRole", hasRaw)[0] !== true) {
    throw new Error(`${roleMethod} signer is not authorized by RegistryV2`);
  }
}

function sourceBlock(subject: ClassifiedSubject) {
  return { sourceBlock: { number: BigInt(subject.sourceBlockNumber), hash: subject.sourceBlockHash } };
}

function reportFindings(report: SubjectCheckReport): readonly string[] {
  const value = report as unknown as Record<string, unknown>;
  return Object.freeze(["findings", "deterministicFindings", "informationalFindings"]
    .flatMap((key) => Array.isArray(value[key]) ? value[key] as string[] : []));
}

function checkId(report: SubjectCheckReport): string {
  if (report.kind === "EOA_SNAPSHOT") return "eoa-snapshot";
  if (report.kind === "CONTRACT_ANALYSIS") return "contract-analysis";
  return "delegated-eoa-analysis";
}

function digest(value: unknown): Bytes32 {
  const serialized = canonicalize(value);
  if (typeof serialized !== "string") throw new Error("Deterministic evidence could not be canonicalized");
  return keccak256(toUtf8Bytes(serialized)) as Bytes32;
}

function parseRiskScore(content: string): number {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("0G Compute returned non-JSON risk output"); }
  return scoreSchema.parse(value).riskScore;
}

function requireNode24(version: string): void {
  const major = Number(version.split(".")[0]);
  if (!Number.isSafeInteger(major) || major < 24) throw new Error("Production ProofLock requires Node 24 or newer");
}

function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function address(env: Environment, name: string): HexAddress {
  const value = required(env, name);
  if (!isAddress(value) || getAddress(value) === ZeroAddress) throw new Error(`${name} must be a nonzero address`);
  return getAddress(value) as HexAddress;
}

function exactAddress(env: Environment, name: string, expected: string): HexAddress {
  const value = address(env, name);
  if (value !== getAddress(expected)) throw new Error(`${name} must be the canonical 0G mainnet contract`);
  return value;
}

function exactUrl(env: Environment, name: string, expected: string, label: string): string {
  const value = required(env, name);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be the canonical ${label}`); }
  if (parsed.href !== `${expected}/` || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must be the canonical ${label}`);
  }
  return expected;
}

function boundedText(env: Environment, name: string, maximum: number): string {
  const value = required(env, name);
  if (value.length > maximum) throw new Error(`${name} is too long`);
  return value;
}

function integer(env: Environment, name: string, minimum: number, maximum: number): number {
  const value = required(env, name);
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function spendConsent(env: Environment): true {
  if (required(env, "PROOFLOCK_SPEND_AUTHORIZED") !== "true") {
    throw new Error("PROOFLOCK_SPEND_AUTHORIZED must be explicitly true");
  }
  return true;
}

function durableDirectory(env: Environment): string {
  const directory = required(env, "PROOFLOCK_STATE_DIRECTORY");
  if (!isAbsolute(directory)) throw new Error("PROOFLOCK_STATE_DIRECTORY must be absolute");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("PROOFLOCK_STATE_DIRECTORY is invalid");
  return directory;
}

function bindKey(privateKey: string, expected: HexAddress, label: string): void {
  let actual: string;
  try { actual = new Wallet(privateKey).address; } catch { throw new Error(`${label} is invalid`); }
  if (actual !== expected) throw new Error(`${label} does not match configured address`);
}
