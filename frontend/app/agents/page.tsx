"use client";
// File: frontend/app/agents/page.tsx
import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentWithAttestation } from "@/lib/types";

function relativeTime(ts: number): string {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function scoreColor(score: number): string {
  if (score >= 60) return "#ef4444"; // FLAGGED (60-100)
  if (score >= 30) return "#f59e0b"; // CAUTION (30-59)
  return "#10b981";                  // SAFE (0-29)
}

function badgeClass(agent: AgentWithAttestation): string {
  if (agent.threat_level === 2 || agent.code_risk === 2) return "sg-tbl-badge sg-tbl-badge-threat";
  if (agent.threat_level === 1 || agent.code_risk === 1) return "sg-tbl-badge sg-tbl-badge-caution";
  return "sg-tbl-badge sg-tbl-badge-safe";
}

function badgeLabel(agent: AgentWithAttestation): string {
  if (agent.threat_level === 2 || agent.code_risk === 2) return "THREAT";
  if (agent.threat_level === 1 || agent.code_risk === 1) return "CAUTION";
  return "SAFE";
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentWithAttestation[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);

  async function fetchAgents() {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setAgents(data.agents || []);
      setFetchError(false);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleRescan(address: string) {
    setScanning(address);
    setScanError(null);
    try {
      const res = await fetch("/api/scan/behavioral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentAddress: address }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setScanError(data.error || `Scan failed (HTTP ${res.status})`);
      } else {
        await fetchAgents();
      }
    } catch {
      setScanError("Scan request failed — check network connection");
    } finally {
      setScanning(null);
    }
  }

  useEffect(() => {
    fetchAgents();
  }, []);

  return (
    <div className="sg-dash-section">
      <div className="sg-dash-header">
        <div>
          <h1 className="sg-dash-title">Registered Agents</h1>
          <div className="sg-dash-subtitle">
            Behavioral audit · Code scan · On-chain attestation · 0G Aristotle
          </div>
        </div>
        <button
          className="sg-btn-refresh"
          onClick={fetchAgents}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {scanError && (
        <div style={{
          padding: "0.625rem 0",
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontSize: "0.6875rem",
          color: "#ef4444",
          marginBottom: "0.75rem",
        }}>
          {scanError}
        </div>
      )}

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
      ) : loading ? (
        <div style={{
          padding: "4rem 0",
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontSize: "0.75rem",
          color: "rgba(0,212,255,0.4)",
          textAlign: "center",
        }}>
          Loading from 0G Chain…
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
              <th className="sg-score-cell">TRUST SCORE</th>
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
                    <span
                      className="sg-tbl-score-val"
                      style={{ color: scoreColor(agent.behavioral_score) }}
                    >
                      {agent.behavioral_score}
                    </span>
                    <div className="sg-tbl-score-track">
                      <div
                        className="sg-tbl-score-fill"
                        style={{
                          width: `${agent.behavioral_score}%`,
                          background: scoreColor(agent.behavioral_score),
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
                  <button
                    className="sg-btn-refresh"
                    disabled={scanning !== null}
                    onClick={() => handleRescan(agent.address)}
                    style={{ fontSize: "0.625rem", padding: "0.25rem 0.625rem" }}
                    aria-label={`Rescan ${agent.address.slice(0, 6)}…${agent.address.slice(-4)}`}
                  >
                    {scanning === agent.address ? "Scanning…" : "Rescan"}
                  </button>
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
