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
import { collectRiskBundle, createProductionRiskBundleDeps, combineBehavioralScore, combineCodeRisk, bundleForLlm } from "./analysis/risk-bundle";
import type { RiskEvidenceBundle } from "./analysis/types";
import { createProductionStrictComputeDependencies, runStrictCompute } from "./compute/strict-broker";
import { buildDriftFingerprint, type DriftFingerprint } from "./drift";
import { createErc8004Adapter, resolveAgentIdentity } from "./identity/erc8004";
import { createProductionReadDependencies } from "./read-api";
import { createSqliteOperationJournal, type OperationJournalLimits } from "./operation-journal";
import { createWriteRecoveryService } from "./recovery";
import type { DeterministicStageResult, PaidCostController, ProofLockRunnerDependencies, RunnerContext } from "./runner";
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
// Behavioral risk-score bands (must match the label policy re-derived in runner.ts assertCompute):
// [0,30) SAFE, [30,60) CAUTION, [60,100] FLAGGED. Also the uncertainty floor for a degraded seal.
const CAUTION_SCORE_THRESHOLD = 30;
const FLAGGED_SCORE_THRESHOLD = 60;

// A SAFE verdict requires complete behavioral evidence. When the deep-risk explorer coverage is
// incomplete, the transaction history is partial, so a clean-looking score carries irreducible
// uncertainty: floor it at the CAUTION threshold so a degraded seal can never present as fully
// cleared. Flooring the score (not the label) preserves the score<->label policy invariant that
// runner.ts assertCompute re-checks.
export function floorScoreForCoverage(combinedScore: number, behavioralCoverageComplete: boolean): number {
  return behavioralCoverageComplete ? combinedScore : Math.max(combinedScore, CAUTION_SCORE_THRESHOLD);
}
type Environment = Record<string, string | undefined>;

export type ProductionOperatorConfig = Readonly<{
  rpcUrl: string; storageIndexer: string; flowAddress: HexAddress; registryAddress: HexAddress;
  adminAddress: HexAddress; scannerAddress: HexAddress; guardianAddress: HexAddress; computeAddress: HexAddress;
  scannerPrivateKey: string;
  guardianPrivateKey: string; computePrivateKey: string; scannerSoftwareVersion: string; policyVersion: number;
  computeProvider: HexAddress; computeModel: string; stateDirectory: string;
  spendAuthorized: true; confirmations: number; timeoutMs: number; recoveryLivenessGraceMs: number;
  operationLimits: OperationJournalLimits;
}>;

export type ProductionOperatorBinding = Readonly<{
  registryAddress: HexAddress; scanner: HexAddress; scannerSoftwareVersion: string;
  policyVersion: number; validForSeconds: 604800;
}>;

