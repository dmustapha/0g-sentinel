// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/operator" }));
const client = vi.hoisted(() => ({
  resolveIdentity: vi.fn(), readProofLockDetail: vi.fn(), runProofLock: vi.fn(),
  recoverProofLock: vi.fn(), markOnDemandDrift: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("../../lib/prooflock-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/prooflock-client")>(), ...client,
}));

import OperatorPage from "../../app/operator/page";
import { NavLinks } from "../../components/NavLinks";
import { OperatorWorkbench } from "../../components/OperatorWorkbench";
import { ProofLockApiError } from "../../lib/prooflock-client";
import type { CanonicalIdentity, ProofLockDetailResponse, ProofLockRecord } from "../../lib/prooflock-types";

const ADDRESS = `0x${"11".repeat(20)}` as const;
const KEY = `0x${"22".repeat(32)}` as const;
const identity: CanonicalIdentity = { identity: { namespace: "eip155", chainId: 16661,
  registryAddress: ADDRESS, agentId: "7" }, owner: ADDRESS, agentWallet: ADDRESS,
  agentURI: "ipfs://agent", registrationDigest: KEY, sourceBlockNumber: "1", sourceBlockHash: KEY, card: {} };
const record: ProofLockRecord = { identityKey: KEY, subject: ADDRESS, envelopeDigest: KEY, storageRoot: KEY,
  computeRoot: KEY, artifactHash: KEY, runtimeCodeHash: KEY, version: "1", issuedAt: "1", validUntil: "2",
  policyVersion: 1, behavioralScore: 1, codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0 };

beforeEach(() => {
  process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS = ADDRESS;
  for (const mock of Object.values(client)) mock.mockReset();
  client.resolveIdentity.mockResolvedValue(identity);
});
afterEach(() => cleanup());

describe("public and operator route separation", () => {
  it("keeps public landing and detail routes free of mutation components", async () => {
    const [landing, detail] = await Promise.all([
      source("app/page.tsx"), source("app/agents/[address]/page.tsx"),
    ]);
    expect(landing).not.toMatch(/ScanInput|RescanButton|OperatorWorkbench|type=["']password/);
    expect(detail).not.toMatch(/<RescanButton|type=["']password/);
    expect(detail).toContain("/operator?agentId=");
  });

  it("preloads only a canonical public Agent ID from the operator query", () => {
    const html = renderPage({ agentId: "7", token: "operator-secret" });
    expect(html).toContain('value="7"');
    expect(html).not.toContain("operator-secret");
    expect(renderPage({ agentId: "07", token: "operator-secret" })).not.toContain('value="07"');
  });

  it("names authority and paid-work boundaries before the token field", async () => {
    client.readProofLockDetail.mockRejectedValueOnce(notFound());
    const view = render(<OperatorWorkbench initialAgentId="7" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Resolve identity" }));
    await screen.findByLabelText("One-time operator token");
    const text = view.container.textContent ?? "";
    expect(text.indexOf("Named operator authority")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Paid 0G Compute and Storage work")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Named operator authority")).toBeLessThan(text.indexOf("One-time operator token"));
  });

  it("supports first seal and existing-record drift, reseal, and recovery from one workbench", async () => {
    client.readProofLockDetail.mockRejectedValueOnce(notFound());
    const first = render(<OperatorWorkbench initialAgentId="7" />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Resolve identity" }));
    expect(await screen.findByRole("button", { name: "Run verified evaluation" })).toBeTruthy();
    first.unmount();

    client.readProofLockDetail.mockResolvedValue(detailResponse());
    render(<OperatorWorkbench initialAgentId="7" />);
    await user.click(screen.getByRole("button", { name: "Resolve identity" }));
    expect(await screen.findByRole("button", { name: "Run on-demand drift" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reseal new version" })).toBeTruthy();
    expect(screen.getByText(/Recovery is commitment-bound/)).toBeTruthy();
  });

  it("aborts paid work and clears its secret when operator navigation changes identity", async () => {
    client.readProofLockDetail.mockRejectedValueOnce(notFound());
    let signal: AbortSignal | undefined;
    client.runProofLock.mockImplementation((...args: unknown[]) => {
      signal = args[3] as AbortSignal;
      return new Promise((_resolve, reject) => signal?.addEventListener("abort",
        () => reject(new DOMException("canceled", "AbortError")), { once: true }));
    });
    const view = render(<OperatorWorkbench initialAgentId="7" />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Resolve identity" }));
    await user.type(await screen.findByLabelText("One-time operator token"), "operator-secret");
    await user.click(screen.getByRole("button", { name: "Run verified evaluation" }));
    expect(signal?.aborted).toBe(false);
    view.rerender(<OperatorWorkbench initialAgentId="8" />);
    expect(signal?.aborted).toBe(true);
    expect((screen.getByLabelText("ERC-8004 Agent ID") as HTMLInputElement).value).toBe("8");
    expect(view.container.textContent).not.toContain("operator-secret");
  });

  it("marks and announces the current primary route", () => {
    navigation.pathname = "/operator";
    render(<NavLinks />);
    expect(screen.getByRole("link", { name: "Operator" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe("Primary, current page: Operator");
  });

  it("does not announce Overview for an unknown route", () => {
    navigation.pathname = "/missing";
    render(<NavLinks />);
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe("Primary");
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it.each(["/agents-old", "/proofread", "/operatorial"])(
    "does not activate a navigation section for near-prefix route %s", (pathname) => {
      navigation.pathname = pathname;
      render(<NavLinks />);
      expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe("Primary");
      expect(screen.queryByRole("link", { current: "page" })).toBeNull();
    },
  );
});

function renderPage(searchParams: Record<string, string>): string {
  const view = render(OperatorPage({ searchParams }));
  const html = view.container.innerHTML; view.unmount(); return html;
}

async function source(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), "utf8");
}

function notFound() {
  return new ProofLockApiError({ code: "NOT_FOUND", message: "missing",
    stage: "READING_PROOF", retryable: false, requestId: "test" }, 404);
}

function detailResponse(): ProofLockDetailResponse {
  return { identityKey: KEY, proofLock: record, detail: { status: "VERIFIED", identity: {
    identityKey: KEY, namespace: "eip155", chainId: 16661, registryAddress: ADDRESS, agentId: "7",
    owner: ADDRESS, agentWallet: ADDRESS, registrationUri: "ipfs://agent", registrationDigest: KEY,
    sourceBlockNumber: "1", sourceBlockHash: KEY }, resolution: { owner: ADDRESS, agentWallet: ADDRESS,
    agentURI: "ipfs://agent", registrationDigest: KEY, sourceBlockNumber: "1", sourceBlockHash: KEY },
  gate: { status: "VERIFIED", allowed: true, reason: 0, subject: ADDRESS, version: "1" },
  consumer: { status: "VERIFIED", accepted: true, address: ADDRESS, subject: ADDRESS, version: "1" } } };
}
