import type {
  CurrentVerification,
  ProofLockDetailResponse,
  ProofVerificationState,
  VerificationState,
  VerifiedProof,
} from "./prooflock-types";

type HistoricalFailure = Extract<ProofVerificationState,
  "MISMATCH" | "HINT_REQUIRED" | "UNAVAILABLE" | "TIMEOUT" | "CANCELED">;
type CurrentFailure = Extract<CurrentVerification["status"],
  "UNAVAILABLE" | "TIMEOUT" | "CANCELED">;

export type VerificationAction =
  | Readonly<{ type: "RESET"; generation: number }>
  | Readonly<{ type: "START"; generation: number; retry: boolean }>
  | Readonly<{ type: "HISTORICAL_MATCH"; generation: number; proof: VerifiedProof }>
  | Readonly<{ type: "HISTORICAL_FAILURE"; generation: number; status: HistoricalFailure }>
  | Readonly<{ type: "CURRENT_START"; generation: number }>
  | Readonly<{ type: "CURRENT_RESULT"; generation: number; access: "ADMITTED" | "BLOCKED"; reason: string }>
  | Readonly<{ type: "CURRENT_FAILURE"; generation: number; status: CurrentFailure }>;

export const initialVerificationState: VerificationState = {
  generation: 0,
  historical: { status: "IDLE" },
  current: { status: "IDLE" },
};

export function verificationReducer(state: VerificationState, action: VerificationAction): VerificationState {
  if (action.type === "RESET") return reset(state, action.generation);
  if (action.type === "START") return start(state, action);
  if (action.generation !== state.generation) return state;
  const historicalActive = state.historical.status === "VERIFYING" ||
    state.historical.status === "RETRYING";
  if (action.type === "HISTORICAL_MATCH" && historicalActive) {
    return historicalMatch(state, action.proof);
  }
  if (action.type === "HISTORICAL_FAILURE" && historicalActive) {
    return historicalFailure(state, action.status);
  }
  if (state.historical.status !== "MATCH") return state;
  if (action.type === "CURRENT_START" && state.current.status === "IDLE") {
    return { ...state, current: { status: "READING" } };
  }
  if (action.type === "CURRENT_RESULT" && state.current.status === "READING") {
    return { ...state, current: { status: action.access, reason: action.reason } };
  }
  if (action.type === "CURRENT_FAILURE" && state.current.status === "READING") {
    return { ...state, current: { status: action.status } };
  }
  return state;
}

function reset(state: VerificationState, generation: number): VerificationState {
  if (generation <= state.generation) return state;
  return { generation, historical: { status: "IDLE" }, current: { status: "IDLE" } };
}

function start(state: VerificationState, action: Extract<VerificationAction, { type: "START" }>): VerificationState {
  if (action.generation <= state.generation) return state;
  return {
    generation: action.generation,
    historical: { status: action.retry ? "RETRYING" : "VERIFYING" },
    current: { status: "IDLE" },
  };
}

function historicalMatch(state: VerificationState, proof: VerifiedProof): VerificationState {
  return { ...state, historical: { status: "MATCH", proof }, current: { status: "IDLE" } };
}

function historicalFailure(state: VerificationState, status: HistoricalFailure): VerificationState {
  return { ...state, historical: { status }, current: { status: "IDLE" } };
}

export type VerificationIdentifiers = Readonly<{
  proofId: string;
  identityKey: string;
  sourceTxHash?: string;
}>;

type AbortKind = "TIMEOUT" | "CANCELED";
type TimedRequest = {
  controller: AbortController;
  generation: number;
  timer?: ReturnType<typeof setTimeout>;
  abortKind?: AbortKind;
};
type CoordinatorDependencies = Readonly<{
  timeoutMs: number;
  dispatch: (action: VerificationAction) => void;
  verifyHistorical: (identifiers: VerificationIdentifiers, signal: AbortSignal) => Promise<VerifiedProof>;
  readCurrent: (identityKey: string, signal: AbortSignal) => Promise<ProofLockDetailResponse>;
  mapHistoricalError: (cause: unknown, abortKind?: AbortKind) => HistoricalFailure;
  mapCurrentAccess: (detail: ProofLockDetailResponse) => Readonly<{ access: "ADMITTED" | "BLOCKED"; reason: string }>;
}>;

export function createVerificationCoordinator(dependencies: CoordinatorDependencies) {
  return new VerificationCoordinator(dependencies);
}

class VerificationCoordinator {
  private active = true;
  private generation = 0;
  private identifiers?: VerificationIdentifiers;
  private historical?: TimedRequest;
  private current?: TimedRequest;

  constructor(private readonly dependencies: CoordinatorDependencies) {}

  setIdentifiers(identifiers: VerificationIdentifiers): void {
    const reactivating = !this.active;
    this.active = true;
    if (!reactivating && identifiersEqual(this.identifiers, identifiers)) return;
    this.abortAll("CANCELED");
    this.identifiers = identifiers;
    this.dependencies.dispatch({ type: "RESET", generation: ++this.generation });
  }