type Composition = Readonly<{
  runner: ProofLockRunnerDependencies;
  recovery: ReturnType<typeof createWriteRecoveryService>;
  drift: Readonly<{
    chainAdapter: RegistryChainAdapter; registryAddress: HexAddress; confirmations: number; timeoutMs: number;
    verifyAuthority(): Promise<void>;
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
  const computePrivateKey = required(env, "PROOFLOCK_COMPUTE_PRIVATE_KEY");
  const scannerAddress = address(env, "PROOFLOCK_SCANNER_ADDRESS");
  const guardianAddress = address(env, "PROOFLOCK_GUARDIAN_ADDRESS");
  const adminAddress = address(env, "PROOFLOCK_ADMIN_ADDRESS");
  bindKey(scannerPrivateKey, scannerAddress, "scanner signing key");
  bindKey(guardianPrivateKey, guardianAddress, "guardian signing key");
  const computeAddress = keyAddress(computePrivateKey, "Compute payer signing key") as HexAddress;
  if (new Set([adminAddress, scannerAddress, guardianAddress].map((value) => value.toLowerCase())).size !== 3) {
    throw new Error("ProofLock admin, scanner, and guardian custody must remain distinct");
  }
  if ([adminAddress, scannerAddress, guardianAddress]
    .some((address) => address.toLowerCase() === computeAddress.toLowerCase())) {
    throw new Error("ProofLock Compute payer key must remain distinct from Registry role keys");
  }
  return Object.freeze({
    rpcUrl: exactUrl(env, "ZERO_G_RPC", MAINNET_RPC, "mainnet RPC"),
    storageIndexer: exactUrl(env, "ZERO_G_STORAGE_INDEXER", MAINNET_INDEXER, "mainnet Storage indexer"),
    flowAddress: exactAddress(env, "PROOFLOCK_STORAGE_FLOW_ADDRESS", MAINNET_FLOW),
    registryAddress: address(env, "PROOFLOCK_REGISTRY_V2_ADDRESS"),
    adminAddress, scannerAddress, guardianAddress, computeAddress,
    scannerPrivateKey, guardianPrivateKey, computePrivateKey,
    scannerSoftwareVersion: boundedText(env, "PROOFLOCK_SCANNER_SOFTWARE_VERSION", 128),
    policyVersion: integer(env, "PROOFLOCK_POLICY_VERSION", 1, 4_294_967_295),
    computeProvider: address(env, "PROOFLOCK_COMPUTE_PROVIDER"),
    computeModel: boundedText(env, "PROOFLOCK_COMPUTE_MODEL", 256),
    stateDirectory: durableDirectory(env),
    spendAuthorized: spendConsent(env),
    confirmations: integer(env, "PROOFLOCK_CHAIN_CONFIRMATIONS", 3, 64),
    timeoutMs: integer(env, "PROOFLOCK_TRANSACTION_TIMEOUT_MS", 1, 120_000),
    recoveryLivenessGraceMs: integer(env, "PROOFLOCK_RECOVERY_LIVENESS_GRACE_MS", 60_000, 3_600_000),
    operationLimits: Object.freeze({
      maxConcurrency: integer(env, "PROOFLOCK_OPERATOR_MAX_CONCURRENCY", 1, 1_000),
      globalMaxConcurrency: integer(env, "PROOFLOCK_OPERATOR_MAX_CONCURRENCY", 1, 1_000),
      rateWindowMs: integer(env, "PROOFLOCK_OPERATOR_RATE_WINDOW_MS", 1, 86_400_000),
      rateLimit: integer(env, "PROOFLOCK_OPERATOR_RATE_LIMIT", 1, 1_000_000),
      dailyCeremonyLimit: integer(env, "PROOFLOCK_OPERATOR_DAILY_CEREMONY_LIMIT", 1, 1_000_000),
      dailyCostUnitsLimit: integer(env, "PROOFLOCK_OPERATOR_DAILY_COST_UNITS_LIMIT", 1, 1_000_000_000),
    }),
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

export async function createProofLockRecoveryOperator(): Promise<Composition["recovery"]> {
  return (await productionComposition()).recovery;
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
  await requireCustody(provider, config);
  const subjectAdapter = subjectChainAdapter(provider);
  const scannerChain = createEthersRegistryChainAdapter(provider, scanner, config.registryAddress);
  const guardianChain = createEthersRegistryChainAdapter(provider, guardian, config.registryAddress);
  const state = createState(config, provider, scanner);
  const snapshots = new Map<Bytes32, EvidenceEnvelopeV1>();
  return Object.freeze({
    runner: runnerDependencies(config, provider, subjectAdapter, scannerChain, state),
    recovery: createWriteRecoveryService({ journal: state.operations, chain: scannerChain,
      confirmations: config.confirmations, timeoutMs: config.timeoutMs, livenessGraceMs: config.recoveryLivenessGraceMs }),
    drift: driftDependencies(config, provider, subjectAdapter, guardianChain, state.reads, snapshots),
  });
}

function createState(config: ProductionOperatorConfig, provider: JsonRpcProvider, scanner: Wallet) {
  const compute = createProductionStrictComputeDependencies({ privateKey: config.computePrivateKey,
    rpcUrl: config.rpcUrl, stateDirectory: join(config.stateDirectory, "compute") });
  const storage = createZeroGStorageAdapter({ indexerRpc: config.storageIndexer,
    chainRpc: config.rpcUrl, expectedFlowAddress: config.flowAddress, signer: scanner });
  return Object.freeze({
    compute,
    storage: Object.freeze({ storage, chain: createEthersFinalityAdapter(provider),
      journal: createFileUploadJournal(join(config.stateDirectory, "storage-journal")) }),
    reads: createProductionReadDependencies(process.env),
    operations: createSqliteOperationJournal({ directory: join(config.stateDirectory, "operation-journal"),
      limits: config.operationLimits, audit: (event) => console.info(JSON.stringify({ scope: "prooflock-operation", ...event })) }),
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
      { adapter: createErc8004Adapter(provider), finalityConfirmations: config.confirmations, allowUnverifiedCard: true }),
    classifySubject: (identity) => classifyResolved(subjectAdapter, identity),
    runDeterministicChecks: (_identity, subject) => deterministicResult(subjectAdapter, subject, config),
    runCompute: (identity, subject, deterministic, _signal, costs) => computeResult(config, state.compute,
      identity, subject, deterministic, costs),
    buildEvidenceEnvelope: (context) => Promise.resolve(evidenceEnvelope(context)),
    uploadStorage: (canonical) => persistVerifiedEvidence(canonical, state.storage,
      { confirmations: config.confirmations, receiptTimeoutMs: config.timeoutMs,
        expectedFlowAddress: config.flowAddress }),
    verifyStorage: (upload) => Promise.resolve(upload as Awaited<ReturnType<typeof persistVerifiedEvidence>>),
    operationJournal: state.operations,
    writeChain: async (input, _signal, report) => {
      await requireCustody(provider, config);
      return writeProofLock(chain, input, { confirmations: config.confirmations, timeoutMs: config.timeoutMs }, report);
    },
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
    verifyAuthority: () => requireCustody(provider, config),
    confirmations: config.confirmations, timeoutMs: config.timeoutMs,
    readSealedSnapshot: async (identityKey) => {
      const record = await chainAdapter.getProofLock(identityKey);
      const verified = await boundedStorageRead((signal) => reads.verifyStoredEvidence(record, signal));
      const envelope = parseEnvelope(verified.envelope, identityKey);
      snapshots.set(identityKey, envelope);
      return Object.freeze({ identityKey, version: record.version, fingerprint: envelopeFingerprint(envelope) });
    },
    resolveCurrentFingerprint: async (identityKey) => {
      const envelope = snapshots.get(identityKey) ?? await recoverEnvelope(identityKey, chainAdapter, reads);
      snapshots.delete(identityKey);
      const identity = await resolveAgentIdentity(envelope.identity,
        { adapter: createErc8004Adapter(provider), finalityConfirmations: config.confirmations, allowUnverifiedCard: true });
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
  const verified = await boundedStorageRead((signal) => reads.verifyStoredEvidence(record, signal));
  return parseEnvelope(verified.envelope, identityKey);
}

// 0G Storage downloads can hang on this host (transient socket/ephemeral-port pressure). Bound each
// evidence read so a hang becomes a clean, retryable error at the process level instead of stalling
// the whole drift/recovery ceremony forever.
async function boundedStorageRead<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs = 120_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("0G Storage evidence read timed out")), timeoutMs);
  try { return await fn(controller.signal); }
  finally { clearTimeout(timer); }
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
  config?: ProductionOperatorConfig,
): Promise<DeterministicStageResult> {
  const report = await runSubjectChecks(adapter, subject, sourceBlock(subject));
  const evidenceSubject = toEvidenceSubject(subject, report);
  assertProductionSealableSubject(subject, evidenceSubject);
  // Deep-risk evidence: real 0G explorer behavioral data + heuristics + threat intel + contract
  // analysis. Fully graceful (a down explorer/API degrades to partial coverage, never fails the
  // seal). Captured as a seal-time snapshot and folded into the findings + compute context.
  const riskBundle = await safeCollectRiskBundle(subject.address, config);
  const findings = mergeFindings(reportFindings(report), riskBundle);
  const codeRisk = combineCodeRisk(
    riskBundle ?? emptyBundle(subject.address),
    deterministicCodeRisk(subject.kind, report.status),
    0,
  );
  return Object.freeze({
    checks: [Object.freeze({ id: checkId(report), version: "1", status: report.status,
      inputDigest: digest({ address: subject.address, runtimeCodeHash: subject.runtimeCodeHash,
        block: sourceBlock(subject) }), outputDigest: digest(report), findings })],
    report, evidenceSubject,
    codeRisk: subject.kind === "EOA" ? 0 : codeRisk,
    omissions: subject.kind === "EOA" ? ["Contract code analysis is not applicable to an EOA."] : [],
    ...(riskBundle ? { riskBundle } : {}),
  });
}

async function safeCollectRiskBundle(address: string, config?: ProductionOperatorConfig): Promise<RiskEvidenceBundle | undefined> {
  if (!config) return undefined;
  try {
    return await collectRiskBundle(address, createProductionRiskBundleDeps(config.rpcUrl));
  } catch { return undefined; }
}

function mergeFindings(base: readonly string[], bundle: RiskEvidenceBundle | undefined): readonly string[] {
  if (!bundle) return base;
  const extra = [...bundle.heuristics.factors, ...bundle.contract.factors,
    ...(bundle.threat.sanctioned ? ["Address appears on a sanctions list."] : []),
    ...(bundle.threat.scamFlagged ? ["Address flagged as a known scam or drainer."] : [])];
  return Object.freeze([...base, ...extra].slice(0, 40));
}

function emptyBundle(address: string): RiskEvidenceBundle {
  return { address: address as `0x${string}`, isContract: false, nonce: 0, observedAtBlock: 0,
    heuristics: { signals: [], behavioralScore: 0, factors: [] },
    threat: { sanctioned: false, scamFlagged: false, sources: [], signals: [] },
    contract: { isContract: false, bytecodeFlags: [], sourceFindings: [], codeRisk: 0, signals: [], factors: [] },
    coverage: { explorer: "UNAVAILABLE", rpc: "UNAVAILABLE" } };
}

export function assertProductionSealableSubject(
  subject: Pick<ClassifiedSubject, "kind">,
  evidenceSubject: Pick<EvidenceEnvelopeV1["subject"], "proxyImplementation">,
): void {
  if (subject.kind === "EIP7702_DELEGATED_EOA" || evidenceSubject.proxyImplementation) {
    throw new Error("Nested executable subjects are analyzed but not sealable until AgentGate enforces nested-code drift");
  }
}

async function computeResult(
  config: ProductionOperatorConfig,
  dependencies: ReturnType<typeof createProductionStrictComputeDependencies>,
  identity: ResolvedAgentIdentity,
  subject: ClassifiedSubject,
  deterministic: DeterministicStageResult,
  costs?: PaidCostController,
) {
  // The LLM reasons over the FULL deep-risk bundle (heuristics + threat intel + contract flags), not
  // just the deterministic checks, so it detects malicious patterns instead of guessing from a nonce.
  const riskEvidence = deterministic.riskBundle ? bundleForLlm(deterministic.riskBundle) : undefined;
  const context = canonicalize(normalizeBigints({ identity: identity.identity, subject: deterministic.evidenceSubject,
    deterministicChecks: deterministic.checks, ...(riskEvidence ? { riskEvidence } : {}) }));
  if (typeof context !== "string") throw new Error("Compute context could not be canonicalized");
  const behavioral = await paidCompute("COMPUTE_BEHAVIORAL", costs,
    () => runStrictCompute(computeInput(config, "behavioral-risk", context), dependencies));
  const llmScore = parseRiskScore(behavioral.content);
  const proofs = [behavioral.proof];
  let aiCodeRisk = 0;
  if (subject.kind !== "EOA") {
    const code = await paidCompute("COMPUTE_CONTRACT", costs,
      () => runStrictCompute(computeInput(config, "contract-risk", context), dependencies));
    aiCodeRisk = parseContractCodeRisk(code.content);
    proofs.push(code.proof);
  }
  // Combine: computed heuristic evidence must not be undercounted by the LLM (take the max), and a
  // hard signal (sanctioned / known scam / honeypot) clamps risk high regardless of the LLM.
  const combined = deterministic.riskBundle
    ? combineBehavioralScore(deterministic.riskBundle, llmScore) : llmScore;
  // A SAFE verdict requires complete behavioral evidence. If the deep-risk explorer coverage was
  // unavailable/partial (or the bundle failed to collect entirely), the transaction history the LLM
  // and heuristics reason over is incomplete, so a clean-looking result carries irreducible
  // uncertainty. Floor the score at the CAUTION threshold so a degraded seal can never present as
  // fully cleared. The label is derived strictly from the score downstream, so flooring the score
  // (not the label) keeps the score<->label policy invariant intact.
  const behavioralCoverageComplete = deterministic.riskBundle?.coverage.explorer === "OK";
  const score = floorScoreForCoverage(combined, behavioralCoverageComplete);
  const codeRisk = subject.kind === "EOA" ? 0
    : combineCodeRisk(deterministic.riskBundle ?? emptyBundle(subject.address), deterministic.codeRisk, aiCodeRisk);
  const label = score < CAUTION_SCORE_THRESHOLD ? "SAFE" as const
    : score < FLAGGED_SCORE_THRESHOLD ? "CAUTION" as const : "FLAGGED" as const;
  return Object.freeze({ proofs: Object.freeze(proofs), behavioralScore: score, codeRisk,
    verdict: Object.freeze({ riskScore: score, codeRisk, label }) });
}

// 0G providers occasionally return a non-deterministic response (null/prose content, or a transient
// 5xx) that fails strict parsing. Each attempt is a fresh receipt (unique chatId), so a bounded
// retry is safe and does not risk a double on-chain write (this runs before any broadcast).
const RETRYABLE_COMPUTE_CODES = new Set(["COMPUTE_RESPONSE_INVALID", "COMPUTE_PROVIDER_HTTP_ERROR"]);
export async function retryTransientCompute<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await run(); }
    catch (error) {
      last = error;
      const code = (error as { code?: string } | null)?.code;
      if (!code || !RETRYABLE_COMPUTE_CODES.has(code)) throw error;
    }
  }
  throw last;
}

