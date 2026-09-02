// File: frontend/lib/scan-client.ts
// Public scan+seal client. Posts { agentId } to the tokenless /api/scan/stream front door,
// streams ceremony stages, and reconciles the on-chain result when the stream is cut short
// (Vercel commonly terminates the connection after WRITING_CHAIN, before the SEALED frame).
import { AbiCoder, keccak256 } from "ethers";
import { z } from "zod";
import { ProofLockApiError, readProofLockDetail } from "./prooflock-client";
import type { ApiErrorShape, GateDecision, ProofLockRecord, ProofLockRiskAnalysis, RunnerStage } from "./prooflock-types";

// ERC-8004 identity registry on 0G (Chain ID 16661). The public front door binds every scan
// to this registry, so the identity key derivation must use the exact same constant.
export const SCAN_REGISTRY_ADDRESS = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const SCAN_CHAIN_ID = 16661;

const stageSchema = z.enum(["VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS",
  "RUNNING_COMPUTE", "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE", "VERIFYING_STORAGE", "WRITING_CHAIN",
  "READING_CHAIN_BACK", "SEALED"]);

const errorFrameSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().max(16_384),
  stage: z.string().min(1).max(64),
  retryable: z.boolean(),
  requestId: z.string().min(1).max(128),
});

export type ScanSealed = Readonly<{
  identityKey: `0x${string}`;
  agentId: string;
  proofId?: `0x${string}`;
  version?: string;
  storageRoot?: `0x${string}`;
  gate: GateDecision | null;
  // The plain-English risk verdict (score, label, summary, factors) restored from the sealed evidence.
  // Present when the on-chain read-back returns a VERIFIED detail; the scan result renders it.
  analysis?: ProofLockRiskAnalysis;
  source: "STREAM" | "RECONCILED";
}>;

export type ScanRunHandlers = Readonly<{
  onStage(stage: RunnerStage): void;
  signal?: AbortSignal;
}>;

// The on-chain identity key: keccak256(abi.encode(uint256 chainId, address registry, uint256 agentId)).
// Derived client-side so reconciliation can read the lease back without a round trip.
export function computeScanIdentityKey(agentId: string): `0x${string}` {
  return keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"],
    [SCAN_CHAIN_ID, SCAN_REGISTRY_ADDRESS, BigInt(agentId)])) as `0x${string}`;
}

