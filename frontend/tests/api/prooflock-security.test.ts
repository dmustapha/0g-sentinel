import { Interface } from "ethers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REGISTRY_V2_INTERFACE, computeProofLockId, type RegistryProofLockRecord } from "../../server/prooflock/chain";
import { ProofMismatchError } from "../../server/prooflock/errors";
import { checkAgentGate, createHistoricalProofLocator, type HistoricalProofProvider } from "../../server/prooflock/read-api";
import { ERC8004_IDENTITY_REGISTRY, type Bytes32 } from "../../server/prooflock/types";

const hex = (byte: string, size: number): `0x${string}` => `0x${byte.repeat(size)}`;
const REGISTRY = hex("12", 20);
const GATE_ADDRESS = hex("13", 20);
const TX = hex("93", 32);
const BLOCK_HASH = hex("94", 32);
const GATE = new Interface([
  "function registry() view returns (address)", "function identityRegistry() view returns (address)",
  "function checkAgent(uint256) view returns (bool,uint8,address,uint64)",
]);

afterEach(() => vi.unstubAllGlobals());

function chainFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "sentinel-chain-id", result: "0x4115" })));
}

describe("production Gate binding", () => {
  it("rejects missing Gate bytecode before any Gate call", async () => {
    const provider = { getCode: vi.fn(async () => "0x"), call: vi.fn() };
    await expect(checkAgentGate("https://rpc.example", provider as never, GATE_ADDRESS, REGISTRY,
      "7", new AbortController().signal, chainFetch())).rejects.toThrow("unavailable");
    expect(provider.call).not.toHaveBeenCalled();
  });

  it("rejects wrong RegistryV2 or ERC-8004 pointers before checkAgent", async () => {
    const checkSelector = GATE.getFunction("checkAgent")!.selector;
    const provider = { getCode: vi.fn(async () => "0x6000"), call: vi.fn(async ({ data }) => {
      if (data === GATE.encodeFunctionData("registry")) return GATE.encodeFunctionResult("registry", [hex("99", 20)]);
      if (data === GATE.encodeFunctionData("identityRegistry")) {
        return GATE.encodeFunctionResult("identityRegistry", [ERC8004_IDENTITY_REGISTRY]);
      }
      throw new Error("checkAgent must not run");
    }) };
    await expect(checkAgentGate("https://rpc.example", provider as never, GATE_ADDRESS, REGISTRY,
      "7", new AbortController().signal, chainFetch())).rejects.toThrow("pointer");
    expect(provider.call.mock.calls.some(([request]) => String(request.data).startsWith(checkSelector))).toBe(false);
  });
});

function record(): RegistryProofLockRecord {
  return { identityKey: hex("11", 32), subject: hex("bb", 20), envelopeDigest: hex("33", 32),
    storageRoot: hex("44", 32), computeRoot: hex("55", 32), artifactHash: hex("66", 32),
    runtimeCodeHash: hex("00", 32), version: 1n, issuedAt: 10n, validUntil: 20n,
    policyVersion: 1, behavioralScore: 10, codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0 };
}

function proofLog(blockNumber = 50_000) {
  const value = record();
  const encoded = REGISTRY_V2_INTERFACE.encodeEventLog(REGISTRY_V2_INTERFACE.getEvent("ProofLocked")!, [
    value.identityKey, value.subject, value.version, value.issuedAt, value.validUntil, value.envelopeDigest,
    value.storageRoot, value.computeRoot, value.artifactHash, value.runtimeCodeHash, value.policyVersion,
    value.behavioralScore, value.codeRisk, value.coverage,
  ]);
  return { address: REGISTRY, topics: encoded.topics, data: encoded.data, transactionHash: TX,
    blockNumber, blockHash: BLOCK_HASH, index: 4, removed: false };
}