async function paidCompute<T>(stage: "COMPUTE_BEHAVIORAL" | "COMPUTE_CONTRACT",
  costs: PaidCostController | undefined, run: () => Promise<T>): Promise<T> {
  costs?.reserve(stage);
  try { return await retryTransientCompute(run); }
  finally { costs?.reconcile(stage, "CONSUMED"); }
}

function computeInput(
  config: ProductionOperatorConfig,
  purpose: "behavioral-risk" | "contract-risk",
  context: string,
) {
  // The user message is a canonical JSON evidence blob. A terse instruction makes some 0G/OpenRouter
  // models emit null `content` (reasoning-only), which fails strict parsing; an explicit auditor
  // persona + exact output shape + "output nothing else" reliably yields the parseable JSON.
  // The model returns a rich but strictly-JSON verdict. riskScore drives the on-chain gate; summary
  // and factors are the plain-English "why" (restored from v1) and are carried inside the enclave-
  // signed response, so they are tamper-proof and re-verifiable. Keep it JSON-only to stay parseable.
  const systemPrompt = purpose === "behavioral-risk"
    ? 'You are an on-chain behavioral risk auditor for AI agents. The user message includes a riskEvidence object with computed signals (heuristicScore, riskSignals, threat intel, contract flags) from real 0G on-chain data. Weigh that evidence: unlimited approvals, drain patterns, high failed-tx rate, and single-counterparty concentration raise risk; sanctioned or scam-flagged addresses are maximum risk; a clean active wallet with a registered identity is low risk. Respond with ONLY a strict minified JSON object of exactly this shape and nothing else (no prose, no markdown, no code fences): {"riskScore":N,"summary":S,"factors":F}. N is an integer 0 (safe) to 100 (malicious). S is ONE plain-English sentence (max 200 chars) a non-technical user can understand, stating the verdict and the main reason. F is an array of 2 to 4 short plain-English strings (max 80 chars each) naming the key factors behind the score.'
    : 'You are a smart-contract code risk auditor. The user message includes a riskEvidence.contract object with bytecode flags (SELFDESTRUCT, DELEGATECALL, owner-controlled mint/pause/blacklist) and source findings from the real contract. Weigh them: self-destruct or honeypot patterns are dangerous; upgradeable/owner-controlled is a warning; none is clean. Respond with ONLY a strict minified JSON object of exactly this shape and nothing else (no prose, no markdown, no code fences): {"riskScore":N,"summary":S,"factors":F}. N is an integer 0 (safe) to 100 (dangerous). S is ONE plain-English sentence (max 200 chars) explaining the code-risk verdict. F is an array of 2 to 4 short plain-English strings (max 80 chars each) naming the key factors.';
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
    // Real, block-pinned behavioral signal: the account nonce IS the number of transactions this
    // address has SENT up to the finalized source block. It is on-chain truth from the same RPC (no
    // external explorer), so it is deterministic and re-derivable. A fresh agent has 0; an active one
    // has many. This replaces the previous "history unavailable" default with a real activity read.
    getHistory: async (address, blockTag) => {
      const observedTransactions = await provider.getTransactionCount(address, Number(blockTag));
      return { complete: true, observedTransactions };
    },
  };
  return Object.freeze(adapter);
}

