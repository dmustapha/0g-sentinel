import { FixedPriceFlow__factory } from "@0gfoundation/0g-storage-ts-sdk";
import { keccak256, toUtf8Bytes } from "ethers";
import { describe, expect, it, vi } from "vitest";

import { canonicalizeStorageCommitment } from "../../server/prooflock/canonical";
import type { RegistryProofLockRecord } from "../../server/prooflock/chain";
import { recoverStorageCommitment, StorageRecoveryMismatchError,
  type StorageRecoveryProvider } from "../../server/prooflock/storage-recovery";
import type { Bytes32, StorageCommitment } from "../../server/prooflock/types";

const FLOW = "0x62d4144db0f0a6fbbaeb6296c785c71b3d57c526" as const;
const SENDER = "0x4444444444444444444444444444444444444444" as const;
const ROOT = `0x${"11".repeat(32)}` as Bytes32;
const WRONG_ROOT = `0x${"12".repeat(32)}` as Bytes32;
const TX = `0x${"22".repeat(32)}` as Bytes32;
const DIGEST = `0x${"33".repeat(32)}` as Bytes32;
const iface = FixedPriceFlow__factory.createInterface();

function submission(root = ROOT) {
  return { data: { length: 7, tags: "0x", nodes: [{ root, height: 0 }] }, submitter: SENDER };
}

function commitment(): StorageCommitment {
  return { envelopeDigest: DIGEST, storageRoot: ROOT, uploadTxHash: TX,
    retrievedDigest: DIGEST, finalizedAtBlock: "102", retrievalVerified: true,
    networkProofVerified: false };
}

function record(): RegistryProofLockRecord {
  return { identityKey: DIGEST, subject: SENDER, envelopeDigest: DIGEST, storageRoot: ROOT,
    computeRoot: DIGEST, artifactHash: keccak256(toUtf8Bytes(canonicalizeStorageCommitment(commitment()))) as Bytes32,
    runtimeCodeHash: DIGEST, version: 1n, issuedAt: 1n, validUntil: 2n, policyVersion: 1,
    behavioralScore: 1, codeRisk: 1, coverage: 0x7f, state: 1, stateReason: 0 };
}

function provider(calldataRoot = ROOT): StorageRecoveryProvider {
  const encoded = iface.encodeEventLog(iface.getEvent("Submit"), [SENDER, DIGEST, 7, 0, 7, submission().data]);
  return {
    getBlockNumber: vi.fn(async () => 105),
    getLogs: vi.fn(async () => [{ address: FLOW, topics: encoded.topics, data: encoded.data,
      transactionHash: TX, blockNumber: 100, index: 0, transactionIndex: 0, blockHash: DIGEST,
      removed: false } as never]),
    getTransactionReceipt: vi.fn(async () => ({ status: 1, blockNumber: 100 } as never)),
    getTransaction: vi.fn(async () => ({ to: FLOW, data: iface.encodeFunctionData("submit", [submission(calldataRoot)]), value: 0n } as never)),
  };
}

describe("Storage commitment recovery", () => {
  it("reconstructs the artifact-bound finalized Flow submission without claiming a network proof", async () => {
    await expect(recoverStorageCommitment(provider(), FLOW, 0, 3, record(), new AbortController().signal))
      .resolves.toEqual(commitment());
  });

  it("rejects a Submit event when the transaction calldata did not submit the stored root", async () => {
    await expect(recoverStorageCommitment(provider(WRONG_ROOT), FLOW, 0, 3, record(), new AbortController().signal))
      .rejects.toBeInstanceOf(StorageRecoveryMismatchError);
  });

  it("rejects an otherwise valid Flow transaction when its canonical commitment differs onchain", async () => {
    await expect(recoverStorageCommitment(provider(), FLOW, 0, 3,
      { ...record(), artifactHash: WRONG_ROOT }, new AbortController().signal))
      .rejects.toBeInstanceOf(StorageRecoveryMismatchError);
  });
});
