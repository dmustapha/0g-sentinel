import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GateDecisionCard } from "../../components/GateDecisionCard";
import { identityInputState } from "../../components/IdentityResolver";
import { ProofCoverageGrid } from "../../components/ProofCoverageGrid";
import { StreamingScanPanel } from "../../components/StreamingScanPanel";
import type { RunnerStage } from "../../lib/prooflock-types";

const STAGES: readonly RunnerStage[] = [
  "VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS",
  "RUNNING_COMPUTE", "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE",
  "VERIFYING_STORAGE", "WRITING_CHAIN", "READING_CHAIN_BACK", "SEALED",
];

describe("Evaluate ceremony", () => {
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
