// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsTable } from "../../components/AgentsTable";
import type { ProofLockInventoryItem } from "../../lib/prooflock-types";
import { canonicalAgentHref, canonicalProofHref } from "../../lib/prooflock-routes";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const client = vi.hoisted(() => ({ discoverProofLocks: vi.fn() }));
vi.mock("../../lib/prooflock-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/prooflock-client")>(), ...client,
}));
import ProofLocksPage from "../../app/agents/page";

afterEach(() => { cleanup(); client.discoverProofLocks.mockReset(); });

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
    const html = renderToStaticMarkup(React.createElement(AgentsTable, { items: [item], referenceTimeSeconds: 100 }));
    expect(html).toContain(`/agents/7?sourceTxHash=${item.transactionHash}`);
  });

  it("keeps an unavailable stored identity reachable through its historical verifier", () => {
    process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS = `0x${"44".repeat(20)}`;
    const item = unavailableItem();
    const html = renderToStaticMarkup(React.createElement(AgentsTable, { items: [item], referenceTimeSeconds: 100 }));
    expect(html).toContain("Identity unavailable");
    expect(html).toContain(`/proof/`);
    expect(html).toContain(`identityKey=${item.identityKey}`);
    expect(html).toContain(`sourceTxHash=${item.transactionHash}`);
    expect(html.split(item.identityKey).length - 1).toBeGreaterThanOrEqual(2);
    expect(html.split('aria-label="Copy Identity key"').length - 1).toBe(2);
  });

  it("renders failed enrichment as unavailable and never admitted", () => {
    const item: ProofLockInventoryItem = { status: "ENRICHMENT_UNAVAILABLE", identityKey: h("9"),
      transactionHash: h("8"), blockNumber: 44, code: "DEPENDENCY_UNAVAILABLE" };
    const html = renderToStaticMarkup(React.createElement(AgentsTable, { items: [item], referenceTimeSeconds: 100 }));
    expect(html).toContain("Enrichment unavailable");
    expect(html).toContain("DEPENDENCY_UNAVAILABLE");
    expect(html).not.toContain("ADMITTED");
  });

  it("keeps every datum and action available in desktop and mobile semantics", () => {
    const item = verifiedItem();
    const html = renderToStaticMarkup(<AgentsTable items={[item]} referenceTimeSeconds={100} />);
    expect(html).toContain("Recent finalized RegistryV2 activity — bounded scope shown above.");
    for (const heading of ["Identity", "Coverage", "Seal / Registry source", "Lease", "Gate", "Checked", "Action"])
      expect(html).toContain(`scope="col">${heading}`);
    for (const label of ["Identity", "Coverage", "Seal", "Lease", "Gate", "Registry source transaction", "Last checked", "Action"])
      expect(html).toMatch(new RegExp(`<dt[^>]*>${label}</dt>`));
    for (const value of ["Agent #", "0x7f / 0x7f", "v2", "ALLOWED", `block ${item.blockNumber}`]) {
      expect(html.split(value).length - 1).toBeGreaterThanOrEqual(2);
    }
    expect(html.split(`/agents/7?sourceTxHash=${item.transactionHash}`).length - 1).toBe(2);
    expect(html.split("Open proof record").length - 1).toBe(2);
  });

  it("links failed rows to their exact Registry transaction on both surfaces", () => {
    const item: ProofLockInventoryItem = { status: "ENRICHMENT_UNAVAILABLE", identityKey: h("9"),
      transactionHash: h("8"), blockNumber: 44, code: "DEPENDENCY_UNAVAILABLE" };
    const html = renderToStaticMarkup(<AgentsTable items={[item]} referenceTimeSeconds={100} />);
    const href = `https://chainscan.0g.ai/tx/${item.transactionHash}`;
    expect(html.split(href).length - 1).toBe(2);
  });

  it("renders truthful partial results and deterministic ordering disclosure", async () => {
    client.discoverProofLocks.mockResolvedValue(discovery([verifiedItem(), enrichmentItem()]));
    render(<ProofLocksPage />);
    expect(await screen.findByText("Partial results")).toBeTruthy();
    expect(screen.getByText(/Deterministic order: combined risk/)).toBeTruthy();
    expect(screen.getByText(/complete inventory unavailable/)).toBeTruthy();
  });

  it("discloses deterministic tie-break ordering for fully enriched results", async () => {
    client.discoverProofLocks.mockResolvedValue(discovery([verifiedItem()]));
    render(<ProofLocksPage />);
    expect(await screen.findByText(/then newest source block, then identity key/)).toBeTruthy();
    expect(document.querySelector(".inventory-scope")?.textContent).toContain("100–110 · 10 confirmations");
    expect(document.querySelector(".inventory-scope")?.textContent).toContain("returned · cap 100 · observed");
    expect(document.querySelector(".inventory-scope")?.textContent).toContain(" · complete inventory unavailable");
    expect(screen.queryByText("Partial results")).toBeNull();
  });

  it("offers a scan path when no sealed agents are in range", async () => {
    client.discoverProofLocks.mockResolvedValue(discovery([]));
    render(<ProofLocksPage />);
    expect(await screen.findByText(/No sealed agents yet — run a scan/)).toBeTruthy();
    const scanLink = screen.getByRole("link", { name: "Run a scan" });
    expect(scanLink.getAttribute("href")).toBe("/scan");
  });

  it("uses the server-owned observation time for both ordering and lease presentation", async () => {
    const drifted = driftedItem();
    client.discoverProofLocks.mockResolvedValue(discovery([observationBoundItem(), drifted], "1970-01-01T00:01:40.000Z"));
    const view = render(<ProofLocksPage />);
    expect((await screen.findAllByText("ACTIVE")).length).toBe(2);
    expect(screen.queryByText("EXPIRED")).toBeNull();
    const firstAction = view.container.querySelector<HTMLAnchorElement>(".inventory-table a.identity-link");
    expect(firstAction?.href).toContain(encodeURIComponent(agentId(1)));
  });

  it("preserves denied Gate reason text on desktop and mobile", () => {
    const html = renderToStaticMarkup(<AgentsTable items={[deniedItem()]} referenceTimeSeconds={100} />);
    expect(html.split("COVERAGE_INCOMPLETE").length - 1).toBe(2);
    expect(html.split('data-status="BLOCKED"').length - 1).toBeGreaterThanOrEqual(2);
  });

  it("renders inconsistent Gate allowed/reason tuples as mismatches", () => {
    const html = renderToStaticMarkup(<AgentsTable items={[inconsistentGateItem()]} referenceTimeSeconds={100} />);
    expect(html.split('data-status="MISMATCH"').length - 1).toBeGreaterThanOrEqual(2);
    expect(html.split("GATE_TUPLE_MISMATCH").length - 1).toBe(2);
  });

  it("mounts 100 maximum-width rows with usable last-row actions inside budget", () => {
    const items = Array.from({ length: 100 }, (_, index) => numberedItem(index + 1));
    const started = performance.now();
    const view = render(<AgentsTable items={items} referenceTimeSeconds={100} />);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(2_000);
    const actions = view.container.querySelectorAll<HTMLAnchorElement>("a.identity-link");
    expect(actions).toHaveLength(200);
    expect(actions[99]?.href).toContain(encodeURIComponent(agentId(100)));
    actions[99]?.focus(); expect(document.activeElement).toBe(actions[99]);
    const last = items[99];
    expect(last).toBeDefined();
    expect(view.container.textContent?.split(last!.transactionHash).length).toBe(3);
    expect(view.container.querySelectorAll('button[aria-label="Copy Registry source transaction"]')).toHaveLength(200);
    expect(view.container.querySelectorAll('button[aria-label="Copy Agent ID"]')).toHaveLength(200);
    expect(view.container.querySelectorAll('button[aria-label="Copy Agent wallet"]')).toHaveLength(200);
    expect(view.container.textContent).not.toContain("virtualized");
  });

  it("discloses recent-only finalized scope and exact range metadata", async () => {
    const source = await readFile(resolve(process.cwd(), "app/agents/page.tsx"), "utf8");
    expect(source).toContain("Recent ProofLocks");
    expect(source).toContain("complete inventory unavailable; recent finalized activity only");
    for (const field of ["fromBlock", "toBlock", "confirmations", "observedAt", "cap"]) expect(source).toContain(field);
    expect(source).toMatch(/referenceTimeSeconds[\s\S]+sort\([^\n]+referenceTimeSeconds/);
  });

  it("keeps mobile inventory data on dark-surface contrast tokens", async () => {
    const css = await readFile(resolve(process.cwd(), "app/styles/layouts.css"), "utf8");
    expect(css).toMatch(/\.inventory-card \.ui-data-row__value[^}]+var\(--text-on-dark\)/);
    expect(css).toMatch(/\.inventory-card \.inventory-copy-value[^}]+var\(--text-on-dark\)/);
    expect(css).toMatch(/\.inventory-card \.ui-data-row__value a[^}]+var\(--action-on-dark\)/);
    expect(css).toMatch(/\.inventory-card \.ui-data-row__value button[^}]+var\(--action-on-dark\)/);
    expect(css).toMatch(/\.inventory-card \.ui-data-row__value button:focus-visible[^}]+var\(--focus-on-dark\)/);
    expect(css).toMatch(/@media \(max-width: 850px\)[\s\S]+\.inventory-legend \{ display: none; \}/);
    expect(css).toMatch(/\.inventory-table a[^}]+text-decoration: underline/);
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

  it("keeps public detail proof locators server-derived", async () => {
    const source = await readFile(resolve(process.cwd(), "app/agents/[address]/page.tsx"), "utf8");
    expect(source).not.toMatch(/from ["']ethers["']/);
    expect(source).not.toContain("computeProofId");
    expect(source).not.toContain("NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS");
    expect(source).toContain("resolveIdentityLocator");
    expect(source).toContain("detail.locator");
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

function discovery(identities: readonly ProofLockInventoryItem[], observedAt = "2026-08-29T12:00:00.000Z") {
  return { identities, latestBlock: 120, fromBlock: 100, toBlock: 110, confirmations: 10,
    observedAt, cap: 100, returned: identities.length, complete: false as const };
}

function numberedItem(index: number): ProofLockInventoryItem {
  const base = verifiedItem();
  if (base.status !== "VERIFIED" || base.detail.status !== "VERIFIED") throw new Error("fixture must be verified");
  const identityKey = `0x${index.toString(16).padStart(64, "0")}` as `0x${string}`;
  const transactionHash = `0x${(index + 100).toString(16).padStart(64, "0")}` as `0x${string}`;
  return { ...base, identityKey, transactionHash, proofId: `0x${(index + 200).toString(16).padStart(64, "0")}`,
    proofLock: { ...base.proofLock, identityKey }, detail: { ...base.detail,
      identity: { ...base.detail.identity, identityKey, agentId: agentId(index) } } };
}

function observationBoundItem(): ProofLockInventoryItem {
  const base = verifiedItem();
  if (base.status !== "VERIFIED") throw new Error("fixture must be verified");
  return { ...base, proofLock: { ...base.proofLock, state: 1, issuedAt: "1", validUntil: "1000000" } };
}

function enrichmentItem(): ProofLockInventoryItem {
  return { status: "ENRICHMENT_UNAVAILABLE", identityKey: h("9"), transactionHash: h("8"),
    blockNumber: 44, code: "DEPENDENCY_UNAVAILABLE" };
}

function driftedItem(): ProofLockInventoryItem {
  const base = numberedItem(1);
  if (base.status !== "VERIFIED") throw new Error("fixture must be verified");
  return { ...base, proofLock: { ...base.proofLock, coverage: 0x7f, state: 3 } };
}

function deniedItem(): ProofLockInventoryItem {
  const base = verifiedItem();
  if (base.status !== "VERIFIED" || base.detail.status !== "VERIFIED" || base.detail.gate.status !== "VERIFIED")
    throw new Error("fixture must be verified");
  return { ...base, detail: { ...base.detail, gate: { ...base.detail.gate, allowed: false, reason: 8 } } };
}

function inconsistentGateItem(): ProofLockInventoryItem {
  const base = verifiedItem();
  if (base.status !== "VERIFIED" || base.detail.status !== "VERIFIED" || base.detail.gate.status !== "VERIFIED")
    throw new Error("fixture must be verified");
  return { ...base, detail: { ...base.detail, gate: { ...base.detail.gate, allowed: false, reason: 0 } } };
}

function agentId(index: number): string { return ((1n << 256n) - BigInt(index)).toString(); }
