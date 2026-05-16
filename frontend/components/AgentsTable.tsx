"use client";
// File: components/AgentsTable.tsx
// Client component: agents table with pagination, address filter, and reasoning tooltips.
// Receives server-fetched agents as props — no client-side RPC calls needed.
import { useState } from "react";
import Link from "next/link";
import { AgentWithAttestation } from "@/lib/types";
import { RescanButton } from "@/components/RescanButton";

const PAGE_SIZE = 20;

function relativeTime(ts: number): string {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function scoreColor(agent: AgentWithAttestation): string {
  if (!agent.has_attestation) return "rgba(255,255,255,0.15)";
  if (agent.behavioral_score >= 60) return "#f43f5e";
  if (agent.behavioral_score >= 30) return "#fbbf24";
  return "#10b981";
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

export function AgentsTable({ agents }: { agents: AgentWithAttestation[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = agents.filter((a) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return a.address.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (agents.length === 0) {
    return (
      <div style={{
        padding: "4rem 0",
        fontFamily: "var(--font-dm-mono, monospace)",
        fontSize: "0.75rem",
        color: "rgba(255,255,255,0.15)",
        textAlign: "center",
      }}>
        No agents attested yet. Auto-scan is indexing the chain.
      </div>
    );
  }

  return (
    <>
      {/* Filter */}
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="Filter by address or name…"
          aria-label="Filter agents by address or name"
          style={{
            fontFamily: "var(--font-dm-mono, monospace)",
            fontSize: "1rem",
            color: "rgba(255,255,255,0.6)",
            background: "rgba(6,182,212,0.03)",
            border: "1px solid rgba(6,182,212,0.12)",
            borderRadius: 8,
            padding: "0.375rem 0.75rem",
            outline: "none",
            width: "100%",
            maxWidth: 340,
          }}
        />
        {query && (
          <span style={{ fontFamily: "var(--font-dm-mono, monospace)", fontSize: "0.625rem", color: "rgba(255,255,255,0.25)" }}>
            {filtered.length} of {agents.length}
          </span>
        )}
      </div>

      <table className="sg-agent-table">
        <thead>
          <tr>
            <th>AGENT</th>
            <th className="sg-score-cell">
              <span title="Behavioral risk score (0-100). STATUS reflects combined behavioral + code risk.">
                BEHAVIORAL SCORE
              </span>
            </th>
            <th>STATUS</th>
            <th>LAST ATTESTED</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visible.map((agent, i) => (
            <tr
              key={agent.address}
              className="sg-agent-tr"
              style={{ animationDelay: `${i * 40}ms` }}
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
                    <span className="sg-tbl-score-val" style={{ color: scoreColor(agent) }}>
                      {agent.has_attestation ? agent.behavioral_score : "—"}
                    </span>
                    {agent.has_attestation && agent.code_risk > 0 && (
                      <span
                        style={{
                          fontFamily: "var(--font-dm-mono, monospace)",
                          fontSize: "0.5rem",
                          color: agent.code_risk === 2 ? "#f43f5e" : "#fbbf24",
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
                {/* title attribute shows AI reasoning as a native tooltip — no JS needed */}
                <span
                  className={badgeClass(agent)}
                  title={agent.reasoning || undefined}
                  style={{ cursor: agent.reasoning ? "help" : undefined }}
                >
                  {badgeLabel(agent)}
                </span>
                {agent.reasoning && (
                  <div style={{
                    fontFamily: "var(--font-dm-mono, monospace)",
                    fontSize: "0.5rem",
                    color: "rgba(255,255,255,0.25)",
                    marginTop: "0.25rem",
                    maxWidth: 160,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                    title={agent.reasoning}
                  >
                    {agent.reasoning.slice(0, 55)}{agent.reasoning.length > 55 ? "…" : ""}
                  </div>
                )}
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem" }}>
          <button
            className="sg-btn-refresh"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            style={{ fontSize: "0.625rem", padding: "0.25rem 0.625rem" }}
          >
            ← Prev
          </button>
          <span style={{ fontFamily: "var(--font-dm-mono, monospace)", fontSize: "0.625rem", color: "rgba(255,255,255,0.25)" }}>
            {page} / {totalPages}
          </span>
          <button
            className="sg-btn-refresh"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{ fontSize: "0.625rem", padding: "0.25rem 0.625rem" }}
          >
            Next →
          </button>
          <span style={{ fontFamily: "var(--font-dm-mono, monospace)", fontSize: "0.5625rem", color: "rgba(255,255,255,0.15)", marginLeft: "0.5rem" }}>
            {filtered.length} agents
          </span>
        </div>
      )}
    </>
  );
}
