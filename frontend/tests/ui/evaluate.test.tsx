import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GateDecisionCard } from "../../components/GateDecisionCard";
import { identityInputState } from "../../components/IdentityResolver";
import { ProofCoverageGrid } from "../../components/ProofCoverageGrid";
import { CompletionStatus, ResolveForm, ScanInput } from "../../components/ScanInput";
import { StreamingScanPanel } from "../../components/StreamingScanPanel";
import type { RunnerStage } from "../../lib/prooflock-types";
import { admittedConsumerState } from "../../lib/prooflock-status";

const STAGES: readonly RunnerStage[] = [
  "VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS",
  "RUNNING_COMPUTE", "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE",
  "VERIFYING_STORAGE", "WRITING_CHAIN", "READING_CHAIN_BACK", "SEALED",
];

describe("Evaluate ceremony", () => {
  it("uses a semantic resolve form with an explicit resolution-only cancel boundary", () => {
    const base = { agentId: "7", valid: true, invalid: false, locked: false, onEdit: () => {},
      onResolve: () => {}, onCancel: () => {} } as const;
    const idle = renderToStaticMarkup(React.createElement(ResolveForm, { ...base, phase: "idle" }));
    const resolving = renderToStaticMarkup(React.createElement(ResolveForm, { ...base, phase: "resolving" }));
    expect(idle.startsWith('<form class="evaluate-form"')).toBe(true);
    expect(idle).toContain('type="submit"');
    expect(resolving).toContain('type="button"');
    expect(resolving).toContain("Cancel resolution");
  });

  it("associates invalid and resolution-error identity input with its status", () => {
    const base = { agentId: "abc", valid: false, invalid: true, locked: false, phase: "idle" as const,
      onEdit: () => {}, onResolve: () => {}, onCancel: () => {} };
    const invalid = renderToStaticMarkup(React.createElement(ResolveForm, base));
    const resolutionError = renderToStaticMarkup(React.createElement(ResolveForm,
      { ...base, agentId: "7", phase: "resolve_error" }));
    const workbench = renderToStaticMarkup(React.createElement(ScanInput));
    for (const html of [invalid, resolutionError]) {
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="agent-id-status"');
    }
    expect(workbench).toContain('id="agent-id-status"');
  });

  it("renders paid completion without another paid action", () => {
    const html = renderToStaticMarkup(React.createElement(CompletionStatus,
      { refresh: "complete", refreshError: null }));
    expect(html).toContain("ProofLock write succeeded");
    expect(html).toContain("Current read-back refreshed");
    expect(html).not.toContain("Issue first ProofLock");
    expect(html).not.toContain("operator-token");
    expect(html).not.toContain("Run verified evaluation");
  });

  it("renders refresh failure as successful write plus a do-not-retry alert", () => {
    const html = renderToStaticMarkup(React.createElement(CompletionStatus,
      { refresh: "failed", refreshError: { code: "READ_FAILED", message: "unavailable",
        stage: "READING_CHAIN_BACK", retryable: true, requestId: "test" } }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("ProofLock write succeeded");
    expect(html).toContain("Current read-back is unavailable");
    expect(html).toContain("Do not retry");
    expect(html).not.toContain("Run verified evaluation");
  });

  it("fails closed unless guarded Gate fields match subject, version, and ALLOWED reason", () => {
    const subject = `0x${"22".repeat(20)}` as `0x${string}`;
    const record = { subject, version: "2" };
    const gate = { status: "VERIFIED", allowed: true, reason: 0, subject, version: "2" } as const;
    const consumer = { status: "VERIFIED", accepted: true, address: `0x${"44".repeat(20)}` as `0x${string}`, subject, version: "2" } as const;
    expect(admittedConsumerState(record, gate, consumer, subject)).toBe(true);
    expect(admittedConsumerState(record, { ...gate, reason: 1 }, consumer, subject)).toBe(false);
    expect(admittedConsumerState(record, gate, consumer, `0x${"33".repeat(20)}`)).toBe(false);
    expect(admittedConsumerState(record, { ...gate, version: "1" }, consumer, subject)).toBe(false);
    expect(admittedConsumerState(record, gate, { status: "UNKNOWN", accepted: false }, subject)).toBe(false);
  });
  it("distinguishes invalid, resolving, missing, mismatch and valid identity states", () => {
    expect(identityInputState("abc", "idle")).toBe("INVALID");
    expect(identityInputState("7", "resolving")).toBe("RESOLVING");
    expect(identityInputState("7", "error", "AGENT_NOT_FOUND")).toBe("MISSING");
    expect(identityInputState("7", "error", "IDENTITY_MISMATCH")).toBe("MISMATCH");
    expect(identityInputState("7", "resolved")).toBe("VALID");
  });

  it("renders all ten ProofLock stages and stops with no lease after failure", () => {
    const html = renderToStaticMarkup(React.createElement(StreamingScanPanel, {
      stages: ["VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT"],
      failed: { stage: "CLASSIFYING_SUBJECT", code: "IDENTITY_MISMATCH" },
    }));
    for (const stage of STAGES) expect(html).toContain(stage);
    expect(html).toContain("No lease issued");
    expect(html).toContain("IDENTITY_MISMATCH");
    expect(html).not.toContain("Policy-scoped admission active");
  });

  it("renders typed 0x7f coverage without calling missing checks verified", () => {
    const html = renderToStaticMarkup(React.createElement(ProofCoverageGrid, { coverage: 0x5f }));
    expect(html).toContain("0x5f / 0x7f");
    expect(html).toContain("Evidence Storage");
    expect(html).toContain("Missing");
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])(
    "renders stable Gate reason %i as text and code",
    (reason) => {
      const html = renderToStaticMarkup(React.createElement(GateDecisionCard, { decision: { allowed: reason === 0, reason,
        subject: `0x${"22".repeat(20)}` as `0x${string}`, version: "2" } }));
      expect(html).toContain(reason === 0 ? "ALLOWED" : "BLOCKED");
      expect(html).toContain(`Reason ${reason}`);
    },
  );
});