function historicalProvider(log = proofLog()): HistoricalProofProvider & { getLogs: ReturnType<typeof vi.fn> } {
  const receipt = { status: 1, to: REGISTRY, hash: TX, blockNumber: log.blockNumber,
    blockHash: BLOCK_HASH, logs: [log] };
  return { getBlockNumber: vi.fn(async () => 200_000), getLogs: vi.fn(async () => []),
    getTransactionReceipt: vi.fn(async () => receipt as never),
    getBlock: vi.fn(async () => ({ number: log.blockNumber, hash: BLOCK_HASH }) as never) };
}

function locator(provider: HistoricalProofProvider, overrides = {}) {
  return createHistoricalProofLocator(provider, REGISTRY, { fromBlock: 0, confirmations: 5,
    lookbackBlocks: 120_001, chunkBlocks: 50_000, queryBudget: 3,
    negativeTtlMs: 10_000, negativeMaxEntries: 8, ...overrides });
}

describe("bounded finalized historical locator", () => {
  it("locates a proof over 100,000 blocks old in O(1) with a transaction hint", async () => {
    const provider = historicalProvider();
    const result = await locator(provider).locate(record().identityKey,
      computeProofLockId(REGISTRY, record()), TX, new AbortController().signal);
    expect(provider.getLogs).not.toHaveBeenCalled();
    expect(result?.source).toEqual({ kind: "ProofLocked", registryAddress: REGISTRY,
      transactionHash: TX, blockNumber: 50_000, blockHash: BLOCK_HASH, logIndex: 4 });
  });

  it("finds a 100,000-block-old proof within the fixed indexed fallback budget", async () => {
    const log = proofLog(100_000);
    const base = historicalProvider(log);
    const provider = { ...base, getLogs: vi.fn(async ({ fromBlock, toBlock }) =>
      fromBlock <= log.blockNumber && toBlock >= log.blockNumber ? [log] : []) };
    const result = await locator(provider).locate(record().identityKey,
      computeProofLockId(REGISTRY, record()), undefined, new AbortController().signal);
    expect(result?.source.blockNumber).toBe(100_000);
    expect(provider.getLogs.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("caps identity-indexed fallback queries and negative-caches misses", async () => {
    const provider = historicalProvider();
    const proofLocator = locator(provider);
    await expect(proofLocator.locate(record().identityKey, hex("99", 32), undefined,
      new AbortController().signal)).rejects.toMatchObject({ name: "ProofLocatorHintRequiredError" });
    const calls = provider.getLogs.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(3);
    await expect(proofLocator.locate(record().identityKey, hex("99", 32), undefined,
      new AbortController().signal)).rejects.toMatchObject({ name: "ProofLocatorHintRequiredError" });
    expect(provider.getLogs).toHaveBeenCalledTimes(calls);
  });

  it("rejects a hinted receipt not sent to the configured registry", async () => {
    const provider = { ...historicalProvider(), getTransactionReceipt: vi.fn(async () => ({
      status: 1, to: hex("99", 20), hash: TX, blockNumber: 50_000, blockHash: BLOCK_HASH,
      logs: [proofLog()] }) as never) };
    await expect(locator(provider).locate(record().identityKey, computeProofLockId(REGISTRY, record()), TX,
      new AbortController().signal)).rejects.toBeInstanceOf(ProofMismatchError);
  });

  it("rejects a receipt whose transaction identity conflicts with the hinted event", async () => {
    const provider = { ...historicalProvider(), getTransactionReceipt: vi.fn(async () => ({
      status: 1, to: REGISTRY, hash: hex("98", 32), blockNumber: 50_000,
      blockHash: BLOCK_HASH, logs: [proofLog()] }) as never) };
    await expect(locator(provider).locate(record().identityKey, computeProofLockId(REGISTRY, record()), TX,
      new AbortController().signal)).rejects.toBeInstanceOf(ProofMismatchError);
  });

  it("does not accept an otherwise valid proof before its finalized head", async () => {
    const provider = { ...historicalProvider(), getBlockNumber: vi.fn(async () => 50_003) };
    await expect(locator(provider).locate(record().identityKey, computeProofLockId(REGISTRY, record()), TX,
      new AbortController().signal)).rejects.toThrow("not finalized");
  });
});
