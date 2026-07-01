// File: frontend/lib/scan-errors.ts
// Shared scan-error mapper — used by both the blocking route (/api/scan/behavioral)
// and the streaming route (/api/scan/stream) so user-facing error copy stays
// consistent and lives in one place. No em-dashes in user-facing strings (standing rule).

/**
 * Map a raw scan error message to an actionable, user-facing string.
 * The raw message is also logged server-side (Vercel function logs) for correlation.
 */
export function mapScanError(rawMsg: string): string {
  const msg = rawMsg.toLowerCase();
  if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("aborted") || msg.includes("timed out")) {
    return "Scan timed out. 0G network may be congested. Retry in 30s.";
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("api error: 4")) {
    return "0G Compute API authentication error. Check API key configuration.";
  }
  if (msg.includes("compute api error:") || msg.includes("router-api") || msg.includes("0g compute")) {
    return "0G Compute returned an error. Retry in 30s.";
  }
  if (msg.includes("fetch failed") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("network error") || msg.includes("could not detect network")) {
    return "Network error reaching 0G services. Check connectivity and retry.";
  }
  if (msg.includes("0g storage") || msg.includes("storageclient")) {
    return "Evidence archival failed. Check 0G Storage connectivity and retry.";
  }
  if (msg.includes("nonce") || msg.includes("replacement fee") || msg.includes("underpriced") || msg.includes("already known") || msg.includes("same hash")) {
    return "Transaction nonce conflict. Retry in 10s.";
  }
  if (msg.includes("insufficient funds")) {
    return "Scanner wallet has insufficient funds for gas.";
  }
  if (msg.includes("invalid agent address")) {
    return "Invalid agent address format.";
  }
  if (msg.includes("invalid_argument") || msg.includes("invalid private key") || msg.includes("invalid address")) {
    return "Scanner configuration error. Check SCANNER_PRIVATE_KEY and ATTESTATION_REGISTRY_ADDRESS.";
  }
  if (msg.includes("failed to parse")) {
    return "AI model returned unexpected response. Retry in a few seconds.";
  }
  if (msg.includes("execution reverted") || msg.includes("call_exception") || msg.includes("bad_data")) {
    return "On-chain write failed. Contract rejected transaction. Retry in 10s.";
  }
  if (msg.includes("scanner_busy")) {
    return "Auto-scan queue is writing to chain. Retry in 15s.";
  }
  // Unknown error — include a fragment so Vercel logs can be correlated
  return `Scan failed (${rawMsg.slice(0, 80)}). Retry in 10s.`;
}
