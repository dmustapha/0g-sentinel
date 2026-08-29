"use client";

import { AbiCoder, keccak256 } from "ethers";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Dispatch, MutableRefObject } from "react";
import {
  createResolutionCoordinator, evaluateReducer, executePaidRun, identityLocked, initialEvaluateState,
} from "@/lib/evaluate-state";
import type { EvaluateAction, EvaluateState, ResolutionResult } from "@/lib/evaluate-state";
import { ProofLockApiError, computeProofId, readProofLockDetail, recoverProofLock,
  resolveIdentity, runProofLock } from "@/lib/prooflock-client";
import type { ApiErrorShape, CanonicalIdentity, GateDecision, ProofLockRecord } from "@/lib/prooflock-types";
import { GateDecisionCard } from "./GateDecisionCard";
import { IdentityResolver, identityInputState } from "./IdentityResolver";
import { ProofCoverageGrid } from "./ProofCoverageGrid";
import { StreamingScanPanel } from "./StreamingScanPanel";
import { WriteRecoveryPanel, createOperatorRunSession, interruptedOutcome } from "./WriteRecoveryPanel";
import type { OperatorDisplayOutcome } from "./WriteRecoveryPanel";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { StateMessage } from "./ui/StateMessage";

type ExistingControls = Readonly<{ identity: CanonicalIdentity; record: ProofLockRecord;
  previousProofId: `0x${string}`; refresh(): void }>;

export function ScanInput({ initialAgentId = "", renderExisting }: Readonly<{
  initialAgentId?: string; renderExisting?: (controls: ExistingControls) => React.ReactNode;
}> = {}) {
  const workflow = useEvaluateWorkflow(initialAgentId); const { state } = workflow;
  const previousProofId = state.lock ? proofIdFor(state.lock) : null;
  return <div className="evaluate-workbench">
    <ResolveForm agentId={state.agentId} phase={state.phase} valid={workflow.valid}
      invalid={workflow.invalid} demoId={workflow.demoId} locked={identityLocked(state)} onEdit={workflow.editIdentity}
      onResolve={workflow.resolveCurrent} onCancel={workflow.cancelResolution} />
    <div id="agent-id-status"><IdentityResolver value={state.agentId} status={workflow.resolutionStatus}
      identity={state.identity} error={state.error ?? undefined} /></div>
    {state.identity && (state.phase === "completed"
      ? <CompletionStatus refresh={state.refresh} refreshError={state.refreshError} />
      : <OperatorPanel state={state} dispatch={workflow.dispatch} evaluate={workflow.evaluate}
          cancel={workflow.cancelRun} outcome={workflow.outcome}
          canceling={workflow.canceling} recovering={workflow.recovering} />)}
    {(state.phase === "running" || state.phase === "failed") && (state.stages.length > 0 || state.failed)
      && <StreamingScanPanel stages={state.stages} failed={state.failed ?? undefined} />}
    {workflow.outcome && <WriteRecoveryPanel outcome={workflow.outcome}
      error={workflow.recoveryError ?? undefined}
      mode="SEAL" recovering={workflow.recovering} recoverDisabled={!state.operatorToken}
      explorerBase={process.env.NEXT_PUBLIC_ZERO_G_EXPLORER ?? "https://chainscan.0g.ai"}
      onRecover={() => void workflow.recover()} />}
    {state.lock && <ProofCoverageGrid coverage={state.lock.coverage} />}
    {state.identity && <GateDecisionCard decision={state.gate} />}
    {state.identity && state.lock && previousProofId && renderExisting?.({ identity: state.identity,
      record: state.lock, previousProofId, refresh: () => { workflow.refreshCurrent(); } })}
  </div>;
}

