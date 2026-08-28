import type { ProofLockRecord } from "@/lib/prooflock-types";

export function EvidenceProofCard({ record, compute, storage }: Readonly<{
  record: ProofLockRecord;
  compute?: Readonly<{ provider: string; model: string; verified: boolean }>;
  storage?: Readonly<{ uploadTxHash?: string; retrievedAt?: string; retrievalVerified: boolean; networkProofVerified: false }>;
}>) {
  return <section className="evidence-card evidence-stack"><div className="card-row"><div><span className="card-kicker">Exact provenance</span><h3>Evidence commitments</h3></div>
    <span className={compute?.verified ? "verified-stamp" : "status-chip"}>{compute?.verified ? "VERIFIED" : "UNAVAILABLE"}</span></div>
    <div className="evidence-segment"><b>Verified 0G Compute</b>{compute ? <dl className="proof-list"><div><dt>Provider</dt><dd className="mono break">{compute.provider}</dd></div>
      <div><dt>Model</dt><dd>{compute.model}</dd></div><div><dt>Verification</dt><dd>{compute.verified ? "processResponse + exact signer transcript" : "Not verified"}</dd></div></dl> : <p>Compute transcript is unavailable. No fallback receipt is accepted.</p>}</div>
    <div className="evidence-segment"><b>Verified 0G Storage</b><dl className="proof-list"><div><dt>Root</dt><dd className="mono break">{record.storageRoot}</dd></div>
      <div><dt>Upload transaction</dt><dd className="mono break">{storage?.uploadTxHash ?? "Unavailable"}</dd></div><div><dt>Retrieval</dt><dd>{storage?.retrievalVerified ? `Retrieved and root-matched at time ${storage.retrievedAt ?? "of verification"}` : "Not re-verified"}</dd></div>
      <div><dt>Capability</dt><dd className="mono">networkProofVerified: {String(storage?.networkProofVerified ?? false)}</dd></div></dl></div>
    <dl className="proof-list commitments"><div><dt>Envelope digest</dt><dd className="mono break">{record.envelopeDigest}</dd></div><div><dt>Runtime commitment</dt><dd className="mono break">{record.runtimeCodeHash}</dd></div></dl>
    <p className="trust-note"><code>networkProofVerified: false</code> means the current SDK path verifies exact retrieved bytes, digest, recomputed 0G root, and finalized Flow submission—not an SDK-supplied network Merkle proof.</p>
  </section>;
}

