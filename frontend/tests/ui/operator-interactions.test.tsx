// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  runProofLock: vi.fn(), recoverProofLock: vi.fn(), markOnDemandDrift: vi.fn(),
  resolveIdentity: vi.fn(), readProofLockDetail: vi.fn(),
}));

vi.mock("../../lib/prooflock-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/prooflock-client")>(),
  ...client,
}));

import { RescanButton, selectDetailView } from "../../components/RescanButton";
import { ScanInput } from "../../components/ScanInput";
import { WriteRecoveryPanel } from "../../components/WriteRecoveryPanel";
import { ProofLockApiError } from "../../lib/prooflock-client";
import type { CanonicalIdentity, OperatorRunProgress, ProofLockRecord } from "../../lib/prooflock-types";

const ADDRESS = `0x${"11".repeat(20)}` as const;
const KEY = `0x${"22".repeat(32)}` as const;
const TX = `0x${"33".repeat(32)}` as const;
const RECOVERY_ID = "rec_1234567890abcdef";
const identity: CanonicalIdentity = { identity: { namespace: "eip155", chainId: 16661,
  registryAddress: ADDRESS, agentId: "7" }, owner: ADDRESS, agentWallet: ADDRESS,
  agentURI: "ipfs://agent", registrationDigest: KEY, sourceBlockNumber: "1", sourceBlockHash: KEY, card: {} };
const record: ProofLockRecord = { identityKey: KEY, subject: ADDRESS, envelopeDigest: KEY, storageRoot: KEY,
  computeRoot: KEY, artifactHash: KEY, runtimeCodeHash: KEY, version: "1", issuedAt: "1", validUntil: "2",
  policyVersion: 1, behavioralScore: 1, codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0 };

beforeEach(() => { client.runProofLock.mockReset(); client.recoverProofLock.mockReset();
  client.markOnDemandDrift.mockReset(); client.resolveIdentity.mockReset(); client.readProofLockDetail.mockReset();
  localStorage.clear(); sessionStorage.clear(); });
afterEach(() => cleanup());

function renderRescan(onComplete = vi.fn()) {
  return { onComplete, ...render(<RescanButton identity={identity} record={record}
    previousProofId={KEY} onComplete={onComplete} />) };
}

function abortableRun() {
  let report: ((progress: OperatorRunProgress) => void) | undefined;
  let signal: AbortSignal | undefined;
  client.runProofLock.mockImplementation((...args: unknown[]) => {
    signal = args[3] as AbortSignal; report = args[5] as typeof report;
    return new Promise((_resolve, reject) => signal?.addEventListener("abort",
      () => reject(new DOMException("canceled", "AbortError")), { once: true }));
  });
  return { report: (progress: OperatorRunProgress) => act(() => report?.(progress)), signal: () => signal };
}

async function startReseal() {
  const user = userEvent.setup(); await user.type(screen.getByLabelText("One-time operator token"), "operator-secret");
  await user.click(screen.getByRole("button", { name: "Reseal new version" })); return user;
}

