"use client";

import type { ApiErrorShape, Bytes32, OperatorRunProgress, ProofLockWriteOutcome } from "@/lib/prooflock-types";

export type OperationCertainty = "ACCEPTED" | "SUBMISSION_ATTEMPTED" | "HASH_KNOWN" | "FINALIZED";
export type CancelDecision =
  | Readonly<{ kind: "CANCELED_BEFORE_ACCEPTANCE" }>
  | Readonly<{ kind: "CONNECTION_INTERRUPTED" }>
  | Readonly<{ kind: "RECOVERY_REQUIRED"; certainty: OperationCertainty;
      recoveryId: string; transactionHash?: Bytes32 }>
  | Readonly<{ kind: "REVERTED"; recoveryId: string; transactionHash: Bytes32 }>;

export type OperatorDisplayOutcome = ProofLockWriteOutcome
  | Readonly<{ status: "CANCELED_BEFORE_ACCEPTANCE" }>
  | Readonly<{ status: "CONNECTION_INTERRUPTED" }>
  | Readonly<{ status: "RECOVERY_REQUIRED"; certainty: OperationCertainty;
      recoveryId: string; transactionHash?: Bytes32 }>;

export function interruptedOutcome(decision: CancelDecision): OperatorDisplayOutcome {
  if (decision.kind === "CANCELED_BEFORE_ACCEPTANCE" || decision.kind === "CONNECTION_INTERRUPTED")
    return { status: decision.kind };
  if (decision.kind === "REVERTED") return { status: "REVERTED",
    recoveryId: decision.recoveryId, transactionHash: decision.transactionHash };
  return { status: "RECOVERY_REQUIRED", certainty: decision.certainty, recoveryId: decision.recoveryId,
    ...(decision.transactionHash ? { transactionHash: decision.transactionHash } : {}) };
}

export function createOperatorRunSession(clearSecret: () => void = () => {}) {
  return new OperatorRunSession(clearSecret);
}

class OperatorRunSession {
  private controller?: AbortController;
  private activeGeneration?: number;
  private generation = 0;
  private recoveryId?: string;
  private transactionHash?: Bytes32;
  private certainty?: OperationCertainty;
  private reverted = false;
  private invoked = false;
  private disposed = false;

  constructor(private readonly clearSecret: () => void) {}

  begin(): Readonly<{ signal: AbortSignal; generation: number }> | null {
    if (this.controller || this.disposed) return null;
    this.controller = new AbortController(); this.activeGeneration = ++this.generation;
    return Object.freeze({ signal: this.controller.signal, generation: this.activeGeneration });
  }

  observe(progress: OperatorRunProgress): void {
    this.invoked = true;
    if ("type" in progress) { this.recoveryId = progress.recoveryId; this.certainty = "ACCEPTED"; }
    if ("phase" in progress && progress.phase === "SUBMISSION_ATTEMPTED") this.certainty = "SUBMISSION_ATTEMPTED";
    if ("phase" in progress && progress.phase === "HASH_KNOWN") this.certainty = "HASH_KNOWN";
    if ("phase" in progress && progress.phase === "FINALIZED") this.certainty = "FINALIZED";
    if ("phase" in progress && progress.phase === "REVERTED") this.reverted = true;
    if ("transactionHash" in progress) this.transactionHash = progress.transactionHash;
  }

  cancel(): CancelDecision | null {
    if (!this.controller) return null;
    this.controller.abort(new DOMException("Operator canceled request", "AbortError"));
    return this.interruptionDecision();
  }

  interrupted(): CancelDecision {
    return this.interruptionDecision();
  }

  markInvoked(): void { if (this.controller) this.invoked = true; }

  invalidate(): void {
    this.controller?.abort(new DOMException("Operator context changed", "AbortError")); this.settle();
  }

