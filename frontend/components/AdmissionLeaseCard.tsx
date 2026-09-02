import { useId } from "react";
import { leaseStatus } from "@/lib/prooflock-status";
import { isPositiveUint48, isPositiveUint64 } from "@/lib/prooflock-validation";
import type { ProofLockRecord } from "@/lib/prooflock-types";
import type { ObservationStatus } from "@/lib/prooflock-types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { safeDisplayText } from "@/lib/safe-display";

export function AdmissionLeaseCard({ basis = "current", reason, record, status: currentStatus, nowSeconds }: {
  basis?: "current" | "registry"; record?: ProofLockRecord | null; nowSeconds?: number;
  reason?: string; status?: ObservationStatus;
}) {
  const titleId = useId();
  if (!record) {
    const status = currentStatus ?? "UNAVAILABLE";
    return <section className="evidence-card lease-card bp-bracket" aria-labelledby={titleId}>
    <span className="bp-corners" aria-hidden="true" />
    <div className="card-row"><h3 id={titleId}>Current lease {status}</h3>
      <StatusBadge status={status} surface="paper" /></div>
    <p>{reason ? <>Pinned reason: <bdi>{safeDisplayText(reason, { maxGraphemes: 80 })}</bdi>.</>
      : "No lease value was returned by the pinned current observation."}</p></section>;
  }
  const validNumerics = isPositiveUint64(record.version)
    && isPositiveUint48(record.issuedAt) && isPositiveUint48(record.validUntil);
  const leaseState = validNumerics ? leaseStatus(record, nowSeconds) : "INCOMPLETE";
  const badge = leaseState === "ACTIVE" || leaseState === "EXPIRING" ? "VERIFIED"
    : leaseState === "INCOMPLETE" ? "UNAVAILABLE" : "BLOCKED";
  const authoritativeStatus = basis === "current" ? currentStatus : undefined;
  return <section className="evidence-card lease-card bp-bracket" aria-labelledby={titleId}>
    <span className="bp-corners" aria-hidden="true" />
    <div className="card-row"><div><span className="card-kicker">{basis === "current" ? "Pinned current admission lease" : "Registry record fallback · not current admission"}</span><h3 id={titleId}>{isPositiveUint64(record.version) ? <>Version v<bdi dir="ltr">{record.version}</bdi></> : "Version unavailable"}</h3></div>
      <span><StatusBadge status={authoritativeStatus ?? badge} surface="paper" /><span className="sr-only">{authoritativeStatus ? `Pinned observation ${authoritativeStatus}; lease record ${leaseState}` : leaseState}</span><b aria-hidden="true"> {authoritativeStatus ?? leaseState}</b></span></div>
    <dl className="micro-grid"><div><dt>Issued</dt><dd>{formatTime(record.issuedAt)}</dd></div><div><dt>Expires</dt><dd>{formatTime(record.validUntil)}</dd></div>
      <div><dt>Policy</dt><dd>Policy v{record.policyVersion}</dd></div><div><dt>Coverage</dt><dd className="mono">0x{record.coverage.toString(16).padStart(2, "0")}</dd></div></dl>
    {authoritativeStatus && reason && <p>Pinned reason: <bdi>{safeDisplayText(reason, { maxGraphemes: 80 })}</bdi>.</p>}
    <p className="trust-note">{basis === "current" ? `Lease status comes from the pinned current observation block; record lifecycle is ${leaseState}.` : "This fallback is the loaded Registry record; current admission remains unavailable."} Historical proof validity is displayed separately.</p>
  </section>;
}
function formatTime(value: string): string {
  if (!isPositiveUint48(value)) return "Invalid timestamp";
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? "Invalid timestamp" : date.toISOString();
}
