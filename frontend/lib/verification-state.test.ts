import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProofLockDetailResponse, VerifiedProof } from "./prooflock-types";
import { createVerificationCoordinator, initialVerificationState, verificationReducer } from "./verification-state";

const proof = { proofId: "0xproof" } as unknown as VerifiedProof;

describe("verificationReducer", () => {
  it.each(["MISMATCH", "TIMEOUT"] as const)("clears old payloads before a new %s result", (status) => {
    const matched = reduce(
      { type: "START", generation: 1, retry: false },
      { type: "HISTORICAL_MATCH", generation: 1, proof },
      { type: "CURRENT_START", generation: 1 },
      { type: "CURRENT_RESULT", generation: 1, access: "BLOCKED", reason: "DRIFTED" },
    );

    const started = verificationReducer(matched, { type: "START", generation: 2, retry: true });
    const failed = verificationReducer(started, { type: "HISTORICAL_FAILURE", generation: 2, status });

    expect(started).toEqual({ generation: 2, historical: { status: "RETRYING" }, current: { status: "IDLE" } });
    expect(failed).toEqual({ generation: 2, historical: { status }, current: { status: "IDLE" } });
  });

  it("keeps a historical match visible when the current plane is unavailable", () => {
    const state = reduce(
      { type: "START", generation: 1, retry: false },
      { type: "HISTORICAL_MATCH", generation: 1, proof },
      { type: "CURRENT_START", generation: 1 },
      { type: "CURRENT_FAILURE", generation: 1, status: "UNAVAILABLE" },
    );

    expect(state.historical).toEqual({ status: "MATCH", proof });
    expect(state.current).toEqual({ status: "UNAVAILABLE" });
  });

  it("never lets a current read upgrade a historical mismatch", () => {
    const state = reduce(
      { type: "START", generation: 1, retry: false },
      { type: "HISTORICAL_FAILURE", generation: 1, status: "MISMATCH" },
      { type: "CURRENT_START", generation: 1 },
      { type: "CURRENT_RESULT", generation: 1, access: "ADMITTED", reason: "ALLOWED" },
    );

    expect(state).toEqual({ generation: 1, historical: { status: "MISMATCH" }, current: { status: "IDLE" } });
  });

  it("commits only the latest retry generation", () => {
    const state = reduce(
      { type: "START", generation: 1, retry: false },
      { type: "START", generation: 2, retry: true },
      { type: "HISTORICAL_MATCH", generation: 1, proof },
      { type: "HISTORICAL_FAILURE", generation: 2, status: "UNAVAILABLE" },
    );

    expect(state).toEqual({ generation: 2, historical: { status: "UNAVAILABLE" }, current: { status: "IDLE" } });
  });

  it("maps historical user cancellation to CANCELED without starting current", () => {
    const state = reduce(
      { type: "START", generation: 1, retry: false },
      { type: "HISTORICAL_FAILURE", generation: 1, status: "CANCELED" },
    );

    expect(state).toEqual({ generation: 1, historical: { status: "CANCELED" }, current: { status: "IDLE" } });
  });

  it("preserves a completed historical match when the current read is canceled", () => {
    const state = reduce(
      { type: "START", generation: 1, retry: false },
      { type: "HISTORICAL_MATCH", generation: 1, proof },
      { type: "CURRENT_START", generation: 1 },
      { type: "CURRENT_FAILURE", generation: 1, status: "CANCELED" },
    );

    expect(state.historical).toEqual({ status: "MATCH", proof });
    expect(state.current).toEqual({ status: "CANCELED" });
  });

  it("rejects terminal actions outside their intended source phases", () => {
    const timedOut = reduce(
      { type: "START", generation: 1, retry: false },
      { type: "HISTORICAL_FAILURE", generation: 1, status: "TIMEOUT" },
    );
    const resurrected = verificationReducer(timedOut, { type: "HISTORICAL_MATCH", generation: 1, proof });
    const matched = reduce(
      { type: "START", generation: 1, retry: false },
      { type: "HISTORICAL_MATCH", generation: 1, proof },
      { type: "CURRENT_START", generation: 1 },
      { type: "CURRENT_RESULT", generation: 1, access: "ADMITTED", reason: "ALLOWED" },
    );
    const restarted = verificationReducer(matched, { type: "CURRENT_START", generation: 1 });

    expect(resurrected.historical).toEqual({ status: "TIMEOUT" });
    expect(restarted.current).toEqual({ status: "ADMITTED", reason: "ALLOWED" });
  });
});

