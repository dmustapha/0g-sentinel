// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => navigation.params }));

import { AgentsTable } from "../../components/AgentsTable";
import { EvidenceProofCard } from "../../components/EvidenceProofCard";
import { GateDecisionCard } from "../../components/GateDecisionCard";
import { HistoricalProofDetails } from "../../components/VerifyEvidenceButton";
import { IdentityResolver } from "../../components/IdentityResolver";
import { SubsystemHealthGrid } from "../../components/SubsystemHealthGrid";
import { TrustRoleDisclosure } from "../../components/TrustRoleDisclosure";
import ProofDetailPage from "../../app/proof/[proofId]/page";
import { ProofLockApiError, readHealth, readProofLockDetail, resolveIdentity, verifyProof } from "../../lib/prooflock-client";
import { assertClaimAllowed, claimFor, formatComputeClaim } from "../../lib/prooflock-claims";
import { mapHistoricalPlane } from "../../lib/proof-detail-state";
import { safeDisplayText } from "../../lib/safe-display";
import type { CanonicalIdentity, HealthSnapshot, ProofLockInventoryItem, ProofLockRecord, VerifiedProof } from "../../lib/prooflock-types";

const bidi = "trusted\u202e<script>evil</script>\u200b";
const h = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const a = (byte: string) => `0x${byte.repeat(40)}` as `0x${string}`;

afterEach(() => cleanup());

