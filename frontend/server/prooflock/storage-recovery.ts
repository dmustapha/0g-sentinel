import { concat, keccak256, type Filter, type Log, type TransactionReceipt, type TransactionResponse } from "ethers";

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
  const nodes = value.nodes;
  if (!nodes?.length) return false;
  const want = expected.toLowerCase();
  // Single-subtree file: the file root IS the one submission node root.
  if (nodes.some((node) => normalizeRoot(node.root)?.toLowerCase() === want)) return true;
  // Multi-subtree file: the SDK file root is the keccak fold of the subtree node roots,
  // right-to-left (root = keccak256(node[i] ++ acc)). The on-chain Submit event only records the
  // subtree nodes, so we must reconstruct the file root to match the sealed storageRoot.
  return foldSubmissionRoot(nodes) === want;
}

function foldSubmissionRoot(nodes: readonly { root?: unknown }[]): string | null {
  let acc = normalizeRoot(nodes[nodes.length - 1]?.root);
  if (!acc) return null;
  for (let i = nodes.length - 2; i >= 0; i -= 1) {
    const node = normalizeRoot(nodes[i]?.root);
    if (!node) return null;
    acc = keccak256(concat([node, acc]));
  }
  return acc.toLowerCase();
}

function normalizeRoot(root: unknown): string | null {
  const hex = typeof root === "bigint" ? `0x${root.toString(16).padStart(64, "0")}` : String(root);
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? hex : null;
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
