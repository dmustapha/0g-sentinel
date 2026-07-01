// File: frontend/app/api/scan/stream/route.ts
// POST /api/scan/stream — same full two-pipeline scan as /api/scan/behavioral, but streams
// live progress as Server-Sent Events (SSE) so the client can render each stage as it happens:
// discover → behavioral (0G Compute) → code (0G Compute) → evidence (0G Storage) → attest (0G Chain / SETTLED).
// The engine (runFullScan) is shared; this route only forwards its onProgress events as SSE frames.
import { NextRequest, NextResponse } from "next/server";
import { runFullScan } from "@scanner/scanner";
import { mapScanError } from "@/lib/scan-errors";

// Node runtime + dynamic — required for a long-lived streamed response (no static caching/buffering).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BODY_BYTES = 64 * 1024; // 64KB — an agent address scan never needs more

// In-memory rate limiter: 1 scan per address per 60s (mirrors the blocking route).
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
  for (const [addr, ts] of scanCooldowns) {
    if (now - ts > SCAN_COOLDOWN_MS) scanCooldowns.delete(addr);
  }
  const key = agentAddress.toLowerCase();
  const lastScan = scanCooldowns.get(key);
  if (lastScan && now - lastScan < SCAN_COOLDOWN_MS) {
    const retryAfter = Math.ceil((SCAN_COOLDOWN_MS - (now - lastScan)) / 1000);
    return NextResponse.json(
      { error: `Scan already in progress or recently completed. Retry in ${retryAfter}s.` },
      { status: 429 }
    );
  }
  scanCooldowns.set(key, now);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // Controller already closed (client disconnected) — ignore.
        }
      };

      // Flush an initial frame immediately so the client renders the checklist at t=0
      // (kills perceived latency; also defeats intermediary buffering).
      send({ type: "open", agentAddress });

      try {
        const result = await runFullScan(agentAddress, (ev) => send({ type: "progress", ...ev }));
        send({
          type: "complete",
          result: {
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
          },
        });
      } catch (error: unknown) {
        // Clear cooldown on failure — user should be able to retry immediately.
        scanCooldowns.delete(key);
        const rawMsg = error instanceof Error ? error.message : String(error);
        console.error("[StreamScanAPI] Scan error for", agentAddress, "—", rawMsg);
        send({ type: "error", error: mapScanError(rawMsg) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