// Streams the seal ceremony. Returns whether the stream reached WRITING_CHAIN so the caller can
// decide to reconcile on an interrupted or errored connection. Throws ScanStreamError with a typed
// ApiErrorShape for pre-chain failures (invalid agentId, rate limit, allowance exhausted).
export async function runPublicScan(agentId: string, handlers: ScanRunHandlers,
  turnstileToken?: string): Promise<ScanStreamResult> {
  const response = await fetch("/api/scan/stream", {
    method: "POST", cache: "no-store", redirect: "error", signal: handlers.signal,
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(turnstileToken ? { agentId, turnstileToken } : { agentId }),
  });
  if (!response.ok || !response.body) {
    const detail = await readErrorResponse(response);
    throw new ScanStreamError(detail, false);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reachedChainWrite = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (!frame.startsWith("data: ")) continue;
        const payload = JSON.parse(frame.slice(6)) as Record<string, unknown>;
        if (payload.type === "stage") {
          const stage = stageSchema.parse(payload.stage) as RunnerStage;
          if (stage === "WRITING_CHAIN") reachedChainWrite = true;
          handlers.onStage(stage);
          if (stage === "SEALED") return { kind: "SEALED", reachedChainWrite: true };
        } else if (payload.type === "complete") {
          return { kind: "SEALED", reachedChainWrite: true };
        } else if (payload.type === "error") {
          const detail = errorFrameSchema.parse(payload.error) as ApiErrorShape;
          throw new ScanStreamError(detail, reachedChainWrite);
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  // The stream ended without a terminal SEALED/complete frame. If it reached WRITING_CHAIN the
  // on-chain seal may already be final, so the caller reconciles rather than treating this as failure.
  return { kind: "INTERRUPTED", reachedChainWrite };
}

// Reads the current lease back from chain to confirm a seal the stream may not have reported.
export async function reconcileScan(agentId: string, signal?: AbortSignal): Promise<ScanSealed | null> {
  const identityKey = computeScanIdentityKey(agentId);
  try {
    const detail = await readProofLockDetail(identityKey, signal, agentId);
    const gate: GateDecision | null = detail.detail.status === "VERIFIED"
      && detail.detail.gate.status === "VERIFIED"
      ? { allowed: detail.detail.gate.allowed, reason: detail.detail.gate.reason,
        subject: detail.detail.gate.subject, version: detail.detail.gate.version }
      : null;
    const analysis = detail.detail.status === "VERIFIED" ? detail.detail.analysis : undefined;
    return sealedFromDetail(agentId, identityKey, detail.proofLock, detail.proofId, gate, "RECONCILED", analysis);
  } catch (cause) {
    if (cause instanceof ProofLockApiError && cause.detail.code === "NOT_FOUND") return null;
    throw cause;
  }
}

function sealedFromDetail(agentId: string, identityKey: `0x${string}`, record: ProofLockRecord,
  proofId: `0x${string}` | undefined, gate: GateDecision | null, source: ScanSealed["source"],
  analysis?: ProofLockRiskAnalysis): ScanSealed {
  return {
    identityKey, agentId, proofId, version: record.version,
    storageRoot: record.storageRoot as `0x${string}`, gate, source, analysis,
  };
}

export type ScanStreamResult =
  | Readonly<{ kind: "SEALED"; reachedChainWrite: true }>
  | Readonly<{ kind: "INTERRUPTED"; reachedChainWrite: boolean }>;

export class ScanStreamError extends Error {
  constructor(readonly detail: ApiErrorShape, readonly reachedChainWrite: boolean) {
    super(detail.message);
    this.name = "ScanStreamError";
  }
}

async function readErrorResponse(response: Response): Promise<ApiErrorShape> {
  try {
    const raw = await response.json();
    const parsed = errorFrameSchema.safeParse((raw as { error?: unknown })?.error);
    if (parsed.success) return parsed.data as ApiErrorShape;
  } catch { /* fall through to a generic shape */ }
  return {
    code: response.status === 429 ? "RATE_LIMIT" : "DEPENDENCY_UNAVAILABLE",
    message: response.status === 429 ? "Public scan is busy; try again shortly"
      : "The scan service is unavailable right now.",
    stage: "AUTHENTICATING", retryable: true, requestId: "client",
  };
}

// Human-friendly copy for the error codes the public front door can return.
export function friendlyScanError(detail: ApiErrorShape): Readonly<{ title: string; body: string }> {
  switch (detail.code) {
    case "INVALID_INPUT":
      return { title: "That agent ID is not valid.", body: "Enter a whole-number ERC-8004 agent ID, then scan again." };
    case "AGENT_NOT_FOUND":
      return { title: "No ERC-8004 agent found.", body: "That agent ID is not registered on Chain ID 16661." };
    case "AGENT_WALLET_UNSET":
      return { title: "Agent wallet is not set.", body: "This agent has no current wallet to bind, so it cannot be sealed yet." };
    case "RATE_LIMIT":
      return { title: "The scanner is busy.", body: "The public demo is rate limited. Wait a moment and try again." };
    case "CHALLENGE_FAILED":
      return { title: "Human check needed.", body: "Complete the verification challenge, then run the scan again." };
    case "DAILY_CEREMONY_LIMIT":
    case "DAILY_COST_LIMIT":
      return { title: "Live allowance reached for now.", body: "The capped demo allowance is spent. It resets shortly; try again later." };
    case "OPERATOR_CONCURRENCY_LIMIT":
    case "GLOBAL_CONCURRENCY_LIMIT":
    case "CONCURRENCY_LIMIT":
      return { title: "A scan is already running.", body: "Only one live seal runs at a time. Wait for it to finish, then try again." };
    case "SUBMISSION_OUTCOME_UNKNOWN":
    case "FINALIZED_READBACK_UNAVAILABLE":
      return { title: "Seal submitted; confirming on chain.", body: "The write reached the chain. We are reading the lease back to confirm." };
    default:
      return { title: "The scan stopped safely.", body: "No irreversible state was left behind. You can try the scan again." };
  }
}

// Client-side address helpers for the /scan front door. An address is resolved to its agentId only
// when the server verifies getAgentWallet on-chain (foolproof); a non-agent address returns NOT_AN_AGENT.
export function looksLikeAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export type AddressResolution =
  | Readonly<{ status: "AGENT"; agentId: string }>
  | Readonly<{ status: "NOT_AN_AGENT" }>
  | Readonly<{ status: "ERROR" }>;

export async function resolveAddressToAgentId(address: string, signal?: AbortSignal): Promise<AddressResolution> {
  try {
    const response = await fetch(`/api/agents/resolve-address?address=${encodeURIComponent(address)}`,
      { headers: { accept: "application/json" }, signal });
    if (response.ok) {
      const body = (await response.json()) as { agentId?: unknown };
      if (typeof body.agentId === "string" && /^(0|[1-9]\d*)$/.test(body.agentId)) {
        return { status: "AGENT", agentId: body.agentId };
      }
      return { status: "ERROR" };
    }
    if (response.status === 404) return { status: "NOT_AN_AGENT" };
    return { status: "ERROR" };
  } catch {
    return { status: "ERROR" };
  }
}
