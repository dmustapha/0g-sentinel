import { gateReasonMeta } from "@/lib/prooflock-status";
import { safeDisplayText } from "@/lib/safe-display";
import type { GateDecision } from "@/lib/prooflock-types";

export function GateDecisionCard({ decision }: { decision: GateDecision | null }) {
  if (!decision) return <section className="evidence-card state-unknown" aria-label="Gate decision">
    <span className="card-kicker">AgentGateV2</span><h3>Decision unavailable</h3>
    <p>The Gate must be read directly before policy-scoped admission can be claimed.</p>
  </section>;
  const reason = gateReasonMeta(decision.reason);
  return <section className={`evidence-card decision-card ${decision.allowed ? "state-good" : "state-bad"}`} aria-label="Gate decision">
    <div className="decision-head"><span className="card-kicker">AgentGateV2 · Reason {decision.reason}</span>
      <span className="state-mark" aria-hidden="true">{decision.allowed ? "✓" : "×"}</span></div>
    <h3>{decision.allowed ? "ALLOWED" : "BLOCKED"}</h3>
    <p className="reason-code">{reason.code}</p><p>{reason.label}. Stable reason code {decision.reason}.</p>
    <dl className="micro-grid"><div><dt>Subject</dt><dd className="mono break"><bdi dir="ltr">{decision.subject}</bdi></dd></div>
      <div><dt>Version</dt><dd className="mono">v<bdi dir="ltr">{safeDisplayText(decision.version, { maxGraphemes: 80 })}</bdi></dd></div></dl>
  </section>;
}
