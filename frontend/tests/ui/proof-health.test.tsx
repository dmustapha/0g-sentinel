// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProofPage from "../../app/proof/page";
import { SealLifecycle } from "../../components/SealLifecycle";
import { SubsystemHealthGrid } from "../../components/SubsystemHealthGrid";
import { currentAccessFor, HistoricalProofDetails, ProofLocatorNotice, VerificationResult, verificationStateForError, VerifyEvidenceButton } from "../../components/VerifyEvidenceButton";
import { CLAIM_REGISTRY, claimFor } from "../../lib/prooflock-claims";
import { ProofLockApiError } from "../../lib/prooflock-client";
import { verifyLinkedHistoricalProof } from "../../lib/prooflock-routes";
import type { HealthSnapshot, ProofVerificationState, VerifiedProof } from "../../lib/prooflock-types";

const clientMocks = vi.hoisted(() => ({ readHealth: vi.fn(), readProofLockDetail: vi.fn(), verifyProof: vi.fn() }));
const navigationMocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/prooflock-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/prooflock-client")>(),
  readHealth: clientMocks.readHealth,
  readProofLockDetail: clientMocks.readProofLockDetail,
  verifyProof: clientMocks.verifyProof,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup(); navigationMocks.push.mockReset(); clientMocks.readHealth.mockReset();
  clientMocks.readProofLockDetail.mockReset(); clientMocks.verifyProof.mockReset();
});

