import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { AgentsTable } from "../../components/AgentsTable";
import { EvidenceProofCard } from "../../components/EvidenceProofCard";
import { GateDecisionCard } from "../../components/GateDecisionCard";
import { HistoricalProofDetails } from "../../components/VerifyEvidenceButton";
import { IdentityResolver } from "../../components/IdentityResolver";
import { SubsystemHealthGrid } from "../../components/SubsystemHealthGrid";
import { TrustRoleDisclosure } from "../../components/TrustRoleDisclosure";
import { ProofLockApiError, readHealth, readProofLockDetail, resolveIdentity, verifyProof } from "../../lib/prooflock-client";
import type { CanonicalIdentity, HealthSnapshot, ProofLockInventoryItem, ProofLockRecord, VerifiedProof } from "../../lib/prooflock-types";

const bidi = "trusted\u202e<script>evil</script>\u200b";
const h = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const a = (byte: string) => `0x${byte.repeat(40)}` as `0x${string}`;

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
    globalThis.fetch = async () => new Response(JSON.stringify({ identity: {
      ...identity(), identity: { ...identity().identity, agentId: maximum },
    } }), { status: 200, headers: { "content-type": "application/json" } });
    try {
      await expect(resolveIdentity(maximum)).resolves.toMatchObject({ identity: { agentId: maximum } });
      const overflow = (1n << 256n).toString();
      globalThis.fetch = async () => new Response(JSON.stringify({ identity: {
        ...identity(), identity: { ...identity().identity, agentId: overflow },
      } }), { status: 200, headers: { "content-type": "application/json" } });
      await expect(resolveIdentity(overflow)).rejects.toThrow();
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
  });

  it("applies safe display helpers to both active detail routes", async () => {
    const [agentDetail, proofDetail] = await Promise.all([
      readFile(resolve(process.cwd(), "app/agents/[address]/page.tsx"), "utf8"),
      readFile(resolve(process.cwd(), "app/proof/[proofId]/page.tsx"), "utf8"),
    ]);

    expect(agentDetail).toContain("safeDisplayText");
    expect(agentDetail).toContain("dir=\"ltr\"");
    expect(proofDetail).toContain("displayValue");
    expect(proofDetail).toContain("dir=\"ltr\"");
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
