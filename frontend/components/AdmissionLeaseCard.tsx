import { leaseStatus } from "@/lib/prooflock-status";
import { isPositiveUint48, isPositiveUint64 } from "@/lib/prooflock-validation";
import type { ProofLockRecord } from "@/lib/prooflock-types";

export function AdmissionLeaseCard({ record, nowSeconds }: { record: ProofLockRecord; nowSeconds?: number }) {
  const validNumerics = isPositiveUint64(record.version)
    && isPositiveUint48(record.issuedAt) && isPositiveUint48(record.validUntil);
  const status = validNumerics ? leaseStatus(record, nowSeconds) : "INCOMPLETE";
  const tone = status === "ACTIVE" ? "state-good" : status === "EXPIRING" || status === "INCOMPLETE" ? "state-warn" : "state-bad";
  return <section className={`evidence-card lease-card ${tone}`} aria-labelledby="lease-title">
    <div className="card-row"><div><span className="card-kicker">Seven-day admission lease</span><h3 id="lease-title">{isPositiveUint64(record.version) ? <>Version v<bdi dir="ltr">{record.version}</bdi></> : "Version unavailable"}</h3></div>
      <span className="status-chip">{status}</span></div>
    <dl className="micro-grid"><div><dt>Issued</dt><dd>{formatTime(record.issuedAt)}</dd></div><div><dt>Expires</dt><dd>{formatTime(record.validUntil)}</dd></div>
      <div><dt>Policy</dt><dd>Policy v{record.policyVersion}</dd></div><div><dt>Coverage</dt><dd className="mono">0x{record.coverage.toString(16).padStart(2, "0")}</dd></div></dl>
    <p className="trust-note">Lease state is current chain state. Historical proof validity is displayed separately.</p>
  </section>;
}
function formatTime(value: string): string {
  if (!isPositiveUint48(value)) return "Invalid timestamp";
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? "Invalid timestamp" : date.toISOString();
}
