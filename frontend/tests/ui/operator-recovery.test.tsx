import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  WriteRecoveryPanel, createOperatorRunSession,
} from "../../components/WriteRecoveryPanel";
import { RescanActions } from "../../components/RescanButton";
import type { ApiErrorShape, ProofLockWriteOutcome } from "../../lib/prooflock-types";

const TX = `0x${"12".repeat(32)}` as const;
const KEY = `0x${"34".repeat(32)}` as const;
const RECOVERY_ID = "rec_1234567890abcdef";
const ERROR: ApiErrorShape = { code: "CHAIN_WRITE_FAILED", message: "failed", stage: "WRITING_CHAIN",
  retryable: false, requestId: "request-1" };

function render(outcome: ProofLockWriteOutcome, options: Readonly<{ recovering?: boolean; mode?: "SEAL" | "RESEAL";
  error?: ApiErrorShape }> = {}) {
  return renderToStaticMarkup(React.createElement(WriteRecoveryPanel, {
    outcome, recovering: options.recovering ?? false, mode: options.mode ?? "SEAL", error: options.error,
    explorerBase: "https://chainscan.0g.ai", onRecover: () => {},
  }));
}

describe("operator write outcomes", () => {
  it("renders cancellation before operation acceptance as definitive", () => {
    const html = renderToStaticMarkup(React.createElement(WriteRecoveryPanel, {
      outcome: { status: "CANCELED_BEFORE_ACCEPTANCE" }, recovering: false, mode: "SEAL",
      explorerBase: "https://chainscan.0g.ai", onRecover: () => {},
    }));
    expect(html).toContain("Canceled before the operation was accepted");
    expect(html).toContain("request was not invoked");
    expect(html).not.toContain("No lease was issued");
    expect(html).not.toContain("Recover write");
  });

  it("says no lease was issued only for a definitive pre-broadcast outcome", () => {
    const html = render({ status: "NOT_BROADCAST", recoveryId: RECOVERY_ID }, { error: ERROR });
    expect(html).toContain('role="alert"');
    expect(html).toContain("No lease was issued");
    expect(html).toContain("WRITING_CHAIN");
    expect(html).toContain("CHAIN_WRITE_FAILED");
    expect(html).not.toContain("submission was attempted");
  });

  it("forbids retry when submission was attempted but broadcast is not proven", () => {
    const html = render({ status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: RECOVERY_ID });
    expect(html).toContain("Submission was attempted, but broadcast is not yet proven");
    expect(html).toContain("Recover before retrying");
    expect(html).toContain("Recover write");
    expect(html).not.toMatch(/>Retry</);
    expect(html).not.toContain("No lease was issued");
  });

  it("requires recovery after a disconnected accepted operation without claiming submission", () => {
    const html = renderToStaticMarkup(React.createElement(WriteRecoveryPanel, {
      outcome: { status: "RECOVERY_REQUIRED", certainty: "ACCEPTED", recoveryId: RECOVERY_ID }, recovering: false,
      mode: "SEAL", explorerBase: "https://chainscan.0g.ai", onRecover: () => {},
    }));
    expect(html).toContain("Operation was durably accepted");
    expect(html).toContain("Recover before retrying");
    expect(html).not.toContain("Submission was attempted");
    expect(html).not.toContain("No lease was issued");
  });

  it("shows the exact finalized transaction and keeps Recover mounted while pending", () => {
    const outcome = { status: "FINALIZED_READBACK_UNAVAILABLE", recoveryId: RECOVERY_ID,
      transactionHash: TX, identityKey: KEY, version: "7" } as const;
    const idle = render(outcome); const pending = render(outcome, { recovering: true });
    for (const html of [idle, pending]) {
      expect(html).toContain(`href="https://chainscan.0g.ai/tx/${TX}"`);
      expect(html).toContain(TX);
      expect(html).toContain("Recover write");
      expect(html).not.toContain("No lease was issued");
    }
    expect(pending).toContain('disabled=""');
    expect(pending).toContain("Recovering…");
  });

  it.each([
    "http://chainscan.0g.ai", "javascript:alert(1)", "https://evil.example",
    "https://chainscan.0g.ai.evil.example",
  ])("renders inert transaction text for unsafe explorer base %s", (explorerBase) => {
    const html = renderToStaticMarkup(React.createElement(WriteRecoveryPanel, {
      outcome: { status: "FINALIZED_READBACK_UNAVAILABLE", recoveryId: RECOVERY_ID,
        transactionHash: TX, identityKey: KEY, version: "7" }, recovering: false, mode: "SEAL",
      explorerBase, onRecover: () => {},
    }));
    expect(html).toContain(TX);
    expect(html).not.toContain('href="');
  });

  it("announces an exact recovery failure without removing the Recover control", () => {
    const html = renderToStaticMarkup(React.createElement(WriteRecoveryPanel, {
      outcome: { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: RECOVERY_ID }, recovering: false,
      mode: "SEAL", explorerBase: "https://chainscan.0g.ai", onRecover: () => {},
      error: { ...ERROR, stage: "RECOVERING_WRITE", code: "DEPENDENCY_UNAVAILABLE" },
    }));
    expect(html).toContain("Recovery failed at RECOVERING_WRITE");
    expect(html).toContain("DEPENDENCY_UNAVAILABLE");
    expect(html).toContain("Recover write");
  });

  it("shows the sealed version and a proof-record link", () => {
    const html = render({ status: "SEALED", recoveryId: RECOVERY_ID,
      transactionHash: TX, identityKey: KEY, version: "7" });
    expect(html).toContain('role="status"');
    expect(html).toContain("ProofLock v7 sealed");
    expect(html).toContain(`href="/agents/${KEY}"`);
    expect(html).toContain("Open proof record");
    expect(html).not.toContain("Recover write");
  });

  it("preserves the exact reseal failure stage and code", () => {
    const html = render({ status: "NOT_BROADCAST", recoveryId: RECOVERY_ID }, {
      mode: "RESEAL", error: { ...ERROR, stage: "VERIFYING_STORAGE", code: "STORAGE_ROOT_MISMATCH" },
    });
    expect(html).toContain("Reseal failed at VERIFYING_STORAGE");
    expect(html).toContain("STORAGE_ROOT_MISMATCH");
  });

  it.each([
    { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: RECOVERY_ID },
    { status: "FINALIZED_READBACK_UNAVAILABLE", recoveryId: RECOVERY_ID,
      transactionHash: TX, identityKey: KEY, version: "7" },
    { status: "REVERTED", recoveryId: RECOVERY_ID, transactionHash: TX },
  ] as const)("preserves exact sanitized reseal failure for $status", (outcome) => {
    const html = render(outcome, { mode: "RESEAL", error: { ...ERROR,
      stage: "VERIFYING_STORAGE", code: "STORAGE_ROOT_MISMATCH" } });
    expect(html).toContain("Reseal failed at VERIFYING_STORAGE");
    expect(html).toContain("STORAGE_ROOT_MISMATCH");
  });
});

