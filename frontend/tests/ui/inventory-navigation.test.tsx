import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentsTable } from "../../components/AgentsTable";
import type { ProofLockInventoryItem } from "../../lib/prooflock-types";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("ProofLock inventory navigation", () => {
  it("keeps an unavailable stored identity reachable through its historical verifier", () => {
    process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS = `0x${"44".repeat(20)}`;
    const item = unavailableItem();
    const html = renderToStaticMarkup(React.createElement(AgentsTable, { items: [item] }));
    expect(html).toContain("Identity unavailable");
    expect(html).toContain(`/proof/`);
    expect(html).toContain(`identityKey=${item.identityKey}`);
    expect(html).toContain(`sourceTxHash=${item.transactionHash}`);
  });

  it("renders failed enrichment as unavailable and never admitted", () => {
    const item: ProofLockInventoryItem = { status: "ENRICHMENT_UNAVAILABLE", identityKey: h("9"),
      transactionHash: h("8"), blockNumber: 44, code: "DEPENDENCY_UNAVAILABLE" };
    const html = renderToStaticMarkup(React.createElement(AgentsTable, { items: [item] }));
    expect(html).toContain("Enrichment unavailable");
    expect(html).toContain("DEPENDENCY_UNAVAILABLE");
    expect(html).not.toContain("ADMITTED");
  });

  it("discloses recent-only finalized scope and exact range metadata", async () => {
    const source = await readFile(resolve(process.cwd(), "app/agents/page.tsx"), "utf8");
    expect(source).toContain("Recent ProofLocks");
    expect(source).toContain("complete inventory unavailable; recent finalized activity only");
    for (const field of ["fromBlock", "toBlock", "confirmations", "observedAt", "cap"]) expect(source).toContain(field);
    expect(source).toMatch(/const nowSeconds[\s\S]+sort\([^\n]+nowSeconds/);
  });
});

const h = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;

function unavailableItem(): ProofLockInventoryItem {
  return { status: "VERIFIED", identityKey: h("1"), proofId: h("f"), transactionHash: h("2"), blockNumber: 8, proofLock: {
    identityKey: h("1"), subject: `0x${"33".repeat(20)}`, envelopeDigest: h("4"), storageRoot: h("5"),
    computeRoot: h("6"), artifactHash: h("7"), runtimeCodeHash: h("8"), version: "2", issuedAt: "1",
    validUntil: "9999999999", policyVersion: 1, behavioralScore: 10, codeRisk: 0, coverage: 127, state: 0, stateReason: 0,
  }, detail: { status: "UNAVAILABLE", code: "IDENTITY_INVALID", identity: null, resolution: null,
    gate: { status: "UNKNOWN", allowed: false, reason: null }, consumer: { status: "UNKNOWN", accepted: false } } };
}
