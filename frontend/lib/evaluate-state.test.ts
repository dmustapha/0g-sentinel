import { describe, expect, it, vi } from "vitest";

import {
  canStartPaidRun, createResolutionCoordinator, evaluateReducer, executePaidRun, initialEvaluateState,
} from "./evaluate-state";
import type { EvaluateAction, ResolutionResult } from "./evaluate-state";
import type { CanonicalIdentity, GateDecision, ProofLockRecord } from "./prooflock-types";

const ADDRESS = `0x${"11".repeat(20)}` as const;
const HASH = `0x${"22".repeat(32)}` as const;

function identity(agentId: string): CanonicalIdentity {
  return { identity: { namespace: "eip155", chainId: 16661, registryAddress: ADDRESS, agentId },
    owner: ADDRESS, agentWallet: ADDRESS, agentURI: "ipfs://agent", registrationDigest: HASH,
    sourceBlockNumber: "1", sourceBlockHash: HASH, card: {} };
}

const lock = { identityKey: HASH, subject: ADDRESS, envelopeDigest: HASH, storageRoot: HASH,
  computeRoot: HASH, artifactHash: HASH, runtimeCodeHash: HASH, version: "1", issuedAt: "1",
  validUntil: "2", policyVersion: 1, behavioralScore: 1, codeRisk: 0, coverage: 0x7f,
  state: 1, stateReason: 0 } satisfies ProofLockRecord;
const gate = { allowed: true, reason: 0, subject: ADDRESS, version: "1" } satisfies GateDecision;

function result(agentId: string): ResolutionResult { return { identity: identity(agentId), lock, gate }; }

function resolvedState(agentId = "7") {
  let state = evaluateReducer(initialEvaluateState, { type: "EDIT_IDENTITY", agentId, generation: 1 });
  state = evaluateReducer(state, { type: "BEGIN_RESOLVE", generation: 2 });
  return evaluateReducer(state, { type: "RESOLVE_SUCCEEDED", generation: 2,
    requestedAgentId: agentId, ...result(agentId) });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Evaluate state", () => {
  it("represents phase-specific data as a discriminated union", () => {
    const idle = initialEvaluateState;
    const resolved = resolvedState();
    expect(idle).toEqual({ phase: "idle", generation: 0, agentId: "", operatorToken: "",
      identity: null, lock: null, gate: null, stages: [], failed: null, error: null,
      writeOutcome: { status: "NOT_STARTED" } });
    expect(resolved).toMatchObject({ phase: "resolved", identity: identity("7"), lock, gate,
      stages: [], failed: null, writeOutcome: { status: "NOT_STARTED" } });
  });

  it("atomically clears all identity-dependent state and the token on edit", () => {
    let state = evaluateReducer(resolvedState(), { type: "EDIT_OPERATOR_TOKEN", token: "secret" });
    state = evaluateReducer(state, { type: "BEGIN_RUN" });
    state = evaluateReducer(state, { type: "STAGE_REACHED", stage: "RUNNING_COMPUTE" });
    state = evaluateReducer(state, { type: "RUN_FAILED", error: {
      code: "COMPUTE_FAILED", message: "failed", stage: "", retryable: true, requestId: "test",
    } });
    const edited = evaluateReducer(state, { type: "EDIT_IDENTITY", agentId: "9", generation: 3 });
    expect(edited).toEqual({ phase: "idle", generation: 3, agentId: "9", operatorToken: "",
      identity: null, lock: null, gate: null, stages: [], failed: null, error: null,
      writeOutcome: { status: "NOT_STARTED" } });
  });

  it("clears resolved Agent A before accepting edits for Agent B", () => {
    const edited = evaluateReducer(resolvedState("7"), {
      type: "EDIT_IDENTITY", agentId: "8", generation: 3,
    });
    expect(edited).toEqual({ phase: "idle", generation: 3, agentId: "8", operatorToken: "",
      identity: null, lock: null, gate: null, stages: [], failed: null, error: null,
      writeOutcome: { status: "NOT_STARTED" } });
  });

  it("keeps paid success through refresh success, refresh failure, and cancel attempts", () => {
    let state = evaluateReducer(resolvedState(), { type: "EDIT_OPERATOR_TOKEN", token: "secret" });
    state = evaluateReducer(state, { type: "BEGIN_RUN" });
    state = evaluateReducer(state, { type: "RUN_SUCCEEDED" });
    expect(state).toMatchObject({ phase: "completed", refresh: "awaiting",
      writeOutcome: { status: "SUCCEEDED" }, operatorToken: "" });
    state = evaluateReducer(state, { type: "BEGIN_COMPLETION_REFRESH", generation: 3 });
    expect(evaluateReducer(state, { type: "CANCEL_RESOLVE", generation: 3 })).toBe(state);
    const failed = evaluateReducer(state, { type: "COMPLETION_REFRESH_FAILED", generation: 3,
      requestedAgentId: "7", error: { code: "READ_FAILED", message: "failed", stage: "READING_CHAIN_BACK",
        retryable: true, requestId: "test" } });
    expect(failed).toMatchObject({ phase: "completed", refresh: "failed",
      writeOutcome: { status: "SUCCEEDED" }, identity: identity("7"), lock, gate });
    const refreshing = evaluateReducer(state, { type: "COMPLETION_REFRESH_SUCCEEDED", generation: 3,
      requestedAgentId: "7", ...result("7") });
    expect(refreshing).toMatchObject({ phase: "completed", refresh: "complete",
      writeOutcome: { status: "SUCCEEDED" }, identity: identity("7"), lock, gate });
  });

  it("derives failure from current stages and rejects duplicate paid starts", () => {
    let state = evaluateReducer(resolvedState(), { type: "EDIT_OPERATOR_TOKEN", token: "secret" });
    expect(canStartPaidRun(state, false)).toBe(true);
    state = evaluateReducer(state, { type: "BEGIN_RUN" });
    expect(canStartPaidRun(state, true)).toBe(false);
    expect(evaluateReducer(state, { type: "BEGIN_RUN" })).toBe(state);
    state = evaluateReducer(state, { type: "STAGE_REACHED", stage: "UPLOADING_STORAGE" });
    state = evaluateReducer(state, { type: "RUN_FAILED", error: {
      code: "UPLOAD_FAILED", message: "failed", stage: "", retryable: true, requestId: "test",
    } });
    expect(state).toMatchObject({ phase: "failed", operatorToken: "",
      failed: { stage: "UPLOADING_STORAGE", code: "UPLOAD_FAILED" }, writeOutcome: { status: "FAILED" } });
  });
});

