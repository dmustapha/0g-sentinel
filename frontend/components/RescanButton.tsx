"use client";

import { useEffect, useRef, useState } from "react";
import { ProofLockApiError, markOnDemandDrift, recoverProofLock, runProofLock } from "@/lib/prooflock-client";
import type {
  ApiErrorShape, CanonicalIdentity, ProofLockRecord, RunnerStage,
} from "@/lib/prooflock-types";
import { StreamingScanPanel } from "./StreamingScanPanel";
import { WriteFailureNotice, WriteRecoveryPanel, createOperatorRunSession, interruptedOutcome } from "./WriteRecoveryPanel";
import type { OperatorDisplayOutcome } from "./WriteRecoveryPanel";

export function RescanButton({ identity, record, previousProofId, onComplete }: Readonly<{
  identity: CanonicalIdentity; record: ProofLockRecord; previousProofId: `0x${string}`; onComplete(): void;
}>) {
  const routeKey = detailRouteKey(record.identityKey, record.version, previousProofId);
  const stateRouteKeyRef = useRef(routeKey);
  const bindingRef = useDetailBinding(record.identityKey, record.version, previousProofId);
  const [token, setToken] = useState(""); const [busy, setBusy] = useState<"drift" | "reseal" | null>(null);
  const [stages, setStages] = useState<readonly RunnerStage[]>([]); const [write, setWrite] = useState<DetailWrite>();
  const [recoveringBinding, setRecoveringBinding] = useState<DetailBinding>();
  const [canceling, setCanceling] = useState(false); const [driftError, setDriftError] = useState("");
  const [drift, setDrift] = useState<Readonly<{ expected?: string; current?: string; drifted?: boolean; marked?: boolean }>>();
  const sessionRef = useRef<ReturnType<typeof createOperatorRunSession>>();
  const activeBindingRef = useRef<DetailBinding>();
  const routeControllerRef = useRef(new AbortController());
  if (!sessionRef.current) sessionRef.current = createOperatorRunSession(() => setToken(""));
  const session = sessionRef.current;
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => {
    routeControllerRef.current.abort(); routeControllerRef.current = new AbortController(); session.invalidate();
    activeBindingRef.current = undefined; setToken(""); setBusy(null); setStages([]); setWrite(undefined);
    setRecoveringBinding(undefined); setCanceling(false); setDriftError(""); setDrift(undefined);
    stateRouteKeyRef.current = routeKey;
  }, [routeKey, session]);
  const view = selectDetailView(routeKey, stateRouteKeyRef.current, { token, busy, stages, drift, driftError, write });
  const visibleWrite = view.write && sameDetailBinding(view.write.binding, bindingRef.current) ? view.write : undefined;
  const outcome = visibleWrite?.outcome; const error = visibleWrite?.error;
  const recovering = Boolean(recoveringBinding && sameDetailBinding(recoveringBinding, bindingRef.current));

  async function checkDrift() {
    if (!token || busy) return; const binding = bindingRef.current; const requestToken = token;
    const signal = routeControllerRef.current.signal; setToken(""); setBusy("drift"); setDriftError("");
    try { const raw = await markOnDemandDrift(record.identityKey, requestToken, signal) as Record<string, unknown>;
      if (!sameDetailBinding(bindingRef.current, binding)) return;
      const result = raw.result as Record<string, unknown> | undefined;
      setDrift({ expected: string(result?.expectedDigest), current: string(result?.currentDigest),
        drifted: result?.drifted === true, marked: result?.marked === true }); onComplete();
    } catch { if (sameDetailBinding(bindingRef.current, binding) && !signal.aborted)
      setDriftError("On-demand drift check failed safely. No lifecycle claim was changed by the UI."); }
    finally { if (sameDetailBinding(bindingRef.current, binding)) setBusy(null); }
  }

  async function reseal() {
    if (!token) return; const request = session.begin(); if (!request) return;
    const binding = bindingRef.current; const requestToken = token; setToken("");
    activeBindingRef.current = binding;
    setBusy("reseal"); setWrite(undefined); setStages([]); setCanceling(false);
    try { session.markInvoked(); const result = await runProofLock({ identity: identity.identity, mode: "RESEAL",
      expectedPriorVersion: record.version, previousProofId }, requestToken, appendBoundStage(setStages, bindingRef, binding), request.signal,
      undefined, (progress) => session.observe(progress));
      if (!sameDetailBinding(bindingRef.current, binding)) return;
      if (result.kind === "SEALED") { setStages([]); publishDetail(setWrite, binding, result.writeOutcome); onComplete(); }
      else if (result.operation.writeOutcome?.status === "SEALED") {
        setStages([]); publishDetail(setWrite, binding, result.operation.writeOutcome); onComplete();
      } else if (result.operation.writeOutcome) publishDetail(setWrite, binding, result.operation.writeOutcome);
      else publishDetail(setWrite, binding, { status: "RECOVERY_REQUIRED", certainty: "ACCEPTED",
        recoveryId: result.operation.recoveryId });
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")
      && sameDetailBinding(bindingRef.current, binding)) {
      const failed = resealFailure(cause, session); publishDetail(setWrite, binding, failed.outcome, failed.error);
    } } finally { if (sameDetailBinding(bindingRef.current, binding)) {
      setBusy(null); setCanceling(false); activeBindingRef.current = undefined;
    } session.settle(request); }
  }

  function cancelReseal() {
    const binding = activeBindingRef.current; const decision = session.cancel(); if (!decision || !binding) return;
    setCanceling(true); setToken("");
    if (sameDetailBinding(bindingRef.current, binding)) publishDetail(setWrite, binding, interruptedOutcome(decision));
  }

  async function recover() {
    if (!token || !outcome || !recoveryRequired(outcome)) return;
    const binding = bindingRef.current; const recoveryToken = token; setToken(""); setRecoveringBinding(binding);
    publishDetail(setWrite, binding, outcome);
    try { const result = await recoverProofLock(outcome.recoveryId, recoveryToken, outcome.transactionHash,
      routeControllerRef.current.signal);
      if (!sameDetailBinding(bindingRef.current, binding)) return;
      publishDetail(setWrite, binding, result); if (result.status === "SEALED") onComplete();
    } catch (cause) { if (sameDetailBinding(bindingRef.current, binding))
      publishDetail(setWrite, binding, outcome, normalizeResealError(cause));
    } finally { setRecoveringBinding((current) => current && sameDetailBinding(current, binding) ? undefined : current); }
  }

  const needsRecovery = outcome ? recoveryRequired(outcome) : false;
  const needsReconcile = outcome?.status === "CONNECTION_INTERRUPTED";
  return <section className="operator-panel lifecycle-controls"><div><span className="card-kicker">Operator controls</span><h3>On-demand drift · reseal</h3>
    <p>These authenticated actions use the real drift and synchronous ProofLock routes. The token is cleared after each request.</p></div>
    <label htmlFor="detail-token">One-time operator token</label><input id="detail-token" type="password" value={view.token}
      disabled={Boolean(view.busy) || recovering} onChange={(event) => setToken(event.target.value)} autoComplete="off" />
    <RescanActions token={view.token} busy={view.busy} canceling={canceling} recovering={recovering}
      recoveryRequired={needsRecovery} reconcileRequired={needsReconcile}
      onDrift={() => void checkDrift()} onReseal={() => void reseal()}
      onCancel={cancelReseal} />
    {view.drift && <DriftResult drift={view.drift} />}
    {view.driftError && <p className="inline-state state-bad" role="alert">{view.driftError}</p>}
    {view.stages.length > 0 && <StreamingScanPanel stages={view.stages} failed={runnerFailure(error)} />}
    {outcome && <WriteRecoveryPanel outcome={outcome} error={error} mode="RESEAL" recovering={recovering}
      recoverDisabled={!view.token} explorerBase={process.env.NEXT_PUBLIC_ZERO_G_EXPLORER ?? "https://chainscan.0g.ai"}
      onRecover={() => void recover()} />}
    {!outcome && error && <WriteFailureNotice error={error} mode="RESEAL" />}
  </section>;
}