describe("hostile evidence rendering", () => {
  it("bounds and bidi-isolates hostile Compute provider and model without mutating provenance", () => {
    const proof = historicalProof(`${bidi}${"x".repeat(10_000)}`, "Cafe\u0301 p\u0430ypal 🧑🏽‍💻");
    const html = renderToStaticMarkup(<HistoricalProofDetails proof={proof}
      explorerBase="https://chainscan.0g.ai" />);

    expect(html).not.toContain("\u202e");
    expect(html).not.toContain("\u200b");
    expect(html).toContain("<bdi");
    expect(html).toContain("Café pаypal 🧑🏽‍💻");
    const canonical = proof.storage.envelope.computeProofs as readonly Readonly<{ provider: string }>[];
    expect(canonical[0]!.provider).toContain("\u202e");
    expect(canonical[0]!.provider.length).toBeGreaterThan(10_000);
    expect(html.length).toBeLessThan(8_000);
  });

  it("does not create explorer anchors for hostile configuration", () => {
    const proof = historicalProof("provider", "model");
    const html = renderToStaticMarkup(<HistoricalProofDetails proof={proof}
      explorerBase="javascript:alert(1)" />);

    expect(html).not.toContain("href=");
    expect(html).toContain(proof.source.transactionHash);
    expect(html).toContain(proof.source.registryAddress);
  });

  it.each(["data:text/html,owned", "https://user:pass@chainscan.0g.ai", "https://evil.example"])(
    "keeps explorer base %s inert across both evidence components", (base) => {
      const proof = capabilityProof();
      const historical = mapHistoricalPlane({ status: "MATCH", proof }, "2026-08-29T12:00:00.000Z");
      const verifier = renderToStaticMarkup(<HistoricalProofDetails proof={proof} explorerBase={base} />);
      const evidence = renderToStaticMarkup(<EvidenceProofCard record={proof.proofLock}
        historical={historical} explorerBase={base} />);
      expect(verifier).not.toContain("href=");
      expect(evidence).not.toContain("href=");
      expect(verifier).toContain(proof.source.transactionHash);
      expect(evidence).toContain(proof.source.transactionHash);
    });

  it("isolates evidence commitments and natural Compute prose", () => {
    const proof = historicalProof(bidi, `${"m".repeat(10_000)}🧑🏽‍💻`);
    const html = renderToStaticMarkup(<EvidenceProofCard record={proof.proofLock}
      compute={{ provider: bidi, model: `${"m".repeat(10_000)}🧑🏽‍💻`, verified: true }}
      storage={{ uploadTxHash: h("6"), retrievedAt: bidi, retrievalVerified: true,
        networkProofVerified: false }} />);

    expect(html).not.toContain("\u202e");
    expect(html).toContain('dir="ltr"');
    expect(html.length).toBeLessThan(8_000);
  });

  it("copies raw canonical evidence while rendering only bounded safe projections", async () => {
    const provider = `${bidi}${"p".repeat(10_000)}`;
    const uploadTxHash = `${bidi}${"u".repeat(10_000)}`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = render(<EvidenceProofCard record={proofLock()}
      compute={{ provider, model: "model", verified: true }}
      storage={{ uploadTxHash, retrievalVerified: true, networkProofVerified: false }} />);

    expect(view.container.textContent).not.toContain("\u202e");
    expect(view.container.textContent?.length).toBeLessThan(8_000);
    fireEvent.click(screen.getByRole("button", { name: "Copy Provider" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Upload transaction" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls).toEqual([[provider], [uploadTxHash]]);
  });

  it("qualifies and bounds legacy network-proof metadata as unverified", () => {
    const reported = `${bidi}${"n".repeat(10_000)}`;
    const html = renderToStaticMarkup(<EvidenceProofCard record={proofLock()}
      storage={{ retrievalVerified: true, networkProofVerified: reported }} />);

    expect(html).toContain("Unverified legacy metadata: reported networkProofVerified");
    expect(html).not.toContain("\u202e");
    expect(html.length).toBeLessThan(8_000);
  });

  it("bounds identity errors and isolates exact identity values", () => {
    const hostileError = { code: "IDENTITY_UNAVAILABLE", message: `${bidi}${"e".repeat(10_000)}`,
      stage: "RESOLVING_IDENTITY", retryable: true, requestId: "request" };
    const errorHtml = renderToStaticMarkup(<IdentityResolver value="7" status="error"
      identity={null} error={hostileError} />);
    const identityHtml = renderToStaticMarkup(<IdentityResolver value="7" status="resolved"
      identity={identity()} />);

    expect(errorHtml).not.toContain("\u202e");
    expect(errorHtml.length).toBeLessThan(2_000);
    expect(identityHtml).toContain('dir="ltr"');
    expect(identityHtml).toContain(identity().agentWallet);
    for (const label of ["Agent ID", "Current agent wallet", "Owner", "Registry",
      "Resolution block", "Registration digest"]) {
      expect(identityHtml).toContain(`aria-label="Copy ${label}"`);
    }
  });

  it("keeps historical verifier technical values isolated and canonically copyable", async () => {
    const provider = `${bidi}${"p".repeat(10_000)}`;
    const proof = historicalProof(provider, "model");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = render(<HistoricalProofDetails proof={proof} explorerBase="https://chainscan.0g.ai" />);
    const html = view.container.innerHTML;

    for (const label of ["Registry source transaction", "Source block", "Lease version", "Registry",
      "Source block hash", "Log index", "Storage root", "Storage upload transaction", "Compute provider"]) {
      expect(html).toContain(`aria-label="Copy ${label}"`);
    }
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain("\u202e");
    expect(html.length).toBeLessThan(12_000);
    fireEvent.click(screen.getByRole("button", { name: "Copy Compute provider" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(provider));
  });

  it("bounds hostile API error prose at the client parse boundary", async () => {
    const message = `${bidi}${"e".repeat(10_000)}`;
    const response = new Response(JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message,
      stage: "RESOLVING_IDENTITY", retryable: true, requestId: "request" } }), {
      status: 503, headers: { "content-type": "application/json" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response;
    try {
      await resolveIdentity("7");
      throw new Error("Expected identity resolution to fail");
    } catch (cause) {
      expect(cause).toBeInstanceOf(ProofLockApiError);
      const error = cause as ProofLockApiError;
      expect(error.detail.message).not.toContain("\u202e");
      expect(error.detail.message.length).toBeLessThanOrEqual(257);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses explicit fallbacks for blank provider, model, and error prose", async () => {
    const proof = historicalProof("   ", "\t");
    const historical = renderToStaticMarkup(<HistoricalProofDetails proof={proof}
      explorerBase="https://chainscan.0g.ai" />);
    const evidence = renderToStaticMarkup(<EvidenceProofCard record={proof.proofLock}
      compute={{ provider: "   ", model: "\t", verified: true }} />);
    const identityError = renderToStaticMarkup(<IdentityResolver value="7" status="error"
      identity={null} error={{ code: "IDENTITY_UNAVAILABLE", message: " \t ",
        stage: "RESOLVING_IDENTITY", retryable: true, requestId: "request" }} />);
    expect(historical).toContain("Provider not provided");
    expect(historical).toContain("Model not provided");
    expect(evidence).toContain("Provider not provided");
    expect(evidence).toContain("Model not provided");
    expect(identityError).toContain("Identity resolution failed.");
    expect((proof.storage.envelope.computeProofs as any)[0].provider).toBe("   ");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: {
      code: "DEPENDENCY_UNAVAILABLE", message: " \t ", stage: "RESOLVING_IDENTITY",
      retryable: true, requestId: "request",
    } }), { status: 503, headers: { "content-type": "application/json" } });
    try {
      await expect(resolveIdentity("7")).rejects.toMatchObject({
        detail: { message: "Unspecified error" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects multi-megabyte responses before canonical parsing", async () => {
    const originalFetch = globalThis.fetch;
    const body = JSON.stringify({ identity: { ...identity(), agentURI: "x".repeat(2_000_000) } });
    globalThis.fetch = async () => new Response(body, { status: 200,
      headers: { "content-type": "application/json" } });
    try {
      await expect(resolveIdentity("7")).rejects.toThrow(/bounded|large/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects oversized client collections and object projections", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const oversizedCard = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`k${index}`, index]));
      globalThis.fetch = async () => new Response(JSON.stringify({ identity: {
        ...identity(), card: oversizedCard,
      } }), { status: 200, headers: { "content-type": "application/json" } });
      await expect(resolveIdentity("7")).rejects.toThrow();

      const proof = historicalProof("provider", "model");
      globalThis.fetch = async () => new Response(JSON.stringify({ ...proof, storage: {
        ...proof.storage, computeVerification: Array.from({ length: 65 }, () => ({})),
      } }), { status: 200, headers: { "content-type": "application/json" } });
      await expect(verifyProof(proof.proofId, proof.identityKey)).rejects.toThrow();

      const snapshot = healthSnapshot();
      globalThis.fetch = async () => new Response(JSON.stringify({ ...snapshot, dependencies: {
        ...snapshot.dependencies, rpc: { ...snapshot.dependencies.rpc,
          detail: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`k${index}`, index])) },
      } }), { status: 200, headers: { "content-type": "application/json" } });
      await expect(readHealth()).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves a maximum uint256 Agent ID and rejects an overflowing one", async () => {
    const maximum = ((1n << 256n) - 1n).toString();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ identityKey: h("f"), identity: {
      ...identity(), identity: { ...identity().identity, agentId: maximum },
    } }), { status: 200, headers: { "content-type": "application/json" } });
    try {
      await expect(resolveIdentity(maximum)).resolves.toMatchObject({ identity: { agentId: maximum } });
      const overflow = (1n << 256n).toString();
      globalThis.fetch = async () => new Response(JSON.stringify({ identityKey: h("f"), identity: {
        ...identity(), identity: { ...identity().identity, agentId: overflow },
      } }), { status: 200, headers: { "content-type": "application/json" } });
      await expect(resolveIdentity(overflow)).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves raw hashed provider and model fields while bounding their rendered projections", async () => {
    const provider = `${bidi}${"p".repeat(10_000)}`;
    const model = `Cafe\u0301 ${"m".repeat(10_000)}`;
    const proof = historicalProof(provider, model);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(proof), {
      status: 200, headers: { "content-type": "application/json" },
    });
    try {
      const parsed = await verifyProof(proof.proofId, proof.identityKey);
      const compute = parsed.storage.envelope.computeProofs as readonly Readonly<{ provider: string; model: string }>[];
      expect(compute[0]).toEqual({ provider, model });
      const html = renderToStaticMarkup(<HistoricalProofDetails proof={parsed}
        explorerBase="https://chainscan.0g.ai" />);
      expect(html).not.toContain("\u202e");
      expect(html).toContain("Café");
      expect(html.length).toBeLessThan(12_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("renders blank or hostile trust configuration as not configured", () => {
    const html = renderToStaticMarkup(<TrustRoleDisclosure admin="" guardian="   "
      validator={bidi} custodyConstraint={`${bidi}${"c".repeat(10_000)}`} />);

    expect(html.match(/not configured/g)).toHaveLength(3);
    expect(html).not.toContain("\u202e");
    expect(html.length).toBeLessThan(3_000);
  });

  it("renders default-ignorable trust roles and blank custody as exact fallbacks", () => {
    const html = renderToStaticMarkup(<TrustRoleDisclosure admin={"\u2060"} guardian={"\u200b"}
      validator={"\u00ad"} custodyConstraint={" \t "} />);

    expect(html.match(/>not configured</g)).toHaveLength(3);
    expect(html).toContain("custody constraint not configured");
    expect(html).not.toMatch(/[\u00ad\u200b\u2060]/u);
  });

  it("keeps health prose governed and technical observations isolated", () => {
    const snapshot = healthSnapshot();
    const html = renderToStaticMarkup(<SubsystemHealthGrid snapshot={snapshot} />);

    expect(html).not.toContain(bidi);
    expect(html).not.toContain("\u202e");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Service discovery only");
  });

  it("keeps huge agent IDs canonical in navigation while bounding their display", () => {
    const item = inventoryItem(`1${"0".repeat(76)}`);
    const html = renderToStaticMarkup(<AgentsTable items={[item]} />);

    expect(html).toContain(`/agents/${item.detail.status === "VERIFIED" ? item.detail.identity.agentId : ""}`);
    expect(html).toContain('dir="ltr"');
    expect(html.length).toBeLessThan(8_000);
  });

  it("renders hostile inventory numerics inertly and rejects them at the detail client boundary", async () => {
    const hostile = "9".repeat(2_000_000);
    const item = inventoryItem("7");
    const poisoned = { ...item, proofLock: { ...item.proofLock, version: hostile,
      issuedAt: hostile, validUntil: hostile } };
    const html = renderToStaticMarkup(<AgentsTable items={[poisoned]} />);
    expect(html).toContain("Record unavailable");
    expect(html).not.toContain(hostile.slice(0, 100));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ identityKey: poisoned.identityKey,
      proofLock: poisoned.proofLock, detail: poisoned.detail }), { status: 200,
      headers: { "content-type": "application/json" } });
    try {
      await expect(readProofLockDetail(poisoned.identityKey)).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("isolates Gate subjects and uses governed reason prose", () => {
    const subject = `0x${"ab".repeat(20)}` as `0x${string}`;
    const html = renderToStaticMarkup(<GateDecisionCard decision={{ allowed: false,
      reason: 6, subject, version: "9".repeat(78) }} />);

    expect(html).toContain('dir="ltr"');
    expect(html).toContain(subject);
    expect(html).toContain("RUNTIME_CODE_DRIFT");
    expect(html).not.toContain("undefined");
    expect(html).toContain('aria-label="Copy Subject"');
    expect(html).toContain('aria-label="Copy Version"');
  });

  it("isolates current Gate reason as prose and every technical coordinate as LTR", () => {
    const html = renderToStaticMarkup(<GateDecisionCard current={{ status: "VERIFIED", reason: bidi,
      observationBlockNumber: "1234", observedAt: "2026-08-29T12:00:00.000Z",
      serverIssuedAt: "2026-08-29T12:00:01.000Z", ttlMs: 60_000,
      freshnessExpiresAt: "2026-08-29T12:01:00.000Z" }} />);

    expect(html).not.toContain("\u202e");
    expect(html).toMatch(/reason-code[^>]*><bdi>trusted/);
    for (const value of ["1234", "2026-08-29T12:00:00.000Z", "2026-08-29T12:00:01.000Z",
      "60000 ms", "2026-08-29T12:01:00.000Z"]) {
      expect(html).toMatch(new RegExp(`<bdi dir="ltr"[^>]*>${value.replaceAll(".", "\\.")}</bdi>`));
    }
  });

  it("renders verified Compute and Storage prose only through governed claim keys", async () => {
    const proof = capabilityProof();
    const historical = mapHistoricalPlane({ status: "MATCH", proof }, "2026-08-29T12:00:00.000Z");
    const compute = historical.observations.find((item) => item.subsystem === "compute");
    const storage = historical.observations.find((item) => item.subsystem === "storage");
    if (compute?.subsystem !== "compute" || compute.status !== "VERIFIED" || !("capability" in compute)
      || storage?.subsystem !== "storage" || storage.status !== "VERIFIED" || !("capability" in storage)) {
      throw new Error("fixture must verify");
    }
    const computeClaim = assertClaimAllowed(formatComputeClaim(compute.capability));
    const storageClaim = assertClaimAllowed(claimFor("storage", storage));
    const view = render(<EvidenceProofCard record={proof.proofLock} historical={historical} />);
    const source = await readFile(resolve(process.cwd(), "components/EvidenceProofCard.tsx"), "utf8");

    expect(view.container.textContent).toContain(safeDisplayText(computeClaim, { maxGraphemes: 512 }));
    expect(view.container.textContent).toContain(safeDisplayText(storageClaim, { maxGraphemes: 512 }));
    for (const helper of ["formatComputeClaim", "claimFor", "assertClaimAllowed"]) expect(source).toContain(helper);
    for (const localClaim of ["0G Compute capability", "0G Storage evidence",
      "Retrieved bytes and root matched during historical verification"]) expect(source).not.toContain(localClaim);
  });

  it("sanitizes the display projection of a governed claim without mutating its capability", () => {
    const proof = capabilityProof(`${bidi}${"m".repeat(200)}`);
    const historical = mapHistoricalPlane({ status: "MATCH", proof }, "2026-08-29T12:00:00.000Z");
    const compute = historical.observations.find((item) => item.subsystem === "compute");
    const view = render(<EvidenceProofCard record={proof.proofLock} historical={historical} />);
    const capability = proof.storage.computeVerification?.[0] as Readonly<{ model: string }>;
    if (compute?.subsystem !== "compute" || compute.status !== "VERIFIED" || !("capability" in compute)) {
      throw new Error("fixture must preserve a verified hostile capability");
    }
    const claim = safeDisplayText(assertClaimAllowed(formatComputeClaim(compute.capability)), { maxGraphemes: 512 });

    expect(compute?.status).toBe("VERIFIED");
    expect(view.container.textContent).toContain(claim);
    expect(view.container.innerHTML).not.toContain("\u202e");
    expect(view.container.innerHTML.length).toBeLessThan(14_000);
    expect(capability.model).toContain("\u202e");
  });

  it("rejects an oversized Compute capability without rendering a positive claim", () => {
    const proof = capabilityProof(`${bidi}${"m".repeat(10_000)}`);
    const historical = mapHistoricalPlane({ status: "MATCH", proof }, "2026-08-29T12:00:00.000Z");
    const compute = historical.observations.find((item) => item.subsystem === "compute");
    const html = renderToStaticMarkup(<EvidenceProofCard record={proof.proofLock} historical={historical} />);

    expect(compute?.status).toBe("UNAVAILABLE");
    expect(html).not.toContain("0G Compute capability verified");
    expect(html).not.toContain("\u202e");
    expect(html.length).toBeLessThan(14_000);
  });

  it("applies safe display helpers to both active detail routes", async () => {
    const [agentDetail, proofDetail] = await Promise.all([
      readFile(resolve(process.cwd(), "app/agents/[address]/page.tsx"), "utf8"),
      readFile(resolve(process.cwd(), "app/proof/[proofId]/page.tsx"), "utf8"),
    ]);

    expect(agentDetail).toContain("safeDisplayText");
    expect(agentDetail).toContain("dir=\"ltr\"");
    expect(agentDetail).toContain("<DataRow label=\"Agent ID\"");
    expect(agentDetail).toContain("<DataRow label=\"Agent wallet\"");
    expect(proofDetail).toContain("displayValue");
    expect(proofDetail).toContain("<DataRow label=\"Proof ID\"");
    expect(proofDetail).toContain("<DataRow label=\"Identity key\"");
  });

  it("copies valid route identifiers exactly and withholds copy for hostile invalid values", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    navigation.params = new URLSearchParams({ identityKey: h("2"), sourceTxHash: h("3") });
    const valid = render(<ProofDetailPage params={{ proofId: h("1") }} />);
    for (const [label, value] of [["Proof ID", h("1")], ["Identity key", h("2")],
      ["Registry source transaction hint", h("3")]] as const) {
      fireEvent.click(screen.getByRole("button", { name: `Copy ${label}` }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(value));
    }
    valid.unmount(); writeText.mockClear();
    const hostile = `${bidi}${"x".repeat(10_000)}`;
    navigation.params = new URLSearchParams({ identityKey: hostile, sourceTxHash: "javascript:alert(1)" });
    const invalid = render(<ProofDetailPage params={{ proofId: hostile }} />);
    expect(invalid.container.textContent?.length).toBeLessThan(1_000);
    expect(invalid.container.textContent).not.toContain("\u202e");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

function historicalProof(provider: string, model: string): VerifiedProof {
  const record = proofLock();
  return { proofId: h("1"), identityKey: record.identityKey, source: { kind: "ProofLocked",
    registryAddress: a("8"), transactionHash: h("7"), blockNumber: 123,
    blockHash: h("9"), logIndex: 4 }, proofLock: record,
  storage: { retrievalVerified: true, networkProofVerified: false,
    storageCommitment: { uploadTxHash: h("6") },
    envelope: { computeProofs: [{ provider, model }] } } };
}

function capabilityProof(model = "llama-3"): VerifiedProof {
  const proof = historicalProof(a("9"), model);
  const boundHashes = { receiptDigest: h("1"), requestDigest: h("2"), responseDigest: h("3"),
    signedTextSha256: h("4"), requestSha256: h("5"), rawResponseSha256: h("6"),
    responseHeadersSha256: h("8"), artifactHash: h("7") };
  return { ...proof, storage: { ...proof.storage, computeVerification: [{ sdkVersion: "0.9.0",
    method: "processResponse", provider: a("9"), model, proofClass: "DECENTRALIZED_MODEL_TEE",
    processResponseVerified: true, boundHashes }], storageCommitment: { uploadTxHash: h("6") },
    envelope: { computeProofs: [{ provider: a("9"), model, processResponseVerified: true,
      receiptDigest: h("1"), requestDigest: h("2"), responseDigest: h("3"), signedTextSha256: h("4"),
      requestSha256: h("5"), rawResponseSha256: h("6"), responseHeadersSha256: h("8") }] } } };
}

function proofLock(): ProofLockRecord {
  return { identityKey: h("2"), subject: a("3"), envelopeDigest: h("4"), storageRoot: h("5"),
    computeRoot: h("6"), artifactHash: h("7"), runtimeCodeHash: h("8"), version: "2",
    issuedAt: "1", validUntil: "9999999999", policyVersion: 1, behavioralScore: 10,
    codeRisk: 0, coverage: 127, state: 1, stateReason: 0 };
}

function identity(): CanonicalIdentity {
  return { identity: { namespace: "eip155", chainId: 16661, registryAddress: a("8"), agentId: "7" },
    owner: a("1"), agentWallet: a("2"), agentURI: "ipfs://agent", registrationDigest: h("a"),
    sourceBlockNumber: "100", sourceBlockHash: h("b"), card: {} };
}

function healthSnapshot(): HealthSnapshot {
  const probe = { status: "HEALTHY" as const, latencyMs: 10,
    observedAt: "2026-08-28T08:00:00.000Z", detail: { hostile: bidi } };
  return { status: "HEALTHY", dependencies: { rpc: probe, identity: probe, registry: probe,
    gate: probe, compute: { ...probe, detail: { observation: "SERVICE_DISCOVERY",
      inferenceExecuted: false, hostile: bidi } }, storage: probe } };
}

function inventoryItem(agentId: string): Extract<ProofLockInventoryItem, { status: "VERIFIED" }> {
  const record = proofLock();
  return { status: "VERIFIED", identityKey: record.identityKey, proofId: h("f"), transactionHash: h("c"),
    blockNumber: 8, proofLock: record, detail: { status: "VERIFIED", identity: {
      identityKey: record.identityKey, namespace: "eip155", chainId: 16661, registryAddress: a("8"),
      agentId, owner: record.subject, agentWallet: record.subject, registrationUri: "ipfs://agent",
      registrationDigest: h("a"), sourceBlockNumber: "8", sourceBlockHash: h("b") },
    resolution: { owner: record.subject, agentWallet: record.subject, agentURI: "ipfs://agent",
      registrationDigest: h("a"), sourceBlockNumber: "8", sourceBlockHash: h("b") },
    gate: { status: "VERIFIED", allowed: true, reason: 0, subject: record.subject, version: "2" },
    consumer: { status: "VERIFIED", accepted: true, address: a("9"), subject: record.subject,
      version: "2" } } };
}
