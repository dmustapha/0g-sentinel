import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverProofLocks } from "./prooflock-client";

const bytes32 = (byte: string) => `0x${byte.repeat(64)}`;
const address = (byte: string) => `0x${byte.repeat(40)}`;

afterEach(() => vi.unstubAllGlobals());

describe("ProofLock discovery client contract", () => {
  it("accepts a self-consistent finalized discovery response", async () => {
    respond(validResponse());
    await expect(discoverProofLocks()).resolves.toMatchObject({ complete: false, returned: 1, toBlock: 116 });
  });

  it.each([
    ["zero identity", (body: DiscoveryBody) => { body.identities[0]!.identityKey = bytes32("0"); }],
    ["zero source transaction", (body: DiscoveryBody) => { body.identities[0]!.transactionHash = bytes32("0"); }],
    ["row below range", (body: DiscoveryBody) => { body.identities[0]!.blockNumber = 106; }],
    ["row above range", (body: DiscoveryBody) => { body.identities[0]!.blockNumber = 117; }],
    ["duplicate identity", (body: DiscoveryBody) => { body.identities.push({ ...body.identities[0]! }); body.returned = 2; }],
    ["returned mismatch", (body: DiscoveryBody) => { body.returned = 0; }],
    ["cap mismatch", (body: DiscoveryBody) => { body.cap = 0; }],
    ["invalid range", (body: DiscoveryBody) => { body.fromBlock = 117; }],
    ["invalid finality equation", (body: DiscoveryBody) => { body.toBlock = 115; }],
  ] as const)("rejects hostile cross-field metadata: %s", async (_name, mutate) => {
    const body = validResponse();
    mutate(body);
    respond(body);
    await expect(discoverProofLocks()).rejects.toThrow();
  });

  it.each([
    ["identity binding", (body: DiscoveryBody) => { verified(body).proofLock.identityKey = bytes32("9"); }],
    ["zero proof identifier", (body: DiscoveryBody) => { verified(body).proofId = bytes32("0"); }],
  ] as const)("rejects a malformed verified row: %s", async (_name, mutate) => {
    const body = verifiedResponse();
    mutate(body);
    respond(body);
    await expect(discoverProofLocks()).rejects.toThrow();
  });
});

type DiscoveryRow = Record<string, any>;
type DiscoveryBody = ReturnType<typeof validResponse>;

function validResponse() {
  return { identities: [{ status: "ENRICHMENT_UNAVAILABLE", identityKey: bytes32("1"),
    transactionHash: bytes32("2"), blockNumber: 115, code: "DEPENDENCY_UNAVAILABLE" }] as DiscoveryRow[],
    latestBlock: 120, fromBlock: 107, toBlock: 116, confirmations: 5,
    observedAt: "2026-08-29T12:00:00.000Z", cap: 100, returned: 1, complete: false as const };
}

function verifiedResponse(): DiscoveryBody {
  const body = validResponse();
  const identityKey = bytes32("1");
  const subject = address("2");
  body.identities = [{ status: "VERIFIED", identityKey, proofId: bytes32("e"), transactionHash: bytes32("2"),
    blockNumber: 115, proofLock: { identityKey, subject, envelopeDigest: bytes32("3"), storageRoot: bytes32("4"),
      computeRoot: bytes32("5"), artifactHash: bytes32("6"), runtimeCodeHash: bytes32("7"), version: "1",
      issuedAt: "100", validUntil: "1000", policyVersion: 1, behavioralScore: 10, codeRisk: 0, coverage: 127,
      state: 1, stateReason: 0 }, detail: { status: "VERIFIED", identity: { identityKey, namespace: "eip155",
      chainId: 16661, registryAddress: address("8"), agentId: "7", owner: address("9"), agentWallet: subject,
      registrationUri: "https://agent.test", registrationDigest: bytes32("a"), sourceBlockNumber: "116",
      sourceBlockHash: bytes32("b") }, resolution: { owner: address("9"), agentWallet: subject,
      agentURI: "https://agent.test", registrationDigest: bytes32("a"), sourceBlockNumber: "116",
      sourceBlockHash: bytes32("b") }, gate: { status: "VERIFIED", allowed: true, reason: 0, subject, version: "1" },
      consumer: { status: "VERIFIED", accepted: true, address: address("c"), subject, version: "1" } } }];
  return body;
}

function verified(body: DiscoveryBody): DiscoveryRow { return body.identities[0]!; }

function respond(body: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  })));
}
