// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RiskLeaderboard } from "../../components/RiskLeaderboard";
import { rankProofLocksByRisk, proofLockRiskKey } from "../../lib/ranking";
import type { ProofLockInventoryItem } from "../../lib/prooflock-types";

afterEach(cleanup);

const h = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;

// Mirrors the real sealed agent 3527152: version 4, gate ALLOWED, low risk.
function sealedAgent(overrides: Partial<Mutable> = {}): ProofLockInventoryItem {
  const agentId = overrides.agentId ?? "3527152";
  const identityKey = overrides.identityKey ?? h("1");
  const subject = overrides.subject ?? "0xDaA09b710cDB279AF411e4a9C4C79D00bfDB282f";
  return {
    status: "VERIFIED", identityKey, proofId: h("f"),
    transactionHash: overrides.transactionHash ?? h("2"), blockNumber: overrides.blockNumber ?? 100,
    proofLock: {
      identityKey, subject: subject as `0x${string}`, envelopeDigest: h("4"), storageRoot: h("5"),
      computeRoot: h("6"), artifactHash: h("7"), runtimeCodeHash: h("8"),
      version: overrides.version ?? "4", issuedAt: "1", validUntil: "9999999999", policyVersion: 1,
      behavioralScore: overrides.behavioralScore ?? 12, codeRisk: overrides.codeRisk ?? 0,
      coverage: 127, state: 1, stateReason: 0,
    },
    detail: {
      status: "VERIFIED",
      identity: {
        identityKey, namespace: "eip155", chainId: 16661, registryAddress: h("8").slice(0, 42) as `0x${string}`,
        agentId, owner: subject as `0x${string}`, agentWallet: subject as `0x${string}`,
        registrationUri: "ipfs://agent", registrationDigest: h("a"), sourceBlockNumber: "8", sourceBlockHash: h("b"),
      },
      resolution: {
        owner: subject as `0x${string}`, agentWallet: subject as `0x${string}`, agentURI: "ipfs://agent",
        registrationDigest: h("a"), sourceBlockNumber: "8", sourceBlockHash: h("b"),
      },
      gate: { status: "VERIFIED", allowed: overrides.allowed ?? true, reason: overrides.reason ?? 0,
        subject: subject as `0x${string}`, version: overrides.version ?? "4" },
      consumer: { status: "VERIFIED", accepted: true, address: h("9").slice(0, 42) as `0x${string}`,
        subject: subject as `0x${string}`, version: overrides.version ?? "4" },
    },
  };
}

type Mutable = {
  agentId: string; identityKey: `0x${string}`; subject: string; transactionHash: `0x${string}`;
  blockNumber: number; version: string; behavioralScore: number; codeRisk: number;
  allowed: boolean; reason: number;
};

describe("RiskLeaderboard with real sealed data", () => {
  it("renders a single sealed agent (3527152) correctly", () => {
    const html = renderToStaticMarkup(<RiskLeaderboard items={[sealedAgent()]} />);
    expect(html).toContain("3527152");
    expect(html).toContain("ALLOWED");
    expect(html).toContain("v4");
    expect(html).toContain("SAFE");     // behavioralScore 12 -> SAFE band
    expect(html).toContain("CLEAN");    // codeRisk 0 -> CLEAN band
    expect(html).toContain("1 sealed agent");
    // subject rendered monospace, truncated middle
    expect(html).toContain("0xDaA09b71…DB282f");
    // links to the canonical agent proof record
    expect(html).toContain("/agents/3527152?sourceTxHash=");
  });

  it("ranks the highest combined risk first and numbers ranks 1..N", () => {
    const low = sealedAgent({ agentId: "100", identityKey: h("1"), behavioralScore: 5, codeRisk: 0 });
    const flagged = sealedAgent({ agentId: "200", identityKey: h("2"), behavioralScore: 88, codeRisk: 0 });
    const vulnerable = sealedAgent({ agentId: "300", identityKey: h("3"), behavioralScore: 20, codeRisk: 2 });
    const ranked = rankProofLocksByRisk([low, flagged, vulnerable]);
    const ids = ranked.map((i) => (i.status === "VERIFIED" && i.detail.status === "VERIFIED"
      ? i.detail.identity.agentId : null));
    // vulnerable (level 2, score 20) and flagged (level 2, score 88) both level 2;
    // flagged has higher behavioral score so leads, then vulnerable, then low.
    expect(ids).toEqual(["200", "300", "100"]);

    const view = render(<RiskLeaderboard items={[low, flagged, vulnerable]} />);
    const ranks = Array.from(view.container.querySelectorAll(".leaderboard-table .leaderboard-rank"))
      .map((n) => n.textContent);
    expect(ranks).toEqual(["1", "2", "3"]);
    expect(screen.getByText("3 sealed agents")).toBeTruthy();
  });

  it("toggles between risk and version sort", () => {
    const v2 = sealedAgent({ agentId: "111", identityKey: h("1"), version: "2", behavioralScore: 90 });
    const v9 = sealedAgent({ agentId: "222", identityKey: h("2"), version: "9", behavioralScore: 5 });
    const view = render(<RiskLeaderboard items={[v2, v9]} />);
    const firstAgentByRisk = view.container.querySelector(".leaderboard-table tbody tr .leaderboard-agent .mono");
    expect(firstAgentByRisk?.textContent).toBe("111"); // higher behavioral risk leads

    fireEvent.click(screen.getByRole("button", { name: "Version" }));
    const firstAgentByVersion = view.container.querySelector(".leaderboard-table tbody tr .leaderboard-agent .mono");
    expect(firstAgentByVersion?.textContent).toBe("222"); // v9 leads by version
    expect(screen.getByRole("button", { name: "Version" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("surfaces a denied gate with its reason and blocked status", () => {
    const denied = sealedAgent({ allowed: false, reason: 8 }); // COVERAGE_INCOMPLETE
    const html = renderToStaticMarkup(<RiskLeaderboard items={[denied]} />);
    expect(html).toContain("COVERAGE_INCOMPLETE");
    expect(html).toContain('data-status="BLOCKED"');
  });

  it("keeps every ranked row keyboard reachable with a group-labelled sort control", () => {
    const items = [sealedAgent({ agentId: "1", identityKey: h("1") }),
      sealedAgent({ agentId: "2", identityKey: h("2"), behavioralScore: 80 })];
    render(<RiskLeaderboard items={items} />);
    const group = screen.getByRole("group", { name: "Sort sealed agents" });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    const links = screen.getAllByRole("link");
    links[0]?.focus();
    expect(document.activeElement).toBe(links[0]);
  });

  it("gives the riskless empty case a stable, unavailable-safe risk key", () => {
    const enrichment: ProofLockInventoryItem = { status: "ENRICHMENT_UNAVAILABLE",
      identityKey: h("9"), transactionHash: h("8"), blockNumber: 44, code: "DEPENDENCY_UNAVAILABLE" };
    expect(proofLockRiskKey(enrichment)).toBe(-1);
  });
});
