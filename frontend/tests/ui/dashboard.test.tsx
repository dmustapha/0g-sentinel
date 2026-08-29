// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AdmissionLeaseCard } from "../../components/AdmissionLeaseCard";
import { DemoFixtureBadge } from "../../components/DemoFixtureBadge";
import { EvidenceProofCard } from "../../components/EvidenceProofCard";
import { SealLifecycle } from "../../components/SealLifecycle";
import { canonicalAgentHref } from "../../lib/agents";
import { mapHistoricalPlane } from "../../lib/proof-detail-state";
import type { ProofLockRecord, VerifiedProof } from "../../lib/prooflock-types";

const detailClient = vi.hoisted(() => ({
  resolveIdentity: vi.fn(), readProofLockDetail: vi.fn(), computeProofId: vi.fn(), verifyProof: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("../../lib/prooflock-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/prooflock-client")>(), ...detailClient,
}));

import AgentDetailPage from "../../app/agents/[address]/page";

afterEach(() => cleanup());

const record: ProofLockRecord = {
  identityKey: `0x${"11".repeat(32)}`, subject: `0x${"22".repeat(20)}`,
  envelopeDigest: `0x${"33".repeat(32)}`, storageRoot: `0x${"44".repeat(32)}`,
  computeRoot: `0x${"55".repeat(32)}`, artifactHash: `0x${"66".repeat(32)}`,
  runtimeCodeHash: `0x${"77".repeat(32)}`, version: "2", issuedAt: "1000", validUntil: "704800",
  policyVersion: 3, behavioralScore: 12, codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0,
};

