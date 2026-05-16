// File: frontend/app/agents/page.tsx
// Server component with ISR — no loading spinner on initial render.
// Rescan interactivity is isolated to the client RescanButton component.
import Link from "next/link";
import { getAttestationRegistry } from "@/lib/contracts";
import { AgentWithAttestation } from "@/lib/types";
import { ScanInput } from "@/components/ScanInput";
import { ChainDiscovery } from "@/components/ChainDiscovery";
import { AgentsTable } from "@/components/AgentsTable";
import { QueueBanner } from "@/components/QueueBanner";
import { agentDisplayName } from "@/lib/constants";

export const revalidate = 30;

async function fetchAgents(): Promise<{ agents: AgentWithAttestation[]; addresses: string[] }> {
  const attestationRegistry = getAttestationRegistry();

  // Source of truth: every address ever attested via Sentinel — no registration step.
  const attestedAddresses: string[] = await attestationRegistry.getAllAttestedAgents();

  const agents = await Promise.all(
    attestedAddresses.map(async (address) => {
      const name = agentDisplayName(address);
      // Single RPC call: getAttestation returns zero-value struct if no attestation.
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

  return { agents, addresses: attestedAddresses };
}

export default async function AgentsPage() {
  let agents: AgentWithAttestation[] = [];
  let attestedAddresses: string[] = [];
  let fetchError = false;

  try {
    const result = await fetchAgents();
    agents = result.agents;
    attestedAddresses = result.addresses;
  } catch {
    fetchError = true;
  }

  return (
    <div className="sg-dash-section">
      <div className="sg-dash-header">
        <div>
          <h1 className="sg-dash-title">Agents on 0G Chain</h1>
          <div className="sg-dash-subtitle">
            Source: AttestationRegistry · Behavioral audit · Code scan · 0G Aristotle
          </div>
        </div>
      </div>

      {/* Hero scan panel — prominent primary action */}
      <div style={{
        background: "rgba(6,182,212,0.04)",
        border: "1px solid rgba(6,182,212,0.18)",
        borderRadius: "6px",
        padding: "1.5rem",
        marginBottom: "2rem",
      }}>
        <div style={{
          fontFamily: "var(--font-dm-mono, monospace)",
          fontSize: "0.6875rem",
          color: "#06b6d4",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "0.5rem",
        }}>
          Scan any agent address
        </div>
        <div style={{
          fontFamily: "DM Mono, monospace",
          fontSize: "0.75rem",
          color: "rgba(255,255,255,0.25)",
          marginBottom: "1rem",
          lineHeight: 1.5,
        }}>
          Paste any 0G Aristotle contract or wallet address. Behavioral analysis + code audit runs via 0G Compute and writes an immutable attestation to chain.
        </div>
        <ScanInput />
      </div>

      {/* Auto-scan queue progress */}
      <QueueBanner />

      {fetchError ? (
        <div style={{
          padding: "4rem 0",
          fontFamily: "var(--font-dm-mono, monospace)",
          fontSize: "0.75rem",
          color: "#f43f5e",
          textAlign: "center",
        }}>
          Failed to load agents. Check RPC connection.
        </div>
      ) : (
        <AgentsTable agents={agents} />
      )}

      <div className="sg-dash-footer">
        <span className="sg-dash-footer-text">
          {agents.length} attested ·{" "}
          {agents.filter((a) => a.has_attestation && a.threat_level === 0 && a.code_risk === 0).length} verified safe ·{" "}
          {agents.filter((a) => a.has_attestation && (a.threat_level === 2 || a.code_risk === 2)).length} threats detected
        </span>
        <Link href="/proof" style={{ color: "#06b6d4", fontFamily: "var(--font-dm-mono, monospace)", fontSize: "0.6875rem", textDecoration: "none" }}>
          Integration Proof →
        </Link>
      </div>

      {/* Chain-discovered contracts — client-rendered, non-blocking */}
      <ChainDiscovery attestedAddresses={attestedAddresses} />
    </div>
  );
}
