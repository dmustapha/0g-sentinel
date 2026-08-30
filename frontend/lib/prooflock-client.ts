import { z } from "zod";
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "json-canonicalize";
import { assertObservation } from "./prooflock-observations";
import { gateReasonMeta } from "./prooflock-status";
import { isCanonicalAgentId, isCanonicalUint48, isCanonicalUint64,
  isPositiveUint48, isPositiveUint64 } from "./prooflock-validation";
import { configuredDisplayText } from "./safe-display";

import type {
  ApiErrorShape, CanonicalIdentity, HealthSnapshot, OperatorRunInput, ProofLockDiscoveryResponse,
  OperatorRunProgress, OperatorTerminalResult, ProofLockCurrentDetailResponse, ProofLockDetailResponse, ProofLockRecord,
  ProofLockWriteOutcome, ResolvedIdentityLocator, RunnerStage, VerifiedProof,
} from "./prooflock-types";

const hex20 = z.string().regex(/^0x[0-9a-f]{40}$/i);
const nonZeroHex20 = hex20.refine((value) => !/^0x0{40}$/i.test(value));
const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/i);
const nonZeroHex32 = hex32.refine((value) => !/^0x0{64}$/i.test(value));
const canonicalAgentId = z.string().max(78).refine(isCanonicalAgentId);
const uint64Decimal = z.string().max(20).refine(isCanonicalUint64);
const positiveUint64Decimal = z.string().max(20).refine(isPositiveUint64);
const uint48Decimal = z.string().max(15).refine(isCanonicalUint48);
const positiveUint48Decimal = z.string().max(15).refine(isPositiveUint48);
const policyVersion = z.number().int().min(1).max(4_294_967_295);
const uri = z.string().max(4_096);
const identityCard = boundedRecord({ keys: 256, nodes: 1_024, depth: 8,
  array: 128, stringUnits: 65_536 });
const ERC8004_REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const identitySchema = z.object({
  identity: z.object({ namespace: z.literal("eip155"), chainId: z.literal(16661), registryAddress: hex20, agentId: canonicalAgentId }),
  owner: hex20, agentWallet: hex20, agentURI: uri, registrationDigest: hex32,
  sourceBlockNumber: uint64Decimal, sourceBlockHash: hex32, card: identityCard,
});
const lockSchema = z.object({
  identityKey: hex32, subject: hex20, envelopeDigest: hex32, storageRoot: hex32, computeRoot: hex32,
  artifactHash: hex32, runtimeCodeHash: hex32, version: positiveUint64Decimal,
  issuedAt: positiveUint48Decimal, validUntil: positiveUint48Decimal,
  policyVersion, behavioralScore: z.number().int().min(0).max(100),
  codeRisk: z.number().int().min(0).max(2), coverage: z.number().int().min(0).max(255),
  state: z.number().int().min(0).max(255), stateReason: z.number().int().min(0).max(255),
});
const unknownGateSchema = z.object({ status: z.literal("UNKNOWN"), allowed: z.literal(false), reason: z.null() });
const verifiedGateSchema = z.object({ status: z.literal("VERIFIED"), allowed: z.boolean(), reason: z.number().int().min(0).max(255),
  subject: hex20, version: uint64Decimal });
const unknownConsumerSchema = z.object({ status: z.literal("UNKNOWN"), accepted: z.literal(false) });
const verifiedConsumerSchema = z.object({ status: z.literal("VERIFIED"), accepted: z.boolean(), address: hex20, subject: hex20, version: uint64Decimal });
const identitySummarySchema = z.object({ identityKey: hex32, namespace: z.literal("eip155"), chainId: z.literal(16661),
  registryAddress: hex20, agentId: canonicalAgentId, owner: hex20, agentWallet: hex20, registrationUri: uri,
  registrationDigest: hex32, sourceBlockNumber: uint64Decimal, sourceBlockHash: hex32 });
const resolutionSummarySchema = z.object({ owner: hex20, agentWallet: hex20, agentURI: uri,
  registrationDigest: hex32, sourceBlockNumber: uint64Decimal, sourceBlockHash: hex32 });
const detailSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("VERIFIED"), identity: identitySummarySchema, resolution: resolutionSummarySchema,
    gate: z.union([verifiedGateSchema, unknownGateSchema]), consumer: z.union([verifiedConsumerSchema, unknownConsumerSchema]) }),
  z.object({ status: z.literal("UNAVAILABLE"), code: z.enum(["EVIDENCE_UNAVAILABLE", "EVIDENCE_INVALID", "IDENTITY_UNAVAILABLE", "IDENTITY_INVALID"]),
    identity: z.null(), resolution: z.null(), gate: unknownGateSchema, consumer: unknownConsumerSchema }),
]);
const observationReason = z.enum(["ALLOWED", "NO_PROOF", "REVOKED", "DRIFTED", "EXPIRED",
  "SUBJECT_CHANGED", "RUNTIME_CODE_DRIFT", "POLICY_TOO_OLD", "COVERAGE_INCOMPLETE",
  "COMPUTE_UNVERIFIED", "STORAGE_UNVERIFIED", "BEHAVIORAL_RISK", "CODE_RISK",
  "IDENTITY_UNAVAILABLE", "AGENT_NOT_FOUND", "AGENT_WALLET_UNSET", "IDENTITY_MISMATCH",
  "UNKNOWN_REASON", "EVIDENCE_UNAVAILABLE", "EVIDENCE_MISMATCH"]);
