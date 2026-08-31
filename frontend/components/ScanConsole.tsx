"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { canonicalProofHref } from "@/lib/prooflock-routes";
import { isCanonicalAgentId } from "@/lib/prooflock-validation";
import type { RunnerStage } from "@/lib/prooflock-types";
import {
  friendlyScanError, reconcileScan, runPublicScan, ScanStreamError, type ScanSealed,
} from "@/lib/scan-client";
import { GateDecisionCard } from "./GateDecisionCard";
import { StreamingScanPanel } from "./StreamingScanPanel";
import { Button } from "./ui/Button";
import { DataRow } from "./ui/DataRow";
import { Field } from "./ui/Field";
import { StateMessage } from "./ui/StateMessage";

type ScanPhase = "idle" | "streaming" | "reconciling" | "sealed" | "error";

type ScanState = Readonly<{
  agentId: string;
  phase: ScanPhase;
  stages: readonly RunnerStage[];
  failed?: Readonly<{ stage: RunnerStage; code: string }>;
  sealed: ScanSealed | null;
  error: Readonly<{ title: string; body: string }> | null;
}>;

type ScanAction =
  | { type: "EDIT"; agentId: string }
  | { type: "START" }
  | { type: "STAGE"; stage: RunnerStage }
  | { type: "RECONCILING" }
  | { type: "SEALED"; sealed: ScanSealed }
  | { type: "FAILED"; stage: RunnerStage; code: string; error: Readonly<{ title: string; body: string }> }
  | { type: "ERROR"; error: Readonly<{ title: string; body: string }> };

const DEMO_AGENT_ID = process.env.NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID ?? "3527152";
const EXPLORER_BASE = process.env.NEXT_PUBLIC_ZERO_G_EXPLORER ?? "https://chainscan.0g.ai";

const initialState: ScanState = {
  agentId: DEMO_AGENT_ID, phase: "idle", stages: [], sealed: null, error: null,
};

function reducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "EDIT":
      return state.phase === "streaming" || state.phase === "reconciling" ? state
        : { ...initialState, agentId: action.agentId, phase: "idle" };
    case "START":
      return { ...state, phase: "streaming", stages: [], failed: undefined, sealed: null, error: null };
    case "STAGE":
      return state.stages.includes(action.stage) ? state
        : { ...state, stages: [...state.stages, action.stage] };
    case "RECONCILING":
      return { ...state, phase: "reconciling" };
    case "SEALED":
      return { ...state, phase: "sealed", sealed: action.sealed, failed: undefined, error: null };
    case "FAILED":
      return { ...state, phase: "error", failed: { stage: action.stage, code: action.code }, error: action.error };
    case "ERROR":
      return { ...state, phase: "error", error: action.error };
    default:
      return state;
  }
}

export function ScanConsole() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const runRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const valid = isCanonicalAgentId(state.agentId);
  const busy = state.phase === "streaming" || state.phase === "reconciling";

  useEffect(() => () => runRef.current?.abort(), []);
  useEffect(() => {
    if (state.phase === "sealed" || state.phase === "error") resultRef.current?.focus();
  }, [state.phase]);

  const scan = useCallback(async (agentId: string) => {
    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;
    dispatch({ type: "START" });
    let reachedChainWrite = false;
    try {
      const outcome = await runPublicScan(agentId, {
        signal: controller.signal,
        onStage: (stage) => dispatch({ type: "STAGE", stage }),
      });
      reachedChainWrite = outcome.reachedChainWrite;
      if (outcome.kind === "SEALED") {
        await reconcileInto(agentId, controller.signal, dispatch, true);
        return;
      }
      // Stream ended without a terminal frame. Reconcile if the chain write was reached.
      if (outcome.reachedChainWrite) {
        await reconcileInto(agentId, controller.signal, dispatch, false);
      } else {
        dispatch({ type: "ERROR", error: friendlyScanError({
          code: "DEPENDENCY_UNAVAILABLE", message: "", stage: "AUTHENTICATING", retryable: true, requestId: "client" }) });
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      const failedChainWrite = reachedChainWrite
        || (cause instanceof ScanStreamError && cause.reachedChainWrite);
      if (failedChainWrite) {
        await reconcileInto(agentId, controller.signal, dispatch, false);
        return;
      }
      if (cause instanceof ScanStreamError) {
        dispatch({ type: "FAILED", stage: streamStage(cause.detail.stage), code: cause.detail.code,
          error: friendlyScanError(cause.detail) });
      } else {
        dispatch({ type: "ERROR", error: friendlyScanError({
          code: "DEPENDENCY_UNAVAILABLE", message: "", stage: "AUTHENTICATING", retryable: true, requestId: "client" }) });
      }
    }
  }, []);

  return (
    <div className="evaluate-workbench scan-console">
      <form className="evaluate-form" onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) void scan(state.agentId.trim());
      }}>
        <div className="input-row">
          <Field id="scan-agent-id" label="ERC-8004 Agent ID" inputMode="numeric" pattern="[0-9]*"
            value={state.agentId} disabled={busy} autoComplete="off" spellCheck={false}
            invalid={state.agentId !== "" && !valid} aria-describedby="scan-status"
            onChange={(event) => dispatch({ type: "EDIT", agentId: event.target.value.trim() })}
            placeholder={`e.g. ${DEMO_AGENT_ID}`} />
          <Button variant="primary" type="submit" disabled={!valid || busy} pending={busy}
            pendingLabel={state.phase === "reconciling" ? "Confirming on chain…" : "Sealing…"}>
            Scan agent
          </Button>
        </div>
        <p className="scan-disclosure">
          Live demo: runs a real on-chain seal from a capped allowance; keys rotated post-event.
        </p>
      </form>

      <div id="scan-status" aria-live="polite" className="scan-status-region">
        {state.phase === "idle" && state.agentId !== "" && !valid ? (
          <div className="inline-state state-bad">Invalid Agent ID · use an unsigned decimal token ID.</div>
        ) : null}
        {state.phase === "reconciling" ? (
          <StateMessage state="loading" title="Reading the lease back from chain">
            The connection closed early. Confirming the seal directly on 0G before reporting success.
          </StateMessage>
        ) : null}
      </div>

      {state.stages.length > 0 || state.failed ? (
        <StreamingScanPanel stages={state.stages} failed={state.failed} />
      ) : null}

      <div ref={resultRef} tabIndex={-1} className="scan-outcome">
        {state.phase === "error" && state.error ? (
          <StateMessage state="error" title={state.error.title}>{state.error.body}</StateMessage>
        ) : null}
        {state.phase === "sealed" && state.sealed ? (
          <SealedCard sealed={state.sealed} />
        ) : null}
      </div>
    </div>
  );
}