describe("operator component interactions", () => {
  it("does not turn the second click into a cancel or duplicate paid run", async () => {
    const run = abortableRun(); renderRescan(); const user = userEvent.setup();
    await user.type(screen.getByLabelText("One-time operator token"), "operator-secret");
    await user.dblClick(screen.getByRole("button", { name: "Reseal new version" }));
    expect(client.runProofLock).toHaveBeenCalledTimes(1);
    expect(run.signal()?.aborted).toBe(false);
  });

  it.each([
    ["admission-unobserved", [] as OperatorRunProgress[], "Connection interrupted; operation outcome is unestablished"],
    ["admitted", [{ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" }] as OperatorRunProgress[], "Operation was durably accepted"],
    ["submission", [{ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" }, { phase: "SUBMISSION_ATTEMPTED" }] as OperatorRunProgress[], "Submission was attempted"],
    ["hash", [{ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" }, { phase: "SUBMISSION_ATTEMPTED" },
      { phase: "HASH_KNOWN", transactionHash: TX }] as OperatorRunProgress[], "A transaction hash was observed"],
    ["finalized", [{ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" }, { phase: "SUBMISSION_ATTEMPTED" },
      { phase: "FINALIZED", transactionHash: TX, blockHash: KEY, blockNumber: "9", confirmations: 3 }] as OperatorRunProgress[],
      "Registry transaction finalized"],
    ["reverted", [{ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" }, { phase: "SUBMISSION_ATTEMPTED" },
      { phase: "REVERTED", transactionHash: TX }] as OperatorRunProgress[], "Registry transaction reverted"],
  ])("preserves the %s boundary when cancellation aborts the stream", async (_name, progress, copy) => {
    const run = abortableRun(); renderRescan(); const user = await startReseal();
    for (const item of progress) run.report(item);
    await user.click(screen.getByRole("button", { name: "Cancel reseal" }));
    expect(await screen.findByText(new RegExp(copy))).toBeTruthy();
    expect(run.signal()?.aborted).toBe(true);
  });

  it("does not demote a queued admission-frame race to a safe fresh retry", async () => {
    const run = abortableRun(); renderRescan(); const user = await startReseal();
    await user.click(screen.getByRole("button", { name: "Cancel reseal" }));
    run.report({ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" });
    expect(await screen.findByText(/Connection interrupted; operation outcome is unestablished/)).toBeTruthy();
    expect(screen.queryByText(/Canceled before the operation was accepted/)).toBeNull();
    expect(screen.getByRole("button", { name: "Resume/reconcile reseal" })).toBeTruthy();
    await user.type(screen.getByLabelText("One-time operator token"), "resume-token");
    await user.click(screen.getByRole("button", { name: "Resume/reconcile reseal" }));
    expect(client.runProofLock).toHaveBeenCalledTimes(2);
  });

  it("renders exact reseal failure detail without a write outcome", async () => {
    client.runProofLock.mockRejectedValue(new ProofLockApiError({ code: "STORAGE_ROOT_MISMATCH",
      message: "failed", stage: "VERIFYING_STORAGE", retryable: false, requestId: "test" }, 500));
    renderRescan(); await startReseal();
    expect(await screen.findByText(/Reseal failed at VERIFYING_STORAGE/)).toBeTruthy();
    expect(screen.getByText("STORAGE_ROOT_MISMATCH")).toBeTruthy();
    expect(screen.queryByText(/Connection interrupted|outcome is unestablished|Resume\/reconcile/)).toBeNull();
    expect(screen.getByRole("button", { name: "Reseal new version" })).toBeTruthy();
  });

  it("keeps a structured seal failure fresh-attempt-safe without uncertainty copy", async () => {
    client.resolveIdentity.mockResolvedValue(identity);
    client.readProofLockDetail.mockRejectedValue(new ProofLockApiError({ code: "NOT_FOUND", message: "missing",
      stage: "READING_PROOF", retryable: false, requestId: "test" }, 404));
    client.runProofLock.mockRejectedValue(new ProofLockApiError({ code: "STORAGE_ROOT_MISMATCH", message: "failed",
      stage: "VERIFYING_STORAGE", retryable: false, requestId: "test" }, 500));
    const user = userEvent.setup(); render(<ScanInput />);
    await user.type(screen.getByLabelText("ERC-8004 Agent ID"), "7");
    await user.click(screen.getByRole("button", { name: "Resolve identity" }));
    await user.type(await screen.findByLabelText("One-time operator token"), "token");
    await user.click(screen.getByRole("button", { name: "Run verified evaluation" }));
    expect((await screen.findAllByText("STORAGE_ROOT_MISMATCH")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Connection interrupted|outcome is unestablished|Resume\/reconcile/)).toBeNull();
    expect(screen.getByRole("button", { name: "Run verified evaluation" })).toBeTruthy();
  });

  it("treats a multi-tab existing SEALED operation as success", async () => {
    const onComplete = vi.fn(); client.runProofLock.mockResolvedValue({ kind: "EXISTING_OPERATION", operation: {
      recoveryId: RECOVERY_ID, phase: "TERMINAL", writeOutcome: { status: "SEALED", recoveryId: RECOVERY_ID,
        transactionHash: TX, identityKey: KEY, version: "2" } } });
    renderRescan(onComplete); await startReseal();
    expect(await screen.findByText("ProofLock v2 sealed.")).toBeTruthy();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each(["NOT_BROADCAST", "REVERTED"] as const)(
    "replaces stale uncertain error with definitive recovered %s copy", async (status) => {
      client.runProofLock.mockRejectedValue(new ProofLockApiError({ code: "STORAGE_ROOT_MISMATCH",
        message: "uncertain", stage: "VERIFYING_STORAGE", retryable: false, requestId: "test" }, 500,
      { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: RECOVERY_ID }));
      client.recoverProofLock.mockResolvedValue(status === "NOT_BROADCAST"
        ? { status, recoveryId: RECOVERY_ID }
        : { status, recoveryId: RECOVERY_ID, transactionHash: TX });
      renderRescan(); await startReseal();
      expect(await screen.findByText("STORAGE_ROOT_MISMATCH")).toBeTruthy();
      const user = userEvent.setup(); await user.type(screen.getByLabelText("One-time operator token"), "recover-token");
      await user.click(screen.getByRole("button", { name: "Recover write" }));
      expect(await screen.findByText(status === "NOT_BROADCAST" ? /No lease was issued/ : /Registry transaction reverted/)).toBeTruthy();
      expect(screen.queryByText("STORAGE_ROOT_MISMATCH")).toBeNull();
    },
  );

  it("removes the token-bearing field on navigation/unmount without browser persistence", async () => {
    const view = renderRescan(); const user = userEvent.setup();
    await user.type(screen.getByLabelText("One-time operator token"), "operator-secret");
    expect((screen.getByLabelText("One-time operator token") as HTMLInputElement).value).toBe("operator-secret");
    view.unmount();
    expect(view.container.textContent).not.toContain("operator-secret");
    expect(JSON.stringify({ ...localStorage })).not.toContain("operator-secret");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("operator-secret");
  });

  it("keeps keyboard focus on the same Recover button while recovery starts", async () => {
    const outcome = { status: "SUBMISSION_OUTCOME_UNKNOWN" as const, recoveryId: RECOVERY_ID };
    const view = render(<WriteRecoveryPanel outcome={outcome} mode="SEAL" recovering={false}
      explorerBase="https://chainscan.0g.ai" onRecover={() => {}} />);
    const recover = screen.getByRole("button", { name: "Recover write" }); recover.focus();
    expect(document.activeElement).toBe(recover);
    view.rerender(<WriteRecoveryPanel outcome={outcome} mode="SEAL" recovering
      explorerBase="https://chainscan.0g.ai" onRecover={() => {}} />);
    expect(screen.getByRole("button", { name: "Recover write" })).toBe(recover);
    expect(document.activeElement).toBe(recover);
  });

  it("cannot publish or refresh Agent A recovery after switching to Agent B", async () => {
    const recovered = deferred<Extract<import("../../lib/prooflock-types").ProofLockWriteOutcome, { status: "SEALED" }>>();
    client.resolveIdentity.mockImplementation((agentId: string) => Promise.resolve({ ...identity,
      identity: { ...identity.identity, agentId } }));
    client.readProofLockDetail.mockRejectedValue(new ProofLockApiError({ code: "NOT_FOUND", message: "missing",
      stage: "READING_PROOF", retryable: false, requestId: "test" }, 404));
    client.runProofLock.mockRejectedValue(new ProofLockApiError({ code: "SUBMISSION_OUTCOME_UNKNOWN",
      message: "uncertain", stage: "WRITING_CHAIN", retryable: false, requestId: "test" }, 500,
    { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: RECOVERY_ID }));
    client.recoverProofLock.mockReturnValue(recovered.promise);
    const user = userEvent.setup(); render(<ScanInput />);
    const agent = screen.getByLabelText("ERC-8004 Agent ID"); await user.type(agent, "7");
    await user.click(screen.getByRole("button", { name: "Resolve identity" }));
    await user.type(await screen.findByLabelText("One-time operator token"), "first-token");
    await user.click(screen.getByRole("button", { name: "Run verified evaluation" }));
    await user.type(await screen.findByLabelText("One-time operator token"), "recovery-token");
    await user.click(screen.getByRole("button", { name: "Recover write" }));
    await user.clear(agent); await user.type(agent, "8");
    expect(screen.queryByRole("button", { name: "Recover write" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Resolve identity" }));
    expect(await screen.findByText(/ERC-8004 Agent #8/)).toBeTruthy();
    await act(() => { recovered.resolve({ status: "SEALED", recoveryId: RECOVERY_ID,
      transactionHash: TX, identityKey: KEY, version: "9" }); return recovered.promise; });
    expect(screen.queryByText("ProofLock v9 sealed.")).toBeNull();
    expect(client.resolveIdentity.mock.calls.map(([agentId]) => agentId)).toEqual(["7", "8"]);
  });

  it("binds cancellation copy to its outcome without reducer fallback errors", async () => {
    let report: ((progress: OperatorRunProgress) => void) | undefined;
    client.resolveIdentity.mockResolvedValue(identity);
    client.readProofLockDetail.mockRejectedValue(new ProofLockApiError({ code: "NOT_FOUND", message: "missing",
      stage: "READING_PROOF", retryable: false, requestId: "test" }, 404));
    client.runProofLock.mockImplementation((...args: unknown[]) => { report = args[5] as typeof report;
      const signal = args[3] as AbortSignal; return new Promise((_resolve, reject) => signal.addEventListener("abort",
        () => reject(new DOMException("canceled", "AbortError")), { once: true })); });
    const user = userEvent.setup(); render(<ScanInput />);
    await user.type(screen.getByLabelText("ERC-8004 Agent ID"), "7");
    await user.click(screen.getByRole("button", { name: "Resolve identity" }));
    await user.type(await screen.findByLabelText("One-time operator token"), "token");
    await user.click(screen.getByRole("button", { name: "Run verified evaluation" }));
    act(() => report?.({ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" }));
    await user.click(screen.getByRole("button", { name: "Cancel seal" }));
    const outcome = await screen.findByText(/Operation was durably accepted/);
    expect(outcome.closest("[role=alert]")?.textContent).not.toMatch(/RUN_FAILED|REQUEST_ABORTED/);
    expect(screen.queryByText(/RUN_FAILED|REQUEST_ABORTED/)).toBeNull();
  });

  it("clears the prior bound error when recovery remains recoverable", async () => {
    client.resolveIdentity.mockResolvedValue(identity);
    client.readProofLockDetail.mockRejectedValue(new ProofLockApiError({ code: "NOT_FOUND", message: "missing",
      stage: "READING_PROOF", retryable: false, requestId: "test" }, 404));
    client.runProofLock.mockRejectedValue(new ProofLockApiError({ code: "OLD_FAILURE", message: "uncertain",
      stage: "VERIFYING_STORAGE", retryable: false, requestId: "test" }, 500,
    { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: RECOVERY_ID }));
    client.recoverProofLock.mockResolvedValue({ status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: RECOVERY_ID });
    const user = userEvent.setup(); render(<ScanInput />);
    await user.type(screen.getByLabelText("ERC-8004 Agent ID"), "7");
    await user.click(screen.getByRole("button", { name: "Resolve identity" }));
    await user.type(await screen.findByLabelText("One-time operator token"), "token");
    await user.click(screen.getByRole("button", { name: "Run verified evaluation" }));
    expect((await screen.findAllByText("OLD_FAILURE")).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText("One-time operator token"), "recover-token");
    await user.click(screen.getByRole("button", { name: "Recover write" }));
    expect(screen.queryAllByText("OLD_FAILURE")).toHaveLength(0);
  });

  it("cannot publish a detail-page recovery after route props switch identity", async () => {
    const recovered = deferred<Extract<import("../../lib/prooflock-types").ProofLockWriteOutcome, { status: "SEALED" }>>();
    client.runProofLock.mockRejectedValue(new ProofLockApiError({ code: "SUBMISSION_OUTCOME_UNKNOWN",
      message: "uncertain", stage: "WRITING_CHAIN", retryable: false, requestId: "test" }, 500,
    { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: RECOVERY_ID }));
    client.recoverProofLock.mockReturnValue(recovered.promise); const onComplete = vi.fn();
    const view = render(<RescanButton identity={identity} record={record} previousProofId={KEY} onComplete={onComplete} />);
    await startReseal(); const user = userEvent.setup();
    await user.type(screen.getByLabelText("One-time operator token"), "recover-token");
    await user.click(screen.getByRole("button", { name: "Recover write" }));
    const nextKey = `0x${"44".repeat(32)}` as const;
    view.rerender(<RescanButton identity={{ ...identity, identity: { ...identity.identity, agentId: "8" } }}
      record={{ ...record, identityKey: nextKey }} previousProofId={nextKey} onComplete={onComplete} />);
    expect(screen.queryByRole("button", { name: "Recover write" })).toBeNull();
    await act(() => { recovered.resolve({ status: "SEALED", recoveryId: RECOVERY_ID,
      transactionHash: TX, identityKey: KEY, version: "9" }); return recovered.promise; });
    expect(screen.queryByText("ProofLock v9 sealed.")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("clears idle secrets and detail state when version or prior proof changes", async () => {
    client.markOnDemandDrift.mockResolvedValue({ result: { expectedDigest: KEY, currentDigest: TX,
      drifted: true, marked: false } });
    const view = renderRescan(); const user = userEvent.setup();
    await user.type(screen.getByLabelText("One-time operator token"), "drift-token");
    await user.click(screen.getByRole("button", { name: "Run on-demand drift" }));
    await user.type(screen.getByLabelText("One-time operator token"), "idle-secret");
    const nextProof = `0x${"55".repeat(32)}` as const;
    view.rerender(<RescanButton identity={identity} record={{ ...record, version: "2" }}
      previousProofId={nextProof} onComplete={view.onComplete} />);
    expect((screen.getByLabelText("One-time operator token") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("DRIFT DETECTED")).toBeNull();
  });

  it("selects an empty detail view on the first render of a new composite route key", () => {
    expect(selectDetailView("new-key", "old-key", { token: "secret", busy: "reseal",
      stages: ["WRITING_CHAIN"], drift: { drifted: true }, driftError: "old", write: { stale: true } }))
      .toEqual({ token: "", busy: null, stages: [], drift: undefined, driftError: "", write: undefined });
  });

  it("aborts and erases an active detail run when route binding changes", async () => {
    const run = abortableRun(); const view = renderRescan(); await startReseal();
    run.report({ phase: "SUBMISSION_ATTEMPTED" });
    const nextProof = `0x${"66".repeat(32)}` as const;
    view.rerender(<RescanButton identity={identity} record={{ ...record, version: "2" }}
      previousProofId={nextProof} onComplete={view.onComplete} />);
    expect(run.signal()?.aborted).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel reseal" })).toBeNull();
    expect(screen.queryByText(/Submission was attempted/)).toBeNull();
    expect((screen.getByLabelText("One-time operator token") as HTMLInputElement).value).toBe("");
  });

  it("announces one terminal status after reseal success", async () => {
    client.runProofLock.mockImplementation(async (_input, _token, onStage) => {
      onStage("WRITING_CHAIN"); return { kind: "SEALED", stage: "SEALED", writeOutcome: {
        status: "SEALED", recoveryId: RECOVERY_ID, transactionHash: TX, identityKey: KEY, version: "2",
      } };
    });
    renderRescan(); await startReseal();
    expect(await screen.findByText("ProofLock v2 sealed.")).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
