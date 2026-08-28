import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubsystemHealthGrid } from "../../components/SubsystemHealthGrid";
import { currentAccessFor, HistoricalProofDetails, VerificationResult, verificationStateForError, VerifyEvidenceButton } from "../../components/VerifyEvidenceButton";
import { ProofLockApiError } from "../../lib/prooflock-client";
import type { HealthSnapshot, ProofVerificationState } from "../../lib/prooflock-types";

describe("public proof verification", () => {
  it("keys the stateful verifier by the complete identifier tuple", () => {
    const first = VerifyEvidenceButton({ proofId: "proof", identityKey: "identity", sourceTxHash: "tx-1" });
    const same = VerifyEvidenceButton({ proofId: "proof", identityKey: "identity", sourceTxHash: "tx-1" });
    const proofChanged = VerifyEvidenceButton({ proofId: "proof-2", identityKey: "identity", sourceTxHash: "tx-1" });
    const identityChanged = VerifyEvidenceButton({ proofId: "proof", identityKey: "identity-2", sourceTxHash: "tx-1" });
    const sourceChanged = VerifyEvidenceButton({ proofId: "proof", identityKey: "identity", sourceTxHash: "tx-2" });

    expect(first.key).toBe(same.key);
    expect(new Set([first.key, proofChanged.key, identityChanged.key, sourceChanged.key])).toHaveLength(4);
  });
  it("maps mismatch, dependency outage, timeout, and user cancel to distinct stable states", () => {
    const error = (code: string, status: number) => new ProofLockApiError({ code, message: code, stage: "VERIFYING_PROOF",
      retryable: status === 503, requestId: "req" }, status);
    expect(verificationStateForError(error("MISMATCH", 409))).toBe("MISMATCH");
    expect(verificationStateForError(error("DEPENDENCY_UNAVAILABLE", 503))).toBe("UNAVAILABLE");
    expect(verificationStateForError(new DOMException("Aborted", "AbortError"), "TIMEOUT")).toBe("TIMEOUT");
    expect(verificationStateForError(new DOMException("Aborted", "AbortError"), "CANCELED")).toBe("CANCELED");
  });

  it("keeps current access blocked when Gate allows but guarded consumer proof is unknown", () => {
    const proof = historicalProof(); const subject = proof.proofLock.subject;
    const detail = { identityKey: proof.identityKey, proofLock: proof.proofLock, detail: { status: "VERIFIED" as const,
      identity: { identityKey: proof.identityKey, namespace: "eip155" as const, chainId: 16661 as const,
        registryAddress: `0x${"88".repeat(20)}` as `0x${string}`, agentId: "7", owner: subject, agentWallet: subject,
        registrationUri: "ipfs://agent", registrationDigest: `0x${"aa".repeat(32)}` as `0x${string}`,
        sourceBlockNumber: "100", sourceBlockHash: `0x${"bb".repeat(32)}` as `0x${string}` },
      resolution: { owner: subject, agentWallet: subject, agentURI: "ipfs://agent", registrationDigest: `0x${"aa".repeat(32)}` as `0x${string}`,
        sourceBlockNumber: "100", sourceBlockHash: `0x${"bb".repeat(32)}` as `0x${string}` },
      gate: { status: "VERIFIED" as const, allowed: true, reason: 0, subject, version: "2" },
      consumer: { status: "UNKNOWN" as const, accepted: false as const } } };
    expect(currentAccessFor(detail)).toEqual({ current: "BLOCKED", reason: "CONSUMER_UNKNOWN" });
  });

  it("renders immutable chain, Storage, and Compute provenance with explorer links", () => {
    const html = renderToStaticMarkup(React.createElement(HistoricalProofDetails, { proof: historicalProof(),
      explorerBase: "https://chainscan.0g.ai" }));
    for (const value of ["block 123", "Version 2", "provider-tee", "model-tee", `0x${"55".repeat(32)}`, `0x${"66".repeat(32)}`]) expect(html).toContain(value);
    expect(html).toContain(`/tx/0x${"77".repeat(32)}`); expect(html).toContain(`/address/0x${"88".repeat(20)}`);
  });
  it.each([
    ["MATCH", "Historical artifact matches"], ["MISMATCH", "Historical artifact mismatch"],
    ["UNAVAILABLE", "Evidence unavailable"], ["TIMEOUT", "Verification timed out"], ["CANCELED", "Verification canceled"],
    ["RETRYING", "Retrying verification"],
  ] satisfies readonly (readonly [ProofVerificationState, string])[])("renders %s explicitly", (state, label) => {
    const html = renderToStaticMarkup(React.createElement(VerificationResult, { state })); expect(html).toContain(label);
  });
  it("separates historical artifact match from current blocked lease", () => {
    const html = renderToStaticMarkup(React.createElement(VerificationResult, { state: "MATCH", current: "BLOCKED", reasonCode: "DRIFTED" }));
    expect(html).toContain("Historical artifact matches"); expect(html).toContain("Current access: BLOCKED"); expect(html).toContain("DRIFTED");
    expect(html).not.toContain("Current access: ADMITTED");
  });
  it("announces busy verification with concise status semantics", () => {
    const html = renderToStaticMarkup(React.createElement(VerificationResult, { state: "VERIFYING", busy: true }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });
  it("keeps a historical match visible when current access is unavailable", () => {
    const html = renderToStaticMarkup(React.createElement(VerificationResult, { state: "MATCH", current: "UNAVAILABLE" }));
    expect(html).toContain("Historical artifact matches");
    expect(html).toContain("Current access: UNAVAILABLE");
  });
});

function historicalProof() {
  const h = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
  return { proofId: h("1"), identityKey: h("2"), source: { kind: "ProofLocked" as const, registryAddress: `0x${"88".repeat(20)}` as `0x${string}`,
    transactionHash: h("7"), blockNumber: 123, blockHash: h("9"), logIndex: 4 }, proofLock: {
    identityKey: h("2"), subject: `0x${"33".repeat(20)}` as `0x${string}`, envelopeDigest: h("4"), storageRoot: h("5"), computeRoot: h("6"),
    artifactHash: h("7"), runtimeCodeHash: h("8"), version: "2", issuedAt: "1", validUntil: "9999999999", policyVersion: 1,
    behavioralScore: 10, codeRisk: 0, coverage: 127, state: 1, stateReason: 0 }, storage: { retrievalVerified: true as const,
    networkProofVerified: false as const, storageCommitment: { uploadTxHash: h("6") }, envelope: { computeProofs: [{ provider: "provider-tee", model: "model-tee" }] } } };
}

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
