"use client";

import { AbiCoder, keccak256 } from "ethers";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import {
  createResolutionCoordinator, evaluateReducer, executePaidRun, identityLocked, initialEvaluateState,
} from "@/lib/evaluate-state";
import type { EvaluateAction, EvaluateState, ResolutionResult } from "@/lib/evaluate-state";
import { ProofLockApiError, readProofLockDetail, resolveIdentity, runProofLock } from "@/lib/prooflock-client";
import type { ApiErrorShape, CanonicalIdentity, GateDecision } from "@/lib/prooflock-types";
import { GateDecisionCard } from "./GateDecisionCard";
import { IdentityResolver, identityInputState } from "./IdentityResolver";
import { ProofCoverageGrid } from "./ProofCoverageGrid";
import { StreamingScanPanel } from "./StreamingScanPanel";

export function ScanInput(_legacyProps: { defaultAddress?: string } = {}) {
  const workflow = useEvaluateWorkflow(); const { state } = workflow;
  return <div className="evaluate-workbench">
    <ResolveForm agentId={state.agentId} phase={state.phase} valid={workflow.valid}
      invalid={workflow.invalid} demoId={workflow.demoId} locked={identityLocked(state)} onEdit={workflow.editIdentity}
      onResolve={workflow.resolveCurrent} onCancel={workflow.cancelResolution} />
    <div id="agent-id-status"><IdentityResolver value={state.agentId} status={workflow.resolutionStatus}
      identity={state.identity} error={state.error ?? undefined} /></div>
    {state.identity && (state.phase === "completed"
      ? <CompletionStatus refresh={state.refresh} refreshError={state.refreshError} />
      : <OperatorPanel state={state} dispatch={workflow.dispatch} evaluate={workflow.evaluate} />)}
    {(state.stages.length > 0 || state.failed) && <StreamingScanPanel stages={state.stages} failed={state.failed ?? undefined} />}
    {state.lock && <ProofCoverageGrid coverage={state.lock.coverage} />}
    {state.identity && <GateDecisionCard decision={state.gate} />}
  </div>;
}

function useEvaluateWorkflow() {
  const [state, dispatch] = useReducer(evaluateReducer, initialEvaluateState);
  const coordinator = useCoordinator(dispatch);
  const runActiveRef = useRef(false);
  const valid = validAgentId(state.agentId);
  const invalid = identityInputState(state.agentId, "idle") === "INVALID" || state.phase === "resolve_error";
  const resolutionStatus: "idle" | "resolving" | "resolved" | "error" =
    state.phase === "resolving" ? "resolving" : state.phase === "resolve_error" ? "error"
    : state.identity ? "resolved" : "idle";
  const evaluate = useEvaluationRun(state, dispatch, coordinator, runActiveRef);
  return { state, dispatch, valid, invalid, resolutionStatus, demoId: process.env.NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID,
    editIdentity: coordinator.edit, cancelResolution: coordinator.cancel,
    resolveCurrent: (agentId: string) => coordinator.resolve(agentId, validAgentId(agentId)), evaluate };
}

function useCoordinator(dispatch: Dispatch<EvaluateAction>) {
  const coordinatorRef = useRef<ReturnType<typeof createResolutionCoordinator>>();
  if (!coordinatorRef.current) coordinatorRef.current = createResolutionCoordinator(loadResolution, dispatch,
    (cause) => apiError(cause, "IDENTITY_UNAVAILABLE", "Canonical identity could not be resolved."));
  useEffect(() => {
    const coordinator = coordinatorRef.current;
    coordinator?.activate();
    return () => coordinator?.dispose();
  }, []);
  return coordinatorRef.current;
}

function useEvaluationRun(state: EvaluateState, dispatch: Dispatch<EvaluateAction>,
  coordinator: ReturnType<typeof createResolutionCoordinator>, activeRef: MutableRefObject<boolean>) {
  return useCallback(() => executePaidRun(state, activeRef, runProofLock, dispatch, coordinator.refresh,
    (cause) => apiError(cause, "RUN_FAILED", "ProofLock run stopped safely.")), [coordinator, state]);
}

type ResolveFormProps = Readonly<{ agentId: string; phase: EvaluateState["phase"]; valid: boolean; invalid: boolean;
  demoId?: string; locked: boolean; onEdit: (agentId: string) => unknown;
  onResolve: (agentId: string) => unknown; onCancel: () => void }>;

