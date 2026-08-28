import type { Filter, Log, TransactionReceipt, TransactionResponse } from "ethers";

import { verifyStorageArtifactBinding } from "./offline-verifier";
import type { RegistryProofLockRecord } from "./chain";
import type { Bytes32, HexAddress, StorageCommitment } from "./types";

const CHUNK = 2_000;

export class StorageRecoveryMismatchError extends Error {
  constructor() { super("Storage candidate conflicts with the sealed proof"); this.name = "StorageRecoveryMismatchError"; }
}

export class StorageRecoveryDependencyError extends Error {
  constructor() { super("Canonical Storage commitment is unavailable"); this.name = "StorageRecoveryDependencyError"; }
}

export type StorageRecoveryProvider = Readonly<{
  getCode(address: string): Promise<string>;
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
  validateRecoveryConfig(flowAddress, fromBlock, confirmations);
  const code = await provider.getCode(flowAddress);
  if (code === "0x") throw new StorageRecoveryDependencyError();
  const { FixedPriceFlow__factory } = await import("@0gfoundation/0g-storage-ts-sdk");
  const contract = FixedPriceFlow__factory.createInterface();
  const topic = contract.getEvent("Submit")!.topicHash;
  const latest = await provider.getBlockNumber();
  let candidateFound = false;
  for (let end = latest; end >= fromBlock; end -= CHUNK) {
    signal.throwIfAborted();
    const start = Math.max(fromBlock, end - CHUNK + 1);
    const logs = await provider.getLogs({ address: flowAddress, topics: [topic], fromBlock: start, toBlock: end });
    for (const log of logs.reverse()) {
      const parsed = contract.parseLog(log);
      if (!parsed || !containsRoot(parsed.args.submission, record.storageRoot)) continue;
      candidateFound = true;
      const receipt = await provider.getTransactionReceipt(log.transactionHash);
      const transaction = await provider.getTransaction(log.transactionHash);
      if (!receipt || receipt.status !== 1 || !transaction?.to) throw new StorageRecoveryDependencyError();
      assertFlowOrigin(flowAddress, log, receipt, transaction, parsed.args[0]);
      const call = contract.parseTransaction({ data: transaction.data, value: transaction.value });
      if (!call || call.name !== "submit" || !containsRoot(call.args[0], record.storageRoot)) {
        throw new StorageRecoveryMismatchError();
      }
      const commitment = makeRecoveredCommitment(record, log.transactionHash as Bytes32,
        BigInt(receipt.blockNumber), confirmations);
      if (BigInt(latest) < BigInt(commitment.finalizedAtBlock)) throw new StorageRecoveryDependencyError();
      try { verifyStorageArtifactBinding(record.artifactHash, commitment); return commitment; }
      catch { /* A duplicate root may have a different canonical upload transaction. */ }
    }
  }
  if (candidateFound) throw new StorageRecoveryMismatchError();
  throw new StorageRecoveryDependencyError();
}

function validateRecoveryConfig(flowAddress: string, fromBlock: number, confirmations: number): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(flowAddress) || /^0x0{40}$/i.test(flowAddress)
    || !Number.isSafeInteger(fromBlock) || fromBlock < 0
    || !Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 128) {
    throw new StorageRecoveryDependencyError();
  }
}

function assertFlowOrigin(
  flowAddress: string,
  log: Log,
  receipt: TransactionReceipt,
  transaction: TransactionResponse,
  submitter: unknown,
): void {
  const address = flowAddress.toLowerCase();
  const receiptLog = receipt.logs.find((item) => item.index === log.index);
  if (log.address.toLowerCase() !== address || log.removed
    || receipt.to?.toLowerCase() !== address || transaction.to?.toLowerCase() !== address
    || receipt.hash.toLowerCase() !== log.transactionHash.toLowerCase()
    || transaction.hash.toLowerCase() !== log.transactionHash.toLowerCase()
    || transaction.from.toLowerCase() !== String(submitter).toLowerCase()
    || receipt.blockNumber !== log.blockNumber || receipt.blockHash.toLowerCase() !== log.blockHash.toLowerCase()
    || !receiptLog || receiptLog.address.toLowerCase() !== address
    || receiptLog.transactionHash.toLowerCase() !== log.transactionHash.toLowerCase()
    || receiptLog.blockHash.toLowerCase() !== log.blockHash.toLowerCase()
    || receiptLog.data !== log.data || receiptLog.topics.join(":") !== log.topics.join(":")) {
    throw new StorageRecoveryMismatchError();
  }
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