type RescanActionsProps = Readonly<{ token: string; busy: "drift" | "reseal" | null; canceling: boolean;
  recovering: boolean; recoveryRequired: boolean; reconcileRequired?: boolean;
  onDrift(): void; onReseal(): void; onCancel(): void }>;

export function RescanActions(props: RescanActionsProps) {
  const locked = !props.token || Boolean(props.busy) || props.recovering;
  return <div className="action-row"><button className="button" type="button" disabled={locked}
    onClick={props.onDrift}>{props.busy === "drift" ? "Checking…" : "Run on-demand drift"}</button>
    {!props.recoveryRequired && <button className="button primary" type="button" disabled={locked}
      onClick={props.onReseal}>{props.busy === "reseal" ? "Resealing…"
        : props.reconcileRequired ? "Resume/reconcile reseal" : "Reseal new version"}</button>}
    {props.busy === "reseal" && <button className="button" type="button" disabled={props.canceling}
      onClick={props.onCancel}>{props.canceling ? "Cancelling…" : "Cancel reseal"}</button>}
  </div>;
}

function DriftResult({ drift }: Readonly<{ drift: Readonly<{
  expected?: string; current?: string; drifted?: boolean; marked?: boolean;
}> }>) {
  return <div className={drift.drifted ? "drift-diff state-bad" : "drift-diff state-good"}>
    <b>{drift.drifted ? "DRIFT DETECTED" : "NO DRIFT"}</b><span>Before <code>{drift.expected}</code></span>
    <span>After <code>{drift.current}</code></span><span>{drift.marked
      ? "Lifecycle marked on-chain; consumer action is blocked." : "No drift mark written."}</span>
  </div>;
}