const currentReason = z.enum(["OBSERVED", "CURRENT_IDENTITY_UNAVAILABLE", "CURRENT_LEASE_UNAVAILABLE",
  "CURRENT_GATE_UNAVAILABLE", "CURRENT_CONSUMER_UNAVAILABLE", "CURRENT_LEASE_MISMATCH",
  "CURRENT_GATE_MISMATCH", "CURRENT_CONSUMER_MISMATCH", "GUARDED_CONSUMER_BLOCKED",
  ...observationReason.options]);
const currentObservationSchema = z.object({ scope: z.literal("CURRENT"),
  subsystem: z.enum(["identity", "lease", "gate", "consumer"]),
  status: z.enum(["VERIFIED", "BLOCKED", "UNAVAILABLE", "STALE", "MISMATCH", "NOT_APPLICABLE"]),
  observedAt: z.string().datetime(), observationBlockNumber: positiveUint64Decimal, observationBlockHash: nonZeroHex32,
  serverIssuedAt: z.string().datetime(), ttlMs: z.number().int().positive().max(3_600_000),
  freshnessExpiresAt: z.string().datetime(), reasonCode: observationReason.optional(),
  allowed: z.literal(true).optional(), accepted: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.freshnessExpiresAt) !== Date.parse(value.observedAt) + value.ttlMs) {
    context.addIssue({ code: "custom", message: "Current observation freshness is inconsistent" });
  }
  if (Date.parse(value.serverIssuedAt) < Date.parse(value.observedAt)) {
    context.addIssue({ code: "custom", message: "Current observation server time is inconsistent" });
  }
  try { assertObservation(value); }
  catch { context.addIssue({ code: "custom", message: "Current observation state is invalid" }); }
});
const currentIdentityValueSchema = z.object({ identity: z.object({ namespace: z.literal("eip155"),
  chainId: z.literal(16661), registryAddress: hex20, agentId: canonicalAgentId }).strict(), owner: hex20,
  agentWallet: hex20, agentURI: uri, registrationDigest: hex32,
  sourceBlockNumber: uint64Decimal, sourceBlockHash: hex32 }).strict();
const currentGateValueSchema = z.object({ allowed: z.boolean(), reason: z.number().int().min(0).max(16),
  subject: hex20, version: uint64Decimal }).strict();
const currentConsumerValueSchema = z.object({ accepted: z.boolean(), address: hex20,
  subject: hex20, version: uint64Decimal }).strict();
const currentEntry = <T extends z.ZodType>(capability: string, subsystem: string, value: T) =>
  z.object({ capability: z.literal(capability), reason: currentReason,
    observation: currentObservationSchema.refine((item) => item.subsystem === subsystem,
      { message: "Current observation subsystem is inconsistent" }), value: value.nullable() }).strict()
    .superRefine((entry, context) => {
      const parsed = entry as unknown as Readonly<{
        observation: Readonly<{ status: string }>;
        value: unknown;
      }>;
      const unavailable = ["UNAVAILABLE", "MISMATCH", "STALE", "NOT_APPLICABLE"]
        .includes(parsed.observation.status);
      if ((parsed.observation.status === "VERIFIED" && parsed.value === null)
        || (unavailable && parsed.value !== null)) {
        context.addIssue({ code: "custom", message: "Current observation value is inconsistent" });
      }
    });
const currentAccessSchema = z.object({ schema: z.literal("sentinel.prooflock/current-access-v1"),
  version: z.literal(1), agentId: canonicalAgentId, identityKey: nonZeroHex32,
  observationBlock: z.object({ number: positiveUint64Decimal, hash: nonZeroHex32,
    timestamp: positiveUint48Decimal }).strict(),
  observedAt: z.string().datetime(), freshnessExpiresAt: z.string().datetime(),
  observations: z.object({
    identity: currentEntry("ERC8004_IDENTITY_AT_FINALIZED_BLOCK", "identity", currentIdentityValueSchema),
    lease: currentEntry("REGISTRY_V2_LEASE_AT_FINALIZED_BLOCK", "lease", lockSchema),
    gate: currentEntry("AGENT_GATE_V2_AT_FINALIZED_BLOCK", "gate", currentGateValueSchema),
    consumer: currentEntry("GUARDED_CONSUMER_AT_FINALIZED_BLOCK", "consumer", currentConsumerValueSchema),
  }).strict(),
}).strict().superRefine(validateCurrentAccessMetadata);
const sealedEvidenceSchema = z.object({ schema: z.literal("sentinel.prooflock/sealed-evidence-v1"),
  version: z.literal(1), proofLock: lockSchema, detail: detailSchema }).strict();
const registryLocatorSchema = z.object({ identityKey: nonZeroHex32, proofId: nonZeroHex32,
  registryAddress: nonZeroHex20 }).strict();
const registrySourceLocatorSchema = registryLocatorSchema.extend({ transactionHash: nonZeroHex32,
  blockNumber: z.number().int().nonnegative() }).strict();
const legacyDetailResponseSchema = z.object({ identityKey: nonZeroHex32,
  proofLock: lockSchema, detail: detailSchema }).strict();
const currentDetailResponseSchema = legacyDetailResponseSchema.extend({ responseVersion: z.literal(2),
  proofId: nonZeroHex32, registryAddress: nonZeroHex20, locator: registryLocatorSchema,
  sealedEvidence: sealedEvidenceSchema,
  currentAccess: currentAccessSchema }).strict();