describe("public proof verification", () => {
  it("specifies a semantic three-field entry form built only from canonical primitives", async () => {
    const source = await projectSource("app/proof/page.tsx");
    expect(source).toMatch(/<form\b[^>]*onSubmit=/s);
    for (const label of ["Proof ID", "Identity key", "Optional Registry source transaction"])
      expect(source).toContain(`label="${label}"`);
    expect(source.match(/<Field\b/g)).toHaveLength(3);
    expect(source).toMatch(/<Button\b[^>]*type="submit"/s);
    expect(source).toContain("<StateMessage");
    expect(source).not.toMatch(/<(?:input|button)\b/);
  });

  it("renders the verifier claim from claimFor without a component-local replacement", async () => {
    const source = await projectSource("app/proof/page.tsx");
    const governed = claimFor("verifier");
    expect(governed.text).toBe(`${CLAIM_REGISTRY.verifier.permitted} ${CLAIM_REGISTRY.verifier.qualification}`);
    expect(source).toMatch(/claimFor\(\s*["']verifier["']\s*\)/);
    expect(source).toMatch(/\{\s*\w+\.text\s*\}/);
    expect(source).not.toContain(CLAIM_REGISTRY.verifier.permitted);
    expect(source).not.toContain(CLAIM_REGISTRY.verifier.qualification);
    expect(source).not.toMatch(/offline verifier/i);
  });

  it("keeps all verifier capability and status prose in the governed copy registry", async () => {
    const claims = await import("../../lib/prooflock-claims") as unknown as {
      VERIFIER_CLAIM_COPY?: Readonly<Record<string, unknown>>;
    };
    expect(claims.VERIFIER_CLAIM_COPY).toBeDefined();
    expect(Object.isFrozen(claims.VERIFIER_CLAIM_COPY)).toBe(true);
    const governedText = stringLeaves(claims.VERIFIER_CLAIM_COPY);
    const localReplacements = ["Retrying probes", "Retrying", "Verifying exact evidence",
      "inferenceExecuted:", "networkProofVerified:"];
    for (const path of ["app/proof/page.tsx", "app/proof/[proofId]/page.tsx",
      "components/VerifyEvidenceButton.tsx", "components/SubsystemHealthGrid.tsx"]) {
      const source = await projectSource(path); expect(source, path).toContain("VERIFIER_CLAIM_COPY");
      for (const text of governedText) expect(hasLocalCopy(source, text), `${path}: ${text}`).toBe(false);
      for (const text of localReplacements) expect(source, `${path}: ${text}`).not.toContain(text);
    }
  });

  it("allows an invalid optional source submission and focuses the first invalid field", async () => {
    clientMocks.readHealth.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup(); render(<ProofPage />);
    const proof = screen.getByRole("textbox", { name: "Proof ID" });
    const identity = screen.getByRole("textbox", { name: "Identity key" });
    const source = screen.getByRole("textbox", { name: "Optional Registry source transaction" });
    await user.type(proof, h("1")); await user.type(identity, h("2")); await user.type(source, "invalid");
    const submit = screen.getByRole("button", { name: "Open verifier" });
    expect((submit as HTMLButtonElement).disabled).toBe(false); await user.click(submit);
    expect(document.activeElement).toBe(source); expect(navigationMocks.push).not.toHaveBeenCalled();
    await user.clear(proof); proof.focus(); await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(proof); expect(navigationMocks.push).not.toHaveBeenCalled();
    expect(proof.getAttribute("aria-invalid")).toBe("true");
    expect(proof.getAttribute("aria-describedby")).toMatch(/error/);
    expect(screen.getByText("Enter an exact nonzero bytes32 proof ID.")).not.toBeNull();
  });

  it("keeps result identifiers and the optional source locator visible around a focusable route heading", async () => {
    const source = await projectSource("app/proof/[proofId]/page.tsx");
    expect(source).toMatch(/<h1\b[^>]*tabIndex=\{-1\}[^>]*>Proof verification<\/h1>/s);
    for (const label of ["Proof ID", "Identity key", "Registry source transaction"])
      expect(source).toContain(label);
    expect(source).toContain("sourceParam.status !== \"ABSENT\"");
  });

  it("keeps the matched dossier inside the historical plane and uses the approved pilot measures", async () => {
    const source = await projectSource("components/VerifyEvidenceButton.tsx");
    const historicalStart = source.indexOf('data-plane="historical"');
    const dossier = source.indexOf("<HistoricalProofDetails", historicalStart);
    const currentStart = source.indexOf('data-plane="current"', historicalStart);
    expect(historicalStart).toBeGreaterThan(-1);
    expect(dossier).toBeGreaterThan(historicalStart);
    expect(currentStart).toBeGreaterThan(dossier);

    const layouts = await projectSource("app/styles/layouts.css");
    expect(layouts).toMatch(/\.proof-page \.verify-sheet\s*\{[^}]*max-width:\s*var\(--measure-prose\)/s);
    expect(layouts).toMatch(/\.verification-result\s*\{[^}]*grid-template-columns:/s);
    expect(layouts).toMatch(/@media \(max-width: 850px\)[\s\S]*\.verification-result[^}]*grid-template-columns:\s*1fr/s);
    const components = await projectSource("app/styles/components.css");
    expect(components).toMatch(/\.proof-identifiers dt\s*\{[^}]*color:\s*var\(--text-muted-on-dark\)/s);
  });

  it.each([
    ["MATCH", "Historical artifact matches"], ["MISMATCH", "Historical artifact mismatch"],
    ["HINT_REQUIRED", "Source transaction required"], ["UNAVAILABLE", "Evidence unavailable"],
    ["TIMEOUT", "Verification timed out"], ["CANCELED", "Verification canceled"],
  ] satisfies readonly (readonly [ProofVerificationState, string])[])
  ("renders %s in a canonical, focusable historical status", (state, label) => {
    const html = renderToStaticMarkup(<VerificationResult state={state} />);
    expect(html).toContain("ui-state-message");
    expect(html).toContain('data-plane="historical"');
    expect(html).toMatch(new RegExp(`<h2[^>]*tabindex="-1"[^>]*>${label}</h2>`));
  });

  it("keeps Retry focused and inert while a clean historical retry is pending", async () => {
    clientMocks.verifyProof.mockRejectedValueOnce(new ProofLockApiError({ code: "DEPENDENCY_UNAVAILABLE",
      message: "unavailable", stage: "VERIFYING_PROOF", retryable: true, requestId: "retry-1" }, 503));
    const user = userEvent.setup();
    render(<VerifyEvidenceButton proofId={h("1")} identityKey={h("2")} />);
    await user.click(screen.getByRole("button", { name: "Verify exact evidence" }));
    const status = await screen.findByRole("heading", { name: "Evidence unavailable" });
    const historicalPlane = status.closest('[data-plane="historical"]');
    expect(status.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(status);

    let settle: (() => void) | undefined;
    clientMocks.verifyProof.mockImplementationOnce(() => new Promise((resolve) => { settle = () => resolve(historicalProof()); }));
    const retry = screen.getByRole("button", { name: "Retry" });
    const retryPosition = historicalPlane?.compareDocumentPosition(retry) ?? 0;
    expect(retryPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    retry.focus(); await user.click(retry);
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("true"));
    expect(document.activeElement).toBe(retry); expect(screen.getByRole("button", { name: "Cancel historical verification" })).not.toBeNull();
    settle?.();
  });

  it("focuses the current heading only after a user cancels its read", async () => {
    clientMocks.verifyProof.mockResolvedValueOnce(historicalProof());
    clientMocks.readProofLockDetail.mockImplementationOnce(() => new Promise(() => {}));
    const user = userEvent.setup(); render(<VerifyEvidenceButton proofId={h("1")} identityKey={h("2")} />);
    await user.click(screen.getByRole("button", { name: "Verify exact evidence" }));
    await user.click(await screen.findByRole("button", { name: "Cancel current access read" }));
    const heading = await screen.findByRole("heading", { name: "Current access: CANCELED" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("rejects a substituted proof tuple as an explicit mismatch with no proof", async () => {
    const requested = historicalProof();
    const other = { ...requested, proofId: h("a"), source: { ...requested.source, transactionHash: h("b") } };
    const verify = vi.fn().mockResolvedValue(other);
    const result = await verifyLinkedHistoricalProof({ proofId: requested.proofId,
      identityKey: requested.identityKey, sourceTxHash: requested.source.transactionHash },
    new AbortController().signal, verify);
    expect(verify).toHaveBeenCalledWith(requested.proofId, requested.identityKey,
      expect.any(AbortSignal), requested.source.transactionHash);
    expect(result).toEqual({ status: "MISMATCH" });
    expect(result).not.toHaveProperty("proof");
  });

  it("treats only a hinted NOT_FOUND as stale", async () => {
    const requested = historicalProof();
    const notFound = vi.fn().mockRejectedValue(new ProofLockApiError({ code: "NOT_FOUND",
      message: "not found", stage: "VERIFYING_PROOF", retryable: false, requestId: "req" }, 404));
    await expect(verifyLinkedHistoricalProof({ proofId: requested.proofId,
      identityKey: requested.identityKey, sourceTxHash: requested.source.transactionHash },
    new AbortController().signal, notFound)).resolves.toEqual({ status: "STALE_LINK" });

    const wrongSource = { ...requested, source: { ...requested.source, transactionHash: h("b") } };
    await expect(verifyLinkedHistoricalProof({ proofId: requested.proofId,
      identityKey: requested.identityKey, sourceTxHash: requested.source.transactionHash },
    new AbortController().signal, vi.fn().mockResolvedValue(wrongSource)))
      .resolves.toEqual({ status: "MISMATCH" });
  });

  it.each([h("0"), "invalid-source"])("rejects returned source transaction %s without a hint", async (transactionHash) => {
    const requested = historicalProof();
    const contradictory = { ...requested, source: { ...requested.source, transactionHash } } as VerifiedProof;
    const result = await verifyLinkedHistoricalProof({ proofId: requested.proofId,
      identityKey: requested.identityKey }, new AbortController().signal,
    vi.fn().mockResolvedValue(contradictory));
    expect(result).toEqual({ status: "MISMATCH" });
    expect(result).not.toHaveProperty("proof");
  });

  it("preserves a hinted cryptographic MISMATCH with no returned proof", async () => {
    const requested = historicalProof();
    const mismatch = vi.fn().mockRejectedValue(new ProofLockApiError({ code: "MISMATCH",
      message: "mismatch", stage: "VERIFYING_PROOF", retryable: false, requestId: "req" }, 409));
    const result = await verifyLinkedHistoricalProof({ proofId: requested.proofId,
      identityKey: requested.identityKey, sourceTxHash: requested.source.transactionHash },
    new AbortController().signal, mismatch);
    expect(result).toEqual({ status: "MISMATCH" });
    expect(result).not.toHaveProperty("proof");
  });

  it("preserves the precise bounded-locator result for an old URL without a hint", async () => {
    const requested = historicalProof();
    const verify = vi.fn().mockRejectedValue(new ProofLockApiError({ code: "HINT_REQUIRED",
      message: "hint required", stage: "VERIFYING_PROOF", retryable: false, requestId: "req" }, 422));
    await expect(verifyLinkedHistoricalProof({ proofId: requested.proofId,
      identityKey: requested.identityKey }, new AbortController().signal, verify))
      .resolves.toEqual({ status: "HINT_REQUIRED" });
  });

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
    expect(verificationStateForError(error("HINT_REQUIRED", 422))).toBe("HINT_REQUIRED");
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
    expect(html).toContain("Registry source transaction");
    expect(html).toContain("Storage upload transaction");
    expect(html).toContain(`/tx/0x${"66".repeat(32)}`);
  });
  it("labels a predecessor without a source transaction as a locator that may need a hint", () => {
    const html = renderToStaticMarkup(React.createElement(SealLifecycle, { currentVersion: "2",
      previousProofId: h("3"), identityKey: h("2") }));
    expect(html).toContain("locator may require source transaction");
    expect(html).toContain(`/proof/${h("3")}?identityKey=${h("2")}`);
  });
  it("renders a stale hinted link without claiming its historical proof", () => {
    const html = renderToStaticMarkup(React.createElement(ProofLocatorNotice, {
      status: "STALE_LINK", currentHref: "/agents/7",
    }));
    expect(html).toContain("Stale proof link");
    expect(html).toContain("source transaction does not identify the current record");
    expect(html).toContain("Retry current record without source locator");
    expect(html).not.toContain("Historical artifact matches");
  });
  it("renders cryptographic mismatch separately from stale-link advancement", () => {
    const html = renderToStaticMarkup(React.createElement(ProofLocatorNotice, {
      status: "MISMATCH", currentHref: "/agents/7",
    }));
    expect(html).toContain("Historical proof mismatch");
    expect(html).toContain("cryptographic or finalized provenance checks");
    expect(html).not.toContain("Stale proof link");
    expect(html).not.toContain("Historical artifact matches");
  });
  it.each([
    ["MATCH", "Historical artifact matches"], ["MISMATCH", "Historical artifact mismatch"],
    ["UNAVAILABLE", "Evidence unavailable"], ["TIMEOUT", "Verification timed out"], ["CANCELED", "Verification canceled"],
    ["HINT_REQUIRED", "Source transaction required"], ["RETRYING", "Retrying verification"],
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

  it("announces only concise plane state and never the matched dossier or actions", () => {
    render(<VerificationResult state="MATCH" current="ADMITTED" reasonCode="ALLOWED"
      proof={historicalProof()} explorerBase="https://chainscan.0g.ai" />);
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]?.textContent).toContain("Historical artifact matches");
    expect(statuses[0]?.textContent).not.toContain(h("5"));
    expect(statuses[1]?.textContent).toContain("Current access: ADMITTED");
  });

  it("bounds and bidi-neutralizes hostile status prose", () => {
    const hostile = `DRIFTED\u202e<script>${"x".repeat(10_000)}`;
    const html = renderToStaticMarkup(<VerificationResult state="MATCH" current="BLOCKED" reasonCode={hostile} />);
    expect(html).not.toContain("\u202e"); expect(html).not.toContain("<script>"); expect(html.length).toBeLessThan(4_000);
  });
});

function historicalProof() {
  return { proofId: h("1"), identityKey: h("2"), source: { kind: "ProofLocked" as const, registryAddress: `0x${"88".repeat(20)}` as `0x${string}`,
    transactionHash: h("7"), blockNumber: 123, blockHash: h("9"), logIndex: 4 }, proofLock: {
    identityKey: h("2"), subject: `0x${"33".repeat(20)}` as `0x${string}`, envelopeDigest: h("4"), storageRoot: h("5"), computeRoot: h("6"),
    artifactHash: h("7"), runtimeCodeHash: h("8"), version: "2", issuedAt: "1", validUntil: "9999999999", policyVersion: 1,
    behavioralScore: 10, codeRisk: 0, coverage: 127, state: 1, stateReason: 0 }, storage: { retrievalVerified: true as const,
    networkProofVerified: false as const, storageCommitment: { uploadTxHash: h("6") }, envelope: { computeProofs: [{ provider: "provider-tee", model: "model-tee" }] } } };
}

const h = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;

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

  it("keeps each mixed probe in its own labeled, non-live state boundary", () => {
    const probe = (status: "HEALTHY" | "UNHEALTHY" | "UNKNOWN") => ({ status, latencyMs: 10,
      observedAt: "2026-08-28T08:00:00.000Z" });
    const snapshot: HealthSnapshot = { status: "DEGRADED", dependencies: {
      rpc: probe("HEALTHY"), identity: probe("UNHEALTHY"), registry: probe("UNKNOWN"),
      gate: probe("HEALTHY"), compute: probe("UNHEALTHY"), storage: probe("UNKNOWN"),
    } };
    const view = render(<SubsystemHealthGrid snapshot={snapshot} />);
    for (const [name, status] of [["rpc", "HEALTHY"], ["identity", "UNHEALTHY"], ["registry", "UNKNOWN"],
      ["gate", "HEALTHY"], ["compute", "UNHEALTHY"], ["storage", "UNKNOWN"]] as const) {
      const cell = view.container.querySelector(`[data-subsystem="${name}"]`);
      expect(cell?.getAttribute("data-status")).toBe(status);
      expect(cell?.textContent).toContain(status);
    }
    expect(view.container.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });
});

async function projectSource(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), "utf8");
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringLeaves);
}

function hasLocalCopy(source: string, text: string): boolean {
  return [`"${text}"`, `'${text}'`, `\`${text}\``, `>${text}<`, `>${text}:`]
    .some((candidate) => source.includes(candidate));
}