async function requireMainnet(provider: JsonRpcProvider): Promise<void> {
  if ((await provider.getNetwork()).chainId !== 16661n) throw new Error("Production operator requires 0G mainnet chain 16661");
  const code = await provider.getCode(ERC8004_IDENTITY_REGISTRY);
  if (code === "0x") throw new Error("Canonical ERC-8004 Identity Registry is unavailable");
}

async function requireCustody(
  provider: JsonRpcProvider,
  config: ProductionOperatorConfig,
): Promise<void> {
  if (await provider.getCode(config.registryAddress) === "0x") throw new Error("ProofLock RegistryV2 is unavailable");
  const scannerRole = await readRole(provider, config.registryAddress, "SCANNER_ROLE");
  const guardianRole = await readRole(provider, config.registryAddress, "GUARDIAN_ROLE");
  const adminRole = `0x${"00".repeat(32)}`;
  const expected = [[scannerRole, config.scannerAddress], [guardianRole, config.guardianAddress],
    [adminRole, config.adminAddress]] as const;
  const forbidden = [[guardianRole, config.scannerAddress], [adminRole, config.scannerAddress],
    [scannerRole, config.guardianAddress], [adminRole, config.guardianAddress],
    [scannerRole, config.adminAddress], [guardianRole, config.adminAddress],
    [scannerRole, config.computeAddress], [guardianRole, config.computeAddress],
    [adminRole, config.computeAddress]] as const;
  if ((await Promise.all(expected.map(([role, account]) => hasRole(provider, config.registryAddress, role, account)))).includes(false)
    || (await Promise.all(forbidden.map(([role, account]) => hasRole(provider, config.registryAddress, role, account)))).includes(true)) {
    throw new Error("RegistryV2 role custody no longer matches the separated production policy");
  }
}

