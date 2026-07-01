"use client";
// File: components/AgentsTable.tsx
// The prototype risk board (`.board`): riskiest agents first, color-coded by verdict,
// every row a real attestation. Client component with an address filter, pagination,
// and per-row rescan. Receives server-fetched, risk-ranked agents as props — no
// client-side RPC. Pass `hideControls` (+ pre-sliced agents) for the compact home board.
import { useState, useEffect } from "react";
import Link from "next/link";
import { AgentWithAttestation, CODE_RISK_LABELS } from "@/lib/types";
import { RescanButton } from "@/components/RescanButton";

const PAGE_SIZE = 20;

function relativeTime(ts: number): string {
  if (!ts) return "–";
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function scoreColor(agent: AgentWithAttestation): string {
  if (!agent.has_attestation) return "var(--tx-dim)";
  if (agent.behavioral_score >= 60) return "var(--bad)";
  if (agent.behavioral_score >= 30) return "var(--warn)";
  return "var(--good)";
}

function badgeClass(agent: AgentWithAttestation): string {
  if (!agent.has_attestation) return "badge b-none";
  if (agent.threat_level === 2 || agent.code_risk === 2) return "badge b-flag";
  if (agent.threat_level === 1 || agent.code_risk === 1) return "badge b-caut";
  return "badge b-safe";
}

function badgeLabel(agent: AgentWithAttestation): string {
  if (!agent.has_attestation) return "NOT SCANNED";
  if (agent.threat_level === 2 || agent.code_risk === 2) return "FLAGGED";
  if (agent.threat_level === 1 || agent.code_risk === 1) return "CAUTION";
  return "SAFE";
}

export function AgentsTable({
  agents,
  hideControls = false,
}: {
  agents: AgentWithAttestation[];
  hideControls?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [mounted, setMounted] = useState(false);

  // Fill the score bars from 0 → score once, after mount (CSS transition on .score-fill).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const filtered = hideControls
    ? agents
    : agents.filter((a) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return a.address.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
      });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const visible = hideControls ? filtered : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (agents.length === 0) {
    return (
      <div className="board">
        <div className="board-empty">No agents attested yet. Auto-scan is indexing the chain.</div>
      </div>
    );
  }

  return (
    <>
      {!hideControls && (
        <div className="board-filter">
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Filter by address or name…"
            aria-label="Filter agents by address or name"
          />
          {query && <span className="count">{filtered.length} of {agents.length}</span>}
        </div>
      )}

      <div className="board scale-in">
        <table>
          <colgroup>
            <col className="col-agent" />
            <col className="col-score" />
            <col className="col-status" />
            <col className="col-attest" />
            <col className="col-act" />
          </colgroup>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Behavioral Score</th>
              <th>Status</th>
              <th>Last Attested</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((agent) => (
              <tr key={agent.address}>
                <td>
                  <div className="agent-cell">
                    <span className="nm">
                      <Link href={`/agents/${agent.address}`}>{agent.name || "Unnamed Agent"}</Link>
                    </span>
                    <span className="ad">{agent.address.slice(0, 6)}…{agent.address.slice(-4)}</span>
                    {agent.has_attestation && agent.code_risk > 0 && (
                      <span className="code-note">
                        code {CODE_RISK_LABELS[agent.code_risk]}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="score-wrap">
                    <span className="score-num" style={{ color: scoreColor(agent) }}>
                      {agent.has_attestation ? agent.behavioral_score : "–"}
                    </span>
                    <div className="score-track">
                      <div
                        className="score-fill"
                        style={{
                          width: mounted && agent.has_attestation ? `${agent.behavioral_score}%` : "0%",
                          background: scoreColor(agent),
                        }}
                      />
                    </div>
                  </div>
                </td>
                <td>
                  <span className={badgeClass(agent)} title={agent.reasoning || undefined}>
                    {badgeLabel(agent)}
                  </span>
                  {agent.reasoning && (
                    <div className="reason-preview" title={agent.reasoning}>
                      {agent.reasoning.slice(0, 55)}{agent.reasoning.length > 55 ? "…" : ""}
                    </div>
                  )}
                </td>
                <td className="attest-cell">
                  {agent.has_attestation ? relativeTime(agent.attestation_timestamp) : "–"}
                </td>
                <td className="col-act">
                  <RescanButton address={agent.address} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!hideControls && totalPages > 1 && (
        <div className="board-page">
          <button className="rescan" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </button>
          <span className="pg">{page} / {totalPages}</span>
          <button className="rescan" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
          <span className="pg" style={{ marginLeft: 6, color: "var(--tx-dim)" }}>{filtered.length} agents</span>
        </div>
      )}
    </>
  );
}