describe("Resolution coordinator", () => {
  it("submits only valid identity input", () => {
    const dispatch = vi.fn(); const load = vi.fn();
    const coordinator = createResolutionCoordinator(load, dispatch);
    expect(coordinator.resolve("", false)).toBe(false);
    expect(load).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });

  it("aborts active resolution and makes double Cancel idempotent before the next success", async () => {
    const first = deferred<ResolutionResult>(); const second = deferred<ResolutionResult>();
    const signals: AbortSignal[] = []; const actions: EvaluateAction[] = [];
    const load = vi.fn((id: string, signal: AbortSignal) => {
      signals.push(signal); return id === "7" ? first.promise : second.promise;
    });
    const coordinator = createResolutionCoordinator(load, (action) => actions.push(action));
    expect(coordinator.resolve("7", true)).toBe(true);
    coordinator.cancel(); coordinator.cancel();
    expect(signals[0].aborted).toBe(true);
    expect(actions.filter(({ type }) => type === "CANCEL_RESOLVE")).toHaveLength(1);
    expect(coordinator.resolve("8", true)).toBe(true);
    second.resolve(result("8")); await vi.waitFor(() => expect(actions.at(-1)).toMatchObject({
      type: "RESOLVE_SUCCEEDED", generation: 2, requestedAgentId: "8",
    }));
  });

  it("ignores a superseded response even when its loader ignores abort", async () => {
    const old = deferred<ResolutionResult>(); const current = deferred<ResolutionResult>();
    const actions: EvaluateAction[] = [];
    const coordinator = createResolutionCoordinator((id) => id === "7" ? old.promise : current.promise,
      (action) => actions.push(action));
    coordinator.resolve("7", true); coordinator.resolve("8", true);
    old.resolve(result("7")); current.resolve(result("8"));
    await vi.waitFor(() => expect(actions.at(-1)).toMatchObject({ type: "RESOLVE_SUCCEEDED", requestedAgentId: "8" }));
    expect(actions).not.toContainEqual(expect.objectContaining({ type: "RESOLVE_SUCCEEDED", requestedAgentId: "7" }));
  });

  it("aborts on dispose and never dispatches a later completion", async () => {
    const pending = deferred<ResolutionResult>(); const actions: EvaluateAction[] = [];
    let signal: AbortSignal | undefined;
    const coordinator = createResolutionCoordinator((_id, activeSignal) => {
      signal = activeSignal; return pending.promise;
    }, (action) => actions.push(action));
    coordinator.resolve("7", true); coordinator.dispose(); pending.resolve(result("7"));
    await Promise.resolve(); await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(actions).toEqual([{ type: "BEGIN_RESOLVE", generation: 1 }]);
  });

  it("does not let resolve Cancel abort a paid completion refresh", async () => {
    const pending = deferred<ResolutionResult>(); const actions: EvaluateAction[] = [];
    let signal: AbortSignal | undefined;
    const coordinator = createResolutionCoordinator((_id, activeSignal) => {
      signal = activeSignal; return pending.promise;
    }, (action) => actions.push(action));
    expect(coordinator.refresh("7")).toBe(true); coordinator.cancel();
    expect(signal?.aborted).toBe(false);
    pending.resolve(result("7"));
    await vi.waitFor(() => expect(actions.at(-1)).toMatchObject({
      type: "COMPLETION_REFRESH_SUCCEEDED", requestedAgentId: "7",
    }));
  });
});