const apiCodeSchema = z.enum(["INVALID_INPUT", "UNAUTHORIZED", "NOT_FOUND", "GONE", "METHOD_NOT_ALLOWED",
  "AGENT_NOT_FOUND", "AGENT_WALLET_UNSET", "IDENTITY_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE", "COMPUTE_UNVERIFIED",
  "MISMATCH", "HINT_REQUIRED", "REQUEST_ABORTED", "INTERNAL_ERROR", "SUBMISSION_OUTCOME_UNKNOWN",
  "FINALIZED_READBACK_UNAVAILABLE", "NOT_BROADCAST", "SEALED", "REVERTED", "RECOVERY_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT", "IDENTITY_ACTIVE", "CONCURRENCY_LIMIT", "OPERATOR_CONCURRENCY_LIMIT",
  "GLOBAL_CONCURRENCY_LIMIT", "RATE_LIMIT", "DAILY_CEREMONY_LIMIT", "DAILY_COST_LIMIT"]);
const apiStageSchema = z.enum(["VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS",
  "RUNNING_COMPUTE", "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE", "VERIFYING_STORAGE", "WRITING_CHAIN",
  "READING_CHAIN_BACK", "SEALED", "AUTHENTICATING", "RESOLVING_IDENTITY", "READING_PROOF", "VERIFYING_PROOF",
  "HEALTH_CHECK", "RECOVERING_WRITE"]);
const errorMessageSchema = z.string().max(16_384).transform((value) =>
  configuredDisplayText(value, "Unspecified error", { maxGraphemes: 256 }));
const errorSchema = z.object({ error: z.object({ code: apiCodeSchema, message: errorMessageSchema,
  stage: apiStageSchema, retryable: z.boolean(), requestId: z.string().min(1).max(128) }).strict() }).strict();
const recoveryId = z.string().regex(/^rec_[0-9a-f]{16,64}$/i);
const writeOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_BROADCAST"), recoveryId }),
  z.object({ status: z.literal("SUBMISSION_OUTCOME_UNKNOWN"), recoveryId, transactionHash: hex32.optional() }),
  z.object({ status: z.literal("FINALIZED_READBACK_UNAVAILABLE"), recoveryId, transactionHash: hex32,
    identityKey: hex32, version: positiveUint64Decimal }),
  z.object({ status: z.literal("SEALED"), recoveryId, transactionHash: hex32, identityKey: hex32, version: positiveUint64Decimal }),
  z.object({ status: z.literal("REVERTED"), recoveryId, transactionHash: hex32 }),
]);
const runnerStageSchema = z.enum(["VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS",
  "RUNNING_COMPUTE", "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE", "VERIFYING_STORAGE", "WRITING_CHAIN",
  "READING_CHAIN_BACK", "SEALED"]);
const phaseSchema = z.enum(["REQUESTED", "COMPUTE_VERIFIED", "STORAGE_VERIFIED", "CHAIN_INPUT_COMMITTED",
  "SUBMISSION_ATTEMPTED", "HASH_KNOWN", "FINALIZED", "RECOVERY_REQUIRED", "TERMINAL"]);
const terminalSchema = z.union([
  z.object({ kind: z.literal("SEALED"), stage: z.literal("SEALED"),
    identity: z.record(z.string(), z.unknown()).optional(), subject: z.record(z.string(), z.unknown()).optional(),
    envelope: z.record(z.string(), z.unknown()).optional(), storage: z.record(z.string(), z.unknown()).optional(),
    chain: z.record(z.string(), z.unknown()).optional(), proofLock: z.record(z.string(), z.unknown()).optional(),
    writeOutcome: writeOutcomeSchema.refine((value) => value.status === "SEALED") }).strict(),
  z.object({ kind: z.literal("EXISTING_OPERATION"), operation: z.object({ recoveryId, phase: phaseSchema,
    writeOutcome: writeOutcomeSchema.optional() }).strict() }).strict(),
]);
const progressSchema = z.union([
  z.object({ type: z.literal("admission"), state: z.enum(["ACCEPTED", "DEDUPLICATED"]), recoveryId,
    idempotencyKey: z.string().min(8).max(128) }).strict(),
  z.object({ phase: z.literal("PRE_SEND") }).strict(),
  z.object({ phase: z.literal("SUBMISSION_ATTEMPTED") }).strict(),
  z.object({ phase: z.literal("HASH_KNOWN"), transactionHash: hex32 }).strict(),
  z.object({ phase: z.literal("REVERTED"), transactionHash: hex32 }).strict(),
  z.object({ phase: z.literal("FINALIZED"), transactionHash: hex32, blockHash: hex32,
    blockNumber: positiveUint64Decimal, confirmations: z.number().int().positive() }).strict(),
]);
const activeKeys = new Map<string, string>();
const recoveryInputs = new Map<string, string>();
const ACTIVE_KEY_PREFIX = "sentinel.prooflock.active.v1:";
const RECOVERY_KEY_PREFIX = "sentinel.prooflock.recovery.v1:";

export class ProofLockApiError extends Error {
  constructor(readonly detail: ApiErrorShape, readonly status: number,
    readonly writeOutcome?: ProofLockWriteOutcome) { super(detail.message); this.name = "ProofLockApiError"; }
}
export class ProofLockStreamInterruptedError extends Error {
  constructor(readonly recoveryId: string | undefined, readonly idempotencyKey: string) {
    super("ProofLock stream ended before a validated terminal result"); this.name = "ProofLockStreamInterruptedError";
  }
}