  settle(request?: Readonly<{ generation: number }>): void {
    if (request && request.generation !== this.activeGeneration) return;
    this.controller = undefined;
    this.activeGeneration = undefined;
    this.recoveryId = undefined;
    this.transactionHash = undefined;
    this.certainty = undefined;
    this.reverted = false;
    this.invoked = false;
  }

  activate(): void { this.disposed = false; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort(new DOMException("Operator view closed", "AbortError"));
    this.clearSecret();
  }

  snapshot() {
    return Object.freeze({ active: Boolean(this.controller), recoveryId: this.recoveryId,
      transactionHash: this.transactionHash, certainty: this.certainty, reverted: this.reverted });
  }

  private recoveryDecision(): Extract<CancelDecision, { kind: "RECOVERY_REQUIRED" | "REVERTED" }> {
    if (this.reverted && this.transactionHash) return { kind: "REVERTED", recoveryId: this.recoveryId!,
      transactionHash: this.transactionHash };
    return { kind: "RECOVERY_REQUIRED", certainty: this.certainty!, recoveryId: this.recoveryId!,
      ...(this.transactionHash ? { transactionHash: this.transactionHash } : {}) };
  }

  private interruptionDecision(): CancelDecision {
    if (this.recoveryId && this.certainty) return this.recoveryDecision();
    return this.invoked ? { kind: "CONNECTION_INTERRUPTED" } : { kind: "CANCELED_BEFORE_ACCEPTANCE" };
  }
}

type WriteRecoveryPanelProps = Readonly<{
  outcome: OperatorDisplayOutcome;
  error?: ApiErrorShape;
  mode: "SEAL" | "RESEAL";
  recovering: boolean;
  recoverDisabled?: boolean;
  explorerBase: string;
  onRecover(): void;
}>;

export function WriteRecoveryPanel(props: WriteRecoveryPanelProps) {
  if (props.outcome.status === "SEALED") return <SealedOutcome outcome={props.outcome} />;
  if (props.outcome.status === "CANCELED_BEFORE_ACCEPTANCE") return <CanceledOutcome />;
  if (props.outcome.status === "CONNECTION_INTERRUPTED")
    return <ConnectionInterruptedOutcome error={props.error} mode={props.mode} />;
  if (props.outcome.status === "NOT_BROADCAST") return <NotBroadcastOutcome {...props} />;
  if (props.outcome.status === "REVERTED") return <RevertedOutcome {...props} />;
  return <RecoveryRequiredOutcome {...props} />;
}

function CanceledOutcome() {
  return <section className="inline-state state-warn" role="alert">
    <b>Canceled before the operation was accepted.</b> The network request was not invoked.
  </section>;
}

function ConnectionInterruptedOutcome({ error, mode }: Readonly<{ error?: ApiErrorShape; mode: "SEAL" | "RESEAL" }>) {
  return <section className="inline-state state-warn" role="alert">
    <b>Connection interrupted; operation outcome is unestablished.</b>{" "}
    {error && <FailureDetail mode={mode} error={error} />}
    <p>Resume/reconcile this same operation. Its stable idempotency key prevents a fresh paid retry.</p>
  </section>;
}

export function WriteFailureNotice({ error, mode }: Readonly<{
  error: ApiErrorShape; mode: "SEAL" | "RESEAL";
}>) {
  return <section className="inline-state state-bad" role="alert"><FailureDetail mode={mode} error={error} /></section>;
}

function SealedOutcome({ outcome }: Readonly<{
  outcome: Extract<ProofLockWriteOutcome, { status: "SEALED" }>;
}>) {
  return <section className="inline-state state-good" role="status">
    <b>ProofLock v{outcome.version} sealed.</b>{" "}
    <a className="text-link" href={`/agents/${outcome.identityKey}`}>Open proof record</a>
  </section>;
}

