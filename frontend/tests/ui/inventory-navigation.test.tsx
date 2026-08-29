import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentsTable } from "../../components/AgentsTable";
import type { ProofLockInventoryItem } from "../../lib/prooflock-types";
import { canonicalAgentHref, canonicalProofHref } from "../../lib/prooflock-routes";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("ProofLock inventory navigation", () => {
  it("builds V2-only canonical routes without letting a source hint change the proof ID", () => {
    const proofId = h("a");
    const identityKey = h("b");
    const sourceTxHash = h("c");
    expect(canonicalAgentHref("7", sourceTxHash)).toBe(`/agents/7?sourceTxHash=${sourceTxHash}`);
    expect(canonicalProofHref(proofId, identityKey)).toBe(`/proof/${proofId}?identityKey=${identityKey}`);
    expect(canonicalProofHref(proofId, identityKey, sourceTxHash)).toBe(
      `/proof/${proofId}?identityKey=${identityKey}&sourceTxHash=${sourceTxHash}`,
    );
    expect(canonicalProofHref(proofId, identityKey, h("d")).split("?")[0]).toBe(`/proof/${proofId}`);
    expect(() => canonicalAgentHref("07", sourceTxHash)).toThrow(/agent id/i);
    expect(() => canonicalProofHref(proofId, identityKey, h("0"))).toThrow(/source/i);
  });

  it("carries the exact Registry source transaction from inventory into agent detail", () => {
    const item = verifiedItem();
    const html = renderToStaticMarkup(React.createElement(AgentsTable, { items: [item] }));
    expect(html).toContain(`/agents/7?sourceTxHash=${item.transactionHash}`);
  });

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

  it("validates and binds an inventory source hint before agent-detail verification", async () => {
    const source = await readFile(resolve(process.cwd(), "app/agents/[address]/page.tsx"), "utf8");
    expect(source).toContain("useSearchParams");
    expect(source).toContain("parseSourceTxHashParam");
    expect(source).toContain("verifyLinkedHistoricalProof");
    expect(source).toMatch(/verifyLinkedHistoricalProof\([\s\S]+proofId[\s\S]+identityKey:[^\n]+key[\s\S]+sourceTxHash/);
    expect(source).toMatch(/<ProofLocatorNotice[^>]+linkedProof\.status[^>]+canonicalAgentHref/);
  });

  it("labels the proof-page query value as a hint until verification proves it", async () => {
    const source = await readFile(resolve(process.cwd(), "app/proof/[proofId]/page.tsx"), "utf8");
    expect(source).toContain("Registry source transaction hint");
    expect(source).not.toMatch(/<dt>Registry source transaction<\/dt>[\s\S]+sourceTxHash/);
  });

  it("uses the V2 route helper when the manual verifier opens a proof URL", async () => {
    const source = await readFile(resolve(process.cwd(), "app/proof/page.tsx"), "utf8");
    expect(source).toContain("canonicalProofHref");
    expect(source).not.toMatch(/router\.push\(`\/proof\/\$\{/);
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

function verifiedItem(): ProofLockInventoryItem {
  const item = unavailableItem();
  if (item.status !== "VERIFIED") throw new Error("fixture must be verified");
  return { ...item, detail: { status: "VERIFIED", identity: {
    identityKey: item.identityKey, namespace: "eip155", chainId: 16661,
    registryAddress: `0x${"88".repeat(20)}`, agentId: "7", owner: item.proofLock.subject,
    agentWallet: item.proofLock.subject, registrationUri: "ipfs://agent", registrationDigest: h("a"),
    sourceBlockNumber: "8", sourceBlockHash: h("b"),
  }, resolution: { owner: item.proofLock.subject, agentWallet: item.proofLock.subject,
    agentURI: "ipfs://agent", registrationDigest: h("a"), sourceBlockNumber: "8", sourceBlockHash: h("b") },
  gate: { status: "VERIFIED", allowed: true, reason: 0, subject: item.proofLock.subject, version: "2" },
  consumer: { status: "VERIFIED", accepted: true, address: `0x${"99".repeat(20)}`,
    subject: item.proofLock.subject, version: "2" } } };
}