describe("verification coordinator", () => {
  afterEach(() => vi.useRealTimers());

  it("maps a successful unavailable current response to UNAVAILABLE", async () => {
    const harness = coordinatorHarness({
      verifyHistorical: async () => proof,
      readCurrent: async () => unavailableDetail,
    });

    await harness.coordinator.start(false);

    expect(harness.state.historical).toEqual({ status: "MATCH", proof });
    expect(harness.state.current).toEqual({ status: "UNAVAILABLE" });
    expect(harness.mapCurrentAccess).not.toHaveBeenCalled();
  });

  it("settles current as UNAVAILABLE when access mapping throws", async () => {
    const harness = coordinatorHarness({
      mapCurrentAccess: () => { throw new Error("unexpected mapper failure"); },
    });

    await harness.coordinator.start(false);

    expect(harness.state.historical).toEqual({ status: "MATCH", proof });
    expect(harness.state.current).toEqual({ status: "UNAVAILABLE" });
  });

  it("starts the current timeout budget only after historical verification completes", async () => {
    vi.useFakeTimers();
    const historical = deferred<VerifiedProof>();
    const current = deferred<ProofLockDetailResponse>();
    const harness = coordinatorHarness({ verifyHistorical: () => historical.promise, readCurrent: () => current.promise });
    const attempt = harness.coordinator.start(false);

    await vi.advanceTimersByTimeAsync(90);
    historical.resolve(proof);
    await Promise.resolve();
    expect(harness.state.current.status).toBe("READING");
    await vi.advanceTimersByTimeAsync(90);
    expect(harness.state.current.status).toBe("READING");
    await vi.advanceTimersByTimeAsync(10);
    expect(harness.state.historical.status).toBe("MATCH");
    expect(harness.state.current.status).toBe("TIMEOUT");
    current.resolve(availableDetail);
    await attempt;
  });

  it("aborts and resets active work when the identifier tuple changes", async () => {
    const historical = deferred<VerifiedProof>();
    const harness = coordinatorHarness({ verifyHistorical: () => historical.promise });
    const attempt = harness.coordinator.start(false);
    const signal = harness.verifyHistorical.mock.calls[0]?.[1];

    harness.coordinator.setIdentifiers({ proofId: "proof-2", identityKey: "identity-2", sourceTxHash: "tx-2" });
    historical.resolve(proof);
    await attempt;

    expect(signal?.aborted).toBe(true);
    expect(harness.state.historical).toEqual({ status: "IDLE" });
    expect(harness.state.current).toEqual({ status: "IDLE" });
  });

  it("does not dispatch after disposal even when abandoned work settles", async () => {
    const historical = deferred<VerifiedProof>();
    const harness = coordinatorHarness({ verifyHistorical: () => historical.promise });
    const attempt = harness.coordinator.start(false);
    const dispatchedBeforeDispose = harness.actions.length;

    harness.coordinator.dispose();
    historical.resolve(proof);
    await attempt;

    expect(harness.actions).toHaveLength(dispatchedBeforeDispose);
    expect(harness.verifyHistorical.mock.calls[0]?.[1].aborted).toBe(true);
  });

  it("cancels current work without changing the completed historical match", async () => {
    const current = deferred<ProofLockDetailResponse>();
    const harness = coordinatorHarness({ readCurrent: () => current.promise });
    const attempt = harness.coordinator.start(false);
    await Promise.resolve();
    await Promise.resolve();

    harness.coordinator.cancelCurrent();

    expect(harness.state.historical).toEqual({ status: "MATCH", proof });
    expect(harness.state.current).toEqual({ status: "CANCELED" });
    current.resolve(availableDetail);
    await attempt;
  });

  it("does not dispatch when current work settles after disposal", async () => {
    const current = deferred<ProofLockDetailResponse>();
    const harness = coordinatorHarness({ readCurrent: () => current.promise });
    const attempt = harness.coordinator.start(false);
    await Promise.resolve();
    await Promise.resolve();
    const dispatchedBeforeDispose = harness.actions.length;

    harness.coordinator.dispose();
    current.resolve(availableDetail);
    await attempt;

    expect(harness.actions).toHaveLength(dispatchedBeforeDispose);
    expect(harness.readCurrent.mock.calls[0]?.[1].aborted).toBe(true);
  });

  it("preserves the first abort cause across user cancel and timeout", async () => {
    vi.useFakeTimers();
    const first = deferred<VerifiedProof>();
    const second = deferred<VerifiedProof>();
    const harness = coordinatorHarness({ verifyHistorical: vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise) });
    const timedOut = harness.coordinator.start(false);
    await vi.advanceTimersByTimeAsync(100);
    harness.coordinator.cancelHistorical();
    expect(harness.state.historical.status).toBe("TIMEOUT");
    first.resolve(proof);
    await timedOut;

    const canceled = harness.coordinator.start(true);
    harness.coordinator.cancelHistorical();
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.state.historical.status).toBe("CANCELED");
    second.resolve(proof);
    await canceled;
  });

  it("does not start current work after a historical mismatch", async () => {
    const harness = coordinatorHarness({
      verifyHistorical: async () => { throw new Error("mismatch"); },
      mapHistoricalError: () => "MISMATCH",
    });

    await harness.coordinator.start(false);

    expect(harness.state.historical.status).toBe("MISMATCH");
    expect(harness.readCurrent).not.toHaveBeenCalled();
  });
});