async function reconcileInto(agentId: string, signal: AbortSignal,
  dispatch: React.Dispatch<ScanAction>, streamSealed: boolean): Promise<void> {
  if (!streamSealed) dispatch({ type: "RECONCILING" });
  try {
    const sealed = await reconcileScan(agentId, signal);
    if (signal.aborted) return;
    if (sealed) dispatch({ type: "SEALED", sealed });
    else dispatch({ type: "ERROR", error: {
      title: streamSealed ? "Seal reported, read-back pending." : "Could not confirm the seal.",
      body: "The lease is not yet visible on chain. Wait a moment and scan again to confirm.",
    } });
  } catch {
    if (signal.aborted) return;
    dispatch({ type: "ERROR", error: {
      title: "Seal submitted; read-back unavailable.",
      body: "The write may already be final. Do not retry immediately; scan again shortly to confirm.",
    } });
  }
}

function SealedCard({ sealed }: Readonly<{ sealed: ScanSealed }>) {
  const proofHref = sealed.proofId
    ? canonicalProofHref(sealed.proofId, sealed.identityKey) : null;
  return (
    <section className="evidence-card decision-card scan-sealed ui-proof-plane--current"
      aria-labelledby="scan-sealed-title">
      <div className="card-row">
        <div>
          <span className="card-kicker">Policy-scoped admission sealed
            {sealed.source === "RECONCILED" ? " · confirmed on chain" : ""}</span>
          <h3 id="scan-sealed-title">Agent #{sealed.agentId} sealed</h3>
        </div>
        <span className="verified-stamp">Gate {sealed.gate?.allowed ? "ALLOWED" : "read"}</span>
      </div>
      <dl className="proof-list">
        {sealed.version ? <DataRow label="Lease version" value={`v${sealed.version}`} technical={false} /> : null}
        {sealed.proofId ? <DataRow label="Proof ID" value={sealed.proofId} copyable /> : null}
        {sealed.storageRoot ? <DataRow label="0G Storage root" value={sealed.storageRoot} copyable /> : null}
        <DataRow label="Identity key" value={sealed.identityKey} copyable />
      </dl>
      <div className="scan-links">
        <a className="text-link" href={EXPLORER_BASE} target="_blank"
          rel="noopener noreferrer" referrerPolicy="no-referrer">0G Explorer ↗</a>
        {proofHref ? <Link className="text-link" href={proofHref}>Open the full proof →</Link> : null}
      </div>
      {sealed.gate ? <GateDecisionCard decision={sealed.gate} /> : null}
    </section>
  );
}

function streamStage(stage: string): RunnerStage {
  const known: readonly RunnerStage[] = ["VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT",
    "RUNNING_DETERMINISTIC_CHECKS", "RUNNING_COMPUTE", "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE",
    "VERIFYING_STORAGE", "WRITING_CHAIN", "READING_CHAIN_BACK", "SEALED"];
  return known.includes(stage as RunnerStage) ? stage as RunnerStage : "VALIDATING_IDENTITY";
}