function useEvaluateWorkflow(initialAgentId: string) {
  const [state, dispatch] = useReducer(evaluateReducer, { ...initialEvaluateState, agentId: initialAgentId });
  const coordinator = useCoordinator(dispatch);
  const runActiveRef = useRef(false);
  const valid = validAgentId(state.agentId);
  const invalid = identityInputState(state.agentId, "idle") === "INVALID" || state.phase === "resolve_error";
  const resolutionStatus: "idle" | "resolving" | "resolved" | "error" =
    state.phase === "resolving" ? "resolving" : state.phase === "resolve_error" ? "error"
    : state.identity ? "resolved" : "idle";
  const write = useOperatorWriteWorkflow(state, dispatch, coordinator, runActiveRef);
  return { state, dispatch, valid, invalid, resolutionStatus, demoId: process.env.NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID,
    cancelResolution: coordinator.cancel,
    refreshCurrent: () => { if (state.identity) coordinator.refresh(state.agentId); },
    resolveCurrent: (agentId: string) => coordinator.resolve(agentId, validAgentId(agentId)), ...write };
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

function useOperatorWriteWorkflow(state: EvaluateState, dispatch: Dispatch<EvaluateAction>,
  coordinator: ReturnType<typeof createResolutionCoordinator>, activeRef: MutableRefObject<boolean>) {
  const key = state.identity ? identityKey(state.identity) : null;
  const bindingRef = useIdentityBinding(key); const [write, setWrite] = useState<BoundWrite | null>(null);
  const [recoveringBinding, setRecoveringBinding] = useState<IdentityBinding | null>(null);
  const [canceling, setCanceling] = useState(false);
  const sessionRef = useRef<ReturnType<typeof createOperatorRunSession>>();
  if (!sessionRef.current) sessionRef.current = createOperatorRunSession(() => dispatch({ type: "CLEAR_OPERATOR_TOKEN" }));
  const session = sessionRef.current;
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  const publish = useCallback((binding: IdentityBinding, outcome: OperatorDisplayOutcome, error?: ApiErrorShape) => {
    if (sameBinding(bindingRef.current, binding)) setWrite({ binding, outcome, error });
  }, [bindingRef]);
  const evaluate = useCallback(async () => {
    const binding = bindingRef.current; const request = session.begin(); if (!binding.identityKey || !request) return false;
    setWrite(null); setCanceling(false);
    const runner = createSessionRunner(request.signal, session,
      (outcome, error) => publish(binding, outcome, error));
    try { return await executePaidRun(state, activeRef, runner, dispatch, coordinator.refresh,
      (cause) => apiError(cause, "RUN_FAILED", "ProofLock run stopped safely.")); }
    finally { session.settle(request); setCanceling(false); }
  }, [activeRef, bindingRef, coordinator, dispatch, publish, session, state]);
  const cancelRun = useCallback(() => {
    const decision = session.cancel(); if (!decision) return;
    setCanceling(true); dispatch({ type: "CLEAR_OPERATOR_TOKEN" });
    publish(bindingRef.current, interruptedOutcome(decision));
  }, [bindingRef, dispatch, publish, session]);
  const visible = write && sameBinding(write.binding, bindingRef.current) ? write : null;
  const recovering = Boolean(recoveringBinding && sameBinding(recoveringBinding, bindingRef.current));
  const recover = useRecovery(state, visible, bindingRef, publish, setRecoveringBinding, dispatch, coordinator);
  const editIdentity = useCallback((agentId: string) => { invalidateBinding(bindingRef);
    setWrite(null); setRecoveringBinding(null); return coordinator.edit(agentId); }, [bindingRef, coordinator]);
  return { evaluate, cancelRun, recover, editIdentity, outcome: visible?.outcome ?? null,
    recovering, canceling, recoveryError: visible?.error ?? null };
}

function createSessionRunner(signal: AbortSignal, session: ReturnType<typeof createOperatorRunSession>,
  publish: (outcome: OperatorDisplayOutcome, error?: ApiErrorShape) => void) {
  return async (...args: Parameters<typeof runProofLock> extends [infer A, infer B, infer C, ...unknown[]]
    ? [A, B, C] : never) => {
    try {
      session.markInvoked();
      const result = await runProofLock(...args, signal, undefined, (progress) => session.observe(progress));
      if (result.kind === "SEALED") publish(result.writeOutcome);
      else if (result.operation.writeOutcome) publish(result.operation.writeOutcome);
      else publish({ status: "RECOVERY_REQUIRED", certainty: "ACCEPTED", recoveryId: result.operation.recoveryId });
      return result;
    } catch (cause) {
      if (cause instanceof ProofLockApiError) {
        if (cause.writeOutcome) publish(cause.writeOutcome, cause.detail);
      } else if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        const decision = session.interrupted();
        if (decision.kind !== "CANCELED_BEFORE_ACCEPTANCE") publish(interruptedOutcome(decision));
      }
      throw cause;
    }
  };
}

