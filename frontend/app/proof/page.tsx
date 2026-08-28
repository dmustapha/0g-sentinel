"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SubsystemHealthGrid } from "@/components/SubsystemHealthGrid";
import { readHealth } from "@/lib/prooflock-client";
import type { HealthSnapshot } from "@/lib/prooflock-types";

export default function ProofPage() {
  const router = useRouter(); const [proofId, setProofId] = useState(""); const [identityKey, setIdentityKey] = useState("");
  const [health, setHealth] = useState<HealthSnapshot>(); const [healthError, setHealthError] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); setHealthError(false); void readHealth(controller.signal).then(setHealth)
    .catch(() => { if (!controller.signal.aborted) setHealthError(true); }); return () => controller.abort(); }, [retry]);
  const valid = /^0x[0-9a-fA-F]{64}$/.test(proofId) && /^0x[0-9a-fA-F]{64}$/.test(identityKey);
  return <section className="workspace-section proof-page"><div className="wrap"><div className="page-heading"><span className="eyebrow">Public offline verifier</span><h1>Verify a ProofLock</h1>
    <p>Retrieve canonical evidence, recompute commitments, and compare the historical artifact without starting paid Compute.</p></div>
    <div className="verify-sheet"><label htmlFor="proof-id">Proof ID</label><input id="proof-id" className="mono" value={proofId} onChange={(event) => setProofId(event.target.value.trim())} placeholder="0x…32-byte proof ID" />
      <label htmlFor="identity-key">Identity key</label><input id="identity-key" className="mono" value={identityKey} onChange={(event) => setIdentityKey(event.target.value.trim())} placeholder="0x…32-byte identity key" />
      <button className="button primary" disabled={!valid} onClick={() => router.push(`/proof/${proofId}?identityKey=${identityKey}`)}>Open verifier</button>
      {(proofId || identityKey) && !valid && <p className="inline-state state-warn">Both values must be exact nonzero bytes32 identifiers.</p>}</div>
    <div className="section-heading health-heading"><span className="eyebrow">Independent live probes</span><h2>Subsystem health</h2><p>Each cell is probed independently. Chain health never implies Storage or Compute health.</p></div>
    {!health && !healthError && <div className="loading-ledger"><i /><i /><i /><span>Probing six dependencies…</span></div>}
    {healthError && <div className="empty-ledger state-bad"><h2>Health response unavailable</h2><button className="button" onClick={() => setRetry((value) => value + 1)}>Retry probes</button></div>}
    {health && <SubsystemHealthGrid snapshot={health} />}
    <aside className="trust-disclosure"><h2>Verification scope</h2><p>“Retrieved and root-matched” describes this observation time. The current SDK path reports <code>networkProofVerified: false</code>; it does not claim an independently verified network Merkle proof.</p></aside>
  </div></section>;
}
