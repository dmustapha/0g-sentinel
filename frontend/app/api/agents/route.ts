// File: frontend/app/api/agents/route.ts
import { NextResponse } from "next/server";
import { getAttestationRegistry } from "@/lib/contracts";
import { agentDisplayName } from "@/lib/constants";

export async function GET() {
  try {
    const attestationRegistry = getAttestationRegistry();

    // Source of truth: AttestationRegistry.getAllAttestedAgents()
    // No registration step — the chain IS the registry.
    const attestedAddresses: string[] = await attestationRegistry.getAllAttestedAgents();

    const agents = await Promise.all(
      attestedAddresses.map(async (address) => {
        const name = agentDisplayName(address);
        const att = await attestationRegistry.getAttestation(address);
        const hasAtt = BigInt(att.attestation_timestamp) > 0n;
        if (!hasAtt) {
          return {
            address,
            name,
            behavioral_score: 0,
            threat_level: 0 as const,
            code_risk: 0 as const,
            code_findings: "",
            behavioral_receipt_hash: "",
            code_receipt_hash: "",
            evidence_hash: "",
            attestation_timestamp: 0,
            has_attestation: false,
          };
        }
        return {
          address,
          name,
          behavioral_score: Number(att.behavioral_score),
          threat_level: Number(att.threat_level) as 0 | 1 | 2,
          code_risk: Number(att.code_risk) as 0 | 1 | 2,
          code_findings: att.code_findings,
          reasoning: att.reasoning || "",
          behavioral_receipt_hash: att.behavioral_receipt_hash,
          code_receipt_hash: att.code_receipt_hash,
          evidence_hash: att.evidence_hash,
          attestation_timestamp: Number(att.attestation_timestamp),
          has_attestation: true,
        };
      })
    );

    return NextResponse.json({ agents, total: agents.length });
  } catch (error) {
    console.error("[AgentsAPI]", error);
    return NextResponse.json({ error: "Failed to fetch agents" }, { status: 500 });
  }
}