function reduce(...actions: Parameters<typeof verificationReducer>[1][]) {
  return actions.reduce(verificationReducer, initialVerificationState);
}

function coordinatorHarness(overrides: Partial<CoordinatorOverrides> = {}) {
  let state = initialVerificationState;
  const actions: Parameters<typeof verificationReducer>[1][] = [];
  const verifyHistorical = vi.fn(overrides.verifyHistorical ?? (async () => proof));
  const readCurrent = vi.fn(overrides.readCurrent ?? (async () => availableDetail));
  const mapCurrentAccess = vi.fn(overrides.mapCurrentAccess ??
    (() => ({ access: "ADMITTED" as const, reason: "ALLOWED" })));
  const coordinator = createVerificationCoordinator({
    timeoutMs: 100,
    verifyHistorical,
    readCurrent,
    mapHistoricalError: overrides.mapHistoricalError ?? (() => "UNAVAILABLE"),
    mapCurrentAccess,
    dispatch: (action) => {
      actions.push(action);
      state = verificationReducer(state, action);
    },
  });
  coordinator.setIdentifiers({ proofId: "proof-1", identityKey: "identity-1", sourceTxHash: "tx-1" });
  return {
    coordinator,
    actions,
    verifyHistorical,
    readCurrent,
    mapCurrentAccess,
    get state() { return state; },
  };
}

type CoordinatorOverrides = {
  verifyHistorical: (identifiers: { proofId: string; identityKey: string; sourceTxHash?: string }, signal: AbortSignal) => Promise<VerifiedProof>;
  readCurrent: (identityKey: string, signal: AbortSignal) => Promise<ProofLockDetailResponse>;
  mapHistoricalError: () => "MISMATCH" | "UNAVAILABLE";
  mapCurrentAccess: () => { access: "ADMITTED" | "BLOCKED"; reason: string };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const unavailableDetail = { detail: { status: "UNAVAILABLE" } } as unknown as ProofLockDetailResponse;
const availableDetail = { detail: { status: "VERIFIED" } } as unknown as ProofLockDetailResponse;
