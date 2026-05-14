// File: frontend/app/api/agents/route.ts
import { NextResponse } from "next/server";
import { getAttestationRegistry, getAgentRegistry } from "@/lib/contracts";

const AGENT_NAMES: Record<string, string> = {
  [process.env.AGENT_A_ADDRESS?.toLowerCase() ?? ""]: "Agent Alpha",
  [process.env.AGENT_B_ADDRESS?.toLowerCase() ?? ""]: "Agent Beta",
  [process.env.AGENT_C_ADDRESS?.toLowerCase() ?? ""]: "Agent Gamma",
  [process.env.AGENT_D_ADDRESS?.toLowerCase() ?? ""]: "Agent Delta",
  [process.env.AGENT_E_ADDRESS?.toLowerCase() ?? ""]: "Agent Epsilon",
  [process.env.AGENT_F_ADDRESS?.toLowerCase() ?? ""]: "Agent Zeta",
  [process.env.AGENT_G_ADDRESS?.toLowerCase() ?? ""]: "Agent Eta",
  [process.env.AGENT_H_ADDRESS?.toLowerCase() ?? ""]: "Agent Theta",
};

export async function GET() {
  try {
    const attestationRegistry = getAttestationRegistry();
    const agentRegistry = getAgentRegistry();

    const agentAddresses: string[] = await agentRegistry.getAllAgents();

    const agents = await Promise.all(
      agentAddresses.map(async (address) => {
        const has = await attestationRegistry.hasAttestation(address);
        if (!has) {
          return {
            address,
            name: AGENT_NAMES[address.toLowerCase()] || `Agent ${address.slice(0, 6)}...${address.slice(-4)}`,
            behavioral_score: 0,
            threat_level: 1 as const,
            code_risk: 1 as const,
            code_findings: "",
            behavioral_receipt_hash: "",
            code_receipt_hash: "",
            evidence_hash: "",
            attestation_timestamp: 0,
            has_attestation: false,
          };
        }
        const att = await attestationRegistry.getAttestation(address);
        return {
          address,
          name: AGENT_NAMES[address.toLowerCase()] || `Agent ${address.slice(0, 6)}...${address.slice(-4)}`,
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