describe("Paid run orchestration", () => {
  it("detaches paid work from component cancellation and rejects a duplicate active start", async () => {
    let state = evaluateReducer(resolvedState(), { type: "EDIT_OPERATOR_TOKEN", token: "secret" });
    const pending = deferred<{ kind: "SEALED"; stage: "SEALED"; writeOutcome: { status: "SEALED";
      recoveryId: string; transactionHash: `0x${string}`; identityKey: `0x${string}`; version: string } }>();
    const active = { current: false }; const actions: EvaluateAction[] = [];
    const runner = vi.fn(() => pending.promise); const refresh = vi.fn();
    const first = executePaidRun(state, active, runner, (action) => actions.push(action), refresh,
      () => ({ code: "RUN_FAILED", message: "failed", stage: "VALIDATING_IDENTITY", retryable: true, requestId: "test" }));
    await expect(executePaidRun(state, active, runner, () => {}, refresh, () => ({
      code: "RUN_FAILED", message: "failed", stage: "VALIDATING_IDENTITY", retryable: true, requestId: "test",
    }))).resolves.toBe(false);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]).toHaveLength(3);
    expect(runner.mock.calls[0].some((value: unknown) => value instanceof AbortSignal)).toBe(false);
    pending.resolve({ kind: "SEALED", stage: "SEALED", writeOutcome: { status: "SEALED",
      recoveryId: "rec_1234567890abcdef", transactionHash: `0x${"1".repeat(64)}`,
      identityKey: `0x${"2".repeat(64)}`, version: "1" } }); await expect(first).resolves.toBe(true);
    expect(actions.map(({ type }) => type)).toEqual(["BEGIN_RUN", "RUN_SUCCEEDED"]);
    expect(refresh).toHaveBeenCalledWith("7"); expect(active.current).toBe(false);
    state = actions.reduce(evaluateReducer, state);
    expect(state).toMatchObject({ phase: "completed", operatorToken: "", writeOutcome: { status: "SUCCEEDED" } });
  });

  it("marks success only for a validated discriminated SEALED terminal", async () => {
    const state = evaluateReducer(resolvedState(), { type: "EDIT_OPERATOR_TOKEN", token: "token" });
    const active = { current: false }; const actions: EvaluateAction[] = [];
    const existing = vi.fn().mockResolvedValue({ kind: "EXISTING_OPERATION", operation: {
      recoveryId: "rec_1234567890abcdef", phase: "RECOVERY_REQUIRED",
      writeOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: "rec_1234567890abcdef" } } });
    await executePaidRun(state, active, existing, (action) => actions.push(action), vi.fn(),
      () => ({ code: "RUN_FAILED", message: "failed", stage: "WRITING_CHAIN", retryable: false, requestId: "test" }));
    expect(actions.map((action) => action.type)).toEqual(["BEGIN_RUN", "RUN_FAILED"]);
  });
});