  async start(retry: boolean): Promise<void> {
    if (!this.active || !this.identifiers) return;
    this.abortAll("CANCELED");
    const generation = ++this.generation;
    this.dependencies.dispatch({ type: "START", generation, retry });
    const request = this.openRequest("historical", generation);
    try {
      const proof = await this.dependencies.verifyHistorical(
        this.identifiers,
        request.controller.signal,
      );
      if (!this.claimRequest("historical", request)) return;
      this.dependencies.dispatch({ type: "HISTORICAL_MATCH", generation, proof });
    } catch (cause) {
      if (!this.claimRequest("historical", request)) return;
      const status = this.dependencies.mapHistoricalError(cause, request.abortKind);
      this.dependencies.dispatch({ type: "HISTORICAL_FAILURE", generation, status });
      return;
    }
    await this.readCurrent(generation);
  }

  cancelHistorical(): void {
    this.cancelPlane("historical");
  }

  cancelCurrent(): void {
    this.cancelPlane("current");
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    ++this.generation;
    this.abortAll("CANCELED");
  }

  private async readCurrent(generation: number): Promise<void> {
    if (!this.canCommit(generation) || !this.identifiers) return;
    this.dependencies.dispatch({ type: "CURRENT_START", generation });
    const request = this.openRequest("current", generation);
    try {
      const detail = await this.dependencies.readCurrent(
        this.identifiers.identityKey,
        request.controller.signal,
      );
      if (!this.requestIsActive("current", request)) return;
      if (detail.detail.status === "UNAVAILABLE") {
        if (!this.claimRequest("current", request)) return;
        this.dependencies.dispatch({
          type: "CURRENT_FAILURE",
          generation,
          status: "UNAVAILABLE",
        });
        return;
      }
      const result = this.dependencies.mapCurrentAccess(detail);
      if (!this.claimRequest("current", request)) return;
      this.dependencies.dispatch({ type: "CURRENT_RESULT", generation, ...result });
    } catch {
      if (!this.claimRequest("current", request)) return;
      this.dependencies.dispatch({
        type: "CURRENT_FAILURE",
        generation,
        status: request.abortKind ?? "UNAVAILABLE",
      });
    }
  }

  private openRequest(plane: "historical" | "current", generation: number): TimedRequest {
    const controller = new AbortController();
    const request: TimedRequest = { controller, generation };
    request.timer = setTimeout(() => this.timeoutPlane(plane, request), this.dependencies.timeoutMs);
    this[plane] = request;
    return request;
  }

  private timeoutPlane(plane: "historical" | "current", request: TimedRequest): void {
    if (!this.requestIsActive(plane, request)) return;
    request.abortKind ??= "TIMEOUT";
    request.controller.abort();
    this.detachRequest(plane, request);
    this.dispatchPlaneFailure(plane, request.generation, "TIMEOUT");
  }

  private cancelPlane(plane: "historical" | "current"): void {
    const request = this[plane];
    if (!request || !this.requestIsActive(plane, request)) return;
    request.abortKind ??= "CANCELED";
    request.controller.abort();
    this.detachRequest(plane, request);
    this.dispatchPlaneFailure(plane, request.generation, request.abortKind);
  }

  private claimRequest(plane: "historical" | "current", request: TimedRequest): boolean {
    if (!this.requestIsActive(plane, request)) return false;
    this.detachRequest(plane, request);
    return true;
  }

  private dispatchPlaneFailure(plane: "historical" | "current", generation: number, status: AbortKind): void {
    if (plane === "historical") {
      this.dependencies.dispatch({ type: "HISTORICAL_FAILURE", generation, status });
      return;
    }
    this.dependencies.dispatch({ type: "CURRENT_FAILURE", generation, status });
  }

  private requestIsActive(plane: "historical" | "current", request: TimedRequest): boolean {
    return this.active && this.canCommit(request.generation) && this[plane] === request;
  }

  private canCommit(generation: number): boolean {
    return this.active && generation === this.generation;
  }

  private detachRequest(plane: "historical" | "current", request: TimedRequest): void {
    clearTimeout(request.timer);
    if (this[plane] === request) this[plane] = undefined;
  }

  private abortAll(kind: AbortKind): void {
    this.abortRequest("historical", kind);
    this.abortRequest("current", kind);
  }

  private abortRequest(plane: "historical" | "current", kind: AbortKind): void {
    const request = this[plane];
    if (!request) return;
    request.abortKind ??= kind;
    clearTimeout(request.timer);
    request.controller.abort();
    this[plane] = undefined;
  }
}

function identifiersEqual(left: VerificationIdentifiers | undefined, right: VerificationIdentifiers): boolean {
  return left?.proofId === right.proofId && left.identityKey === right.identityKey &&
    left.sourceTxHash === right.sourceTxHash;
}