function useRecovery(state: EvaluateState, write: BoundWrite | null,
  bindingRef: MutableRefObject<IdentityBinding>, publish: (binding: IdentityBinding,
    outcome: OperatorDisplayOutcome, error?: ApiErrorShape) => void,
  setRecovering: React.Dispatch<React.SetStateAction<IdentityBinding | null>>, dispatch: Dispatch<EvaluateAction>,
  coordinator: ReturnType<typeof createResolutionCoordinator>) {
  return useCallback(async () => {
    if (!write || !isRecoverable(write.outcome) || !state.operatorToken) return false;
    const binding = write.binding; const token = state.operatorToken; setRecovering(binding);
    dispatch({ type: "CLEAR_OPERATOR_TOKEN" });
    try { const recovered = await recoverProofLock(write.outcome.recoveryId, token, write.outcome.transactionHash);
      if (!sameBinding(bindingRef.current, binding)) return false;
      publish(binding, recovered); if (recovered.status === "SEALED") {
        dispatch({ type: "RECOVERY_SUCCEEDED" }); coordinator.refresh(state.agentId);
      } else if (recovered.status === "NOT_BROADCAST" || recovered.status === "REVERTED") {
        dispatch({ type: "RECOVERY_DEFINITIVE" });
      } else dispatch({ type: "RECOVERY_PROGRESS_UPDATED" });
      return true;
    } catch (cause) { if (sameBinding(bindingRef.current, binding)) publish(binding, write.outcome,
      apiError(cause, "RECOVERY_FAILED", "Recovery could not prove a terminal outcome.", "RECOVERING_WRITE"));
      return false;
    } finally { setRecovering((current) => sameBinding(current, binding) ? null : current); }
  }, [bindingRef, coordinator, dispatch, publish, setRecovering, state.agentId, state.operatorToken, write]);
}

type IdentityBinding = Readonly<{ generation: number; identityKey: string | null }>;
type BoundWrite = Readonly<{ binding: IdentityBinding; outcome: OperatorDisplayOutcome; error?: ApiErrorShape }>;

function useIdentityBinding(identityKeyValue: string | null): MutableRefObject<IdentityBinding> {
  const ref = useRef<IdentityBinding>({ generation: 0, identityKey: identityKeyValue });
  if (ref.current.identityKey !== identityKeyValue) ref.current = {
    generation: ref.current.generation + 1, identityKey: identityKeyValue,
  };
  return ref;
}

function invalidateBinding(ref: MutableRefObject<IdentityBinding>): void {
  ref.current = { generation: ref.current.generation + 1, identityKey: null };
}

function sameBinding(left: IdentityBinding | null, right: IdentityBinding): boolean {
  return Boolean(left && left.generation === right.generation && left.identityKey === right.identityKey);
}

function isRecoverable(outcome: OperatorDisplayOutcome): outcome is Extract<OperatorDisplayOutcome,
  { status: "SUBMISSION_OUTCOME_UNKNOWN" | "FINALIZED_READBACK_UNAVAILABLE" | "RECOVERY_REQUIRED" }> {
  return outcome.status === "SUBMISSION_OUTCOME_UNKNOWN" || outcome.status === "FINALIZED_READBACK_UNAVAILABLE"
    || outcome.status === "RECOVERY_REQUIRED";
}

type ResolveFormProps = Readonly<{ agentId: string; phase: EvaluateState["phase"]; valid: boolean; invalid: boolean;
  demoId?: string; locked: boolean; onEdit: (agentId: string) => unknown;
  onResolve: (agentId: string) => unknown; onCancel: () => void }>;