function resealFailure(cause: unknown, session: ReturnType<typeof createOperatorRunSession>): Readonly<{
  outcome?: OperatorDisplayOutcome; error: ApiErrorShape;
}> {
  const error = normalizeResealError(cause);
  if (cause instanceof ProofLockApiError && cause.writeOutcome) return { outcome: cause.writeOutcome, error };
  if (cause instanceof ProofLockApiError) return { error };
  else if (!(cause instanceof DOMException && cause.name === "AbortError")) {
    const decision = session.interrupted();
    if (decision.kind !== "CANCELED_BEFORE_ACCEPTANCE") return { outcome: interruptedOutcome(decision), error };
  }
  return { error };
}

type DetailBinding = Readonly<{ generation: number; identityKey: string; version: string; previousProofId: string }>;
type DetailWrite = Readonly<{ binding: DetailBinding; outcome?: OperatorDisplayOutcome; error?: ApiErrorShape }>;
type DetailDrift = Readonly<{ expected?: string; current?: string; drifted?: boolean; marked?: boolean }>;
type DetailView<TWrite> = Readonly<{ token: string; busy: "drift" | "reseal" | null;
  stages: readonly RunnerStage[]; drift?: DetailDrift; driftError: string; write?: TWrite }>;

export function selectDetailView<TWrite>(routeKey: string, stateRouteKey: string,
  state: DetailView<TWrite>): DetailView<TWrite> {
  return routeKey === stateRouteKey ? state
    : { token: "", busy: null, stages: [], drift: undefined, driftError: "", write: undefined };
}

function detailRouteKey(identityKey: string, version: string, previousProofId: string): string {
  return JSON.stringify([identityKey, version, previousProofId]);
}

function useDetailBinding(identityKey: string, version: string, previousProofId: string): React.MutableRefObject<DetailBinding> {
  const ref = useRef<DetailBinding>({ generation: 0, identityKey, version, previousProofId });
  if (!sameDetailInput(ref.current, identityKey, version, previousProofId)) ref.current = {
    generation: ref.current.generation + 1, identityKey, version, previousProofId,
  };
  return ref;
}

function sameDetailBinding(left: DetailBinding, right: DetailBinding): boolean {
  return left.generation === right.generation && sameDetailInput(left,
    right.identityKey, right.version, right.previousProofId);
}

function sameDetailInput(binding: DetailBinding, identityKey: string, version: string, previousProofId: string): boolean {
  return binding.identityKey === identityKey && binding.version === version
    && binding.previousProofId === previousProofId;
}

function publishDetail(setWrite: React.Dispatch<React.SetStateAction<DetailWrite | undefined>>,
  binding: DetailBinding, outcome?: OperatorDisplayOutcome, error?: ApiErrorShape): void {
  setWrite({ binding, outcome, error });
}

function normalizeResealError(cause: unknown): ApiErrorShape {
  return cause instanceof ProofLockApiError ? cause.detail : { code: cause instanceof DOMException && cause.name === "AbortError"
    ? "REQUEST_ABORTED" : "RESEAL_FAILED", message: "Reseal stopped safely.",
    stage: "WRITING_CHAIN", retryable: false, requestId: "client" };
}

function recoveryRequired(outcome: OperatorDisplayOutcome): outcome is Extract<OperatorDisplayOutcome,
  { status: "SUBMISSION_OUTCOME_UNKNOWN" | "FINALIZED_READBACK_UNAVAILABLE" | "RECOVERY_REQUIRED" }> {
  return outcome.status === "SUBMISSION_OUTCOME_UNKNOWN" || outcome.status === "FINALIZED_READBACK_UNAVAILABLE"
    || outcome.status === "RECOVERY_REQUIRED";
}

function runnerFailure(error?: ApiErrorShape): { stage: RunnerStage; code: string } | undefined {
  return error && isRunnerStage(error.stage) ? { stage: error.stage, code: error.code } : undefined;
}

function isRunnerStage(value: string): value is RunnerStage {
  return ["VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS", "RUNNING_COMPUTE",
    "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE", "VERIFYING_STORAGE", "WRITING_CHAIN",
    "READING_CHAIN_BACK", "SEALED"].includes(value);
}

function appendStage(setStages: (value: readonly RunnerStage[] | ((value: readonly RunnerStage[]) => readonly RunnerStage[])) => void) {
  return (stage: RunnerStage) => setStages((value) => value.includes(stage) ? value : [...value, stage]);
}

function appendBoundStage(setStages: Parameters<typeof appendStage>[0], bindingRef: React.MutableRefObject<DetailBinding>,
  binding: DetailBinding) {
  const append = appendStage(setStages);
  return (stage: RunnerStage) => { if (sameDetailBinding(bindingRef.current, binding)) append(stage); };
}

function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
