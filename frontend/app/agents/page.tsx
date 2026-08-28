"use client";

import { useEffect, useState } from "react";
import { AgentsTable } from "@/components/AgentsTable";
import { discoverProofLocks, readProofLockDetail } from "@/lib/prooflock-client";
import { proofLockUrgency } from "@/lib/prooflock-status";
import type { ProofLockInventoryItem } from "@/lib/prooflock-types";

export default function ProofLocksPage() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<readonly ProofLockInventoryItem[]>([]);
  const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).then((next) => {
    setItems(next); setState("ready");
  }).catch(() => { if (!controller.signal.aborted) setState("error"); }); return () => controller.abort(); }, [retry]);
  return <section className="workspace-section inventory-page"><div className="wrap"><div className="page-heading"><span className="eyebrow">Current chain state</span><h1>ProofLocks</h1>
    <p>Lease inventory ordered by operational urgency—drifted and denied first. This is not a risk leaderboard.</p></div>
    <div className="inventory-legend"><span>Identity</span><span>Coverage</span><span>Seal</span><span>Lease</span><span>Gate</span></div>
    {state === "loading" && <div className="loading-ledger" aria-live="polite"><i /><i /><i /><span>Reading RegistryV2 and verified identity detail…</span></div>}
    {state === "error" && <div className="empty-ledger state-bad"><h2>ProofLock inventory unavailable</h2><p>The public read path failed. No records are inferred from legacy V1.</p><button className="button" onClick={() => { setState("loading"); setRetry((value) => value + 1); }}>Retry read</button></div>}
    {state === "ready" && items.length === 0 && <div className="empty-ledger"><h2>No V2 ProofLocks discovered</h2><p>The current 2,000-block RegistryV2 window contains no lease events. Legacy records are excluded.</p></div>}
    {state === "ready" && items.length > 0 && <AgentsTable items={items} />}
    <aside className="legacy-banner"><b>LEGACY V1 · excluded</b><span>Older AttestationRegistry and AgentRegistry deployments do not satisfy ProofLock V2 admission.</span></aside>
  </div></section>;
}

async function load(signal: AbortSignal): Promise<readonly ProofLockInventoryItem[]> {
  const discovered = await discoverProofLocks(signal);
  const details = await Promise.all(discovered.map(async (entry) => ({ ...(await readProofLockDetail(entry.identityKey, signal)), ...entry })));
  return details.sort((a, b) => proofLockUrgency(a.proofLock) - proofLockUrgency(b.proofLock));
}
