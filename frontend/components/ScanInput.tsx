"use client";

import { AbiCoder, keccak256 } from "ethers";
import { useCallback, useRef, useState } from "react";
import { ProofLockApiError, readProofLockDetail, resolveIdentity, runProofLock } from "@/lib/prooflock-client";
import type { ApiErrorShape, CanonicalIdentity, GateDecision, ProofLockRecord, RunnerStage } from "@/lib/prooflock-types";
import { GateDecisionCard } from "./GateDecisionCard";
import { IdentityResolver, identityInputState } from "./IdentityResolver";
import { ProofCoverageGrid } from "./ProofCoverageGrid";
import { StreamingScanPanel } from "./StreamingScanPanel";

export function ScanInput(_legacyProps: { defaultAddress?: string } = {}) {
  const [agentId, setAgentId] = useState(""); const [operatorToken, setOperatorToken] = useState("");
  const [status, setStatus] = useState<"idle" | "resolving" | "resolved" | "error">("idle");
  const [identity, setIdentity] = useState<CanonicalIdentity | null>(null); const [lock, setLock] = useState<ProofLockRecord | null>(null);
  const [gate, setGate] = useState<GateDecision | null>(null); const [error, setError] = useState<ApiErrorShape>();
  const [stages, setStages] = useState<readonly RunnerStage[]>([]); const [failed, setFailed] = useState<{ stage: RunnerStage; code: string }>();
  const abortRef = useRef<AbortController>(); const valid = identityInputState(agentId, "idle") !== "INVALID" && agentId !== "";
  const demoId = process.env.NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID;

  const resolveCurrent = useCallback(async (id: string) => {
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setStatus("resolving"); setError(undefined); setIdentity(null); setLock(null); setGate(null); setStages([]); setFailed(undefined);
    try {
      const resolved = await resolveIdentity(id, controller.signal); const key = identityKey(resolved);
      const current = await readProofLockDetail(key, controller.signal).catch((cause) => {
          if (cause instanceof ProofLockApiError && cause.detail.code === "NOT_FOUND") return null; throw cause;
        });
      const decision = current?.detail.gate.status === "VERIFIED" ? current.detail.gate : null;
      setIdentity(resolved); setLock(current?.proofLock ?? null); setGate(decision as GateDecision | null); setStatus("resolved");
    } catch (cause) {
      setError(cause instanceof ProofLockApiError ? cause.detail : clientError("IDENTITY_UNAVAILABLE", "Canonical identity could not be resolved.")); setStatus("error");
    }
  }, []);

  async function evaluate() {
    if (!identity || !operatorToken) return;
    const controller = new AbortController(); abortRef.current = controller; setStages([]); setFailed(undefined); setError(undefined);
    try {
      await runProofLock({ identity: identity.identity, mode: "SEAL" }, operatorToken,
        (stage) => setStages((current) => current.includes(stage) ? current : [...current, stage]), controller.signal);
      setOperatorToken(""); await resolveCurrent(agentId);
    } catch (cause) {
      setOperatorToken(""); const detail = cause instanceof ProofLockApiError ? cause.detail : clientError("RUN_FAILED", "ProofLock run stopped safely.");
      setError(detail); setFailed({ stage: (detail.stage || stages.at(-1) || "VALIDATING_IDENTITY") as RunnerStage, code: detail.code });
    }
  }

  return <div className="evaluate-workbench">
    <div className="evaluate-form"><label htmlFor="agent-id">ERC-8004 Agent ID</label><div className="input-row">
      <input id="agent-id" inputMode="numeric" pattern="[0-9]*" value={agentId} onChange={(event) => {
        setAgentId(event.target.value.trim()); setStatus("idle"); setIdentity(null); setError(undefined);
      }} placeholder="e.g. 1842" autoComplete="off" />
      <button className="button primary" disabled={!valid || status === "resolving"} onClick={() => resolveCurrent(agentId)}>{status === "resolving" ? "Resolving…" : "Resolve identity"}</button></div>
      {demoId && <button className="demo-action" type="button" onClick={() => { setAgentId(demoId); void resolveCurrent(demoId); }}>Load labeled demo fixture · Agent #{demoId}</button>}
    </div>
    <IdentityResolver value={agentId} status={status} identity={identity} error={error} />
    {identity && <div className="operator-panel"><div><span className="card-kicker">Named operator-authorized validator</span><h3>{lock ? "Current ProofLock found" : "Issue first ProofLock"}</h3>
      <p>Mutation requires an operator token. It stays only in this form state and is cleared after the request.</p></div>
      {lock ? <p className="inline-state state-warn">Existing v{lock.version}. Reseal is available on the ProofLock detail page.</p> : <div className="operator-controls">
        <label htmlFor="operator-token">One-time operator token</label><input id="operator-token" type="password" value={operatorToken} onChange={(event) => setOperatorToken(event.target.value)} autoComplete="off" spellCheck={false} />
        <button className="button primary" onClick={evaluate} disabled={!operatorToken || stages.length > 0 && !failed}>Run verified evaluation</button></div>}
    </div>}
    {(stages.length > 0 || failed) && <StreamingScanPanel stages={stages} failed={failed} />}
    {lock && <ProofCoverageGrid coverage={lock.coverage} />}{identity && <GateDecisionCard decision={gate} />}
  </div>;
}

function identityKey(identity: CanonicalIdentity): string { return keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"], [16661, identity.identity.registryAddress, BigInt(identity.identity.agentId)])); }
function clientError(code: string, message: string): ApiErrorShape { return { code, message, stage: "VALIDATING_IDENTITY", retryable: true, requestId: "client" }; }