describe("ProofLock dashboard and detail", () => {
  it("loads the additive pinned current snapshot without coupling historical verification", () => {
    const page = source("app/agents/[address]/page.tsx");
    expect(page).toContain("readProofLockDetail(key, signal, agentId)");
    expect(page).toContain("mapHistoricalPlane");
    expect(page).toContain("mapCurrentPlane");
    expect(page).toContain('scope="HISTORICAL"');
    expect(page).toContain('scope="CURRENT"');
    expect(page).not.toContain("consumerAllowed");
    expect(page).not.toContain("const proof = linkedProof.status === \"MATCH\" ? linkedProof.proof : undefined");
  });

  it("orders current decision, sealed evidence, current access, lifecycle, and trust", () => {
    const page = source("app/agents/[address]/page.tsx");
    const decision = page.indexOf("Current decision");
    const historical = page.indexOf('scope="HISTORICAL"');
    const current = page.indexOf('scope="CURRENT"');
    const lifecycle = page.indexOf("<SealLifecycle");
    const trust = page.indexOf("<TrustRoleDisclosure");
    expect(decision).toBeGreaterThan(-1);
    expect(decision).toBeLessThan(historical);
    expect(historical).toBeLessThan(current);
    expect(current).toBeLessThan(lifecycle);
    expect(lifecycle).toBeLessThan(trust);
    expect(page).not.toContain('className="operator-panel lifecycle-controls"');
    expect(page).toContain("Open operator workbench");
  });

  it("refreshes one newly pinned current snapshot on TTL, resume, and explicit action", () => {
    const page = source("app/agents/[address]/page.tsx");
    expect(page).toContain("currentRefreshDelay");
    expect(page).toContain('addEventListener("visibilitychange"');
    expect(page).toContain('removeEventListener("visibilitychange"');
    expect(page).toContain("clearTimeout");
    expect(page).toContain("Refresh current state");
    expect(page).not.toContain("retrievedAt: new Date().toISOString()");
    expect(page).toContain("refreshGeneration");
    expect(page).toContain("current?.access.observations.lease.value");
    expect(page).toContain('currentLeaseStatus === "STALE" ? "OBSERVATION_EXPIRED"');
    expect(page.indexOf("Verify this historical artifact")).toBeLessThan(page.indexOf("Refresh current state"));
    expect(page).toContain("historical.proof.source.transactionHash");
  });

  it("uses explicit surface-aware primitive states instead of inherited global state colors", () => {
    for (const component of ["GateDecisionCard.tsx", "AdmissionLeaseCard.tsx", "ProofCoverageGrid.tsx"]) {
      const text = source(`components/${component}`);
      expect(text).toContain("StatusBadge");
      expect(text).toContain('surface="paper"');
      expect(text).not.toMatch(/state-(?:good|bad|warn|unknown)/);
    }
    const evidence = source("components/EvidenceProofCard.tsx");
    expect(evidence).toContain("historical");
    expect(evidence).toContain("computeObservation.capability");
    expect(evidence).not.toContain("computeSummary");
    expect(evidence).not.toContain("compute?.verified");
    expect(evidence).not.toContain("retrievedAt");
    expect(evidence).toContain("source.blockHash");
    expect(evidence).toContain("proof?.proofLock.artifactHash");
  });

  it("preserves exact null-valued lease status and a visible timestamp-unavailable match", () => {
    const lease = renderToStaticMarkup(<AdmissionLeaseCard record={null} status="BLOCKED" reason="EXPIRED" />);
    expect(lease).toContain("Blocked"); expect(lease).toContain("EXPIRED");
    expect(lease).not.toContain("Current lease unavailable");
    const page = source("app/agents/[address]/page.tsx");
    expect(page).toContain("Historical artifact {historical.status}");
    expect(page).toContain("Observation time unavailable");
  });

  it("keeps pinned lease status authoritative when a value is present", () => {
    const stale = renderToStaticMarkup(<AdmissionLeaseCard record={record} status="STALE" reason="OBSERVATION_EXPIRED" />);
    expect(stale).toContain("Stale"); expect(stale).toContain("OBSERVATION_EXPIRED");
    const blocked = renderToStaticMarkup(<AdmissionLeaseCard record={record} status="BLOCKED" reason="COVERAGE_INCOMPLETE" />);
    expect(blocked).toContain("Blocked"); expect(blocked).toContain("COVERAGE_INCOMPLETE");
  });

  it("gives simultaneous current and registry lease cards unique accessible names", () => {
    const html = renderToStaticMarkup(<><AdmissionLeaseCard record={null} />
      <AdmissionLeaseCard basis="registry" record={record} /></>);
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("discloses null-date terminal historical outcomes instead of loading", () => {
    const page = source("app/agents/[address]/page.tsx");
    expect(page).toContain("Historical artifact {historical.status}");
    expect(page).toContain("Observation time unavailable");
  });

  it("renders complete signed Registry and capability provenance", () => {
    const proof = historicalProof(hex32("a"), record.identityKey);
    const historical = mapHistoricalPlane({ status: "MATCH", proof }, "2026-08-29T12:00:00.000Z");
    const html = renderToStaticMarkup(<EvidenceProofCard record={record} historical={historical} />);
    for (const value of [proof.proofLock.artifactHash, proof.source.transactionHash,
      String(proof.source.blockNumber), proof.source.blockHash, String(proof.source.logIndex),
      proof.source.registryAddress, hex32("1"), hex32("2"), hex32("3")]) expect(html).toContain(value);
    expect(html).toContain(`https://chainscan.0g.ai/tx/${proof.source.transactionHash}`);
    expect(html).toContain(`https://chainscan.0g.ai/address/${proof.source.registryAddress}`);
  });

  it("composes null current lease truth and null-date historical MATCH on the route", async () => {
    process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS = `0x${"88".repeat(20)}`;
    const issuedAt = "9".repeat(100);
    const detail = currentDetail("100") as any;
    detail.proofLock = { ...record, issuedAt }; detail.sealedEvidence.proofLock = detail.proofLock;
    detail.currentAccess.observations.lease = {
      ...detail.currentAccess.observations.lease, value: null, reason: "EXPIRED",
      observation: { ...detail.currentAccess.observations.lease.observation,
        status: "BLOCKED", reasonCode: "EXPIRED" },
    };
    detailClient.resolveIdentity.mockReset().mockResolvedValue(detailIdentity());
    detailClient.readProofLockDetail.mockReset().mockResolvedValue(detail);
    detailClient.computeProofId.mockReset().mockReturnValue(hex32("a"));
    detailClient.verifyProof.mockReset().mockImplementation((proofId, identityKey) =>
      Promise.resolve(historicalProof(proofId, identityKey, detail.proofLock)));
    render(<AgentDetailPage params={{ address: "7" }} />);
    expect(await screen.findByText(/Historical artifact MATCH/)).toBeTruthy();
    expect(screen.getByText(/Observation time unavailable/)).toBeTruthy();
    expect(screen.getAllByText("EXPIRED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Historical evidence details" })).toBeTruthy();
    expect(screen.getByText("Registry source transaction")).toBeTruthy();
  });

  it("renders explicit supporting and lifecycle headings with copyable identifiers and TTL", () => {
    const page = source("app/agents/[address]/page.tsx");
    expect(page).toContain("Supporting current state");
    expect(page).toContain("Identifiers and lifecycle");
    expect(page).toContain("<DataRow");
    expect(page).toContain("copyable");
    expect(source("components/GateDecisionCard.tsx")).toContain("TTL");
    expect(source("components/GateDecisionCard.tsx")).toContain("serverIssuedAt");
  });

  it("keeps only the newest same-locator refresh across manual, resume, focus, and cleanup", async () => {
    process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS = `0x${"88".repeat(20)}`;
    detailClient.resolveIdentity.mockReset().mockResolvedValue(detailIdentity());
    detailClient.computeProofId.mockReset().mockReturnValue(hex32("a"));
    detailClient.verifyProof.mockReset().mockRejectedValue(new Error("historical unavailable"));
    const older = deferredDetail(); const newer = deferredDetail(); const signals: AbortSignal[] = [];
    detailClient.readProofLockDetail.mockReset()
      .mockResolvedValueOnce(currentDetail("100"))
      .mockImplementationOnce((_key, signal) => { signals.push(signal); return older.promise; })
      .mockImplementationOnce((_key, signal) => { signals.push(signal); return newer.promise; });
    const view = render(<AgentDetailPage params={{ address: "7" }} />);
    expect((await screen.findAllByText("100")).length).toBeGreaterThan(0);
    const refresh = screen.getByRole("button", { name: "Refresh current state" });
    refresh.focus();
    fireEvent.click(refresh); await waitFor(() => expect(detailClient.readProofLockDetail).toHaveBeenCalledTimes(2));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(detailClient.readProofLockDetail).toHaveBeenCalledTimes(3));
    expect(signals[0]?.aborted).toBe(true);
    await act(() => { newer.resolve(currentDetail("300")); return newer.promise; });
    expect((await screen.findAllByText("300")).length).toBeGreaterThan(0);
    await act(() => { older.resolve(currentDetail("200")); return older.promise; });
    expect(screen.queryByText("200")).toBeNull(); expect(document.activeElement).toBe(refresh);
    const calls = detailClient.readProofLockDetail.mock.calls.length; view.unmount();
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(detailClient.readProofLockDetail).toHaveBeenCalledTimes(calls);
  });

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
    const html = renderToStaticMarkup(React.createElement(SealLifecycle, { currentVersion: "3", previousProofId: `0x${"aa".repeat(32)}`,
      identityKey: `0x${"bb".repeat(32)}` }));
    expect(html).toContain("v3"); expect(html).toContain("SUPERSEDED"); expect(html).toContain("append-preserved");
  });

  it("preserves predecessor casing in visible text while normalizing its href", () => {
    const previousProofId = `0x${"Ab".repeat(32)}`;
    const html = renderToStaticMarkup(<SealLifecycle currentVersion="3" previousProofId={previousProofId}
      identityKey={`0x${"Cd".repeat(32)}`} />);
    expect(html).toContain(previousProofId);
    expect(html).toContain(`/proof/${previousProofId.toLowerCase()}`);
  });

  it.each([
    ["blank", ""], ["non-hex", "not-a-proof"], ["short", `0x${"aa".repeat(31)}`],
    ["bidi-suffixed", `0x${"aa".repeat(32)}\u202e`], ["oversized", "x".repeat(2_000_000)],
  ])("renders an invalid predecessor (%s) inertly without throwing", (_label, previousProofId) => {
      const html = renderToStaticMarkup(<SealLifecycle currentVersion="3" previousProofId={previousProofId}
        identityKey={`0x${"bb".repeat(32)}`} />);
      expect(html).toContain("Predecessor unavailable");
      expect(html).toContain("No historical locator link is available");
      expect(html).not.toContain("href=");
      expect(html).not.toContain("\u202e");
    });

  it("renders hostile canonical lease numerics as unavailable without truncating them into another value", () => {
    const hostile = "9".repeat(2_000_000);
    const lease = renderToStaticMarkup(<AdmissionLeaseCard record={{ ...record,
      version: hostile, issuedAt: hostile, validUntil: hostile }} nowSeconds={10_000} />);
    const lifecycle = renderToStaticMarkup(<SealLifecycle currentVersion={hostile}
      identityKey={record.identityKey} />);
    expect(lease).toContain("Version unavailable");
    expect(lease).toContain("Invalid timestamp");
    expect(lease).not.toContain(hostile.slice(0, 100));
    expect(lifecycle).toContain("Version unavailable");
    expect(lifecycle).not.toContain(hostile.slice(0, 100));
  });

  it("shows verified Compute and honest Storage capability without fallback claims", () => {
    const html = renderToStaticMarkup(React.createElement(EvidenceProofCard, { record,
      compute: { provider: `0x${"99".repeat(20)}`, model: "llama-3", verified: true },
      storage: { uploadTxHash: `0x${"88".repeat(32)}`, retrievedAt: "2026-08-28T08:00:00Z", retrievalVerified: true, networkProofVerified: false } }));
    expect(html).toContain("0G Compute unavailable"); expect(html).toContain("llama-3");
    expect(html).toContain("Unverified legacy metadata");
    expect(html).toContain("networkProofVerified: false"); expect(html).toContain("root matched during historical verification");
    expect(html).not.toContain("permanently retrievable");
  });

  it("labels a demo fixture as synthetic and excluded from production proof", () => {
    const html = renderToStaticMarkup(React.createElement(DemoFixtureBadge));
    expect(html).toContain("DEMO FIXTURE"); expect(html).toContain("not production evidence");
    const page = source("app/agents/[address]/page.tsx");
    expect(page.match(/data-demo-fixture/g)).toHaveLength(2);
    expect(page).not.toMatch(/share fixture|featured fixture/i);
  });
});

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function currentDetail(block: string) {
  const observedAt = new Date(Date.now()).toISOString();
  const freshnessExpiresAt = new Date(Date.parse(observedAt) + 60_000).toISOString();
  const observation = (subsystem: "identity" | "lease" | "gate" | "consumer") => ({
    scope: "CURRENT", subsystem, status: "VERIFIED", observedAt, observationBlockNumber: block,
    observationBlockHash: hex32("b"), serverIssuedAt: observedAt,
    ttlMs: Date.parse(freshnessExpiresAt) - Date.parse(observedAt), freshnessExpiresAt,
    ...(subsystem === "gate" ? { allowed: true, reasonCode: "ALLOWED" } : {}),
    ...(subsystem === "consumer" ? { accepted: true } : {}),
  });
  const entry = (subsystem: "identity" | "lease" | "gate" | "consumer") => ({
    capability: `${subsystem}-capability`, reason: "OBSERVED", observation: observation(subsystem),
    value: subsystem === "lease" ? record : null,
  });
  return { identityKey: record.identityKey, proofLock: record, detail: { status: "UNAVAILABLE",
    code: "EVIDENCE_UNAVAILABLE", identity: null, resolution: null,
    gate: { status: "UNKNOWN", allowed: false, reason: null },
    consumer: { status: "UNKNOWN", accepted: false } }, responseVersion: 2,
    sealedEvidence: { schema: "sentinel.prooflock/sealed-evidence-v1", version: 1,
      proofLock: record, detail: { status: "UNAVAILABLE", code: "EVIDENCE_UNAVAILABLE",
        identity: null, resolution: null, gate: { status: "UNKNOWN", allowed: false, reason: null },
        consumer: { status: "UNKNOWN", accepted: false } } },
    currentAccess: { schema: "sentinel.prooflock/current-access-v1", version: 1, agentId: "7",
      identityKey: record.identityKey, observationBlock: { number: block, hash: hex32("b"), timestamp: "2000" },
      observedAt, freshnessExpiresAt, observations: { identity: entry("identity"), lease: entry("lease"),
        gate: entry("gate"), consumer: entry("consumer") } } };
}

