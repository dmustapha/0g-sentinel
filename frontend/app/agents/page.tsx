"use client";

import { useEffect, useState } from "react";
import { AgentsTable } from "@/components/AgentsTable";
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
  return <section className="workspace-section inventory-page"><div className="wrap"><div className="page-heading"><span className="eyebrow">Finalized chain activity</span><h1>Recent ProofLocks</h1>
    <p>Recent RegistryV2 activity ordered by operational urgency. This is not a risk leaderboard or a complete registry index.</p></div>
    {discovery && <div className="inventory-scope" aria-label="Discovery scope"><b>Observed finalized blocks {discovery.fromBlock}–{discovery.toBlock}</b>
      {" · "}<span>{discovery.confirmations} confirmations · {discovery.returned} returned · cap {discovery.cap} · observed {discovery.observedAt}</span>
      {" · "}<small>complete inventory unavailable; recent finalized activity only</small></div>}
    {state === "ready" && discovery && <p className="inventory-order">Deterministic order: operational urgency at the observation time, then newest source block, then identity key.</p>}
    {state === "ready" && discovery && partial && <StateMessage className="inventory-partial" announce="off" state="unavailable" title="Partial results">
      Successful rows remain visible; failed Registry enrichment is disclosed in place.
    </StateMessage>}
    <div className="inventory-legend"><span>Identity</span><span>Coverage</span><span>Seal</span><span>Lease</span><span>Gate</span></div>
    {state === "loading" && <StateMessage state="loading" title="Reading recent ProofLocks">Reading RegistryV2 and verified identity detail…</StateMessage>}
    {state === "error" && <StateMessage state="error" title="ProofLock inventory unavailable"
      action={<Button onClick={retryRead}>Retry read</Button>}>The public read path failed. No records are inferred from legacy V1.</StateMessage>}
    {state === "ready" && items.length === 0 && <StateMessage state="empty" title="No recent finalized events"
      action={<Button onClick={retryRead}>Retry read</Button>}>The observed RegistryV2 range contains no lease events. Older active leases may exist outside this bounded view.</StateMessage>}
    {state === "ready" && items.length > 0 && discovery && <AgentsTable items={items}
      referenceTimeSeconds={discovery.referenceTimeSeconds} />}
    <aside className="legacy-banner"><b>LEGACY V1 · excluded</b><span>Older AttestationRegistry and AgentRegistry deployments do not satisfy ProofLock V2 admission.</span></aside>
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
