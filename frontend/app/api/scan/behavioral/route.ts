// File: frontend/app/api/scan/behavioral/route.ts
// POST /api/scan/behavioral — triggers a full two-pipeline scan (behavioral + code) for an agent.
// Runs Pipeline 1 (behavioral signals → 0G Compute) and Pipeline 2 (Solidity audit → 0G Compute)
// in parallel, archives evidence to 0G Storage, then writes the attestation to 0G Chain.
import { NextRequest, NextResponse } from "next/server";
import { runFullScan } from "@scanner/scanner";

const MAX_BODY_BYTES = 64 * 1024; // 64KB — an agent address scan never needs more

// Simple in-memory rate limiter: 1 scan per address per 60s
const scanCooldowns = new Map<string, number>();
const SCAN_COOLDOWN_MS = 60_000;

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  let body: { agentAddress?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { agentAddress } = body;
  if (!agentAddress || typeof agentAddress !== "string" || !agentAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
    return NextResponse.json({ error: "Invalid agent address" }, { status: 400 });
  }

  const now = Date.now();
  // Purge stale entries to prevent unbounded memory growth in long-lived processes
  for (const [addr, ts] of scanCooldowns) {
    if (now - ts > SCAN_COOLDOWN_MS) scanCooldowns.delete(addr);
  }
  const lastScan = scanCooldowns.get(agentAddress.toLowerCase());
  if (lastScan && now - lastScan < SCAN_COOLDOWN_MS) {
    const retryAfter = Math.ceil((SCAN_COOLDOWN_MS - (now - lastScan)) / 1000);
    return NextResponse.json(
      { error: `Scan already in progress or recently completed. Retry in ${retryAfter}s.` },
      { status: 429 }
    );
  }
  // Set cooldown at start to prevent parallel scans for the same address.
  // Cleared on failure so the user can retry immediately after a failed scan.
  scanCooldowns.set(agentAddress.toLowerCase(), now);

  try {
    const result = await runFullScan(agentAddress);

    return NextResponse.json({
      success: true,
      agentAddress,
      behavioral_score: result.behavioral_score,
      threat_level: result.threat_level,
      reasoning: result.reasoning,
      code_risk: result.code_risk,
      code_findings: result.code_findings,
      behavioral_receipt_hash: result.behavioral_receipt_hash,
      code_receipt_hash: result.code_receipt_hash,
      evidence_hash: result.evidence_hash,
      evidence_on_0g_storage: result.evidence_on_0g_storage,
      inference_verified: result.inference_verified,
      attestation_tx_hash: result.attestation_tx_hash,
    });
  } catch (error: unknown) {
    // Clear cooldown on failure — user should be able to retry immediately
    scanCooldowns.delete(agentAddress.toLowerCase());
    // Log full error details — visible in Vercel function logs for diagnosis
    const rawMsg = error instanceof Error ? error.message : String(error);
    console.error("[BehavioralScanAPI] Scan error for", agentAddress, "—", rawMsg);

    // Surface actionable error messages to the client
    const msg = rawMsg.toLowerCase();
    let userError: string;
    if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("aborted") || msg.includes("timed out")) {
      userError = "Scan timed out — 0G network may be congested. Retry in 30s.";
    } else if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("api error: 4")) {
      userError = "0G Compute API authentication error. Check API key configuration.";
    } else if (msg.includes("compute api error:") || msg.includes("router-api") || msg.includes("0g compute")) {
      // 5xx or other non-auth compute errors
      userError = "0G Compute returned an error. Retry in 30s.";
    } else if (msg.includes("fetch failed") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("network error") || msg.includes("could not detect network")) {
      userError = "Network error reaching 0G services. Check connectivity and retry.";
    } else if (msg.includes("0g storage") || msg.includes("storageclient")) {
      userError = "Evidence archival failed. Check 0G Storage connectivity and retry.";
    } else if (msg.includes("nonce") || msg.includes("replacement fee") || msg.includes("underpriced") || msg.includes("already known") || msg.includes("same hash")) {
      userError = "Transaction nonce conflict. Retry in 10s.";
    } else if (msg.includes("insufficient funds")) {
      userError = "Scanner wallet has insufficient funds for gas.";
    } else if (msg.includes("invalid agent address")) {
      userError = "Invalid agent address format.";
    } else if (msg.includes("invalid_argument") || msg.includes("invalid private key") || msg.includes("invalid address")) {
      userError = "Scanner configuration error — check SCANNER_PRIVATE_KEY and ATTESTATION_REGISTRY_ADDRESS.";
    } else if (msg.includes("failed to parse")) {
      userError = "AI model returned unexpected response. Retry in a few seconds.";
    } else if (msg.includes("execution reverted") || msg.includes("call_exception") || msg.includes("bad_data")) {
      userError = "On-chain write failed — contract rejected transaction. Retry in 10s.";
    } else if (msg.includes("scanner_busy")) {
      userError = "Auto-scan queue is writing to chain — retry in 15s.";
    } else {
      // Unknown error — include a fragment so Vercel logs can be correlated
      userError = `Scan failed (${rawMsg.slice(0, 80)}). Retry in 10s.`;
    }

    return NextResponse.json({ error: userError }, { status: 500 });
  }
}
