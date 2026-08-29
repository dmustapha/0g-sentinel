import type {
  ApiErrorShape, CanonicalIdentity, GateDecision, OperatorRunInput, ProofLockRecord, RunnerStage,
} from "./prooflock-types";

type WriteOutcome<Status extends string> = Readonly<{ status: Status }>;
type Common = Readonly<{ generation: number; agentId: string }>;
type EmptyData = Readonly<{ operatorToken: ""; identity: null; lock: null; gate: null;
  stages: readonly []; failed: null; writeOutcome: WriteOutcome<"NOT_STARTED"> }>;
type ResolvedData = Readonly<{ operatorToken: string; identity: CanonicalIdentity;
  lock: ProofLockRecord | null; gate: GateDecision | null; stages: readonly []; failed: null; error: null }>;
type PaidData = Readonly<{ identity: CanonicalIdentity;
  lock: ProofLockRecord | null; gate: GateDecision | null; stages: readonly RunnerStage[] }>;

type IdleState = Common & EmptyData & Readonly<{ phase: "idle"; error: null }>;
type ResolvingState = Common & EmptyData & Readonly<{ phase: "resolving"; error: null }>;
type ResolveErrorState = Common & EmptyData & Readonly<{ phase: "resolve_error"; error: ApiErrorShape }>;
type ResolvedState = Common & ResolvedData & Readonly<{ phase: "resolved"; writeOutcome: WriteOutcome<"NOT_STARTED"> }>;
type RunningState = Common & Omit<ResolvedData, "stages"> & Readonly<{ phase: "running";
  stages: readonly RunnerStage[]; writeOutcome: WriteOutcome<"IN_PROGRESS"> }>;
type FailedState = Common & PaidData & Readonly<{ phase: "failed"; operatorToken: string;
  failed: Readonly<{ stage: RunnerStage; code: string }>;
  error: ApiErrorShape; writeOutcome: WriteOutcome<"FAILED"> }>;
type CompletionRefresh =
  | Readonly<{ refresh: "awaiting" | "refreshing" | "complete"; refreshError: null }>
  | Readonly<{ refresh: "failed"; refreshError: ApiErrorShape }>;
type CompletedState = Common & PaidData & Readonly<{ phase: "completed"; operatorToken: ""; failed: null; error: null;
  writeOutcome: WriteOutcome<"SUCCEEDED"> }> & CompletionRefresh;

export type EvaluateState = IdleState | ResolvingState | ResolveErrorState | ResolvedState
  | RunningState | FailedState | CompletedState;

export type ResolutionResult = Readonly<{ identity: CanonicalIdentity; lock: ProofLockRecord | null; gate: GateDecision | null }>;
export type EvaluateAction =
  | Readonly<{ type: "EDIT_IDENTITY"; agentId: string; generation: number }>
  | Readonly<{ type: "EDIT_OPERATOR_TOKEN"; token: string }>
  | Readonly<{ type: "BEGIN_RESOLVE"; generation: number }>
  | Readonly<{ type: "CANCEL_RESOLVE"; generation: number }>
  | (Readonly<{ type: "RESOLVE_SUCCEEDED"; generation: number; requestedAgentId: string }> & ResolutionResult)
  | Readonly<{ type: "RESOLVE_FAILED"; generation: number; requestedAgentId: string; error: ApiErrorShape }>
  | Readonly<{ type: "BEGIN_RUN" }>
  | Readonly<{ type: "STAGE_REACHED"; stage: RunnerStage }>
  | Readonly<{ type: "RUN_SUCCEEDED" }>
  | Readonly<{ type: "RUN_FAILED"; error: ApiErrorShape }>
  | Readonly<{ type: "BEGIN_COMPLETION_REFRESH"; generation: number }>
  | (Readonly<{ type: "COMPLETION_REFRESH_SUCCEEDED"; generation: number; requestedAgentId: string }> & ResolutionResult)
  | Readonly<{ type: "COMPLETION_REFRESH_FAILED"; generation: number; requestedAgentId: string; error: ApiErrorShape }>;

export const initialEvaluateState: EvaluateState = idleState("", 0);

export function evaluateReducer(state: EvaluateState, action: EvaluateAction): EvaluateState {
  if (action.type === "EDIT_IDENTITY") return editIdentity(state, action);
  if (action.type === "EDIT_OPERATOR_TOKEN") return editToken(state, action.token);
  if (action.type === "BEGIN_RESOLVE") return beginResolve(state, action.generation);
  if (action.type === "CANCEL_RESOLVE") return cancelResolve(state, action.generation);
  if (action.type === "RESOLVE_SUCCEEDED") return resolveSucceeded(state, action);
  if (action.type === "RESOLVE_FAILED") return resolveFailed(state, action);
  if (action.type === "BEGIN_RUN") return beginRun(state);
  if (action.type === "STAGE_REACHED") return stageReached(state, action.stage);
  if (action.type === "RUN_SUCCEEDED") return runSucceeded(state);
  if (action.type === "RUN_FAILED") return runFailed(state, action.error);
  if (action.type === "BEGIN_COMPLETION_REFRESH") return beginCompletionRefresh(state, action.generation);
  return completeRefresh(state, action);
}

