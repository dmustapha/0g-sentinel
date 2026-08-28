import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentsTable } from "../../components/AgentsTable";
import type { ProofLockInventoryItem } from "../../lib/prooflock-types";

describe("ProofLock inventory navigation", () => {
  it("keeps an unavailable stored identity reachable through its historical verifier", () => {
    process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS = `0x${"44".repeat(20)}`;
    const item = unavailableItem();
    const html = renderToStaticMarkup(React.createElement(AgentsTable, { items: [item] }));
    expect(html).toContain("Identity unavailable");
    expect(html).toContain(`/proof/`);
    expect(html).toContain(`identityKey=${item.identityKey}`);
  });
});

function unavailableItem(): ProofLockInventoryItem {
  const h = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
  return { identityKey: h("1"), transactionHash: h("2"), blockNumber: 8, proofLock: {
    identityKey: h("1"), subject: `0x${"33".repeat(20)}`, envelopeDigest: h("4"), storageRoot: h("5"),
    computeRoot: h("6"), artifactHash: h("7"), runtimeCodeHash: h("8"), version: "2", issuedAt: "1",
    validUntil: "9999999999", policyVersion: 1, behavioralScore: 10, codeRisk: 0, coverage: 127, state: 0, stateReason: 0,
  }, detail: { status: "UNAVAILABLE", code: "IDENTITY_INVALID", identity: null, resolution: null,
    gate: { status: "UNKNOWN", allowed: false, reason: null }, consumer: { status: "UNKNOWN", accepted: false } } };
}
