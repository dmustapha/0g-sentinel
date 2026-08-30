import { describe, expect, it, vi } from "vitest";

import {
  createDiscoveryHandler,
  type DiscoveryDependencies,
  type DiscoveryLog,
} from "../../server/prooflock/discovery";
import type { ProofLockDetail } from "../../server/prooflock/api";
import { REGISTRY_V2_INTERFACE, type RegistryProofLockRecord } from "../../server/prooflock/chain";

const bytes32 = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const address = (byte: string) => `0x${byte.repeat(40)}` as `0x${string}`;
const REGISTRY = address("a");

describe("bounded ProofLock discovery", () => {
  it("discloses its finalized range and cap while keeping the newest source transaction per identity", async () => {
    const first = log("1", "2", 110, 1);
    const newest = log("1", "3", 115, 0);
    const second = log("4", "5", 114, 2);
    const deps = dependencies({ logs: [first, second, newest], latestBlock: 120 });
    const response = await createDiscoveryHandler(deps, options({ window: 10, cap: 1 }))(
      new Request("https://sentinel.test/api/discover?locator=registry-v1"),
    );

    expect(response.status).toBe(200);
    expect(deps.getLogs).toHaveBeenCalledWith({
      address: REGISTRY,
      topics: [expect.any(String)],
      fromBlock: 107,
      toBlock: 116,
    }, expect.any(AbortSignal));
    expect(await response.json()).toMatchObject({
      latestBlock: 120,
      fromBlock: 107,
      toBlock: 116,
      confirmations: 5,
      observedAt: "2026-08-29T12:00:00.000Z",
      cap: 1,
      returned: 1,
      complete: false,
      identities: [{ status: "VERIFIED", identityKey: newest.topics[1],
        transactionHash: newest.transactionHash, blockNumber: 115, registryAddress: REGISTRY,
        locator: { identityKey: newest.topics[1], registryAddress: REGISTRY,
          transactionHash: newest.transactionHash, blockNumber: 115, proofId: expect.any(String) } }],
    });
  });

  it("rejects removed events instead of presenting provisional history", async () => {
    const deps = dependencies({ logs: [{ ...log("1", "2", 115, 0), removed: true }] });
    const response = await createDiscoveryHandler(deps, options())(
      new Request("https://sentinel.test/api/discover"),
    );
    expect(response.status).toBe(503);
    expect(deps.readProofLock).not.toHaveBeenCalled();
  });

  it("rejects a finalized-boundary reorganization", async () => {
    const deps = dependencies({ logs: [log("1", "2", 115, 0)],
      boundaryHashes: [bytes32("9"), bytes32("9"), bytes32("8")] });
    const response = await createDiscoveryHandler(deps, options())(
      new Request("https://sentinel.test/api/discover"),
    );
    expect(response.status).toBe(503);
    expect(deps.readProofLock).toHaveBeenCalledOnce();
  });

  it.each([
    ["truncated data", (value: DiscoveryLog) => ({ ...value, data: value.data.slice(0, -2) })],
    ["trailing data", (value: DiscoveryLog) => ({ ...value, data: `${value.data}00` })],
    ["extra topic", (value: DiscoveryLog) => ({ ...value, topics: [...value.topics, bytes32("f")] })],
    ["missing indexed topic", (value: DiscoveryLog) => ({ ...value, topics: value.topics.slice(0, 3) })],
    ["zero identity", () => log("0", "2", 115, 0)],
    ["zero transaction hash", (value: DiscoveryLog) => ({ ...value, transactionHash: bytes32("0") })],
    ["zero block hash", (value: DiscoveryLog) => ({ ...value, blockHash: bytes32("0") })],
    ["zero subject", () => log("1", "2", 115, 0, { subject: address("0") })],
    ["zero version", () => log("1", "2", 115, 0, { version: 0n })],
    ["zero envelope commitment", () => log("1", "2", 115, 0, { envelopeDigest: bytes32("0") })],
    ["zero Storage commitment", () => log("1", "2", 115, 0, { storageRoot: bytes32("0") })],
    ["zero Compute commitment", () => log("1", "2", 115, 0, { computeRoot: bytes32("0") })],
    ["zero artifact commitment", () => log("1", "2", 115, 0, { artifactHash: bytes32("0") })],
    ["invalid lifetime", () => log("1", "2", 115, 0, { issuedAt: 10n, validUntil: 10n })],
    ["oversized lifetime", () => log("1", "2", 115, 0, { issuedAt: 1n, validUntil: 2_592_002n })],
    ["impossible behavioral score", () => log("1", "2", 115, 0, { behavioralScore: 101 })],
    ["impossible code risk", () => log("1", "2", 115, 0, { codeRisk: 3 })],
    ["incomplete coverage", () => log("1", "2", 115, 0, { coverage: 0x3f })],
  ] as const)("rejects malformed or impossible ProofLocked logs: %s", async (_name, mutate) => {
    const candidate = log("1", "2", 115, 0);
    const deps = dependencies({ logs: [mutate(candidate)] });
    const response = await createDiscoveryHandler(deps, options())(
      new Request("https://sentinel.test/api/discover"),
    );
    expect(response.status).toBe(503);
  });

  it("uses the finalized event record and pins detail reads when an unfinalized reseal races discovery", async () => {
    const finalized = log("1", "2", 115, 0, { version: 1n });
    const latest = record(finalized.topics[1]!, { version: 2n });
    const readProofLockDetail = vi.fn(async (value: RegistryProofLockRecord, blockNumber: number) => {
      if (blockNumber !== 116 || value.version !== 1n) return detail(value.identityKey, 0, "2");
      return detail(value.identityKey, 11, "1");
    });
    const deps = dependencies({ logs: [finalized], readProofLock: vi.fn(async (_identityKey, blockNumber) =>
      blockNumber === 116 ? record(finalized.topics[1]!, { version: 1n }) : latest), readProofLockDetail });
    const response = await createDiscoveryHandler(deps, options())(
      new Request("https://sentinel.test/api/discover"),
    );
    const body = await response.json();

    expect(body.identities[0]).toMatchObject({ proofLock: { version: "1" },
      detail: { gate: { status: "VERIFIED", allowed: false, reason: 11, version: "1" } } });
    expect(deps.readProofLock).toHaveBeenCalledWith(finalized.topics[1], 116, expect.any(AbortSignal));
    expect(readProofLockDetail).toHaveBeenCalledWith(expect.objectContaining({ version: 1n }), 116, expect.any(AbortSignal));
  });

  it("never verifies an impossible pinned Registry state", async () => {
    const source = log("1", "2", 115, 0);
    const deps = dependencies({ logs: [source], readProofLock: vi.fn(async () =>
      record(source.topics[1]!, { state: 255, stateReason: 0 })) });
    const response = await createDiscoveryHandler(deps, options())(
      new Request("https://sentinel.test/api/discover"),
    );
    expect((await response.json()).identities[0]).toMatchObject({ status: "ENRICHMENT_UNAVAILABLE" });
  });

  it("preserves successful rows and emits a minimal unavailable row for failed enrichment", async () => {
    const good = log("1", "2", 115, 0);
    const failed = log("3", "4", 114, 0);
    const deps = dependencies({ logs: [good, failed], readFailure: failed.topics[1] });
    const response = await createDiscoveryHandler(deps, options())(
      new Request("https://sentinel.test/api/discover"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.returned).toBe(2);
    expect(body.identities[0]).toMatchObject({ status: "VERIFIED", identityKey: good.topics[1],
      proofLock: { identityKey: good.topics[1] }, detail: { status: "VERIFIED" } });
    expect(body.identities[1]).toEqual({ status: "ENRICHMENT_UNAVAILABLE", identityKey: failed.topics[1],
      transactionHash: failed.transactionHash, blockNumber: failed.blockNumber,
      code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("returns truthful unavailable rows when every enrichment fails", async () => {
    const logs = [log("1", "2", 115, 0), log("3", "4", 114, 0)];
    const deps = dependencies({ logs, failAll: true });
    const response = await createDiscoveryHandler(deps, options())(
      new Request("https://sentinel.test/api/discover"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.identities).toHaveLength(2);
    expect(body.identities.every((row: { status: string }) => row.status === "ENRICHMENT_UNAVAILABLE")).toBe(true);
  });

  it("stops admitting new worker jobs after the request aborts", async () => {
    const logs = [log("1", "2", 115, 0), log("3", "4", 114, 0)];
    const controller = new AbortController();
    const started: string[] = [];
    const deps = dependencies({ logs, readProofLock: vi.fn(async (identityKey, _blockNumber, signal) => {
      started.push(identityKey);
      controller.abort();
      signal.throwIfAborted();
      return record(identityKey);
    }) });
    const response = await createDiscoveryHandler(deps, options({ concurrency: 1 }))(
      new Request("https://sentinel.test/api/discover", { signal: controller.signal }),
    );

    expect(response.status).toBe(503);
    expect(started).toHaveLength(1);
  });

  it("never exceeds the configured number of active enrichment reads", async () => {
    const logs = Array.from({ length: 9 }, (_, index) => log(String(index + 1), "f", 115 - index, index));
    let active = 0;
    let maximum = 0;
    const deps = dependencies({ logs, readProofLock: vi.fn(async (identityKey) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return record(identityKey);
    }) });
    const response = await createDiscoveryHandler(deps, options({ concurrency: 3 }))(
      new Request("https://sentinel.test/api/discover"),
    );

    expect(response.status).toBe(200);
    expect(maximum).toBe(3);
    expect(deps.readProofLock).toHaveBeenCalledTimes(9);
  });
});

function options(overrides: Partial<{ window: number; cap: number; confirmations: number; concurrency: number }> = {}) {
  return { registryAddress: REGISTRY, window: 20, cap: 100, confirmations: 5, concurrency: 4, ...overrides };
}

function log(identityByte: string, transactionByte: string, blockNumber: number, index: number,
  overrides: Partial<RegistryProofLockRecord> = {}): DiscoveryLog {
  const value = record(bytes32(identityByte), overrides);
  const encoded = REGISTRY_V2_INTERFACE.encodeEventLog(REGISTRY_V2_INTERFACE.getEvent("ProofLocked")!, [
    value.identityKey, value.subject, value.version, value.issuedAt, value.validUntil, value.envelopeDigest,
    value.storageRoot, value.computeRoot, value.artifactHash, value.runtimeCodeHash, value.policyVersion,
    value.behavioralScore, value.codeRisk, value.coverage,
  ]);
  return { address: REGISTRY, topics: encoded.topics, data: encoded.data,
    transactionHash: bytes32(transactionByte), blockNumber, blockHash: bytes32("b"), index, removed: false };
}

function dependencies(overrides: Readonly<{
  logs?: readonly DiscoveryLog[];
  latestBlock?: number;
  boundaryHashes?: readonly string[];
  readFailure?: string;
  failAll?: boolean;
  readProofLock?: DiscoveryDependencies["readProofLock"];
  readProofLockDetail?: DiscoveryDependencies["readProofLockDetail"];
}> = {}): DiscoveryDependencies {
  let boundaryRead = 0;
  const hashes = overrides.boundaryHashes ?? [bytes32("9"), bytes32("9")];
  const readProofLock = overrides.readProofLock ?? vi.fn(async (identityKey: string, _blockNumber: number, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (overrides.failAll || identityKey === overrides.readFailure) throw new Error("private provider failure");
    return record(identityKey);
  });
  return {
    assertChain: vi.fn(async (signal: AbortSignal) => signal.throwIfAborted()),
    getLatestBlock: vi.fn(async () => overrides.latestBlock ?? 120),
    getBlock: vi.fn(async (blockNumber: number) => ({ number: blockNumber, hash: hashes[boundaryRead++] ?? hashes.at(-1)! })),
    getLogs: vi.fn(async () => overrides.logs ?? []),
    readProofLock,
    readProofLockDetail: overrides.readProofLockDetail ?? vi.fn(async (value: RegistryProofLockRecord) => detail(value.identityKey)),
    now: () => new Date("2026-08-29T12:00:00.000Z"),
  };
}

function record(identityKey: string, overrides: Partial<RegistryProofLockRecord> = {}): RegistryProofLockRecord {
  return { identityKey: identityKey as `0x${string}`, subject: address("2"), envelopeDigest: bytes32("3"),
    storageRoot: bytes32("4"), computeRoot: bytes32("5"), artifactHash: bytes32("6"), runtimeCodeHash: bytes32("7"),
    version: 2n, issuedAt: 1n, validUntil: 2_000_000n, policyVersion: 1,
    behavioralScore: 10, codeRisk: 0, coverage: 127, state: 1, stateReason: 0, ...overrides };
}

function detail(identityKey: string, gateReason = 0, version = "2"): ProofLockDetail {
  return { status: "VERIFIED", identity: { identityKey: identityKey as `0x${string}`, namespace: "eip155", chainId: 16661,
    registryAddress: REGISTRY, agentId: "7", owner: address("8"), agentWallet: address("9"), registrationUri: "https://agent.test",
    registrationDigest: bytes32("c"), sourceBlockNumber: "100", sourceBlockHash: bytes32("d") },
    resolution: { owner: address("8"), agentWallet: address("9"), agentURI: "https://agent.test",
      registrationDigest: bytes32("c"), sourceBlockNumber: "100", sourceBlockHash: bytes32("d") },
    gate: { status: "VERIFIED", allowed: gateReason === 0, reason: gateReason, subject: address("9"), version },
    consumer: { status: "VERIFIED", accepted: gateReason === 0, address: address("e"), subject: address("9"), version } };
}
