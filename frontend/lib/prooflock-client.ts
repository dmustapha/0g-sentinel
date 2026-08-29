import { z } from "zod";
import { keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "json-canonicalize";

import type {
  ApiErrorShape, CanonicalIdentity, DiscoveryRecord, HealthSnapshot, OperatorRunInput,
  OperatorRunProgress, OperatorTerminalResult, ProofLockDetailResponse, ProofLockRecord,
  ProofLockWriteOutcome, RunnerStage, VerifiedProof,
} from "./prooflock-types";

const hex20 = z.string().regex(/^0x[0-9a-f]{40}$/i);
const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/i);
const decimal = z.string().regex(/^(0|[1-9]\d*)$/);
const identitySchema = z.object({
  identity: z.object({ namespace: z.literal("eip155"), chainId: z.literal(16661), registryAddress: hex20, agentId: decimal }),
  owner: hex20, agentWallet: hex20, agentURI: z.string(), registrationDigest: hex32,
  sourceBlockNumber: decimal, sourceBlockHash: hex32, card: z.record(z.string(), z.unknown()),
});
const lockSchema = z.object({
  identityKey: hex32, subject: hex20, envelopeDigest: hex32, storageRoot: hex32, computeRoot: hex32,
  artifactHash: hex32, runtimeCodeHash: hex32, version: decimal, issuedAt: decimal, validUntil: decimal,
  policyVersion: z.number().int().nonnegative(), behavioralScore: z.number().int().min(0).max(100),
  codeRisk: z.number().int().min(0).max(2), coverage: z.number().int().min(0).max(255),
  state: z.number().int().min(0).max(255), stateReason: z.number().int().min(0).max(255),
});
const unknownGateSchema = z.object({ status: z.literal("UNKNOWN"), allowed: z.literal(false), reason: z.null() });
const verifiedGateSchema = z.object({ status: z.literal("VERIFIED"), allowed: z.boolean(), reason: z.number().int().min(0).max(255),
  subject: hex20, version: decimal });
const unknownConsumerSchema = z.object({ status: z.literal("UNKNOWN"), accepted: z.literal(false) });
const verifiedConsumerSchema = z.object({ status: z.literal("VERIFIED"), accepted: z.boolean(), address: hex20, subject: hex20, version: decimal });
const identitySummarySchema = z.object({ identityKey: hex32, namespace: z.literal("eip155"), chainId: z.literal(16661),
  registryAddress: hex20, agentId: decimal, owner: hex20, agentWallet: hex20, registrationUri: z.string(),
  registrationDigest: hex32, sourceBlockNumber: decimal, sourceBlockHash: hex32 });
const resolutionSummarySchema = z.object({ owner: hex20, agentWallet: hex20, agentURI: z.string(),
  registrationDigest: hex32, sourceBlockNumber: decimal, sourceBlockHash: hex32 });
const detailSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("VERIFIED"), identity: identitySummarySchema, resolution: resolutionSummarySchema,
    gate: z.union([verifiedGateSchema, unknownGateSchema]), consumer: z.union([verifiedConsumerSchema, unknownConsumerSchema]) }),
  z.object({ status: z.literal("UNAVAILABLE"), code: z.enum(["EVIDENCE_UNAVAILABLE", "EVIDENCE_INVALID", "IDENTITY_UNAVAILABLE", "IDENTITY_INVALID"]),
    identity: z.null(), resolution: z.null(), gate: unknownGateSchema, consumer: unknownConsumerSchema }),
]);
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
const errorSchema = z.object({ error: z.object({ code: apiCodeSchema, message: z.string().min(1).max(512),
  stage: apiStageSchema, retryable: z.boolean(), requestId: z.string().min(1).max(128) }).strict() }).strict();
const recoveryId = z.string().regex(/^rec_[0-9a-f]{16,64}$/i);
const writeOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_BROADCAST"), recoveryId }),
  z.object({ status: z.literal("SUBMISSION_OUTCOME_UNKNOWN"), recoveryId, transactionHash: hex32.optional() }),
  z.object({ status: z.literal("FINALIZED_READBACK_UNAVAILABLE"), recoveryId, transactionHash: hex32,
    identityKey: hex32, version: decimal }),
  z.object({ status: z.literal("SEALED"), recoveryId, transactionHash: hex32, identityKey: hex32, version: decimal }),
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
    blockNumber: decimal, confirmations: z.number().int().positive() }).strict(),
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

export async function readProofLock(identityKey: string, signal?: AbortSignal): Promise<ProofLockRecord> {
  const body = await requestJson(`/api/v1/prooflocks/${encodeURIComponent(identityKey)}`, { signal });
  return lockSchema.parse(z.object({ identityKey: hex32, proofLock: lockSchema }).parse(body).proofLock) as ProofLockRecord;
}

export async function readProofLockDetail(identityKey: string, signal?: AbortSignal): Promise<ProofLockDetailResponse> {
  const body = await requestJson(`/api/v1/prooflocks/${encodeURIComponent(identityKey)}`, { signal });
  return z.object({ identityKey: hex32, proofLock: lockSchema, detail: detailSchema }).parse(body) as ProofLockDetailResponse;
}

export async function discoverProofLocks(signal?: AbortSignal): Promise<readonly DiscoveryRecord[]> {
  const body = await requestJson("/api/discover", { signal });
  return z.object({ identities: z.array(z.object({ identityKey: hex32, transactionHash: hex32,
    blockNumber: z.number().int().nonnegative() })) }).parse(body).identities as readonly DiscoveryRecord[];
}

export async function verifyProof(proofId: string, identityKey: string, signal?: AbortSignal, sourceTxHash?: string): Promise<VerifiedProof> {
  const query = new URLSearchParams({ identityKey }); if (sourceTxHash) query.set("sourceTxHash", sourceTxHash);
  const body = await requestJson(`/api/v1/proofs/${encodeURIComponent(proofId)}/verify?${query}`, { signal });
  const schema = z.object({ proofId: hex32, identityKey: hex32, source: z.object({ kind: z.literal("ProofLocked"),
      registryAddress: hex20, transactionHash: hex32, blockNumber: z.number().int().nonnegative(), blockHash: hex32,
      logIndex: z.number().int().nonnegative() }), proofLock: lockSchema,
    storage: z.object({ retrievalVerified: z.literal(true), networkProofVerified: z.literal(false),
      envelope: z.record(z.string(), z.unknown()), computeVerification: z.array(z.unknown()).optional(),
      storageCommitment: z.record(z.string(), z.unknown()).optional() }) });
  return schema.parse(body) as VerifiedProof;
}

export async function readHealth(signal?: AbortSignal): Promise<HealthSnapshot> {
  const response = await fetch("/api/health", { signal, cache: "no-store" });
  const raw = await response.json().catch(() => null);
  const probe = z.object({ status: z.enum(["HEALTHY", "UNHEALTHY", "UNKNOWN"]), latencyMs: z.number().nonnegative(),
    observedAt: z.string().datetime(),
    detail: z.record(z.string(), z.unknown()).optional() });
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
  const response = await fetch("/api/admin/prooflocks/stream", { method: "POST", signal, cache: "no-store",
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
    cache: "no-store", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
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
  return response.json();
}

async function throwResponse(response: Response): Promise<never> {
  const raw = await response.json().catch(() => null);
  const parsed = errorSchema.safeParse(raw);
  if (parsed.success) throw new ProofLockApiError(parsed.data.error as ApiErrorShape, response.status);
  throw new Error(`ProofLock request failed (${response.status})`);
}