function editIdentity(state: EvaluateState, action: Extract<EvaluateAction, { type: "EDIT_IDENTITY" }>): EvaluateState {
  if (identityLocked(state)) return state;
  return idleState(action.agentId, action.generation);
}

function editToken(state: EvaluateState, token: string): EvaluateState {
  if (state.phase !== "resolved" && state.phase !== "failed") return state;
  return { ...state, operatorToken: token };
}

function beginResolve(state: EvaluateState, generation: number): EvaluateState {
  if (!state.agentId || identityLocked(state)) return state;
  return { ...idleState(state.agentId, generation), phase: "resolving" };
}

function cancelResolve(state: EvaluateState, generation: number): EvaluateState {
  if (state.phase !== "resolving" || state.generation !== generation) return state;
  return idleState(state.agentId, generation);
}

function resolveSucceeded(state: EvaluateState, action: Extract<EvaluateAction, { type: "RESOLVE_SUCCEEDED" }>): EvaluateState {
  if (!matchesResolve(state, action)) return state;
  return { phase: "resolved", generation: action.generation, agentId: action.requestedAgentId,
    operatorToken: "", identity: action.identity, lock: action.lock, gate: action.gate,
    stages: [], failed: null, error: null, writeOutcome: { status: "NOT_STARTED" } };
}

function resolveFailed(state: EvaluateState, action: Extract<EvaluateAction, { type: "RESOLVE_FAILED" }>): EvaluateState {
  if (!matchesResolve(state, action)) return state;
  return { ...idleState(state.agentId, state.generation), phase: "resolve_error", error: action.error };
}

function beginRun(state: EvaluateState): EvaluateState {
  if ((state.phase !== "resolved" && state.phase !== "failed") || !state.operatorToken) return state;
  return { ...state, phase: "running", stages: [], failed: null, error: null,
    writeOutcome: { status: "IN_PROGRESS" } };
}

function stageReached(state: EvaluateState, stage: RunnerStage): EvaluateState {
  if (state.phase !== "running" || state.stages.includes(stage)) return state;
  return { ...state, stages: [...state.stages, stage] };
}

function runSucceeded(state: EvaluateState): EvaluateState {
  if (state.phase !== "running") return state;
  return { ...state, phase: "completed", operatorToken: "", failed: null, error: null,
    writeOutcome: { status: "SUCCEEDED" }, refresh: "awaiting", refreshError: null };
}

function runFailed(state: EvaluateState, error: ApiErrorShape): EvaluateState {
  if (state.phase !== "running") return state;
  const stage = runnerStage(error.stage) ?? state.stages.at(-1) ?? "VALIDATING_IDENTITY";
  return { ...state, phase: "failed", operatorToken: "", error,
    failed: { stage, code: error.code }, writeOutcome: { status: "FAILED" } };
}

function beginCompletionRefresh(state: EvaluateState, generation: number): EvaluateState {
  if (state.phase !== "completed" || state.refresh !== "awaiting") return state;
  return { ...state, generation, refresh: "refreshing", refreshError: null };
}

function completeRefresh(state: EvaluateState, action: Extract<EvaluateAction,
  { type: "COMPLETION_REFRESH_SUCCEEDED" | "COMPLETION_REFRESH_FAILED" }>): EvaluateState {
  if (!matchesCompletionRefresh(state, action)) return state;
  if (action.type === "COMPLETION_REFRESH_FAILED") return { ...state, refresh: "failed", refreshError: action.error };
  return { ...state, identity: action.identity, lock: action.lock, gate: action.gate,
    refresh: "complete", refreshError: null };
}

export function canStartPaidRun(state: EvaluateState, active: boolean): state is ResolvedState | FailedState {
  return !active && (state.phase === "resolved" || state.phase === "failed") && Boolean(state.operatorToken);
}

type PaidRunner = (input: OperatorRunInput, token: string,
  onStage: (stage: RunnerStage) => void) => Promise<import("./prooflock-types").OperatorTerminalResult>;

export async function executePaidRun(state: EvaluateState, active: { current: boolean }, runner: PaidRunner,
  dispatch: (action: EvaluateAction) => void, refresh: (agentId: string) => unknown,
  normalizeError: (cause: unknown) => ApiErrorShape): Promise<boolean> {
  if (!canStartPaidRun(state, active.current)) return false;
  active.current = true; dispatch({ type: "BEGIN_RUN" });
  try {
    const result = await runner({ identity: state.identity.identity, mode: "SEAL" }, state.operatorToken,
      (stage) => dispatch({ type: "STAGE_REACHED", stage }));
    if (result.kind !== "SEALED" || result.writeOutcome.status !== "SEALED")
      throw new Error("ProofLock operation requires recovery before success");
    dispatch({ type: "RUN_SUCCEEDED" }); refresh(state.agentId);
  } catch (cause) {
    dispatch({ type: "RUN_FAILED", error: normalizeError(cause) });
  } finally { active.current = false; }
  return true;
}