function detailIdentity() { return { identity: { namespace: "eip155", chainId: 16661,
  registryAddress: `0x${"88".repeat(20)}`, agentId: "7" }, owner: `0x${"22".repeat(20)}`,
  agentWallet: `0x${"22".repeat(20)}`, agentURI: "ipfs://agent", registrationDigest: hex32("c"),
  sourceBlockNumber: "8", sourceBlockHash: hex32("d"), card: {} }; }
function deferredDetail() { let resolve!: (value: ReturnType<typeof currentDetail>) => void;
  const promise = new Promise<ReturnType<typeof currentDetail>>((done) => { resolve = done; });
  return { promise, resolve }; }
function hex32(byte: string): `0x${string}` { return `0x${byte.repeat(64)}`; }

function historicalProof(proofId: string, identityKey: string, proofLock = record): VerifiedProof {
  const hashes = { receiptDigest: hex32("1"), requestDigest: hex32("2"), responseDigest: hex32("3"),
    signedTextSha256: hex32("4"), requestSha256: hex32("5"), rawResponseSha256: hex32("6"),
    responseHeadersSha256: hex32("8") };
  return { proofId: proofId as `0x${string}`, identityKey: identityKey as `0x${string}`,
    source: { kind: "ProofLocked", registryAddress: `0x${"88".repeat(20)}`,
      transactionHash: hex32("7"), blockNumber: 123, blockHash: hex32("9"), logIndex: 4 },
    proofLock, storage: { retrievalVerified: true, networkProofVerified: false,
      envelope: { computeProofs: [{ provider: `0x${"99".repeat(20)}`, model: "llama-3",
        processResponseVerified: true, ...hashes }] },
      computeVerification: [{ sdkVersion: "0.9.0", method: "processResponse",
        provider: `0x${"99".repeat(20)}`, model: "llama-3", proofClass: "DECENTRALIZED_MODEL_TEE",
        processResponseVerified: true, boundHashes: { ...hashes, artifactHash: proofLock.artifactHash } }],
      storageCommitment: { uploadTxHash: hex32("c") } } };
}
