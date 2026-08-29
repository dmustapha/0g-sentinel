import Link from "next/link";
import { canonicalProofHref } from "@/lib/prooflock-routes";
import { isNonZeroBytes32, isPositiveUint64 } from "@/lib/prooflock-validation";

export function SealLifecycle({ currentVersion, previousProofId, identityKey }: { currentVersion: string; previousProofId?: string; identityKey: string }) {
  const version = isPositiveUint64(currentVersion) ? `v${currentVersion}` : "Version unavailable";
  const predecessor = predecessorHref(previousProofId, identityKey);
  return <section className="evidence-card lifecycle-card"><span className="card-kicker">Versioned, append-preserved proof history</span><h3>Seal lifecycle</h3>
    <div className="lifecycle-rail"><div className="life-node current"><span><bdi dir="ltr">{version}</bdi></span><b>CURRENT</b></div>
      {predecessor.status === "VALID" && <div className="life-node"><Link className="text-link mono break" href={predecessor.href}><bdi dir="ltr">{predecessor.proofId}</bdi></Link><b>SUPERSEDED</b><small>locator may require source transaction</small></div>}
      {predecessor.status === "INVALID" && <div className="life-node"><span>Predecessor unavailable</span><b>UNVERIFIED LOCATOR</b><small>No historical locator link is available for the stored value.</small></div>}</div>
    <p className="trust-note">Resealing appends a new version. It does not erase or rewrite the historical artifact.</p>
  </section>;
}

function predecessorHref(previousProofId: string | undefined, identityKey: string) {
  if (previousProofId === undefined) return { status: "ABSENT" as const };
  if (!isNonZeroBytes32(previousProofId) || !isNonZeroBytes32(identityKey)) {
    return { status: "INVALID" as const };
  }
  return { status: "VALID" as const, proofId: previousProofId,
    href: canonicalProofHref(previousProofId, identityKey) };
}
