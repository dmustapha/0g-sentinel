"use client";
// File: frontend/components/AgentRow.tsx
import Link from "next/link";
import { AgentWithAttestation } from "@/lib/types";

interface AgentRowProps {
  agent: AgentWithAttestation;
  scanning: boolean;
  onRescan?: (address: string) => void;
}

const THREAT_LABELS = ["SAFE", "CAUTION", "FLAGGED"];
const CODE_LABELS = ["CLEAN", "WARNING", "VULN"];

function getThreatClass(threatLevel: number, codeRisk: number): string {
  if (threatLevel === 2 || codeRisk === 2) return "danger";
  if (threatLevel === 1 || codeRisk === 1) return "caution";
  if (threatLevel === 0 && codeRisk === 0) return "safe";
  return "unknown";
}

function getBadgeClass(level: number): string {
  if (level === 2) return "sg-badge sg-badge-danger";
  if (level === 1) return "sg-badge sg-badge-caution";
  if (level === 0) return "sg-badge sg-badge-safe";
  return "sg-badge sg-badge-neutral";
}

export function AgentRow({ agent, scanning, onRescan }: AgentRowProps) {
  const threatClass = getThreatClass(agent.threat_level, agent.code_risk);
  const shortAddr = `${agent.address.slice(0, 6)}…${agent.address.slice(-4)}`;
  const lastScanned = agent.attestation_timestamp
    ? new Date(agent.attestation_timestamp * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "—";

  const scoreColor =
    agent.behavioral_score >= 60
      ? "#ef4444"
      : agent.behavioral_score >= 30
      ? "#f59e0b"
      : "#10b981";

  return (
    <div className={`sg-agent-row ${threatClass}${scanning ? " sg-scan-active" : ""}`}>
      {/* Name + address */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link
          href={`/agents/${agent.address}`}
          style={{
            display: "block",
            fontFamily: "Space Grotesk, sans-serif",
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "#c8d3e8",
            textDecoration: "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.3,
            marginBottom: 2,
          }}
        >
          {agent.name || "Unnamed Agent"}
        </Link>
        <div className="sg-mono" style={{ color: "#334155", lineHeight: 1 }}>
          {shortAddr}
        </div>

        {/* Score bar */}
        {agent.has_attestation && (
          <div className="sg-score-bar" style={{ marginTop: 6, width: "85%" }}>
            <div
              className="sg-score-bar-fill"
              style={{ width: `${agent.behavioral_score}%`, background: scoreColor }}
            />
          </div>
        )}
      </div>

      {/* Badges + actions */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 4 }}>
          <span className={getBadgeClass(agent.threat_level)}>
            {THREAT_LABELS[agent.threat_level] ?? "?"}
          </span>
          <span className={getBadgeClass(agent.code_risk)}>
            {CODE_LABELS[agent.code_risk] ?? "?"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span className="sg-mono" style={{ color: "#334155", fontSize: "0.625rem" }}>
            {lastScanned}
          </span>
          {onRescan && (
            <button
              onClick={() => onRescan(agent.address)}
              disabled={scanning}
              className="sg-btn-ghost"
              style={{ padding: "0.125rem 0.375rem", fontSize: "0.625rem" }}
            >
              {scanning ? "…" : "Rescan"}
            </button>
          )}
          {scanning && !onRescan && (
            <span className="sg-mono" style={{ color: "#334155", fontSize: "0.625rem" }}>Scanning…</span>
          )}
        </div>
      </div>
    </div>
  );
}
