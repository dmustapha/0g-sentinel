import { leaseStatus } from "@/lib/prooflock-status";
import type { ProofLockRecord } from "@/lib/prooflock-types";

export function AdmissionLeaseCard({ record, nowSeconds }: { record: ProofLockRecord; nowSeconds?: number }) {
  const status = leaseStatus(record, nowSeconds);
  const tone = status === "ACTIVE" ? "state-good" : status === "EXPIRING" || status === "INCOMPLETE" ? "state-warn" : "state-bad";
  return <section className={`evidence-card lease-card ${tone}`} aria-labelledby="lease-title">
    <div className="card-row"><div><span className="card-kicker">Seven-day admission lease</span><h3 id="lease-title">Version v{record.version}</h3></div>
      <span className="status-chip">{status}</span></div>
    <dl className="micro-grid"><div><dt>Issued</dt><dd>{formatTime(record.issuedAt)}</dd></div><div><dt>Expires</dt><dd>{formatTime(record.validUntil)}</dd></div>
      <div><dt>Policy</dt><dd>Policy v{record.policyVersion}</dd></div><div><dt>Coverage</dt><dd className="mono">0x{record.coverage.toString(16).padStart(2, "0")}</dd></div></dl>
    <p className="trust-note">Lease state is current chain state. Historical proof validity is displayed separately.</p>
  </section>;
}
function formatTime(value: string): string { const seconds = Number(value); return Number.isSafeInteger(seconds) ? new Date(seconds * 1000).toISOString() : "Invalid timestamp"; }

