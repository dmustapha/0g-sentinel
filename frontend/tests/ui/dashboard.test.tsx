import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdmissionLeaseCard } from "../../components/AdmissionLeaseCard";
import { DemoFixtureBadge } from "../../components/DemoFixtureBadge";
import { EvidenceProofCard } from "../../components/EvidenceProofCard";
import { SealLifecycle } from "../../components/SealLifecycle";
import { canonicalAgentHref } from "../../lib/agents";
import type { ProofLockRecord } from "../../lib/prooflock-types";

const record: ProofLockRecord = {
  identityKey: `0x${"11".repeat(32)}`, subject: `0x${"22".repeat(20)}`,
  envelopeDigest: `0x${"33".repeat(32)}`, storageRoot: `0x${"44".repeat(32)}`,
  computeRoot: `0x${"55".repeat(32)}`, artifactHash: `0x${"66".repeat(32)}`,
  runtimeCodeHash: `0x${"77".repeat(32)}`, version: "2", issuedAt: "1000", validUntil: "704800",
  policyVersion: 3, behavioralScore: 12, codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0,
};

describe("ProofLock dashboard and detail", () => {
  it("uses decimal agent-ID routes only after verified identity enrichment", () => {
    expect(canonicalAgentHref("42")).toBe("/agents/42");
    expect(() => canonicalAgentHref(`0x${"11".repeat(32)}`)).toThrow();
  });

  it.each([
    [{}, "ACTIVE"], [{ validUntil: "10500" }, "EXPIRING"], [{ validUntil: "9999" }, "EXPIRED"],
    [{ state: 2 }, "REVOKED"], [{ state: 3 }, "DRIFTED"], [{ coverage: 0x3f }, "INCOMPLETE"],
  ])("renders the lease lifecycle state %s", (override, label) => {
    const html = renderToStaticMarkup(React.createElement(AdmissionLeaseCard, { record: { ...record, ...override }, nowSeconds: 10_000 }));
    expect(html).toContain(label);
    expect(html).toContain("Policy v3");
  });

  it("keeps superseded versions in append-preserved history", () => {
    const html = renderToStaticMarkup(React.createElement(SealLifecycle, { currentVersion: "3", previousProofId: `0x${"aa".repeat(32)}` }));
    expect(html).toContain("v3"); expect(html).toContain("SUPERSEDED"); expect(html).toContain("append-preserved");
  });

  it("shows verified Compute and honest Storage capability without fallback claims", () => {
    const html = renderToStaticMarkup(React.createElement(EvidenceProofCard, { record,
      compute: { provider: `0x${"99".repeat(20)}`, model: "llama-3", verified: true },
      storage: { uploadTxHash: `0x${"88".repeat(32)}`, retrievedAt: "2026-08-28T08:00:00Z", retrievalVerified: true, networkProofVerified: false } }));
    expect(html).toContain("Verified 0G Compute"); expect(html).toContain("llama-3");
    expect(html).toContain("networkProofVerified: false"); expect(html).toContain("root-matched at time");
    expect(html).not.toContain("permanently retrievable");
  });

  it("labels a demo fixture as synthetic and excluded from production proof", () => {
    const html = renderToStaticMarkup(React.createElement(DemoFixtureBadge));
    expect(html).toContain("DEMO FIXTURE"); expect(html).toContain("not production evidence");
  });
});
