import { z } from "zod";
import { keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "json-canonicalize";

import type {
  ApiErrorShape, CanonicalIdentity, DiscoveryRecord, HealthSnapshot, OperatorRunInput,
  ProofLockDetailResponse, ProofLockRecord, RunnerStage, VerifiedProof,
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
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), stage: z.string(),
  retryable: z.boolean(), requestId: z.string() }) });

export class ProofLockApiError extends Error {
  constructor(readonly detail: ApiErrorShape, readonly status: number) { super(detail.message); this.name = "ProofLockApiError"; }
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
): Promise<unknown> {
  const response = await fetch("/api/admin/prooflocks/stream", { method: "POST", signal, cache: "no-store",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  if (!response.ok || !response.body) await throwResponse(response);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const payload = frame.startsWith("data: ") ? JSON.parse(frame.slice(6)) as Record<string, unknown> : null;
      if (payload?.type === "stage") onStage(payload.stage as RunnerStage);
      if (payload?.type === "error") throw new ProofLockApiError(payload.error as unknown as ApiErrorShape, 500);
      if (payload?.type === "complete") return payload.result;
    }
  }
  throw new Error("ProofLock stream ended without a terminal result");
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
