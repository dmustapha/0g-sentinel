// File: frontend/lib/agents.ts
// Server-side fetch of every attested agent, risk-ranked (riskiest first). Shared by the
// home risk board and the /agents dashboard so both inherit identical on-chain data + ordering.
import { getAttestationRegistry } from "@/lib/contracts";
import { AgentWithAttestation } from "@/lib/types";
import { agentDisplayName } from "@/lib/constants";
import { rankByRisk } from "@/lib/ranking";

export function canonicalAgentHref(agentId: string): string {
  if (!/^(0|[1-9]\d*)$/.test(agentId) || BigInt(agentId) >= 1n << 256n) throw new Error("Verified decimal agent ID required");
  return `/agents/${agentId}`;
}

export async function fetchRankedAgents(): Promise<{ agents: AgentWithAttestation[]; addresses: string[] }> {
  const attestationRegistry = getAttestationRegistry();

  // Source of truth: every address ever attested via Sentinel — no registration step.
  const attestedAddresses: string[] = await attestationRegistry.getAllAttestedAgents();

  const agents = await Promise.all(
    attestedAddresses.map(async (address) => {
      const name = agentDisplayName(address);
      // Single RPC call: getAttestation returns a zero-value struct if no attestation.
      // attestation_timestamp === 0 is the reliable "no attestation" sentinel.
      const att = await attestationRegistry.getAttestation(address);
      const hasAtt = BigInt(att.attestation_timestamp) > 0n;
      if (!hasAtt) {
        return {
          address, name,
          behavioral_score: 0, threat_level: 0 as const, code_risk: 0 as const,
          code_findings: "", reasoning: "", behavioral_receipt_hash: "", code_receipt_hash: "",
          evidence_hash: "", attestation_timestamp: 0, has_attestation: false,
        };
      }
      return {
        address, name,
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

  // Threat-board ordering: riskiest agents first (D3 ranking logic).
  return { agents: rankByRisk(agents), addresses: attestedAddresses };
}
