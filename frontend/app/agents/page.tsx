"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentsTable } from "@/components/AgentsTable";
import { RiskLeaderboard } from "@/components/RiskLeaderboard";
import { LeaderboardSkeleton } from "@/components/Skeletons";
import { Button } from "@/components/ui/Button";
import { StateMessage } from "@/components/ui/StateMessage";
import { discoverProofLocks } from "@/lib/prooflock-client";
import { compareProofLockUrgency } from "@/lib/prooflock-status";
import type { ProofLockDiscoveryResponse } from "@/lib/prooflock-types";

type LoadedDiscovery = ProofLockDiscoveryResponse & Readonly<{ referenceTimeSeconds: number }>;

export default function ProofLocksPage() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [discovery, setDiscovery] = useState<LoadedDiscovery | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).then((next) => {
    setDiscovery(next); setState("ready");
  }).catch(() => { if (!controller.signal.aborted) setState("error"); }); return () => controller.abort(); }, [retry]);
  const items = discovery?.identities ?? [];
  const partial = items.some((item) => item.status === "ENRICHMENT_UNAVAILABLE");
  const retryRead = () => { setState("loading"); setRetry((value) => value + 1); };
  const sealed = items.filter((item) => item.status === "VERIFIED");
  return <section className="workspace-section inventory-page"><div className="wrap"><div className="page-heading"><span className="eyebrow">Sealed agents, ranked by risk</span><h1>Risk-ranked ProofLocks</h1>
    <p>Sealed ProofLock V2 records ranked by combined behavioral and code risk, riskiest agent first. Ranking is a triage aid over recent finalized seals, not a complete registry index or a universal safety verdict.</p></div>
    {discovery && <div className="inventory-scope" aria-label="Discovery scope"><b>Observed finalized blocks {discovery.fromBlock}–{discovery.toBlock}</b>
      {" · "}<span>{discovery.confirmations} confirmations · {discovery.returned} returned · cap {discovery.cap} · observed {discovery.observedAt}</span>
      {" · "}<small>complete inventory unavailable; recent finalized activity only</small></div>}
    {state === "ready" && discovery && <p className="inventory-order">Deterministic order: combined risk (max of behavioral and code band, then behavioral score), then newest source block, then identity key.</p>}
    {state === "ready" && discovery && partial && <StateMessage className="inventory-partial" announce="off" state="unavailable" title="Partial results">
      Successful rows remain visible; failed Registry enrichment is disclosed in place.
    </StateMessage>}
    {state === "loading" && <LeaderboardSkeleton />}
    {state === "error" && <StateMessage state="error" title="Risk-ranked ProofLocks unavailable"
      action={<Button onClick={retryRead}>Retry read</Button>}>The public read path failed. No records are inferred from legacy V1.</StateMessage>}
    {state === "ready" && sealed.length === 0 && <StateMessage state="empty" title="No sealed agents yet"
      action={<Link className="button" href="/scan">Run a scan</Link>}>No sealed agents yet — run a scan. Older active leases may exist outside this bounded finalized view.</StateMessage>}
    {state === "ready" && sealed.length > 0 && <RiskLeaderboard items={sealed} />}

    {state === "ready" && items.length > 0 && discovery && <div className="inventory-section">
      <div className="section-heading"><span className="eyebrow">Finalized chain activity</span><h2>Recent ProofLocks</h2>
        <p>The same finalized seals in registry order, with full coverage, lease, and Gate detail per record.</p></div>
      <div className="inventory-legend"><span>Identity</span><span>Coverage</span><span>Seal</span><span>Lease</span><span>Gate</span></div>
      <AgentsTable items={items} referenceTimeSeconds={discovery.referenceTimeSeconds} />
    </div>}
    {state !== "loading" && <aside className="legacy-banner"><b>LEGACY V1 · excluded</b><span>Older AttestationRegistry and AgentRegistry deployments do not satisfy ProofLock V2 admission.</span></aside>}
  </div></section>;
}

async function load(signal: AbortSignal): Promise<LoadedDiscovery> {
  const discovered = await discoverProofLocks(signal);
  const referenceTimeSeconds = observationTimeSeconds(discovered.observedAt);
  return { ...discovered, referenceTimeSeconds, identities: [...discovered.identities]
    .sort((left, right) => compareProofLockUrgency(left, right, referenceTimeSeconds)) };
}

function observationTimeSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("Invalid discovery observation time");
  return Math.floor(milliseconds / 1000);
}
