// File: app/api/scan/queue/route.ts
// GET /api/scan/queue — returns current auto-scan queue status.
// Polled by the QueueBanner client component every 5 seconds.
import { NextResponse } from "next/server";
import { getQueueStatus } from "@scanner/queue";

export async function GET() {
  return NextResponse.json(getQueueStatus());
}