async function readRole(provider: JsonRpcProvider, registry: HexAddress, method: "SCANNER_ROLE" | "GUARDIAN_ROLE") {
  const raw = await provider.call({ to: registry, data: ROLE_INTERFACE.encodeFunctionData(method) });
  return ROLE_INTERFACE.decodeFunctionResult(method, raw)[0] as string;
}

async function hasRole(provider: JsonRpcProvider, registry: HexAddress, role: string, account: HexAddress) {
  const raw = await provider.call({ to: registry, data: ROLE_INTERFACE.encodeFunctionData("hasRole", [role, account]) });
  return ROLE_INTERFACE.decodeFunctionResult("hasRole", raw)[0] === true;
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

// Deep-normalize BigInt -> decimal string so json-canonicalize can serialize live subject data
// (block numbers, nonces, balances arrive as BigInt from the ethers adapter). The result is only
// ever hashed, never parsed back, so decimal strings are a stable, lossless canonical form.
export function normalizeBigints(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeBigints);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, normalizeBigints(inner)]));
  }
  return value;
}

export function stableEvidenceDigest(value: unknown): Bytes32 {
  return digest(value);
}

// A pure EOA has no code, so its deterministic code risk is always 0 — the EOA history WARN is a
// behavioral finding (fed to the risk model), not code risk. The runner enforces the same invariant
// (EOA subjects must seal with codeRisk === 0). Contracts and delegated EOAs carry real code risk.
export function deterministicCodeRisk(kind: ClassifiedSubject["kind"], status: string): number {
  if (kind === "EOA") return 0;
  return status === "FAIL" ? 2 : status === "WARN" ? 1 : 0;
}

function digest(value: unknown): Bytes32 {
  const serialized = canonicalize(normalizeBigints(value));
  if (typeof serialized !== "string") throw new Error("Deterministic evidence could not be canonicalized");
  return keccak256(toUtf8Bytes(serialized)) as Bytes32;
}

function parseRiskScore(content: string): number {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("0G Compute returned non-JSON risk output"); }
  return scoreSchema.parse(value).riskScore;
}

export function parseContractCodeRisk(content: string): number {
  const score = parseRiskScore(content);
  return score < 30 ? 0 : score < 60 ? 1 : 2;
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
  const actual = keyAddress(privateKey, label);
  if (actual !== expected) throw new Error(`${label} does not match configured address`);
}

function keyAddress(privateKey: string, label: string): string {
  try { return new Wallet(privateKey).address; } catch { throw new Error(`${label} is invalid`); }
}
