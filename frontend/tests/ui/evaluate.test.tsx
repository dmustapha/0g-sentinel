import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import OverviewPage from "../../app/page";
import { GateDecisionCard } from "../../components/GateDecisionCard";
import { FeaturedProofLink } from "../../components/FeaturedProofLink";
import { identityInputState } from "../../components/IdentityResolver";
import { OperatorWorkbench } from "../../components/OperatorWorkbench";
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
const FEATURED_ENV = [
  "PROOFLOCK_FEATURED_PROOF_ID", "PROOFLOCK_FEATURED_IDENTITY_KEY", "PROOFLOCK_FEATURED_SOURCE_TX_HASH",
  "PROOFLOCK_FEATURED_AGENT_ID", "PROOFLOCK_FEATURED_VERIFIED_AT",
] as const;

describe("Evaluate ceremony", () => {
  it("keeps public entry secret-free and falls back to recent ProofLocks", () => {
    const link = renderToStaticMarkup(React.createElement(FeaturedProofLink, { config: {} }));
    const html = withoutFeaturedEnvironment(() => renderToStaticMarkup(React.createElement(OverviewPage)));
    expect(link).toContain('href="/agents"');
    expect(link).toContain("Browse recent ProofLocks");
    expect(html).toContain('href="/agents"');
    expect(html).toContain("Browse recent ProofLocks");
    expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(html).not.toMatch(/operator token|verified evaluation|reseal|recover write|seal ProofLock/i);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("/operator?");
  });

  it("links a complete valid featured-proof locator without exposing configuration", () => {
    const proofId = `0x${"11".repeat(32)}`;
    const identityKey = `0x${"22".repeat(32)}`;
    const sourceTxHash = `0x${"33".repeat(32)}`;
    const html = renderToStaticMarkup(React.createElement(FeaturedProofLink, { config: {
      proofId, identityKey, sourceTxHash, agentId: "1842", verifiedAt: "2026-08-29T15:00:00.000Z",
    } }));
    expect(html).toContain("Open featured real ProofLock");
    expect(html).toContain(`/proof/${proofId}?identityKey=${identityKey}&amp;sourceTxHash=${sourceTxHash}`);
    expect(html).toContain("Canonical Agent #1842");
    expect(html).toContain('<time dateTime="2026-08-29T15:00:00.000Z"');
  });

  it.each([
    { proofId: `0x${"11".repeat(32)}` },
    { identityKey: `0x${"22".repeat(32)}` },
    { sourceTxHash: `0x${"33".repeat(32)}` },
    { proofId: `0x${"11".repeat(32)}`, identityKey: `0x${"22".repeat(32)}` },
    { proofId: `0x${"11".repeat(32)}`, sourceTxHash: `0x${"33".repeat(32)}` },
    { identityKey: `0x${"22".repeat(32)}`, sourceTxHash: `0x${"33".repeat(32)}` },
    { proofId: `0x${"11".repeat(32)}`, identityKey: `0x${"22".repeat(32)}`, sourceTxHash: "not-a-hash" },
    { proofId: `0x${"00".repeat(32)}`, identityKey: `0x${"22".repeat(32)}`, sourceTxHash: `0x${"33".repeat(32)}` },
    { proofId: `0x${"11".repeat(32)}`, identityKey: `0x${"22".repeat(32)}`,
      sourceTxHash: `0x${"33".repeat(32)}`, agentId: "1842" },
    { proofId: `0x${"11".repeat(32)}`, identityKey: `0x${"22".repeat(32)}`,
      sourceTxHash: `0x${"33".repeat(32)}`, agentId: "01842", verifiedAt: "2026-08-29T15:00:00.000Z" },
    { proofId: `0x${"11".repeat(32)}`, identityKey: `0x${"22".repeat(32)}`,
      sourceTxHash: `0x${"33".repeat(32)}`, agentId: "1842", verifiedAt: "2026-08-29" },
  ])("never promotes an incomplete or invalid featured tuple", (config) => {
    const html = renderToStaticMarkup(React.createElement(FeaturedProofLink, { config }));
    expect(html).toContain("Browse recent ProofLocks");
    expect(html).not.toContain("featured real proof");
  });

  it("places operator authority and paid-work disclosure before every credential control", () => {
    const html = renderToStaticMarkup(React.createElement(OperatorWorkbench));
    const authority = html.indexOf("Named operator authority");
    const cost = html.indexOf("Paid 0G Compute and Storage work");
    const agentId = html.indexOf("ERC-8004 Agent ID");
    expect(authority).toBeGreaterThan(-1);
    expect(cost).toBeGreaterThan(authority);
    expect(agentId).toBeGreaterThan(cost);
    expect(html).not.toContain("operator-token");
  });

  it("labels the architecture strip as process rather than live progress or health", () => {
    const surfaces = [React.createElement(OverviewPage), React.createElement(OperatorWorkbench)];
    for (const surface of surfaces) {
      const html = renderToStaticMarkup(surface);
      expect(html).toContain("Architecture / process");
      expect(html).toContain("Identity");
      expect(html).toContain("Checks");
      expect(html).toContain("Compute");
      expect(html).toContain("Storage");
      expect(html).toContain("Lease");
      expect(html).toContain("Gate");
      expect(html).toContain("Not live progress or service health");
      expect(html).not.toMatch(/class="[^"]*(?:running|complete)[^"]*"/);
    }
  });

  it("keeps both public actions before dependency disclosure and architecture", () => {
    const html = withoutFeaturedEnvironment(() => renderToStaticMarkup(React.createElement(OverviewPage)));
    const primary = html.indexOf("Browse recent ProofLocks");
    const secondary = html.indexOf("Verify another proof");
    const dependencies = html.indexOf("seals the full evidence on 0G Storage");
    const architecture = html.indexOf("Architecture / process");
    expect(primary).toBeGreaterThan(-1);
    expect(primary).toBeLessThan(secondary);
    expect(secondary).toBeLessThan(dependencies);
    expect(dependencies).toBeLessThan(architecture);
  });

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
    expect(html).not.toContain('role="status"');
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

  it("renders all ten ProofLock stages without guessing write certainty after failure", () => {
    const html = renderToStaticMarkup(React.createElement(StreamingScanPanel, {
      stages: ["VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT"],
      failed: { stage: "CLASSIFYING_SUBJECT", code: "IDENTITY_MISMATCH" },
    }));
    for (const stage of STAGES) expect(html).toContain(stage);
    expect(html).toContain("Ceremony stopped");
    expect(html).toContain("IDENTITY_MISMATCH");
    expect(html).not.toContain("No lease issued");
    expect(html).not.toContain("Policy-scoped admission active");
    expect(html).not.toContain('role="alert"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("keeps the visual stage rail silent and announces only the current stage once", () => {
    const html = renderToStaticMarkup(React.createElement(StreamingScanPanel, {
      stages: ["VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS"],
    }));
    expect(html).toContain('class="proof-ceremony-rail" aria-hidden="true"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain("Current stage: Run typed deterministic checks");
    expect(html).not.toContain('aria-live="polite"');
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

function withoutFeaturedEnvironment<T>(run: () => T): T {
  const previous = Object.fromEntries(FEATURED_ENV.map((name) => [name, process.env[name]]));
  for (const name of FEATURED_ENV) delete process.env[name];
  try { return run(); }
  finally {
    for (const name of FEATURED_ENV) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
