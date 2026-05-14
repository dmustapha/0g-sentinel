// File: frontend/app/api/scan/code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runCodeScanOnly } from "@scanner/scanner";

export async function POST(req: NextRequest) {
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