export async function resolveIdentity(agentId: string, signal?: AbortSignal): Promise<CanonicalIdentity> {
  const body = await requestJson(`/api/v1/identities/resolve?agentId=${encodeURIComponent(agentId)}`, { signal });
  return identitySchema.parse(z.object({ identity: identitySchema }).parse(body).identity) as CanonicalIdentity;
}

export async function resolveIdentityLocator(agentId: string,
  signal?: AbortSignal): Promise<ResolvedIdentityLocator> {
  const body = await requestJson(`/api/v1/identities/resolve?agentId=${encodeURIComponent(agentId)}&locator=identity-v1`, { signal });
  const parsed = z.object({ identity: identitySchema, identityKey: nonZeroHex32 }).strict().parse(body);
  if (parsed.identity.identity.agentId !== agentId) {
    throw new TypeError("Resolved identity locator binding is inconsistent");
  }
  return parsed as ResolvedIdentityLocator;
}

export async function readProofLock(identityKey: string, signal?: AbortSignal): Promise<ProofLockRecord> {
  const body = await requestJson(`/api/v1/prooflocks/${encodeURIComponent(identityKey)}`, { signal });
  return lockSchema.parse(z.object({ identityKey: hex32, proofLock: lockSchema }).parse(body).proofLock) as ProofLockRecord;
}

export async function readProofLockDetail(identityKey: string, signal?: AbortSignal,
  agentId?: string): Promise<ProofLockDetailResponse> {
  const query = agentId === undefined ? ""
    : `?agentId=${encodeURIComponent(agentId)}&locator=registry-v1`;
  const body = await requestJson(`/api/v1/prooflocks/${encodeURIComponent(identityKey)}${query}`, { signal });
  if (agentId === undefined) return legacyDetailResponseSchema.parse(body) as ProofLockDetailResponse;
  const parsed = currentDetailResponseSchema.parse(body);
  if (!validCurrentDetailBinding(parsed, identityKey, agentId)) {
    throw new TypeError("Current ProofLock detail binding is inconsistent");
  }
  return parsed as ProofLockCurrentDetailResponse;
}

export async function discoverProofLocks(signal?: AbortSignal): Promise<ProofLockDiscoveryResponse> {
  const body = await requestJson("/api/discover?locator=registry-v1", { signal });
  const source = { identityKey: nonZeroHex32, proofId: nonZeroHex32,
    registryAddress: nonZeroHex20, transactionHash: nonZeroHex32,
    blockNumber: z.number().int().nonnegative() };
  const discoveryLock = lockSchema.extend({ identityKey: nonZeroHex32, envelopeDigest: nonZeroHex32,
    storageRoot: nonZeroHex32, computeRoot: nonZeroHex32, artifactHash: nonZeroHex32 });
  const verified = z.object({ status: z.literal("VERIFIED"), ...source,
    locator: registrySourceLocatorSchema,
    proofLock: discoveryLock, detail: detailSchema });
  const unavailable = z.object({ status: z.literal("ENRICHMENT_UNAVAILABLE"), ...source,
    locator: registrySourceLocatorSchema, code: z.literal("DEPENDENCY_UNAVAILABLE") }).strict();
  const schema = z.object({ identities: z.array(z.discriminatedUnion("status", [verified, unavailable])).max(100),
    latestBlock: z.number().int().nonnegative(), fromBlock: z.number().int().nonnegative(),
    toBlock: z.number().int().nonnegative(), confirmations: z.number().int().positive(),
    observedAt: z.string().datetime(), cap: z.number().int().positive(), returned: z.number().int().nonnegative(),
    complete: z.literal(false) }).refine((value) => validDiscoveryMetadata(value),
    { message: "Discovery metadata is inconsistent" });
  return schema.parse(body) as ProofLockDiscoveryResponse;
}

function validDiscoveryMetadata(value: Readonly<{ identities: readonly Readonly<{ identityKey: string;
  proofId: string; registryAddress: string; transactionHash: string; blockNumber: number; status: string;
  locator: Readonly<{ identityKey: string; proofId: string; registryAddress: string;
    transactionHash: string; blockNumber: number }>; proofLock?: Readonly<{ identityKey: string }> }>[]; latestBlock: number;
  fromBlock: number; toBlock: number; confirmations: number; cap: number; returned: number }>): boolean {
  const identities = value.identities.map((row) => row.identityKey.toLowerCase());
  return value.latestBlock >= value.confirmations - 1
    && value.toBlock === value.latestBlock - value.confirmations + 1
    && value.fromBlock <= value.toBlock && value.returned === value.identities.length
    && value.returned <= value.cap && new Set(identities).size === identities.length
    && value.identities.every((row) => row.blockNumber >= value.fromBlock && row.blockNumber <= value.toBlock
      && row.locator.identityKey.toLowerCase() === row.identityKey.toLowerCase()
      && row.locator.transactionHash.toLowerCase() === row.transactionHash.toLowerCase()
      && row.locator.blockNumber === row.blockNumber
      && row.locator.proofId.toLowerCase() === row.proofId.toLowerCase()
      && row.locator.registryAddress.toLowerCase() === row.registryAddress.toLowerCase()
      && (row.status !== "VERIFIED" || row.proofLock?.identityKey.toLowerCase() === row.identityKey.toLowerCase()));
}

