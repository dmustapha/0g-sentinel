// File: frontend/app/api/agents/route.ts
import { NextResponse } from "next/server";
import { getAttestationRegistry } from "@/lib/contracts";
import { agentDisplayName, KNOWN_0G_CONTRACTS } from "@/lib/constants";

export async function GET() {
  try {
    const attestationRegistry = getAttestationRegistry();

    // Primary source: AttestationRegistry.getAllAttestedAgents()
    // This returns every address that has ever been attested via Sentinel — no
    // registration step required. The chain IS the registry.
    const attestedAddresses: string[] = await attestationRegistry.getAllAttestedAgents();

    // Merge with known 0G contracts that haven't been attested yet.
    // These appear as "NOT SCANNED" scan targets on the dashboard.
    const attestedSet = new Set(attestedAddresses.map((a) => a.toLowerCase()));
    const unseenKnown = KNOWN_0G_CONTRACTS.filter(
      (a) => !attestedSet.has(a.toLowerCase())
    );

    const allAddresses = [...attestedAddresses, ...unseenKnown];

    const agents = await Promise.all(
      allAddresses.map(async (address) => {
        const name = agentDisplayName(address);
        // Single RPC call — attestation_timestamp === 0 means no attestation written yet.
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
