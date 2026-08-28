import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubsystemHealthGrid } from "../../components/SubsystemHealthGrid";
import { VerificationResult } from "../../components/VerifyEvidenceButton";
import type { HealthSnapshot, ProofVerificationState } from "../../lib/prooflock-types";

describe("public proof verification", () => {
  it.each([
    ["MATCH", "Historical artifact matches"], ["MISMATCH", "Historical artifact mismatch"],
    ["UNAVAILABLE", "Evidence unavailable"], ["TIMEOUT", "Verification timed out"], ["RETRYING", "Retrying verification"],
  ] satisfies readonly (readonly [ProofVerificationState, string])[])("renders %s explicitly", (state, label) => {
    const html = renderToStaticMarkup(React.createElement(VerificationResult, { state })); expect(html).toContain(label);
  });
  it("separates historical artifact match from current blocked lease", () => {
    const html = renderToStaticMarkup(React.createElement(VerificationResult, { state: "MATCH", current: "BLOCKED", reasonCode: "DRIFTED" }));
    expect(html).toContain("Historical artifact matches"); expect(html).toContain("Current access: BLOCKED"); expect(html).toContain("DRIFTED");
    expect(html).not.toContain("Current access: ADMITTED");
  });
});

describe("independent subsystem health", () => {
  it("renders all six probes with independent states, latency, and observation time", () => {
    const probe = (status: "HEALTHY" | "UNHEALTHY" | "UNKNOWN", latencyMs: number) => ({ status, latencyMs, observedAt: "2026-08-28T08:00:00.000Z" });
    const snapshot: HealthSnapshot = { status: "DEGRADED", dependencies: { rpc: probe("HEALTHY", 10), identity: probe("UNHEALTHY", 20),
      registry: probe("HEALTHY", 30), gate: probe("UNKNOWN", 40), compute: { ...probe("HEALTHY", 50), detail: { observation: "SERVICE_DISCOVERY", inferenceExecuted: false } }, storage: probe("UNHEALTHY", 60) } };
    const html = renderToStaticMarkup(React.createElement(SubsystemHealthGrid, { snapshot }));
    for (const label of ["RPC", "ERC-8004", "RegistryV2", "AgentGateV2", "0G Compute", "0G Storage"]) expect(html).toContain(label);
    expect(html).toContain("60 ms"); expect(html).toContain("2026-08-28T08:00:00.000Z");
    expect(html).toContain("Service discovery only"); expect(html).toContain("inferenceExecuted: false");
  });
});