export function ResolveForm({ agentId, phase, valid, invalid, demoId, locked, onEdit, onResolve, onCancel }: ResolveFormProps) {
  return <form className="evaluate-form" onSubmit={(event) => {
    event.preventDefault(); if (valid && !locked && phase !== "resolving") onResolve(agentId);
  }}><div className="input-row">
    <Field id="agent-id" label="ERC-8004 Agent ID" inputMode="numeric" pattern="[0-9]*"
      value={agentId} disabled={locked} invalid={invalid}
      aria-invalid={invalid || undefined} aria-describedby="agent-id-status"
      onChange={(event) => onEdit(event.target.value.trim())} placeholder="e.g. 1842" autoComplete="off" />
    {phase === "resolving"
      ? <Button variant="primary" type="button" onClick={onCancel}>Cancel resolution</Button>
      : <Button variant="primary" type="submit" disabled={!valid || locked}>Resolve identity</Button>}
    </div>
    {demoId && <button className="demo-action" type="button" disabled={locked} onClick={() => {
      onEdit(demoId); onResolve(demoId);
    }}>Load labeled demo fixture · Agent #{demoId}</button>}
  </form>;
}

type CompletionStatusProps = Readonly<{ refresh: "awaiting" | "refreshing" | "complete" | "failed";
  refreshError: ApiErrorShape | null }>;

export function CompletionStatus({ refresh, refreshError }: CompletionStatusProps) {
  if (refresh === "failed") return <StateMessage state="error" title="ProofLock write succeeded.">
    Current read-back is unavailable ({refreshError?.code ?? "READ_FAILED"}).
    Do not retry: the write may already be final.
  </StateMessage>;
  return <StateMessage announce="off" state="success" title="ProofLock write succeeded.">
    {refresh === "complete" ? "Current read-back refreshed." : "Confirming current read-back…"}
  </StateMessage>;
}

function OperatorPanel({ state, dispatch, evaluate, cancel, outcome, canceling, recovering }: Readonly<{
  state: EvaluateState; dispatch: Dispatch<EvaluateAction>; evaluate: () => Promise<unknown>;
  cancel: () => void; outcome: OperatorDisplayOutcome | null;
  canceling: boolean; recovering: boolean;
}>) {
  const busy = state.phase === "running" || state.phase === "completed" && state.refresh === "refreshing";
  const recoveryRequired = outcome ? isRecoverable(outcome) : false;
  const reconcileRequired = outcome?.status === "CONNECTION_INTERRUPTED";
  return <div className="operator-panel"><div><span className="card-kicker">Named operator-authorized validator</span><h3>{state.lock ? "Current ProofLock found" : "Issue first ProofLock"}</h3>
    <p>Mutation requires an operator token. It stays only in this form state and is cleared after the request.</p></div>
    {state.lock ? <p className="inline-state state-warn">Existing v{state.lock.version}. Continue with drift, reseal, or recovery below.</p> : <div className="operator-controls">
      <Field id="operator-token" label="One-time operator token" type="password"
        value={state.operatorToken} disabled={busy} onChange={(event) => dispatch({ type: "EDIT_OPERATOR_TOKEN", token: event.target.value })}
        autoComplete="off" spellCheck={false} />
      {!recoveryRequired && <Button variant="primary" type="button" onClick={() => void evaluate()}
        disabled={!state.operatorToken || recovering} pending={busy}
        pendingLabel="Evaluation running…">{reconcileRequired
          ? "Resume/reconcile evaluation" : "Run verified evaluation"}</Button>}
      {state.phase === "running" && <Button type="button" onClick={cancel}
        disabled={canceling}>{canceling ? "Cancelling…" : "Cancel seal"}</Button>}</div>}
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

function apiError(cause: unknown, code: string, message: string, stage = "VALIDATING_IDENTITY"): ApiErrorShape {
  return cause instanceof ProofLockApiError ? cause.detail
    : { code, message, stage, retryable: true, requestId: "client" };
}

function validAgentId(agentId: string): boolean {
  return agentId !== "" && identityInputState(agentId, "idle") !== "INVALID";
}

function proofIdFor(record: ProofLockRecord): `0x${string}` | null {
  const registry = process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS;
  return registry ? computeProofId(registry, record) : null;
}
