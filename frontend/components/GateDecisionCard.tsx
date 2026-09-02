import { gateReasonMeta } from "@/lib/prooflock-status";
import { safeDisplayText } from "@/lib/safe-display";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataRow } from "@/components/ui/DataRow";
import type { CurrentDecisionView } from "@/lib/proof-detail-state";
import type { GateDecision } from "@/lib/prooflock-types";

export function GateDecisionCard({ current, decision }: Readonly<{
  current?: CurrentDecisionView; decision?: GateDecision | null;
}>) {
  if (current) return <section className="evidence-card decision-card bp-bracket" aria-label="Current decision">
    <span className="bp-corners" aria-hidden="true" />
    <div className="decision-head"><span className="card-kicker">Pinned current access</span>
      <StatusBadge status={current.status} surface="paper" /></div>
    <h3>{current.status === "VERIFIED" ? "ALLOWED" : current.status}</h3>
    <p className="reason-code"><bdi>{safeDisplayText(current.reason, { maxGraphemes: 80 })}</bdi></p>
    <dl className="micro-grid"><DataRow label="Observation block" value={current.observationBlockNumber} copyable />
      <DataRow label="Observed at" value={current.observedAt} copyable />
      <DataRow label="Server issued" value={current.serverIssuedAt} copyable />
      <DataRow label="TTL" value={`${current.ttlMs} ms`} copyable />
      <DataRow label="Fresh until" value={current.freshnessExpiresAt} copyable /></dl>
  </section>;
  if (!decision) return <section className="evidence-card bp-bracket" aria-label="Gate decision">
    <span className="bp-corners" aria-hidden="true" />
    <span className="card-kicker">AgentGateV2</span><h3>Decision unavailable</h3>
    <StatusBadge status="UNAVAILABLE" surface="paper" />
    <p>The Gate must be read directly before policy-scoped admission can be claimed.</p>
  </section>;
  const reason = gateReasonMeta(decision.reason);
  return <section className="evidence-card decision-card bp-bracket" aria-label="Gate decision">
    <span className="bp-corners" aria-hidden="true" />
    <div className="decision-head"><span className="card-kicker">AgentGateV2 · Reason {decision.reason}</span>
      <StatusBadge status={decision.allowed ? "VERIFIED" : "BLOCKED"} surface="paper" /></div>
    <h3>{decision.allowed ? "ALLOWED" : "BLOCKED"}</h3>
    <p className="reason-code">{reason.code}</p><p>{reason.label}. Stable reason code {decision.reason}.</p>
    <dl className="micro-grid"><DataRow label="Subject" value={decision.subject} copyable />
      <DataRow label="Version" value={decision.version}
        displayValue={`v${safeDisplayText(decision.version, { maxGraphemes: 80 })}`} copyable /></dl>
  </section>;
}
