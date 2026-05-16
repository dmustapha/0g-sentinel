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
  const lastScan = scanCooldowns.get(agentAddress.toLowerCase());
  if (lastScan && now - lastScan < SCAN_COOLDOWN_MS) {
    const retryAfter = Math.ceil((SCAN_COOLDOWN_MS - (now - lastScan)) / 1000);
    return NextResponse.json(
      { error: `Scan already in progress or recently completed. Retry in ${retryAfter}s.` },
      { status: 429 }
    );
  }
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
  } catch (error) {
    console.error("[BehavioralScanAPI] Scan error:", error);
    return NextResponse.json(
      { error: "Scan failed — see server logs for details" },
      { status: 500 }
    );
  }
}