describe("operator run session", () => {
  it("rejects double-click starts and releases the guard only after settlement", () => {
    const session = createOperatorRunSession();
    expect(session.begin()).not.toBeNull();
    expect(session.begin()).toBeNull();
    session.settle();
    expect(session.begin()).not.toBeNull();
  });

  it("does not let an old request settle a newer session generation", () => {
    const session = createOperatorRunSession(); const first = session.begin()!;
    session.invalidate(); const second = session.begin()!; session.settle(first);
    expect(session.begin()).toBeNull();
    session.settle(second); expect(session.begin()).not.toBeNull();
  });

  it("makes only pre-admission cancellation definitive", () => {
    const before = createOperatorRunSession(); const request = before.begin();
    expect(before.cancel()).toEqual({ kind: "CANCELED_BEFORE_ACCEPTANCE" });
    expect(request?.signal.aborted).toBe(true);

    const admitted = createOperatorRunSession(); admitted.begin();
    admitted.observe({ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" });
    expect(admitted.cancel()).toEqual({ kind: "RECOVERY_REQUIRED", certainty: "ACCEPTED",
      recoveryId: RECOVERY_ID });
  });

  it("never infers pre-admission certainty once the network request was invoked", () => {
    const session = createOperatorRunSession(); session.begin(); session.markInvoked();
    expect(session.cancel()).toEqual({ kind: "CONNECTION_INTERRUPTED" });
  });

  it.each([
    ["SUBMISSION_ATTEMPTED", [{ phase: "SUBMISSION_ATTEMPTED" }], undefined],
    ["HASH_KNOWN", [{ phase: "SUBMISSION_ATTEMPTED" }, { phase: "HASH_KNOWN", transactionHash: TX }], TX],
    ["FINALIZED", [{ phase: "SUBMISSION_ATTEMPTED" }, { phase: "HASH_KNOWN", transactionHash: TX },
      { phase: "FINALIZED", transactionHash: TX, blockHash: KEY, blockNumber: "9", confirmations: 3 }], TX],
  ] as const)("preserves %s certainty when canceling an admitted operation", (certainty, progress, transactionHash) => {
    const session = createOperatorRunSession(); session.begin();
    session.observe({ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" });
    for (const item of progress) session.observe(item);
    expect(session.cancel()).toEqual({ kind: "RECOVERY_REQUIRED", certainty, recoveryId: RECOVERY_ID,
      ...(transactionHash ? { transactionHash } : {}) });
  });

  it("preserves a proven reverted terminal instead of demoting it to unknown", () => {
    const session = createOperatorRunSession(); session.begin();
    session.observe({ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" });
    session.observe({ phase: "SUBMISSION_ATTEMPTED" });
    session.observe({ phase: "REVERTED", transactionHash: TX });
    expect(session.cancel()).toEqual({ kind: "REVERTED", recoveryId: RECOVERY_ID, transactionHash: TX });
  });

  it("turns a disconnect after admission into recovery instead of a retry", () => {
    const session = createOperatorRunSession(); session.begin();
    session.observe({ type: "admission", state: "ACCEPTED", recoveryId: RECOVERY_ID,
      idempotencyKey: "client-stable-key" });
    expect(session.interrupted()).toEqual({ kind: "RECOVERY_REQUIRED", certainty: "ACCEPTED", recoveryId: RECOVERY_ID });
  });

  it("aborts and clears secrets on dispose without serializing them", () => {
    const clearSecret = vi.fn(); const session = createOperatorRunSession(clearSecret);
    const request = session.begin(); session.dispose(); session.dispose();
    expect(request?.signal.aborted).toBe(true);
    expect(clearSecret).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(session.snapshot())).not.toContain("operator-secret");
  });

  it("reactivates after the development Strict Mode cleanup cycle", () => {
    const session = createOperatorRunSession(); session.dispose();
    expect(session.begin()).toBeNull();
    session.activate();
    expect(session.begin()).not.toBeNull();
  });
});

describe("reseal controls", () => {
  it("keeps visible cancellation at the paid side-effect boundary", () => {
    const html = renderToStaticMarkup(React.createElement(RescanActions, { token: "",
      busy: "reseal", canceling: false, recovering: false, recoveryRequired: false,
      onDrift: () => {}, onReseal: () => {}, onCancel: () => {} }));
    expect(html).toContain("Cancel reseal");
    expect(html).not.toContain("Reseal new version");
  });

  it("leaves recovery to the single stable outcome control", () => {
    const html = renderToStaticMarkup(React.createElement(RescanActions, { token: "new-token",
      busy: null, canceling: false, recovering: false, recoveryRequired: true,
      onDrift: () => {}, onReseal: () => {}, onCancel: () => {} }));
    expect(html).not.toContain("Recover write");
    expect(html).not.toContain("Reseal new version");
  });
});