export function ResolveForm({ agentId, phase, valid, invalid, demoId, locked, onEdit, onResolve, onCancel }: ResolveFormProps) {
  return <form className="evaluate-form" onSubmit={(event) => {
    event.preventDefault(); if (valid && !locked && phase !== "resolving") onResolve(agentId);
  }}><label htmlFor="agent-id">ERC-8004 Agent ID</label><div className="input-row">
    <input id="agent-id" inputMode="numeric" pattern="[0-9]*" value={agentId} disabled={locked}
      aria-invalid={invalid || undefined} aria-describedby="agent-id-status"
      onChange={(event) => onEdit(event.target.value.trim())} placeholder="e.g. 1842" autoComplete="off" />
    {phase === "resolving"
      ? <button className="button primary" type="button" onClick={onCancel}>Cancel resolution</button>
      : <button className="button primary" type="submit" disabled={!valid || locked}>Resolve identity</button>}
    </div>
    {demoId && <button className="demo-action" type="button" disabled={locked} onClick={() => {
      onEdit(demoId); onResolve(demoId);
    }}>Load labeled demo fixture · Agent #{demoId}</button>}
  </form>;
}

type CompletionStatusProps = Readonly<{ refresh: "awaiting" | "refreshing" | "complete" | "failed";
  refreshError: ApiErrorShape | null }>;

export function CompletionStatus({ refresh, refreshError }: CompletionStatusProps) {
  if (refresh === "failed") return <section className="inline-state state-warn" role="alert">
    <b>ProofLock write succeeded.</b> Current read-back is unavailable ({refreshError?.code ?? "READ_FAILED"}).
    Do not retry: the write may already be final.
  </section>;
  return <section className="inline-state state-good" role="status">
    <b>ProofLock write succeeded.</b> {refresh === "complete"
      ? "Current read-back refreshed." : "Confirming current read-back…"}
  </section>;
}

function OperatorPanel({ state, dispatch, evaluate }: Readonly<{ state: EvaluateState;
  dispatch: Dispatch<EvaluateAction>; evaluate: () => Promise<unknown> }>) {
  const busy = state.phase === "running" || state.phase === "completed" && state.refresh === "refreshing";
  return <div className="operator-panel"><div><span className="card-kicker">Named operator-authorized validator</span><h3>{state.lock ? "Current ProofLock found" : "Issue first ProofLock"}</h3>
    <p>Mutation requires an operator token. It stays only in this form state and is cleared after the request.</p></div>
    {state.lock ? <p className="inline-state state-warn">Existing v{state.lock.version}. Reseal is available on the ProofLock detail page.</p> : <div className="operator-controls">
      <label htmlFor="operator-token">One-time operator token</label><input id="operator-token" type="password"
        value={state.operatorToken} disabled={busy} onChange={(event) => dispatch({ type: "EDIT_OPERATOR_TOKEN", token: event.target.value })}
        autoComplete="off" spellCheck={false} />
      <button className="button primary" type="button" onClick={() => void evaluate()}
        disabled={!state.operatorToken || busy}>Run verified evaluation</button></div>}
  </div>;
}

async function loadResolution(agentId: string, signal: AbortSignal): Promise<ResolutionResult> {
  const identity = await resolveIdentity(agentId, signal); const current = await readCurrentLock(identity, signal);
  return { identity, lock: current?.proofLock ?? null, gate: verifiedGate(current) };
}

async function readCurrentLock(identity: CanonicalIdentity, signal: AbortSignal) {
  try { return await readProofLockDetail(identityKey(identity), signal); }
  catch (cause) { if (cause instanceof ProofLockApiError && cause.detail.code === "NOT_FOUND") return null; throw cause; }
}

function verifiedGate(current: Awaited<ReturnType<typeof readCurrentLock>>): GateDecision | null {
  return current?.detail.gate.status === "VERIFIED" ? current.detail.gate : null;
}

function identityKey(identity: CanonicalIdentity): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"],
    [16661, identity.identity.registryAddress, BigInt(identity.identity.agentId)]));
}

function apiError(cause: unknown, code: string, message: string): ApiErrorShape {
  return cause instanceof ProofLockApiError ? cause.detail
    : { code, message, stage: "VALIDATING_IDENTITY", retryable: true, requestId: "client" };
}

function validAgentId(agentId: string): boolean {
  return agentId !== "" && identityInputState(agentId, "idle") !== "INVALID";
}
