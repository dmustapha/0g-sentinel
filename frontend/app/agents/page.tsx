// File: frontend/app/agents/page.tsx
// Server component with ISR — no loading spinner on initial render.
// Rescan interactivity is isolated to the client RescanButton component.
import Link from "next/link";
import { getAttestationRegistry, getAgentRegistry } from "@/lib/contracts";
import { AgentWithAttestation } from "@/lib/types";
import { RescanButton } from "@/components/RescanButton";
import { ScanInput } from "@/components/ScanInput";
import { agentDisplayName } from "@/lib/constants";

export const revalidate = 30;

function relativeTime(ts: number): string {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function scoreColor(agent: AgentWithAttestation): string {
  if (!agent.has_attestation) return "#334155";          // NOT SCANNED — neutral
  if (agent.behavioral_score >= 60) return "#ef4444";    // FLAGGED (60-100)
  if (agent.behavioral_score >= 30) return "#f59e0b";    // CAUTION (30-59)
  return "#10b981";                                      // SAFE (0-29)
}

function badgeClass(agent: AgentWithAttestation): string {
  if (!agent.has_attestation) return "sg-tbl-badge sg-tbl-badge-neutral";
  if (agent.threat_level === 2 || agent.code_risk === 2) return "sg-tbl-badge sg-tbl-badge-threat";
  if (agent.threat_level === 1 || agent.code_risk === 1) return "sg-tbl-badge sg-tbl-badge-caution";
  return "sg-tbl-badge sg-tbl-badge-safe";
}

function badgeLabel(agent: AgentWithAttestation): string {
  if (!agent.has_attestation) return "NOT SCANNED";
  if (agent.threat_level === 2 || agent.code_risk === 2) return "FLAGGED";
  if (agent.threat_level === 1 || agent.code_risk === 1) return "CAUTION";
  return "SAFE";
}

async function fetchAgents(): Promise<AgentWithAttestation[]> {
  const attestationRegistry = getAttestationRegistry();
  const agentRegistry = getAgentRegistry();
  const agentAddresses: string[] = await agentRegistry.getAllAgents();

  return Promise.all(
    agentAddresses.map(async (address) => {
      const has = await attestationRegistry.hasAttestation(address);
      const name = agentDisplayName(address);
      if (!has) {
        return {
          address, name,
          behavioral_score: 0, threat_level: 1 as const, code_risk: 1 as const,
          code_findings: "", behavioral_receipt_hash: "", code_receipt_hash: "",
          evidence_hash: "", attestation_timestamp: 0, has_attestation: false,
        };
      }
      const att = await attestationRegistry.getAttestation(address);
      return {
        address, name,
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
}

export default async function AgentsPage() {
  let agents: AgentWithAttestation[] = [];
  let fetchError = false;

  try {
    agents = await fetchAgents();
  } catch {
    fetchError = true;
  }

  return (
    <div className="sg-dash-section">
      <div className="sg-dash-header">
        <div>
          <h1 className="sg-dash-title">Registered Agents</h1>
          <div className="sg-dash-subtitle">
            Behavioral audit · Code scan · On-chain attestation · 0G Aristotle
          </div>
        </div>
        <div style={{ flex: "1 1 320px", maxWidth: 480 }}>
          <div className="sg-label" style={{ marginBottom: "0.5rem", fontSize: "0.5625rem" }}>
            Scan any agent address
          </div>
          <ScanInput />
        </div>
      </div>

      {fetchError ? (
        <div style={{
          padding: "4rem 0",
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontSize: "0.75rem",
          color: "#ef4444",
          textAlign: "center",
        }}>
          Failed to load agents — check RPC connection
        </div>
      ) : agents.length === 0 ? (
        <div style={{
          padding: "4rem 0",
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontSize: "0.75rem",
          color: "#334155",
          textAlign: "center",
        }}>
          No agents registered
        </div>
      ) : (
        <table className="sg-agent-table">
          <thead>
            <tr>
              <th>AGENT</th>
              <th className="sg-score-cell">
                <span title="Behavioral risk score (0-100). STATUS badge reflects combined behavioral + code risk.">
                  BEHAVIORAL SCORE
                </span>
              </th>
              <th>STATUS</th>
              <th>LAST ATTESTED</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, i) => (
              <tr
                key={agent.address}
                className="sg-agent-tr"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <td>
                  <div className="sg-tbl-agent-name">
                    <Link href={`/agents/${agent.address}`} style={{ color: "inherit", textDecoration: "none" }}>
                      {agent.name || "Unnamed Agent"}
                    </Link>
                  </div>
                  <div className="sg-tbl-agent-addr">
                    {agent.address.slice(0, 6)}…{agent.address.slice(-4)}
                  </div>
                </td>
                <td className="sg-score-cell">
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.125rem" }}>
                      <span
                        className="sg-tbl-score-val"
                        style={{ color: scoreColor(agent) }}
                      >
                        {agent.has_attestation ? agent.behavioral_score : "—"}
                      </span>
                      {agent.has_attestation && agent.code_risk > 0 && (
                        <span
                          style={{
                            fontFamily: "var(--font-jetbrains-mono, monospace)",
                            fontSize: "0.5rem",
                            color: agent.code_risk === 2 ? "#ef4444" : "#f59e0b",
                            letterSpacing: "0.04em",
                          }}
                          title="Code scan result"
                        >
                          {agent.code_risk === 2 ? "CODE VULN" : "CODE WARN"}
                        </span>
                      )}
                    </div>
                    <div className="sg-tbl-score-track">
                      <div
                        className="sg-tbl-score-fill"
                        style={{
                          width: agent.has_attestation ? `${agent.behavioral_score}%` : "0%",
                          background: scoreColor(agent),
                        }}
                      />
                    </div>
                  </div>
                </td>
                <td>
                  <span className={badgeClass(agent)}>{badgeLabel(agent)}</span>
                </td>
                <td>
                  <span className="sg-tbl-time">
                    {agent.has_attestation ? relativeTime(agent.attestation_timestamp) : "—"}
                  </span>
                </td>
                <td>
                  <RescanButton address={agent.address} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="sg-dash-footer">
        <span className="sg-dash-footer-text">
          {agents.length} agent{agents.length !== 1 ? "s" : ""} monitored ·{" "}
          {agents.filter((a) => a.threat_level === 0 && a.code_risk === 0).length} verified safe ·{" "}
          {agents.filter((a) => a.threat_level === 2 || a.code_risk === 2).length} threats detected
        </span>
        <Link href="/proof" style={{ color: "#00d4ff", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.6875rem", textDecoration: "none" }}>
          Integration Proof →
        </Link>
      </div>
    </div>
  );
}
