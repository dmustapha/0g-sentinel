// File: frontend/app/api/scan/code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runCodeScanOnly } from "@scanner/scanner";

const MAX_BODY_BYTES = 64 * 1024; // 64KB

// Simple in-memory rate limiter: 1 code scan per address per 60s
const scanCooldowns = new Map<string, number>();
const SCAN_COOLDOWN_MS = 60_000;

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  let body: { agentAddress?: unknown; contractSource?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { agentAddress, contractSource } = body;
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
    const result = await runCodeScanOnly(
      agentAddress as string,
      typeof contractSource === "string" ? contractSource : ""
    );
    return NextResponse.json({ success: true, result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
