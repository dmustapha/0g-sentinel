import { gateReasonMeta } from "@/lib/prooflock-status";
import { safeDisplayText } from "@/lib/safe-display";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { CurrentDecisionView } from "@/lib/proof-detail-state";
import type { GateDecision } from "@/lib/prooflock-types";

export function GateDecisionCard({ current, decision }: Readonly<{
  current?: CurrentDecisionView; decision?: GateDecision | null;
}>) {
  if (current) return <section className="evidence-card decision-card" aria-label="Current decision">
    <div className="decision-head"><span className="card-kicker">Pinned current access</span>
      <StatusBadge status={current.status} surface="paper" /></div>
    <h3>{current.status === "VERIFIED" ? "ALLOWED" : current.status}</h3>
    <p className="reason-code">{safeDisplayText(current.reason, { maxGraphemes: 80 })}</p>
    <dl className="micro-grid"><div><dt>Observation block</dt><dd className="mono"><bdi>{current.observationBlockNumber}</bdi></dd></div>
      <div><dt>Observed at</dt><dd><bdi>{current.observedAt}</bdi></dd></div>
      <div><dt>Server issued</dt><dd><bdi>{current.serverIssuedAt}</bdi></dd></div>
      <div><dt>TTL</dt><dd><bdi>{current.ttlMs} ms</bdi></dd></div>
      <div><dt>Fresh until</dt><dd><bdi>{current.freshnessExpiresAt}</bdi></dd></div></dl>
  </section>;
  if (!decision) return <section className="evidence-card" aria-label="Gate decision">
    <span className="card-kicker">AgentGateV2</span><h3>Decision unavailable</h3>
    <StatusBadge status="UNAVAILABLE" surface="paper" />
    <p>The Gate must be read directly before policy-scoped admission can be claimed.</p>
  </section>;
  const reason = gateReasonMeta(decision.reason);
  return <section className="evidence-card decision-card" aria-label="Gate decision">
    <div className="decision-head"><span className="card-kicker">AgentGateV2 · Reason {decision.reason}</span>
      <StatusBadge status={decision.allowed ? "VERIFIED" : "BLOCKED"} surface="paper" /></div>
    <h3>{decision.allowed ? "ALLOWED" : "BLOCKED"}</h3>
    <p className="reason-code">{reason.code}</p><p>{reason.label}. Stable reason code {decision.reason}.</p>
    <dl className="micro-grid"><div><dt>Subject</dt><dd className="mono break"><bdi dir="ltr">{decision.subject}</bdi></dd></div>
      <div><dt>Version</dt><dd className="mono">v<bdi dir="ltr">{safeDisplayText(decision.version, { maxGraphemes: 80 })}</bdi></dd></div></dl>
  </section>;
}