function validateCurrentAccessMetadata(value: Record<string, any>, context: z.RefinementCtx): void {
  const block = value.observationBlock;
  const entries = Object.values(value.observations) as Record<string, any>[];
  const consistent = entries.every(({ observation }) =>
    observation.observationBlockNumber === block.number
    && observation.observationBlockHash.toLowerCase() === block.hash.toLowerCase()
    && observation.observedAt === value.observedAt
    && observation.serverIssuedAt === value.observedAt
    && observation.freshnessExpiresAt === value.freshnessExpiresAt);
  if (!consistent) context.addIssue({ code: "custom",
    message: "Current access observation metadata is inconsistent" });
  if (!validCurrentEntrySemantics(value)) context.addIssue({ code: "custom",
    message: "Current access observation state is inconsistent" });
}

function validCurrentEntrySemantics(value: Record<string, any>): boolean {
  const { identity, lease, gate, consumer } = value.observations;
  if (!validEntryState("identity", identity) || !validEntryState("lease", lease)
    || !validEntryState("gate", gate) || !validEntryState("consumer", consumer)) return false;
  if (identity.value && (identity.value.sourceBlockNumber !== value.observationBlock.number
    || identity.value.sourceBlockHash.toLowerCase() !== value.observationBlock.hash.toLowerCase())) return false;
  if (!validLeaseState(lease, value.observationBlock.timestamp)
    || !validGateState(gate) || !validConsumerState(consumer)) return false;
  return validCurrentProvenance(identity, lease, gate, consumer,
    value.identityKey, value.observationBlock.timestamp);
}

function validLeaseState(entry: Record<string, any>, timestamp: string): boolean {
  if (!entry.value) return entry.observation.status !== "VERIFIED";
  const expected = leaseBlockReason(entry.value, BigInt(timestamp));
  if (entry.observation.status === "VERIFIED") return expected === null;
  if (entry.observation.status === "BLOCKED") return expected === entry.reason
    && expected === entry.observation.reasonCode;
  return false;
}

function leaseBlockReason(value: Record<string, any>, timestamp: bigint): string | null {
  if (value.state === 2) return "REVOKED";
  if (value.state === 3) return "DRIFTED";
  if (value.state !== 1 || value.coverage !== 0x7f) return "COVERAGE_INCOMPLETE";
  if (BigInt(value.validUntil) <= timestamp) return "EXPIRED";
  return null;
}

function validEntryState(subsystem: string, entry: Record<string, any>): boolean {
  const status = entry.observation.status;
  const unavailable = { identity: ["CURRENT_IDENTITY_UNAVAILABLE", "IDENTITY_UNAVAILABLE"],
    lease: ["CURRENT_LEASE_UNAVAILABLE", "EVIDENCE_UNAVAILABLE"],
    gate: ["CURRENT_GATE_UNAVAILABLE", "EVIDENCE_UNAVAILABLE"],
    consumer: ["CURRENT_CONSUMER_UNAVAILABLE", "EVIDENCE_UNAVAILABLE"] } as const;
  const mismatch = `CURRENT_${subsystem.toUpperCase()}_MISMATCH`;
  if (status === "UNAVAILABLE") return entry.reason === unavailable[subsystem as keyof typeof unavailable][0]
    && entry.observation.reasonCode === unavailable[subsystem as keyof typeof unavailable][1];
  if (status === "MISMATCH") return subsystem !== "identity" && entry.reason === mismatch
    && entry.observation.reasonCode === "EVIDENCE_MISMATCH";
  if (status === "VERIFIED") return entry.reason === (subsystem === "gate" ? "ALLOWED" : "OBSERVED")
    && entry.observation.reasonCode === (subsystem === "gate" ? "ALLOWED" : undefined);
  if (status !== "BLOCKED" || !["lease", "gate", "consumer"].includes(subsystem)) return false;
  if (subsystem === "consumer") return entry.reason === "GUARDED_CONSUMER_BLOCKED"
    && entry.observation.reasonCode === "UNKNOWN_REASON" && entry.value !== null;
  return entry.reason === entry.observation.reasonCode
    && (subsystem === "lease" && entry.reason === "NO_PROOF"
      ? entry.value === null : entry.value !== null);
}

function validGateState(entry: Record<string, any>): boolean {
  if (!entry.value) return entry.observation.status !== "VERIFIED";
  const code = gateReasonMeta(entry.value.reason).code;
  const identityFailure = ["IDENTITY_UNAVAILABLE", "AGENT_NOT_FOUND", "AGENT_WALLET_UNSET"].includes(code);
  if (identityFailure && (!/^0x0{40}$/i.test(entry.value.subject) || entry.value.version !== "0")) return false;
  if (!identityFailure && /^0x0{40}$/i.test(entry.value.subject)) return false;
  if (entry.observation.status === "VERIFIED") return entry.value.allowed === true
    && entry.value.reason === 0 && code === "ALLOWED";
  if (entry.observation.status === "BLOCKED") return entry.value.allowed === false
    && code === entry.reason && code === entry.observation.reasonCode;
  return false;
}

function validConsumerState(entry: Record<string, any>): boolean {
  if (!entry.value) return entry.observation.status !== "VERIFIED";
  if (entry.observation.status === "VERIFIED") return entry.value.accepted === true;
  if (entry.observation.status === "BLOCKED") return entry.value.accepted === false;
  return false;
}

