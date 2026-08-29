// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { AbiCoder, keccak256 } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ query: "" }));
const client = vi.hoisted(() => ({
  resolveIdentity: vi.fn(), readProofLockDetail: vi.fn(), computeProofId: vi.fn(), verifyProof: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("../../lib/prooflock-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/prooflock-client")>(),
  ...client,
}));

import AgentDetailPage from "../../app/agents/[address]/page";
import type { CanonicalIdentity, ProofLockDetailResponse, VerifiedProof } from "../../lib/prooflock-types";

const address = `0x${"11".repeat(20)}` as const;
const proofId = h("1");
const sourceOne = h("2");
const sourceTwo = h("3");
const identity: CanonicalIdentity = { identity: { namespace: "eip155", chainId: 16661,
  registryAddress: address, agentId: "7" }, owner: address, agentWallet: address,
  agentURI: "ipfs://agent", registrationDigest: h("4"), sourceBlockNumber: "8",
  sourceBlockHash: h("5"), card: {} };
const identityKey = keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"],
  [16661, address, 7n])) as `0x${string}`;

beforeEach(() => {
  navigation.query = `sourceTxHash=${sourceOne}`;
  process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS = `0x${"77".repeat(20)}`;
  client.resolveIdentity.mockReset().mockResolvedValue(identity);
  client.readProofLockDetail.mockReset().mockResolvedValue(detail());
  client.computeProofId.mockReset().mockReturnValue(proofId);
  client.verifyProof.mockReset().mockResolvedValue(proof(sourceOne));
});
afterEach(() => cleanup());

describe("agent detail locator races", () => {
  it("hides prior detail atomically when the source hint becomes invalid", async () => {
    const view = render(<AgentDetailPage params={{ address: "7" }} />);
    expect(await screen.findByText(sourceOne)).toBeTruthy();

    navigation.query = "sourceTxHash=javascript%3Aalert(1)%E2%80%AE";
    view.rerender(<AgentDetailPage params={{ address: "7" }} />);

    expect(screen.queryByText(sourceOne)).toBeNull();
    expect(await screen.findByRole("heading", { name: "ProofLock unavailable" })).toBeTruthy();
    expect(screen.queryByText(/javascript|alert/i)).toBeNull();
  });

  it("ignores an out-of-order completion after the validated hint changes", async () => {
    const first = deferred<VerifiedProof>(); const second = deferred<VerifiedProof>();
    const signals: AbortSignal[] = [];
    client.verifyProof.mockImplementation((_proofId, _identityKey, signal, sourceTxHash) => {
      signals.push(signal);
      return sourceTxHash === sourceOne ? first.promise : second.promise;
    });
    const view = render(<AgentDetailPage params={{ address: "7" }} />);
    await waitFor(() => expect(client.verifyProof).toHaveBeenCalledTimes(1));

    navigation.query = `sourceTxHash=${sourceTwo}`;
    view.rerender(<AgentDetailPage params={{ address: "7" }} />);
    expect(screen.getByText(/Resolving identity, lease, evidence, and Gate/)).toBeTruthy();
    await waitFor(() => expect(client.verifyProof).toHaveBeenCalledTimes(2));
    expect(signals[0]?.aborted).toBe(true);

    await act(() => { second.resolve(proof(sourceTwo)); return second.promise; });
    expect(await screen.findByText(sourceTwo)).toBeTruthy();
    await act(() => { first.resolve(proof(sourceOne)); return first.promise; });
    expect(screen.getByText(sourceTwo)).toBeTruthy();
    expect(screen.queryByText(sourceOne)).toBeNull();
  });

  it("hides prior agent data while a different agent locator is loading", async () => {
    const view = render(<AgentDetailPage params={{ address: "7" }} />);
    expect(await screen.findByRole("heading", { name: "Agent #7" })).toBeTruthy();
    const pending = deferred<CanonicalIdentity>();
    client.resolveIdentity.mockImplementation((agentId) => agentId === "8" ? pending.promise : identity);
    navigation.query = "";
    view.rerender(<AgentDetailPage params={{ address: "8" }} />);
    expect(screen.queryByRole("heading", { name: "Agent #7" })).toBeNull();
    expect(screen.getByText(/Resolving identity, lease, evidence, and Gate/)).toBeTruthy();
  });
});

function detail(): ProofLockDetailResponse {
  const record = { identityKey, subject: address, envelopeDigest: h("6"), storageRoot: h("7"),
    computeRoot: h("8"), artifactHash: h("9"), runtimeCodeHash: h("a"), version: "2",
    issuedAt: "1", validUntil: "9999999999", policyVersion: 1, behavioralScore: 10,
    codeRisk: 0, coverage: 127, state: 1, stateReason: 0 } as const;
  return { identityKey, proofLock: record, detail: { status: "VERIFIED", identity: { identityKey,
    namespace: "eip155", chainId: 16661, registryAddress: address, agentId: "7", owner: address,
    agentWallet: address, registrationUri: "ipfs://agent", registrationDigest: h("4"),
    sourceBlockNumber: "8", sourceBlockHash: h("5") }, resolution: { owner: address,
    agentWallet: address, agentURI: "ipfs://agent", registrationDigest: h("4"),
    sourceBlockNumber: "8", sourceBlockHash: h("5") }, gate: { status: "VERIFIED",
    allowed: true, reason: 0, subject: address, version: "2" }, consumer: { status: "VERIFIED",
    accepted: true, address, subject: address, version: "2" } } };
}

function proof(sourceTxHash: `0x${string}`): VerifiedProof {
  return { proofId, identityKey, source: { kind: "ProofLocked", registryAddress: address,
    transactionHash: sourceTxHash, blockNumber: 8, blockHash: h("b"), logIndex: 1 },
  proofLock: detail().proofLock, storage: { retrievalVerified: true, networkProofVerified: false,
    envelope: {}, storageCommitment: { uploadTxHash: h("c") } } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function h(byte: string): `0x${string}` { return `0x${byte.repeat(64)}`; }
