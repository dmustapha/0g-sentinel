import type { ProofLockRecord } from "@/lib/prooflock-types";
import { configuredDisplayText, safeDisplayText } from "@/lib/safe-display";

export function EvidenceProofCard({ record, compute, storage }: Readonly<{
  record: ProofLockRecord;
  compute?: Readonly<{ provider: string; model: string; verified: boolean }>;
  storage?: Readonly<{ uploadTxHash?: string; retrievedAt?: string; retrievalVerified: boolean; networkProofVerified: false }>;
}>) {
  const provider = compute && configuredDisplayText(compute.provider, "Provider not provided", { maxGraphemes: 96 });
  const model = compute && configuredDisplayText(compute.model, "Model not provided", { maxGraphemes: 120 });
  const uploadTx = storage?.uploadTxHash && safeDisplayText(storage.uploadTxHash, { maxGraphemes: 96 });
  const retrievedAt = storage?.retrievedAt && safeDisplayText(storage.retrievedAt, { maxGraphemes: 96 });
  return <section className="evidence-card evidence-stack"><div className="card-row"><div><span className="card-kicker">Exact provenance</span><h3>Evidence commitments</h3></div>
    <span className={compute?.verified ? "verified-stamp" : "status-chip"}>{compute?.verified ? "VERIFIED" : "UNAVAILABLE"}</span></div>
    <div className="evidence-segment"><b>Verified 0G Compute</b>{compute ? <dl className="proof-list"><div><dt>Provider</dt><dd className="mono break"><bdi>{provider}</bdi></dd></div>
      <div><dt>Model</dt><dd><bdi>{model}</bdi></dd></div><div><dt>Verification</dt><dd>{compute.verified ? "processResponse + exact signer transcript" : "Not verified"}</dd></div></dl> : <p>Compute transcript is unavailable. No fallback receipt is accepted.</p>}</div>
    <div className="evidence-segment"><b>Verified 0G Storage</b><dl className="proof-list"><div><dt>Root</dt><dd className="mono break"><bdi dir="ltr">{record.storageRoot}</bdi></dd></div>
      <div><dt>Upload transaction</dt><dd className="mono break"><bdi dir="ltr">{uploadTx ?? "Unavailable"}</bdi></dd></div><div><dt>Retrieval</dt><dd>{storage?.retrievalVerified ? <>Retrieved and root-matched at time <bdi dir="ltr">{retrievedAt ?? "of verification"}</bdi></> : "Not re-verified"}</dd></div>
      <div><dt>Capability</dt><dd className="mono">networkProofVerified: {String(storage?.networkProofVerified ?? false)}</dd></div></dl></div>
    <dl className="proof-list commitments"><div><dt>Envelope digest</dt><dd className="mono break"><bdi dir="ltr">{record.envelopeDigest}</bdi></dd></div><div><dt>Runtime commitment</dt><dd className="mono break"><bdi dir="ltr">{record.runtimeCodeHash}</bdi></dd></div></dl>
    <p className="trust-note"><code>networkProofVerified: false</code> means the current SDK path verifies exact retrieved bytes, digest, recomputed 0G root, and finalized Flow submission—not an SDK-supplied network Merkle proof.</p>
  </section>;
}