export function identityLocked(state: EvaluateState): boolean {
  return state.phase === "running" || state.phase === "completed"
    && (state.refresh === "awaiting" || state.refresh === "refreshing");
}

function matchesResolve(state: EvaluateState, action: { generation: number; requestedAgentId: string }): boolean {
  return state.phase === "resolving" && state.generation === action.generation && state.agentId === action.requestedAgentId;
}

function matchesCompletionRefresh(state: EvaluateState, action: { generation: number; requestedAgentId: string }): state is CompletedState {
  return state.phase === "completed" && state.refresh === "refreshing"
    && state.generation === action.generation && state.agentId === action.requestedAgentId;
}

function idleState(agentId: string, generation: number): IdleState {
  return { phase: "idle", generation, agentId, operatorToken: "", identity: null, lock: null,
    gate: null, stages: [], failed: null, error: null, writeOutcome: { status: "NOT_STARTED" } };
}

type ResolutionLoader = (agentId: string, signal: AbortSignal) => Promise<ResolutionResult>;
type ActiveRequest = Readonly<{ kind: "resolve" | "refresh"; generation: number;
  agentId: string; controller: AbortController }>;

export function createResolutionCoordinator(load: ResolutionLoader, dispatch: (action: EvaluateAction) => void,
  normalizeError: (cause: unknown) => ApiErrorShape = defaultResolutionError) {
  return new ResolutionCoordinator(load, dispatch, normalizeError);
}

class ResolutionCoordinator {
  private generation = 0;
  private active?: ActiveRequest;
  private disposed = false;

  constructor(private readonly load: ResolutionLoader, private readonly dispatch: (action: EvaluateAction) => void,
    private readonly normalizeError: (cause: unknown) => ApiErrorShape) {}

  edit = (agentId: string): boolean => {
    if (this.disposed || this.active?.kind === "refresh") return false;
    this.active?.controller.abort(); this.active = undefined;
    this.dispatch({ type: "EDIT_IDENTITY", agentId, generation: ++this.generation }); return true;
  };

  resolve = (agentId: string, valid: boolean): boolean => {
    if (this.disposed || !valid || this.active?.kind === "refresh") return false;
    this.active?.controller.abort(); return this.begin("resolve", agentId);
  };

  refresh = (agentId: string): boolean => {
    if (this.disposed || this.active) return false;
    return this.begin("refresh", agentId);
  };

  cancel = (): void => {
    if (this.disposed || this.active?.kind !== "resolve") return;
    const request = this.active; this.active = undefined; request.controller.abort();
    this.dispatch({ type: "CANCEL_RESOLVE", generation: request.generation });
  };

  activate(): void { this.disposed = false; }
  dispose(): void { this.disposed = true; this.active?.controller.abort(); this.active = undefined; }

  private begin(kind: ActiveRequest["kind"], agentId: string): boolean {
    const request = { kind, agentId, generation: ++this.generation, controller: new AbortController() } as const;
    this.active = request;
    this.dispatch(kind === "resolve" ? { type: "BEGIN_RESOLVE", generation: request.generation }
      : { type: "BEGIN_COMPLETION_REFRESH", generation: request.generation });
    void this.settle(request); return true;
  }

  private async settle(request: ActiveRequest): Promise<void> {
    try { this.finish(request, await this.load(request.agentId, request.controller.signal)); }
    catch (cause) { this.fail(request, this.normalizeError(cause)); }
    finally { if (this.active === request) this.active = undefined; }
  }

  private finish(request: ActiveRequest, value: ResolutionResult): void {
    if (!this.isCurrent(request)) return;
    this.dispatch(request.kind === "resolve" ? { type: "RESOLVE_SUCCEEDED", generation: request.generation,
      requestedAgentId: request.agentId, ...value } : { type: "COMPLETION_REFRESH_SUCCEEDED",
      generation: request.generation, requestedAgentId: request.agentId, ...value });
  }

  private fail(request: ActiveRequest, error: ApiErrorShape): void {
    if (!this.isCurrent(request) || request.controller.signal.aborted) return;
    this.dispatch(request.kind === "resolve" ? { type: "RESOLVE_FAILED", generation: request.generation,
      requestedAgentId: request.agentId, error } : { type: "COMPLETION_REFRESH_FAILED",
      generation: request.generation, requestedAgentId: request.agentId, error });
  }

  private isCurrent(request: ActiveRequest): boolean {
    return !this.disposed && this.active === request;
  }
}

function defaultResolutionError(): ApiErrorShape {
  return { code: "IDENTITY_UNAVAILABLE", message: "Canonical identity could not be resolved.",
    stage: "VALIDATING_IDENTITY", retryable: true, requestId: "client" };
}

function runnerStage(value: string): RunnerStage | undefined {
  return RUNNER_STAGES.find((stage) => stage === value);
}

const RUNNER_STAGES: readonly RunnerStage[] = [
  "VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS", "RUNNING_COMPUTE",
  "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE", "VERIFYING_STORAGE", "WRITING_CHAIN",
  "READING_CHAIN_BACK", "SEALED",
];
