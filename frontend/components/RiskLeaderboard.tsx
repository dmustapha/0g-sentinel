"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { canonicalAgentHref } from "@/lib/prooflock-routes";
import { gateReasonMeta } from "@/lib/prooflock-status";
import { behavioralLevel, codeRiskLevel, rankProofLocksByRisk } from "@/lib/ranking";
import { safeDisplayText } from "@/lib/safe-display";
import { isCanonicalAgentId } from "@/lib/prooflock-validation";
import { useCountUp } from "@/lib/use-count-up";
import { CODE_RISK_LABELS, THREAT_LABELS } from "@/lib/types";
import type { ObservationStatus, ProofLockInventoryItem } from "@/lib/prooflock-types";

const CAPTION =
  "Sealed ProofLock V2 records ranked by combined risk. Higher-risk agents surface first.";

type SortMode = "risk" | "version";
type RiskLevel = 0 | 1 | 2;

type Row = Readonly<{
  key: string;
  rank: number;
  agentId: string | null;
  agentHref: string | null;
  subject: string;
  behavioralScore: number | null;
  behavioralLevel: RiskLevel | null;
  codeRisk: number | null;
  codeLevel: RiskLevel | null;
  version: string | null;
  gateLabel: string;
  gateReason: string;
  gateStatus: ObservationStatus;
  available: boolean;
}>;

