import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataRow } from "@/components/ui/DataRow";
import { canonicalProofHref } from "@/lib/prooflock-routes";
import { explorerTransactionUrl } from "@/lib/explorer-url";
import { isNonZeroBytes32, isPositiveUint64 } from "@/lib/prooflock-validation";
import type { ObservationStatus } from "@/lib/prooflock-types";

// Append-only version history of a single ProofLock agent, rendered as a vertical timeline.
// It is built ONLY from data the detail page already holds: the current (head) version, its
// real DRIFTED lease state when present, and the append-preserved `previousProofId` link.
// It never fabricates versions the read path cannot prove: deeper ancestry is referenced by
// previousProofId and reached one hop at a time.

type GateState = Readonly<{ status: ObservationStatus; label: string }>;

export type TimelineHead = Readonly<{
  version: string;
  storageRoot: string;
  sourceTxHash?: string;
  gate: GateState;
  drifted: boolean;
  verified: boolean;
}>;

export function AttestationTimeline({ head, previousProofId, identityKey,
  explorerBase = "https://chainscan.0g.ai" }: Readonly<{
  head: TimelineHead; previousProofId?: string; identityKey: string; explorerBase?: string;
}>) {
  const versionLabel = isPositiveUint64(head.version) ? `v${head.version}` : "Version unavailable";
  const event = headEvent(head.version, head.drifted);
  const txUrl = head.sourceTxHash ? explorerTransactionUrl(explorerBase, head.sourceTxHash) : null;
  const predecessor = predecessorLink(previousProofId, identityKey);
  return <section className="evidence-card lifecycle-card attestation-timeline bp-bracket"
    aria-labelledby="attestation-timeline-heading">
    <span className="bp-corners" aria-hidden="true" />
    <span className="card-kicker">Append-only attestation history</span>
    <h3 id="attestation-timeline-heading">Attestation timeline</h3>
    <span className="timeline-dim" aria-hidden="true">Append-only axis · head {versionLabel}</span>
    <ol className="timeline-rail" aria-label="Agent version history, newest first">
      {head.drifted && <li className="timeline-node timeline-node--drift">
        <div className="timeline-node__head"><b>DRIFTED</b>
          <StatusBadge status="BLOCKED" surface="paper" /></div>
        <p>Current identity or runtime diverged from the sealed evidence. Admission is blocked until a reseal appends a new version.</p>
      </li>}
      <li className="timeline-node timeline-node--current">
        <div className="timeline-node__head">
          <span className="timeline-node__version"><bdi dir="ltr">{versionLabel}</bdi></span>
          <b>{event}</b>
          <StatusBadge status={head.gate.status} surface="paper" />
        </div>
        <dl className="proof-list">
          <DataRow label="Gate state" value={head.gate.label} technical={false} />
          <DataRow label="Storage root" value={head.storageRoot} copyable />
          <DataRow label="Source transaction" value={head.sourceTxHash ?? "Historical source unavailable"}
            copyable={Boolean(head.sourceTxHash)} external={Boolean(txUrl)} href={txUrl ?? undefined} />
        </dl>
        {!head.verified && <p className="timeline-node__note">Registry snapshot only: the exact historical artifact was not matched, so the source transaction is not yet linked.</p>}
      </li>
      {predecessor.status === "VALID" && <li className="timeline-node timeline-node--superseded">
        <div className="timeline-node__head"><b>SUPERSEDED</b>
          <StatusBadge status="UNAVAILABLE" surface="paper" /></div>
        <Link className="text-link mono break" href={predecessor.href}>
          <bdi dir="ltr">{predecessor.proofId}</bdi></Link>
        <p className="timeline-node__note">Prior sealed version, preserved on-chain. Verifying it may require its source transaction.</p>
      </li>}
      {predecessor.status === "INVALID" && <li className="timeline-node timeline-node--superseded">
        <div className="timeline-node__head"><b>SUPERSEDED</b>
          <StatusBadge status="UNAVAILABLE" surface="paper" /></div>
        <p className="timeline-node__note">A predecessor is referenced, but its locator is not a resolvable proof ID.</p>
      </li>}
      {predecessor.status === "ABSENT" && head.version === "1" && <li className="timeline-node timeline-node--genesis">
        <div className="timeline-node__head"><b>GENESIS</b></div>
        <p className="timeline-node__note">This is the first sealed version. There is no earlier attestation.</p>
      </li>}
    </ol>
    <p className="trust-note">Resealing appends a new version. It never rewrites or erases a historical artifact. Earlier versions beyond the immediate predecessor are reached one link at a time.</p>
  </section>;
}

function headEvent(version: string, drifted: boolean): string {
  if (drifted) return "RESEAL PENDING";
  if (!isPositiveUint64(version)) return "SEALED";
  return version === "1" ? "SEALED" : "RESEALED";
}

type PredecessorLink =
  | Readonly<{ status: "ABSENT" | "INVALID" }>
  | Readonly<{ status: "VALID"; proofId: string; href: string }>;

function predecessorLink(previousProofId: string | undefined, identityKey: string): PredecessorLink {
  if (previousProofId === undefined) return { status: "ABSENT" };
  if (!isNonZeroBytes32(previousProofId) || !isNonZeroBytes32(identityKey)) return { status: "INVALID" };
  return { status: "VALID", proofId: previousProofId,
    href: canonicalProofHref(previousProofId, identityKey) };
}
