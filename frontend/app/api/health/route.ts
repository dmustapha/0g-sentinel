// File: frontend/app/api/health/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    compute_endpoint: process.env.ZERO_G_COMPUTE_URL || "https://router-api.0g.ai/v1",
    rpc: process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai",
    registry: process.env.NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS || "not configured",
    timestamp: new Date().toISOString(),
  });
}