function validCurrentProvenance(identity: Record<string, any>, lease: Record<string, any>,
  gate: Record<string, any>, consumer: Record<string, any>, identityKey: string,
  blockTimestamp: string): boolean {
  if (gate.value && !gateProvenance(identity, lease, gate.value,
    identityKey, blockTimestamp)) return false;
  if (consumer.value && !consumerProvenance(identity.value, lease.value, gate.value, consumer.value)) return false;
  if (!gate.value || !consumer.value) return true;
  return gate.value.allowed === consumer.value.accepted
    && gate.value.subject.toLowerCase() === consumer.value.subject.toLowerCase()
    && gate.value.version === consumer.value.version;
}

function gateProvenance(identity: Record<string, any>, lease: Record<string, any>,
  gate: Record<string, any>, identityKey: string, blockTimestamp: string): boolean {
  if (identityFailureGate(gate)) return identity.observation.status === "UNAVAILABLE";
  if (identity.value && gate.subject.toLowerCase() !== identity.value.agentWallet.toLowerCase()) return false;
  if (!lease.value) return lease.reason !== "NO_PROOF" || (gate.reason === 1 && gate.version === "0");
  if (gate.version !== lease.value.version) return false;
  const intrinsic = intrinsicGateReason(gate, lease.value, identityKey, BigInt(blockTimestamp));
  if (intrinsic !== null) return gate.reason === intrinsic;
  return ![1, 2, 3, 5, 8, 9, 10, 16].includes(gate.reason);
}

function intrinsicGateReason(gate: Record<string, any>, lease: Record<string, any>,
  identityKey: string, blockTimestamp: bigint): number | null {
  if (lease.version === "0") return 1;
  if (lease.identityKey.toLowerCase() !== identityKey.toLowerCase()) return 16;
  if (lease.subject.toLowerCase() !== gate.subject.toLowerCase()) return 5;
  if (lease.state === 2) return 2;
  if (lease.state === 3) return 3;
  if (lease.state !== 1) return 16;
  if (BigInt(lease.issuedAt) > blockTimestamp || BigInt(lease.validUntil) <= blockTimestamp) return 4;
  if ((lease.coverage & 0x08) === 0) return 9;
  if ((lease.coverage & 0x20) === 0) return 10;
  if ((lease.coverage & 0x7f) !== 0x7f) return 8;
  return null;
}

function consumerProvenance(identity: Record<string, any> | null, lease: Record<string, any> | null,
  gate: Record<string, any> | null, consumer: Record<string, any>): boolean {
  if (identity && consumer.subject.toLowerCase() !== identity.agentWallet.toLowerCase()) return false;
  if (!lease) return true;
  if (consumer.version !== lease.version) return false;
  if (!consumer.accepted && gate && [1, 5, 13, 14, 15].includes(gate.reason)) return true;
  return consumer.subject.toLowerCase() === lease.subject.toLowerCase();
}

function identityFailureGate(gate: Record<string, any>): boolean {
  return gate.allowed === false && [13, 14, 15].includes(gate.reason)
    && /^0x0{40}$/i.test(gate.subject) && gate.version === "0";
}

function validCurrentDetailBinding(value: z.infer<typeof currentDetailResponseSchema>,
  requestedIdentityKey: string, requestedAgentId: string): boolean {
  const key = value.identityKey.toLowerCase();
  const current = value.currentAccess;
  const identityValue = current.observations.identity.value;
  const leaseValue = current.observations.lease.value;
  const sealedIdentity = value.detail.status === "VERIFIED" ? value.detail.identity : null;
  return key === requestedIdentityKey.toLowerCase()
    && value.proofLock.identityKey.toLowerCase() === key
    && value.locator.identityKey.toLowerCase() === key
    && value.locator.proofId.toLowerCase() === value.proofId.toLowerCase()
    && value.locator.registryAddress.toLowerCase() === value.registryAddress.toLowerCase()
    && current.identityKey.toLowerCase() === key && current.agentId === requestedAgentId
    && (!sealedIdentity || (sealedIdentity.identityKey.toLowerCase() === key
      && sealedIdentity.agentId === requestedAgentId))
    && (!identityValue || validCurrentIdentityBinding(identityValue.identity, requestedAgentId))
    && (!leaseValue || leaseValue.identityKey.toLowerCase() === key)
    && JSON.stringify(value.sealedEvidence.proofLock) === JSON.stringify(value.proofLock)
    && JSON.stringify(value.sealedEvidence.detail) === JSON.stringify(value.detail);
}

function validCurrentIdentityBinding(identity: Readonly<{ namespace: "eip155"; chainId: 16661;
  registryAddress: string; agentId: string }>, requestedAgentId: string): boolean {
  if (!isCanonicalAgentId(identity.agentId) || identity.agentId !== requestedAgentId
    || identity.registryAddress.toLowerCase() !== ERC8004_REGISTRY) return false;
  return true;
}

export async function verifyProof(proofId: string, identityKey: string, signal?: AbortSignal, sourceTxHash?: string): Promise<VerifiedProof> {
  const query = new URLSearchParams({ identityKey }); if (sourceTxHash) query.set("sourceTxHash", sourceTxHash);
  const body = await requestJson(`/api/v1/proofs/${encodeURIComponent(proofId)}/verify?${query}`, { signal });
  const schema = z.object({ proofId: hex32, identityKey: hex32, source: z.object({ kind: z.literal("ProofLocked"),
      registryAddress: hex20, transactionHash: hex32, blockNumber: z.number().int().nonnegative(), blockHash: hex32,
      logIndex: z.number().int().nonnegative() }), proofLock: lockSchema,
    storage: z.object({ retrievalVerified: z.literal(true), networkProofVerified: z.literal(false),
      envelope: boundedRecord({ keys: 256, nodes: 10_000, depth: 16, array: 512,
        stringUnits: 900_000 }), computeVerification: z.array(z.unknown()).max(64).optional(),
      storageCommitment: boundedRecord({ keys: 64, nodes: 256, depth: 6, array: 64,
        stringUnits: 32_768 }).optional() }) });
  return schema.parse(body) as VerifiedProof;
}