function NotBroadcastOutcome({ mode, error }: WriteRecoveryPanelProps) {
  const label = mode === "RESEAL" ? "Reseal" : "Seal";
  return <section className="inline-state state-bad" role="alert">
    <b>{label} failed at {error?.stage ?? "WRITING_CHAIN"}.</b>{" "}
    <span className="mono">{error?.code ?? "NOT_BROADCAST"}</span>. No lease was issued.
  </section>;
}

function RevertedOutcome({ error, outcome, explorerBase, mode }: WriteRecoveryPanelProps) {
  if (outcome.status !== "REVERTED") return null;
  return <section className="inline-state state-bad" role="alert">
    <b>Registry transaction reverted.</b>{" "}
    {error ? <FailureDetail mode={mode} error={error} /> : <span className="mono">REVERTED</span>}{" "}
    <TransactionLink explorerBase={explorerBase} transactionHash={outcome.transactionHash} />
  </section>;
}

function RecoveryRequiredOutcome(props: WriteRecoveryPanelProps) {
  const { outcome } = props;
  if (outcome.status !== "SUBMISSION_OUTCOME_UNKNOWN" && outcome.status !== "FINALIZED_READBACK_UNAVAILABLE"
    && outcome.status !== "RECOVERY_REQUIRED") return null;
  return <section className="inline-state state-warn" role="alert">
    <b>{outcome.status === "RECOVERY_REQUIRED" ? recoveryHeading(outcome.certainty)
      : outcome.status === "SUBMISSION_OUTCOME_UNKNOWN"
      ? "Submission was attempted, but broadcast is not yet proven."
      : `Registry transaction finalized for expected ProofLock v${outcome.version}; read-back is unavailable.`}</b>
    {outcome.transactionHash && <p><TransactionLink explorerBase={props.explorerBase}
      transactionHash={outcome.transactionHash} /></p>}
    {props.error && props.error.stage !== "RECOVERING_WRITE"
      && <p><FailureDetail mode={props.mode} error={props.error} /></p>}
    {props.error?.stage === "RECOVERING_WRITE" && <p><b>Recovery failed at {props.error.stage}.</b>{" "}
      <span className="mono">{props.error.code}</span></p>}
    <p>Recover before retrying. Recovery verifies the durable operation and never repeats paid work.</p>
    <button className="button" type="button" aria-label="Recover write"
      disabled={props.recovering || props.recoverDisabled} onClick={props.onRecover}>
      {props.recovering ? "Recovering…" : "Recover write"}
    </button>
  </section>;
}

function FailureDetail({ mode, error }: Readonly<{ mode: "SEAL" | "RESEAL"; error: ApiErrorShape }>) {
  return <><b>{mode === "RESEAL" ? "Reseal" : "Seal"} failed at {error.stage}.</b>{" "}
    <span className="mono">{error.code}</span>.</>;
}

function recoveryHeading(certainty: OperationCertainty): string {
  if (certainty === "FINALIZED") return "Registry transaction finalized; read-back is not yet proven.";
  if (certainty === "HASH_KNOWN") return "A transaction hash was observed; finality is not yet proven.";
  if (certainty === "SUBMISSION_ATTEMPTED") return "Submission was attempted, but broadcast is not yet proven.";
  return "Operation was durably accepted; Registry submission is not established.";
}

function TransactionLink({ explorerBase, transactionHash }: Readonly<{
  explorerBase: string; transactionHash: Bytes32;
}>) {
  const href = safeTransactionHref(explorerBase, transactionHash);
  if (!href) return <span className="mono break">{transactionHash}</span>;
  return <a className="text-link mono break" href={href}
    target="_blank" rel="noreferrer">{transactionHash}</a>;
}

function safeTransactionHref(explorerBase: string, transactionHash: Bytes32): string | undefined {
  try { const base = new URL(explorerBase);
    if (base.protocol !== "https:" || base.origin !== "https://chainscan.0g.ai"
      || base.username || base.password) return undefined;
    return new URL(`/tx/${transactionHash}`, base.origin).toString();
  } catch { return undefined; }
}
