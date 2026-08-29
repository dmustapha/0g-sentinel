import { describe, expect, it, vi } from "vitest";

import { createEthersRegistryChainAdapter, REGISTRY_V2_INTERFACE, writeProofLock,
  type ChainWriteRequest, type RegistryChainAdapter } from
  "../../server/prooflock/chain";
import type { Bytes32, HexAddress } from "../../server/prooflock/types";

const REGISTRY = "0x1000000000000000000000000000000000000001" as HexAddress;
const SCANNER = "0x2000000000000000000000000000000000000002" as HexAddress;
const OTHER = "0x3000000000000000000000000000000000000003" as HexAddress;
const SUBJECT = "0x4000000000000000000000000000000000000004" as HexAddress;
const HASH = `0x${"11".repeat(32)}` as Bytes32;
const TX = `0x${"22".repeat(32)}` as Bytes32;
const ZERO = `0x${"00".repeat(32)}` as Bytes32;

function request(): ChainWriteRequest {
  return {
    registryAddress: REGISTRY, mode: "SEAL", scanner: SCANNER,
    identityKey: HASH, subject: SUBJECT, envelopeDigest: HASH, storageRoot: HASH,
    computeRoot: HASH, artifactHash: HASH, runtimeCodeHash: ZERO,
    validForSeconds: 604800, policyVersion: 1, behavioralScore: 10,
    codeRisk: 0, coverage: 0x7f,
  };
}

function adapter(from: HexAddress, recoveredFrom = from): RegistryChainAdapter {
  let submittedData = "0x";
  return {
    registryAddress: REGISTRY,
    getChainId: vi.fn(async () => 16661n),
    getCode: vi.fn(async (address) => address === REGISTRY ? "0x6001" : "0x"),
    getProofLock: vi.fn(async () => ({
      identityKey: `0x${"00".repeat(32)}` as Bytes32,
      subject: "0x0000000000000000000000000000000000000000" as HexAddress,
      envelopeDigest: HASH, storageRoot: HASH, computeRoot: HASH,
      artifactHash: HASH, runtimeCodeHash: HASH, version: 0n, issuedAt: 0n,
      validUntil: 0n, policyVersion: 0, behavioralScore: 0, codeRisk: 0,
      coverage: 0, state: 0, stateReason: 0,
    })),
    sendTransaction: vi.fn(async ({ to, data }) => {
      submittedData = data;
      return { hash: TX, to, data, from };
    }),
    waitForReceipt: vi.fn(async () => ({ transactionHash: TX, status: 1,
      blockNumber: 1n, blockHash: HASH, confirmations: 3, logs: [] })),
    getTransaction: vi.fn(async () => ({ hash: TX, to: REGISTRY,
      data: submittedData, from: recoveredFrom })),
  };
}

describe("Registry scanner provenance", () => {
  it("passes the finalized discovery block through the Ethers Registry adapter", async () => {
    const raw = REGISTRY_V2_INTERFACE.encodeFunctionResult("getProofLock", [[
      HASH, SUBJECT, HASH, HASH, HASH, HASH, ZERO, 1n, 10n, 20n, 1, 10, 0, 0x7f, 1, 0,
    ]]);
    const provider = { call: vi.fn(async () => raw) };
    const chain = createEthersRegistryChainAdapter(provider as never, {} as never, REGISTRY);

    await expect(chain.getProofLock(HASH, new AbortController().signal, 116)).resolves.toMatchObject({ version: 1n });
    expect(provider.call).toHaveBeenCalledWith(expect.objectContaining({ to: REGISTRY, blockTag: 116 }));
  });

  it("rejects a submitted seal before finality when tx.from is not the evidence scanner", async () => {
    const chain = adapter(OTHER);
    await expect(writeProofLock(chain, request(), { confirmations: 3, timeoutMs: 30_000 }))
      .rejects.toMatchObject({ code: "TRANSACTION_MISMATCH" });
    expect(chain.waitForReceipt).not.toHaveBeenCalled();
  });

  it("requires finalized transaction recovery to preserve the same scanner sender", async () => {
    const chain = adapter(SCANNER, OTHER);
    await expect(writeProofLock(chain, request(), { confirmations: 3, timeoutMs: 30_000 }))
      .rejects.toMatchObject({ code: "TRANSACTION_MISMATCH" });
  });
});