export async function readHealth(signal?: AbortSignal): Promise<HealthSnapshot> {
  const response = await fetch("/api/health", { signal, cache: "no-store" });
  const raw = await readBoundedJson(response).catch(() => null);
  const probe = z.object({ status: z.enum(["HEALTHY", "UNHEALTHY", "UNKNOWN"]), latencyMs: z.number().nonnegative(),
    observedAt: z.string().datetime(),
    detail: boundedRecord({ keys: 128, nodes: 512, depth: 6, array: 64,
      stringUnits: 32_768 }).optional() });
  return z.object({ status: z.enum(["HEALTHY", "DEGRADED"]), dependencies: z.object({
    rpc: probe, identity: probe, registry: probe, gate: probe, compute: probe, storage: probe,
  }) }).parse(raw) as HealthSnapshot;
}

export async function runProofLock(
  input: OperatorRunInput,
  token: string,
  onStage: (stage: RunnerStage) => void,
  signal?: AbortSignal,
  idempotencyKey?: string,
  onProgress?: (progress: OperatorRunProgress) => void,
): Promise<OperatorTerminalResult> {
  const inputKey = canonicalize(input) ?? JSON.stringify(input);
  const storageKey = `${ACTIVE_KEY_PREFIX}${keccak256(toUtf8Bytes(inputKey))}`;
  const saved = readActiveOperation(storageKey);
  const stableKey = idempotencyKey ?? saved?.idempotencyKey ?? activeKeys.get(inputKey) ?? `client-${crypto.randomUUID()}`;
  rememberActiveOperation(storageKey, inputKey, { idempotencyKey: stableKey, recoveryId: saved?.recoveryId });
  const response = await fetch("/api/admin/prooflocks/stream", { method: "POST", signal, cache: "no-store", redirect: "error",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`,
      "idempotency-key": stableKey }, body: JSON.stringify(input) });
  if (!response.ok || !response.body) {
    try { await throwResponse(response); }
    catch (cause) { if (cause instanceof ProofLockApiError) forgetActiveOperation(storageKey, inputKey); throw cause; }
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let admittedRecoveryId: string | undefined;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const payload = frame.startsWith("data: ") ? JSON.parse(frame.slice(6)) as Record<string, unknown> : null;
      if (payload?.type === "stage") onStage(runnerStageSchema.parse(payload.stage) as RunnerStage);
      if (payload?.type === "progress") {
        const progress = progressSchema.parse(payload.progress) as OperatorRunProgress;
        safeProgress(onProgress, progress);
        if ("type" in progress) { admittedRecoveryId = progress.recoveryId;
          rememberActiveOperation(storageKey, inputKey, { idempotencyKey: stableKey, recoveryId: admittedRecoveryId }); }
      }
      if (payload?.type === "error") {
        const terminal = z.object({ error: errorSchema.shape.error, writeOutcome: writeOutcomeSchema.optional() }).parse(payload);
        if (!terminal.writeOutcome || terminal.writeOutcome.status === "NOT_BROADCAST"
          || terminal.writeOutcome.status === "REVERTED")
          forgetActiveOperation(storageKey, inputKey);
        throw new ProofLockApiError(terminal.error as ApiErrorShape, 500,
          terminal.writeOutcome as ProofLockWriteOutcome | undefined);
      }
      if (payload?.type === "complete") {
        const result = terminalSchema.parse(payload.result) as OperatorTerminalResult;
        if (result.kind === "SEALED" || result.operation.writeOutcome?.status === "NOT_BROADCAST"
          || result.operation.writeOutcome?.status === "REVERTED"
          || result.operation.writeOutcome?.status === "SEALED") forgetActiveOperation(storageKey, inputKey);
        return result;
      }
    }
  }
  throw new ProofLockStreamInterruptedError(admittedRecoveryId, stableKey);
}

function safeProgress(report: ((progress: OperatorRunProgress) => void) | undefined,
  progress: OperatorRunProgress): void {
  try { report?.(progress); } catch { /* UI observation cannot change the paid operation */ }
}

type ActiveOperation = Readonly<{ idempotencyKey: string; recoveryId?: string }>;
function readActiveOperation(key: string): ActiveOperation | undefined {
  try { const value = localStorage.getItem(key); if (!value) return undefined;
    return z.object({ idempotencyKey: z.string().min(8).max(128), recoveryId: recoveryId.optional() }).parse(JSON.parse(value));
  } catch { return undefined; }
}
function rememberActiveOperation(key: string, inputKey: string, value: ActiveOperation): void {
  activeKeys.set(inputKey, value.idempotencyKey);
  if (value.recoveryId) recoveryInputs.set(value.recoveryId, inputKey);
  try { localStorage.setItem(key, JSON.stringify(value));
    if (value.recoveryId) localStorage.setItem(`${RECOVERY_KEY_PREFIX}${value.recoveryId}`, key);
  } catch { /* memory fallback for SSR/private mode */ }
}
function forgetActiveOperation(key: string, inputKey: string): void {
  activeKeys.delete(inputKey);
  for (const [recoveryId, storedInput] of recoveryInputs) if (storedInput === inputKey) recoveryInputs.delete(recoveryId);
  try { const saved = readActiveOperation(key); if (saved?.recoveryId) {
      recoveryInputs.delete(saved.recoveryId); localStorage.removeItem(`${RECOVERY_KEY_PREFIX}${saved.recoveryId}`); }
    localStorage.removeItem(key); } catch { /* memory-only environment */ }
}

export async function recoverProofLock(recovery: string, token: string,
  transactionHash?: string, signal?: AbortSignal): Promise<ProofLockWriteOutcome> {
  const body = await requestJson("/api/admin/prooflocks/recovery", { method: "POST", signal, cache: "no-store",
    redirect: "error",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ recoveryId: recovery, ...(transactionHash ? { transactionHash } : {}) }) });
  const result = writeOutcomeSchema.parse(z.object({ result: writeOutcomeSchema }).parse(body).result) as ProofLockWriteOutcome;
  if (result.status === "NOT_BROADCAST" || result.status === "REVERTED" || result.status === "SEALED")
    forgetRecoveredOperation(result.recoveryId);
  return result;
}

function forgetRecoveredOperation(recoveryId: string): void {
  const inputKey = recoveryInputs.get(recoveryId); if (inputKey) activeKeys.delete(inputKey);
  recoveryInputs.delete(recoveryId);
  try { const indexKey = `${RECOVERY_KEY_PREFIX}${recoveryId}`; const storageKey = localStorage.getItem(indexKey);
    if (storageKey) localStorage.removeItem(storageKey); localStorage.removeItem(indexKey);
  } catch { /* memory-only environment */ }
}

export async function markOnDemandDrift(identityKey: string, token: string, signal?: AbortSignal): Promise<unknown> {
  return requestJson(`/api/admin/prooflocks/${encodeURIComponent(identityKey)}/drift`, { method: "POST", signal,
    cache: "no-store", redirect: "error",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ mark: true }) });
}

export function computeProofId(registryAddress: string, record: ProofLockRecord): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(registryAddress) || !/^0x[0-9a-fA-F]{64}$/.test(record.identityKey)) throw new Error("Invalid proof identifier input");
  const value = { schema: "sentinel.prooflock/id-v1", chainId: 16661, registryAddress: registryAddress.toLowerCase(),
    identityKey: record.identityKey.toLowerCase(), subject: record.subject.toLowerCase(), version: record.version,
    issuedAt: record.issuedAt, validUntil: record.validUntil, envelopeDigest: record.envelopeDigest.toLowerCase(),
    storageRoot: record.storageRoot.toLowerCase(), computeRoot: record.computeRoot.toLowerCase(), artifactHash: record.artifactHash.toLowerCase(),
    runtimeCodeHash: record.runtimeCodeHash.toLowerCase(), policyVersion: record.policyVersion,
    behavioralScore: record.behavioralScore, codeRisk: record.codeRisk, coverage: record.coverage };
  return keccak256(toUtf8Bytes(canonicalize(value)!)) as `0x${string}`;
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", ...init?.headers } });
  if (!response.ok) await throwResponse(response);
  return readBoundedJson(response);
}

async function throwResponse(response: Response): Promise<never> {
  const raw = await readBoundedJson(response).catch(() => null);
  const parsed = errorSchema.safeParse(raw);
  if (parsed.success) throw new ProofLockApiError(parsed.data.error as ApiErrorShape, response.status);
  throw new Error(`ProofLock request failed (${response.status})`);
}

const MAX_JSON_RESPONSE_BYTES = 1_048_576;
async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_RESPONSE_BYTES) responseTooLarge();
  if (!response.body) {
    const text = await response.text();
    if (text.length > MAX_JSON_RESPONSE_BYTES) responseTooLarge();
    return JSON.parse(text);
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_JSON_RESPONSE_BYTES) { await reader.cancel(); responseTooLarge(); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function responseTooLarge(): never { throw new Error("ProofLock response exceeds bounded size"); }

type RecordLimits = Readonly<{ keys: number; nodes: number; depth: number;
  array: number; stringUnits: number }>;
function boundedRecord(limits: RecordLimits) {
  return z.record(z.string().max(256), z.unknown()).superRefine((value, context) => {
    try { assertBoundedValue(value, limits); }
    catch (cause) { context.addIssue({ code: "custom",
      message: cause instanceof Error ? cause.message : "Object exceeds bounds" }); }
  });
}

function assertBoundedValue(root: unknown, limits: RecordLimits): void {
  const pending: Array<readonly [unknown, number]> = [[root, 0]];
  let nodes = 0; let stringUnits = 0;
  while (pending.length) {
    const [value, depth] = pending.pop()!; nodes += 1;
    if (nodes > limits.nodes || depth > limits.depth) throw new Error("Object exceeds structural bounds");
    if (typeof value === "string") { stringUnits += value.length;
      if (stringUnits > limits.stringUnits) throw new Error("Object strings exceed bounds"); }
    else if (Array.isArray(value)) { if (value.length > limits.array) throw new Error("Array exceeds bounds");
      for (const item of value) pending.push([item, depth + 1]); }
    else if (value && typeof value === "object") { const entries = Object.entries(value);
      if (entries.length > limits.keys) throw new Error("Object keys exceed bounds");
      for (const [, item] of entries) pending.push([item, depth + 1]); }
  }
}