export function RiskLeaderboard({ items }: { items: readonly ProofLockInventoryItem[] }) {
  const [sort, setSort] = useState<SortMode>("risk");
  const rows = useMemo(() => buildRows(items, sort), [items, sort]);
  return (
    <div className="leaderboard">
      <div className="leaderboard-controls">
        <div className="leaderboard-sort" role="group" aria-label="Sort sealed agents">
          <span id="leaderboard-sort-label">Sort by</span>
          <SortButton mode="risk" active={sort} onSelect={setSort}>Risk</SortButton>
          <SortButton mode="version" active={sort} onSelect={setSort}>Version</SortButton>
        </div>
        <p className="leaderboard-count" aria-live="polite">
          {rows.length} sealed {rows.length === 1 ? "agent" : "agents"}
        </p>
      </div>
      <div className="leaderboard-shell bp-bracket">
        <span className="bp-corners" aria-hidden="true" />
        <table className="leaderboard-table">
          <caption>{CAPTION}</caption>
          <thead>
            <tr>
              {["Rank", "Agent", "Subject", "Behavioral risk", "Code risk", "Gate", "Version"].map(
                (label) => (
                  <th scope="col" key={label}>{label}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>{rows.map((row) => <LeaderboardRow key={row.key} row={row} />)}</tbody>
        </table>
        <ol className="leaderboard-cards" aria-label={CAPTION}>
          {rows.map((row) => <LeaderboardCard key={row.key} row={row} />)}
        </ol>
      </div>
    </div>
  );
}

function SortButton({ mode, active, onSelect, children }: {
  mode: SortMode; active: SortMode; onSelect: (mode: SortMode) => void; children: ReactNode;
}) {
  const selected = active === mode;
  return (
    <button type="button" className="leaderboard-sort-button" data-active={selected}
      aria-pressed={selected} onClick={() => onSelect(mode)}>
      {children}
    </button>
  );
}

function LeaderboardRow({ row }: { row: Row }) {
  return (
    <tr className="leaderboard-row">
      <td><span className="leaderboard-rank" aria-hidden="true">{row.rank}</span>
        <span className="sr-only">Rank {row.rank}</span></td>
      <td><AgentCell row={row} /></td>
      <td><Subject value={row.subject} /></td>
      <td><RiskCell label="Behavioral" score={row.behavioralScore} level={row.behavioralLevel}
        labels={THREAT_LABELS} unit /></td>
      <td><RiskCell label="Code" score={row.codeRisk} level={row.codeLevel}
        labels={CODE_RISK_LABELS} /></td>
      <td><GateCell row={row} /></td>
      <td><Version value={row.version} /></td>
    </tr>
  );
}

function LeaderboardCard({ row }: { row: Row }) {
  return (
    <li className="leaderboard-card">
      <div className="leaderboard-card-head">
        <span className="leaderboard-rank" aria-hidden="true">{row.rank}</span>
        <AgentCell row={row} />
        <StatusBadge status={row.gateStatus} />
      </div>
      <dl className="leaderboard-card-data">
        <Field label="Subject"><Subject value={row.subject} /></Field>
        <Field label="Behavioral risk">
          <RiskCell label="Behavioral" score={row.behavioralScore} level={row.behavioralLevel}
            labels={THREAT_LABELS} unit />
        </Field>
        <Field label="Code risk">
          <RiskCell label="Code" score={row.codeRisk} level={row.codeLevel} labels={CODE_RISK_LABELS} />
        </Field>
        <Field label="Gate"><GateReason row={row} /></Field>
        <Field label="Version"><Version value={row.version} /></Field>
      </dl>
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="leaderboard-field"><dt>{label}</dt><dd>{children}</dd></div>;
}

function AgentCell({ row }: { row: Row }) {
  if (!row.agentId) return <span className="leaderboard-agent leaderboard-unavailable">Unavailable</span>;
  const label = <><b>Agent #</b><span className="mono break">{row.agentId}</span></>;
  return row.agentHref
    ? <Link className="leaderboard-agent identity-link" href={row.agentHref}>{label}</Link>
    : <span className="leaderboard-agent">{label}</span>;
}

function Subject({ value }: { value: string }) {
  if (value === "Unavailable") return <span className="leaderboard-unavailable">Unavailable</span>;
  return <bdi dir="ltr" className="mono leaderboard-subject" title={value}>{truncateMiddle(value)}</bdi>;
}

function RiskCell({ label, score, level, labels, unit = false }: {
  label: string; score: number | null; level: RiskLevel | null;
  labels: readonly string[]; unit?: boolean;
}) {
  if (score === null || level === null)
    return <span className="leaderboard-unavailable">Unavailable</span>;
  const band = labels[level] ?? "UNKNOWN";
  return (
    <span className="leaderboard-risk" data-level={level}>
      <span className="leaderboard-risk-band">{band}</span>
      <span className="leaderboard-risk-score">
        <span className="sr-only">{label} score {score}{unit ? " out of 100" : ""}</span>
        <CountUpScore value={score} unit={unit} />
      </span>
    </span>
  );
}

// Visible count-up of the numeric risk score. The true value is announced in the sibling sr-only
// span, so screen readers never hear the interpolated numbers.
function CountUpScore({ value, unit }: Readonly<{ value: number; unit: boolean }>) {
  const shown = useCountUp(value);
  return <span aria-hidden="true">{shown}{unit ? " / 100" : ""}</span>;
}

function GateCell({ row }: { row: Row }) {
  return (
    <span className="leaderboard-gate">
      <StatusBadge status={row.gateStatus} />
      <small>{row.gateReason}</small>
    </span>
  );
}

function GateReason({ row }: { row: Row }) {
  return (
    <span className="leaderboard-gate">
      <StatusBadge status={row.gateStatus} /><small>{row.gateLabel} · {row.gateReason}</small>
    </span>
  );
}

function Version({ value }: { value: string | null }) {
  if (!value) return <span className="leaderboard-unavailable">Unavailable</span>;
  return <span className="mono">v{value}</span>;
}

function buildRows(items: readonly ProofLockInventoryItem[], sort: SortMode): readonly Row[] {
  const ranked = rankProofLocksByRisk(items);
  const rows = ranked.map((item, index) => toRow(item, index + 1));
  if (sort === "version") return [...rows].sort(byVersionDescending);
  return rows;
}

function byVersionDescending(left: Row, right: Row): number {
  const leftVersion = left.version === null ? -1n : safeBigint(left.version);
  const rightVersion = right.version === null ? -1n : safeBigint(right.version);
  if (leftVersion > rightVersion) return -1;
  if (leftVersion < rightVersion) return 1;
  return left.rank - right.rank;
}

function safeBigint(value: string): bigint {
  try { return BigInt(value); } catch { return -1n; }
}

function toRow(item: ProofLockInventoryItem, rank: number): Row {
  if (item.status !== "VERIFIED") {
    return {
      key: item.identityKey, rank, agentId: null, agentHref: null, subject: "Unavailable",
      behavioralScore: null, behavioralLevel: null, codeRisk: null, codeLevel: null, version: null,
      gateLabel: "Unknown", gateReason: item.code, gateStatus: "UNAVAILABLE", available: false,
    };
  }
  const record = item.proofLock;
  const detail = item.detail;
  const gate = detail.status === "VERIFIED" ? detail.gate : null;
  const gateMeta = gate && gate.status === "VERIFIED" ? gateReasonMeta(gate.reason) : null;
  const gateConsistent = gate?.status === "VERIFIED" && gateMeta?.allowed === gate.allowed;
  const gateStatus: ObservationStatus = !gateMeta
    ? "UNAVAILABLE"
    : !gateConsistent
      ? "MISMATCH"
      : gateMeta.allowed ? "VERIFIED" : "BLOCKED";
  const behavioral = clampScore(record.behavioralScore);
  const agentId = detail.status === "VERIFIED" && isCanonicalAgentId(detail.identity.agentId)
    ? safeDisplayText(detail.identity.agentId, { maxGraphemes: 80 })
    : null;
  return {
    key: item.identityKey,
    rank,
    agentId,
    agentHref: agentId ? canonicalAgentHref(agentId, item.transactionHash) : null,
    subject: record.subject,
    behavioralScore: behavioral,
    behavioralLevel: behavioralLevel(behavioral),
    codeRisk: record.codeRisk,
    codeLevel: codeRiskLevel(record.codeRisk),
    version: record.version,
    gateLabel: gateMeta ? gateMeta.label : "Unknown",
    gateReason: gateMeta
      ? gateConsistent ? gateMeta.code : `GATE_TUPLE_MISMATCH · ${gateMeta.code}`
      : "UNKNOWN",
    gateStatus,
    available: true,
  };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function truncateMiddle(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}
