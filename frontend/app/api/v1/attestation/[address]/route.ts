import { NextRequest, NextResponse } from "next/server";
import { getAttestationRegistry } from "@/lib/contracts";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;
  if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  try {
    const registry = getAttestationRegistry();
    const att = await registry.getAttestation(address);
    const hasAtt = BigInt(att.attestation_timestamp) > 0n;
    if (!hasAtt) {
      return NextResponse.json({ error: "No attestation found" }, { status: 404 });
    }
    return NextResponse.json({
      address,
      behavioral_score: Number(att.behavioral_score),
      threat_level: Number(att.threat_level),
      code_risk: Number(att.code_risk),
      code_findings: att.code_findings,
      reasoning: att.reasoning,
      behavioral_receipt_hash: att.behavioral_receipt_hash,
      code_receipt_hash: att.code_receipt_hash,
      evidence_hash: att.evidence_hash,
      attestation_timestamp: Number(att.attestation_timestamp),
      verified: true,
    });
  } catch (err) {
    console.error("[AttestationAPI] Error:", err);
    return NextResponse.json({ error: "Registry read failed" }, { status: 500 });
  }
}
