"use client";

import { useEffect, useState } from "react";
import { AgentsTable } from "@/components/AgentsTable";
import { discoverProofLocks } from "@/lib/prooflock-client";
import { compareProofLockUrgency } from "@/lib/prooflock-status";
import type { ProofLockDiscoveryResponse } from "@/lib/prooflock-types";

export default function ProofLocksPage() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [discovery, setDiscovery] = useState<ProofLockDiscoveryResponse | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).then((next) => {
    setDiscovery(next); setState("ready");
  }).catch(() => { if (!controller.signal.aborted) setState("error"); }); return () => controller.abort(); }, [retry]);
  const items = discovery?.identities ?? [];
  return <section className="workspace-section inventory-page"><div className="wrap"><div className="page-heading"><span className="eyebrow">Finalized chain activity</span><h1>Recent ProofLocks</h1>
    <p>Recent RegistryV2 activity ordered by operational urgency. This is not a risk leaderboard or a complete registry index.</p></div>
    {discovery && <div className="inventory-scope" aria-label="Discovery scope"><b>Observed finalized blocks {discovery.fromBlock}–{discovery.toBlock}</b>
      <span>{discovery.confirmations} confirmations · {discovery.returned} returned · cap {discovery.cap} · observed {discovery.observedAt}</span>
      <small>complete inventory unavailable; recent finalized activity only</small></div>}
    <div className="inventory-legend"><span>Identity</span><span>Coverage</span><span>Seal</span><span>Lease</span><span>Gate</span></div>
    {state === "loading" && <div className="loading-ledger" aria-live="polite"><i /><i /><i /><span>Reading RegistryV2 and verified identity detail…</span></div>}
    {state === "error" && <div className="empty-ledger state-bad"><h2>ProofLock inventory unavailable</h2><p>The public read path failed. No records are inferred from legacy V1.</p><button className="button" onClick={() => { setState("loading"); setRetry((value) => value + 1); }}>Retry read</button></div>}
    {state === "ready" && items.length === 0 && <div className="empty-ledger"><h2>No recent finalized events</h2><p>The observed RegistryV2 range contains no lease events. Older active leases may exist outside this bounded view.</p></div>}
    {state === "ready" && items.length > 0 && <AgentsTable items={items} />}
    <aside className="legacy-banner"><b>LEGACY V1 · excluded</b><span>Older AttestationRegistry and AgentRegistry deployments do not satisfy ProofLock V2 admission.</span></aside>
  </div></section>;
}

async function load(signal: AbortSignal): Promise<ProofLockDiscoveryResponse> {
  const discovered = await discoverProofLocks(signal);
  const nowSeconds = Math.floor(Date.now() / 1000);
  return { ...discovered, identities: [...discovered.identities]
    .sort((left, right) => compareProofLockUrgency(left, right, nowSeconds)) };
}
