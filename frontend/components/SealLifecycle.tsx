import Link from "next/link";

export function SealLifecycle({ currentVersion, previousProofId, identityKey }: { currentVersion: string; previousProofId?: string; identityKey: string }) {
  return <section className="evidence-card lifecycle-card"><span className="card-kicker">Versioned, append-preserved proof history</span><h3>Seal lifecycle</h3>
    <div className="lifecycle-rail"><div className="life-node current"><span>v{currentVersion}</span><b>CURRENT</b></div>
      {previousProofId && <div className="life-node"><Link className="text-link mono break" href={`/proof/${previousProofId}?identityKey=${identityKey}`}>{previousProofId}</Link><b>SUPERSEDED</b></div>}</div>
    <p className="trust-note">Resealing appends a new version. It does not erase or rewrite the historical artifact.</p>
  </section>;
}
