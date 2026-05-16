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
      attestation_tx_hash: result.attestation_tx_hash,
    });
  } catch (error: unknown) {
    // Clear cooldown on failure — user should be able to retry immediately
    scanCooldowns.delete(agentAddress.toLowerCase());
    console.error("[BehavioralScanAPI] Scan error:", error);

    // Surface actionable error messages to the client
    const msg = String(error);
    let userError = "Scan failed. Please try again.";
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      userError = "Scan timed out — 0G network may be congested. Retry in 30s.";
    } else if (msg.includes("API error: 4") || msg.includes("401") || msg.includes("403")) {
      userError = "0G Compute API authentication error. Check API key configuration.";
    } else if (msg.includes("0G Storage") || msg.includes("StorageClient")) {
      userError = "Evidence archival failed. Check 0G Storage connectivity and retry.";
    } else if (msg.includes("nonce") || msg.includes("replacement fee")) {
      userError = "Transaction nonce conflict. Retry in 10s.";
    } else if (msg.includes("insufficient funds")) {
      userError = "Scanner wallet has insufficient funds for gas.";
    } else if (msg.includes("Invalid agent address")) {
      userError = "Invalid agent address format.";
    }

    return NextResponse.json({ error: userError }, { status: 500 });
  }
}
