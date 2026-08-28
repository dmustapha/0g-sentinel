"use client";

import { useState } from "react";
import { markOnDemandDrift, runProofLock } from "@/lib/prooflock-client";
import type { CanonicalIdentity, ProofLockRecord, RunnerStage } from "@/lib/prooflock-types";
import { StreamingScanPanel } from "./StreamingScanPanel";

export function RescanButton({ identity, record, previousProofId, onComplete }: Readonly<{
  identity: CanonicalIdentity; record: ProofLockRecord; previousProofId: `0x${string}`; onComplete(): void;
}>) {
  const [token, setToken] = useState(""); const [busy, setBusy] = useState<"drift" | "reseal" | null>(null);
  const [stages, setStages] = useState<readonly RunnerStage[]>([]); const [error, setError] = useState("");
  const [drift, setDrift] = useState<Readonly<{ expected?: string; current?: string; drifted?: boolean; marked?: boolean }>>();

  async function checkDrift() {
    if (!token) return; setBusy("drift"); setError("");
    try { const raw = await markOnDemandDrift(record.identityKey, token) as Record<string, unknown>;
      const result = raw.result as Record<string, unknown> | undefined;
      setDrift({ expected: string(result?.expectedDigest), current: string(result?.currentDigest), drifted: result?.drifted === true, marked: result?.marked === true });
      setToken(""); onComplete();
    } catch { setError("On-demand drift check failed safely. No lifecycle claim was changed by the UI."); setToken(""); }
    finally { setBusy(null); }
  }
  async function reseal() {
    if (!token) return;
    setBusy("reseal"); setError(""); setStages([]);
    try { await runProofLock({ identity: identity.identity, mode: "RESEAL", expectedPriorVersion: record.version, previousProofId }, token,
      (stage) => setStages((value) => value.includes(stage) ? value : [...value, stage])); setToken(""); onComplete();
    } catch { setError("Reseal stopped safely. The previous version remains append-preserved."); setToken(""); }
    finally { setBusy(null); }
  }
  return <section className="operator-panel lifecycle-controls"><div><span className="card-kicker">Operator controls</span><h3>On-demand drift · reseal</h3>
    <p>These authenticated actions use the real drift and synchronous ProofLock routes. The token is cleared after each request.</p></div>
    <label htmlFor="detail-token">One-time operator token</label><input id="detail-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" />
    <div className="action-row"><button className="button" disabled={!token || !!busy} onClick={checkDrift}>{busy === "drift" ? "Checking…" : "Run on-demand drift"}</button>
      <button className="button primary" disabled={!token || !!busy} onClick={reseal}>{busy === "reseal" ? "Resealing…" : "Reseal new version"}</button></div>
    {drift && <div className={drift.drifted ? "drift-diff state-bad" : "drift-diff state-good"}><b>{drift.drifted ? "DRIFT DETECTED" : "NO DRIFT"}</b>
      <span>Before <code>{drift.expected}</code></span><span>After <code>{drift.current}</code></span><span>{drift.marked ? "Lifecycle marked on-chain; consumer action is blocked." : "No drift mark written."}</span></div>}
    {error && <p className="inline-state state-bad">{error}</p>}{stages.length > 0 && <StreamingScanPanel stages={stages} />}
  </section>;
}
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
