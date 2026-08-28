import type { Filter, Log, TransactionReceipt, TransactionResponse } from "ethers";

import { verifyStorageArtifactBinding } from "./offline-verifier";
import type { RegistryProofLockRecord } from "./chain";
import type { Bytes32, HexAddress, StorageCommitment } from "./types";

const CHUNK = 2_000;

export type StorageRecoveryProvider = Readonly<{
  getBlockNumber(): Promise<number>;
  getLogs(filter: Filter): Promise<Log[]>;
  getTransactionReceipt(hash: string): Promise<TransactionReceipt | null>;
  getTransaction(hash: string): Promise<TransactionResponse | null>;
}>;

export async function recoverStorageCommitment(
  provider: StorageRecoveryProvider,
  flowAddress: HexAddress,
  fromBlock: number,
  confirmations: number,
  record: RegistryProofLockRecord,
  signal: AbortSignal,
): Promise<StorageCommitment> {
  const { FixedPriceFlow__factory } = await import("@0gfoundation/0g-storage-ts-sdk");
  const contract = FixedPriceFlow__factory.createInterface();
  const topic = contract.getEvent("Submit")!.topicHash;
  const latest = await provider.getBlockNumber();
  for (let end = latest; end >= fromBlock; end -= CHUNK) {
    signal.throwIfAborted();
    const start = Math.max(fromBlock, end - CHUNK + 1);
    const logs = await provider.getLogs({ address: flowAddress, topics: [topic], fromBlock: start, toBlock: end });
    for (const log of logs.reverse()) {
      const parsed = contract.parseLog(log);
      if (!parsed || !containsRoot(parsed.args.submission, record.storageRoot)) continue;
      const receipt = await provider.getTransactionReceipt(log.transactionHash);
      const transaction = await provider.getTransaction(log.transactionHash);
      if (!receipt || receipt.status !== 1 || !transaction?.to
        || transaction.to.toLowerCase() !== flowAddress.toLowerCase()) continue;
      const call = contract.parseTransaction({ data: transaction.data, value: transaction.value });
      if (!call || call.name !== "submit" || !containsRoot(call.args[0], record.storageRoot)) continue;
      const commitment = makeRecoveredCommitment(record, log.transactionHash as Bytes32,
        BigInt(receipt.blockNumber), confirmations);
      if (BigInt(latest) < BigInt(commitment.finalizedAtBlock)) continue;
      try { verifyStorageArtifactBinding(record.artifactHash, commitment); return commitment; }
      catch { /* Another submission may have used the same root. */ }
    }
  }
  throw new Error("Canonical Storage commitment could not be recovered");
}

function containsRoot(submission: unknown, expected: string): boolean {
  if (!submission || typeof submission !== "object") return false;
  const value = submission as { data?: unknown; nodes?: readonly { root?: unknown }[] };
  if (value.data) return containsRoot(value.data, expected);
  return Boolean(value.nodes?.some((node) => String(node.root).toLowerCase() === expected.toLowerCase()));
}

function makeRecoveredCommitment(
  record: RegistryProofLockRecord,
  uploadTxHash: Bytes32,
  inclusionBlock: bigint,
  confirmations: number,
): StorageCommitment {
  return Object.freeze({
    envelopeDigest: record.envelopeDigest, storageRoot: record.storageRoot, uploadTxHash,
    retrievedDigest: record.envelopeDigest,
    finalizedAtBlock: (inclusionBlock + BigInt(confirmations) - 1n).toString(),
    retrievalVerified: true, networkProofVerified: false,
  });
}
