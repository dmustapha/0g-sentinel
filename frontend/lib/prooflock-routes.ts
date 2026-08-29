import type { VerifiedProof } from "@/lib/prooflock-types";
import { isCanonicalAgentId, parseNonZeroBytes32 } from "@/lib/prooflock-validation";

type VerifyHistorical = (proofId: string, identityKey: string, signal: AbortSignal,
  sourceTxHash?: string) => Promise<VerifiedProof>;
const SOURCE_TX_HASH_LENGTH = 66;

export type SourceTxHashParam =
  | Readonly<{ status: "ABSENT" | "INVALID" }>
  | Readonly<{ status: "VALID"; value: `0x${string}` }>;

export type LinkedHistoricalProof =
  | Readonly<{ status: "MATCH"; proof: VerifiedProof }>
  | Readonly<{ status: "STALE_LINK" | "MISMATCH" | "HINT_REQUIRED" | "UNAVAILABLE" }>;

export function canonicalAgentHref(agentId: string, sourceTxHash?: string): string {
  if (!isCanonicalAgentId(agentId)) throw new Error("Canonical decimal agent ID required");
  return withQuery(`/agents/${agentId}`, sourceTxHash ? { sourceTxHash: bytes32(sourceTxHash, "source transaction") } : {});
}

export function canonicalProofHref(proofId: string, identityKey: string, sourceTxHash?: string): string {
  const proof = bytes32(proofId, "proof ID");
  const query: Record<string, string> = { identityKey: bytes32(identityKey, "identity key") };
  if (sourceTxHash) query.sourceTxHash = bytes32(sourceTxHash, "source transaction");
  return withQuery(`/proof/${proof}`, query);
}

export function parseSourceTxHashParam(value: string | null): SourceTxHashParam {
  if (value === null) return { status: "ABSENT" };
  if (value.length !== SOURCE_TX_HASH_LENGTH) return { status: "INVALID" };
  const parsed = parseNonZeroBytes32(value);
  return parsed ? { status: "VALID", value: parsed } : { status: "INVALID" };
}

export async function verifyLinkedHistoricalProof(
  identifiers: Readonly<{ proofId: string; identityKey: string; sourceTxHash?: string }>,
  signal: AbortSignal,
  verify: VerifyHistorical,
): Promise<LinkedHistoricalProof> {
  const proofId = bytes32(identifiers.proofId, "proof ID");
  const identityKey = bytes32(identifiers.identityKey, "identity key");
  const sourceTxHash = identifiers.sourceTxHash
    ? bytes32(identifiers.sourceTxHash, "source transaction") : undefined;
  try {
    const proof = await verify(proofId, identityKey, signal, sourceTxHash);
    const status = compareTuple(proof, proofId, identityKey, sourceTxHash);
    return status === "MATCH" ? { status, proof } : { status };
  } catch (cause) {
    if (signal.aborted) throw cause;
    const code = apiErrorCode(cause);
    if (code === "HINT_REQUIRED") return { status: "HINT_REQUIRED" };
    if (sourceTxHash && code === "NOT_FOUND") return { status: "STALE_LINK" };
    if (code === "MISMATCH" || code === "NOT_FOUND") return { status: "MISMATCH" };
    return { status: "UNAVAILABLE" };
  }
}

function compareTuple(proof: VerifiedProof, proofId: string, identityKey: string,
  sourceTxHash?: string): "MATCH" | "STALE_LINK" | "MISMATCH" {
  const returnedProof = parseNonZeroBytes32(proof.proofId);
  const returnedIdentity = parseNonZeroBytes32(proof.identityKey);
  const returnedSource = parseNonZeroBytes32(proof.source.transactionHash);
  if (returnedProof !== proofId || returnedIdentity !== identityKey || !returnedSource) return "MISMATCH";
  if (sourceTxHash && returnedSource !== sourceTxHash) return "MISMATCH";
  return "MATCH";
}

function withQuery(path: string, values: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams(values).toString();
  return query ? `${path}?${query}` : path;
}

function bytes32(value: string, label: string): string {
  const parsed = parseNonZeroBytes32(value);
  if (!parsed) throw new Error(`Exact nonzero bytes32 ${label} required`);
  return parsed;
}

function apiErrorCode(cause: unknown): string | undefined {
  if (!cause || typeof cause !== "object" || !("detail" in cause)) return undefined;
  const detail = (cause as { detail?: unknown }).detail;
  return detail && typeof detail === "object" && "code" in detail
    && typeof (detail as { code?: unknown }).code === "string"
    ? (detail as { code: string }).code : undefined;
}
