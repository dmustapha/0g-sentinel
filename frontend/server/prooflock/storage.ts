import { constants as fsConstants } from "node:fs";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, open, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { keccak256, type AbstractProvider, type Signer } from "ethers";

import type { Bytes32, StorageCommitment } from "./types";

const MAINNET_CHAIN_ID = 16661;
const DEFAULT_CONFIRMATIONS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const MAX_CONFIRMATIONS = 64;
const MAX_TIMEOUT_MS = 120_000;
const UINT64_MAX = (1n << 64n) - 1n;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(0|[1-9]\d*)$/;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const BROADCAST_MESSAGE = /Transaction submitted:\s*(0x[0-9a-fA-F]{64})/;

// SDK 1.2.11 forwards `proof=true` but Downloader.downloadTask does not validate it.
// `retrievalVerified` therefore means independently recomputed local 0G root,
// exact bytes, and Keccak digest — never remote Merkle-proof validation.
export const STORAGE_VERIFICATION_CAPABILITY = Object.freeze({
  localRootVerified: true,
  exactBytesVerified: true,
  digestVerified: true,
  networkProofVerified: false,
  sdkProofParameter: "REQUESTED_NOT_VALIDATED_BY_SDK_1_2_11",
} as const);

export type StorageErrorCode =
  | "INVALID_INPUT"
  | "INVALID_DIGEST"
  | "DIGEST_MISMATCH"
  | "EVIDENCE_TOO_LARGE"
  | "INVALID_OPTIONS"
  | "TEMP_FILE_FAILED"
  | "LOCAL_ROOT_FAILED"
  | "LOCAL_ROOT_MISMATCH"
  | "UPLOAD_FAILED"
  | "INVALID_STORAGE_ROOT"
  | "INVALID_UPLOAD_TX"
  | "WRONG_STORAGE_CHAIN"
  | "WRONG_FLOW_CONTRACT"
  | "FINALITY_FAILED"
  | "UPLOAD_UNFINALIZED"
  | "UPLOAD_REVERTED"
  | "UPLOAD_TX_MISMATCH"
  | "FLOW_SUBMISSION_MISMATCH"
  | "FLOW_EVENT_MISSING"
  | "FLOW_EVENT_MISMATCH"
  | "RETRIEVAL_FAILED"
  | "RETRIEVED_BYTES_MISMATCH"
  | "RETRIEVED_DIGEST_MISMATCH"
  | "RETRIEVED_ROOT_MISMATCH"
  | "JOURNAL_FAILED";

export class StorageProofError extends Error {
  cleanupFailure?: unknown;

  constructor(
    readonly code: StorageErrorCode,
    readonly retryable: boolean,
    message: string = code,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageProofError";
  }
}

export type StorageSubmission = Readonly<{
  data: Readonly<{
    length: string;
    tags: string;
    nodes: readonly Readonly<{ root: Bytes32; height: string }>[];
  }>;
  submitter: `0x${string}`;
}>;

export type StorageLayout = Readonly<{
  storageRoot: Bytes32;
  submission: StorageSubmission;
}>;

export type StorageUploadResult = Readonly<{
  storageRoot: string;
  uploadTxHash: string;
  chainId: number;
  flowAddress: string;
}>;

export interface StorageAdapter {
  computeLayout(bytes: Uint8Array): Promise<StorageLayout>;
  upload(
    filePath: string,
    expectedRoot: Bytes32,
    onBroadcast: (txHash: string) => void,
  ): Promise<StorageUploadResult>;
  download(storageRoot: string, filePath: string, withProof: true): Promise<void>;
}

export type FlowLog = Readonly<{
  address: string;
  topics: readonly string[];
  data: string;
}>;

export type FinalizedUploadReceipt = Readonly<{
  chainId: number;
  transactionHash: string;
  status: number;
  blockNumber: string;
  blockHash: string;
  finalizedAtBlock: string;
  confirmations: number;
  from: string;
  to: string;
  input: string;
  logs: readonly FlowLog[];
}>;

export interface ChainFinalityAdapter {
  waitForTransaction(
    txHash: string,
    confirmations: number,
    timeoutMs: number,
  ): Promise<FinalizedUploadReceipt | null>;
}

export type UploadJournalEntry = Readonly<{
  storageRoot: Bytes32;
  status: "PREPARED" | "SUBMITTED" | "FINALIZED";
  uploadTxHash?: Bytes32;
  updatedAt: string;
}>;

export interface UploadJournal {
  get(storageRoot: Bytes32): Promise<UploadJournalEntry | null>;
  record(entry: UploadJournalEntry): Promise<void>;
  // Synchronous durability is required because the SDK does not await onProgress.
  recordSubmitted(entry: UploadJournalEntry): void;
}

export interface StorageTempFiles {
  readonly uploadPath: string;
  readonly downloadPath: string;
  writeUpload(bytes: Uint8Array): Promise<void>;
  readDownload(maxBytes?: number): Promise<Uint8Array>;
  cleanup(): Promise<void>;
}

export type StorageDependencies = Readonly<{
  storage: StorageAdapter;
  chain: ChainFinalityAdapter;
  journal: UploadJournal;
  createTempFiles?: () => Promise<StorageTempFiles>;
}>;

export type StorageOptions = Readonly<{
  confirmations?: number;
  receiptTimeoutMs?: number;
  maxEvidenceBytes?: number;
  expectedFlowAddress: string;
}>;

export async function persistVerifiedEvidence(
  input: Readonly<{ canonicalBytes: Uint8Array; envelopeDigest: Bytes32 }>,
  dependencies: StorageDependencies,
  options: StorageOptions,
): Promise<StorageCommitment> {
  const settings = validateOptions(options);
  const bytes = validateAndSnapshot(input, settings.maxEvidenceBytes);
  const layout = await computeLayout(dependencies.storage, bytes);
  let files: StorageTempFiles | undefined;
  let failure: unknown;
  try {
    files = await (dependencies.createTempFiles ?? createSecureTempFiles)();
    await writeCanonicalBytes(files, bytes);
    const txHash = await resolveUpload(dependencies, files, layout, settings);
    const receipt = await finalizeUpload(dependencies.chain, txHash, settings, layout);
    await recordJournal(dependencies.journal, journalEntry(layout.storageRoot, "FINALIZED", txHash));
    await retrieve(dependencies.storage, files, layout.storageRoot);
    const retrieved = await readRetrieved(files, settings.maxEvidenceBytes);
    const digest = await verifyRetrieved(dependencies.storage, bytes, retrieved, input.envelopeDigest, layout.storageRoot);
    return makeCommitment(input.envelopeDigest, layout.storageRoot, txHash, digest, receipt);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await cleanupAfterRun(files, failure);
  }
}

export async function computeZeroGLayout(
  bytes: Uint8Array,
  submitter: string,
): Promise<StorageLayout> {
  const { MemData } = await import("@0gfoundation/0g-storage-ts-sdk");
  const file = new MemData(Uint8Array.from(bytes));
  const [tree, treeError] = await file.merkleTree();
  const [submission, submissionError] = await file.createSubmission("0x", submitter);
  const root = tree?.rootHash();
  if (treeError || submissionError || !root || !submission) {
    throw new StorageProofError("LOCAL_ROOT_FAILED", false, "0G layout computation failed", treeError ?? submissionError);
  }
  return Object.freeze({
    storageRoot: requireBytes32(root, "LOCAL_ROOT_FAILED"),
    submission: normalizeSubmission(submission),
  });
}

export async function createSecureTempFiles(): Promise<StorageTempFiles> {
  const directory = await mkdtemp(join(tmpdir(), "sentinel-prooflock-"));
  const uploadPath = join(directory, "upload.bin");
  const downloadPath = join(directory, "download.bin");
  return {
    uploadPath,
    downloadPath,
    writeUpload: (bytes) => writeFile(uploadPath, bytes, { flag: "wx", mode: 0o600 }),
    readDownload: (maximum = DEFAULT_MAX_BYTES) => readRegularFile(downloadPath, maximum),
    cleanup: () => cleanupTempFiles(directory, uploadPath, downloadPath),
  };
}

export function createFileUploadJournal(directory: string): UploadJournal {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return {
    get: async (root) => readJournalFile(directory, root),
    record: async (entry) => writeJournalFile(directory, entry),
    recordSubmitted: (entry) => writeJournalFile(directory, entry),
  };
}

export function createZeroGStorageAdapter(config: Readonly<{
  indexerRpc: string;
  chainRpc: string;
  expectedFlowAddress: string;
  signer: Signer;
}>): StorageAdapter {
  requireEndpoint(config.indexerRpc, "indexerRpc");
  requireEndpoint(config.chainRpc, "chainRpc");
  const expectedFlow = requireAddress(config.expectedFlowAddress, "WRONG_FLOW_CONTRACT");
  return {
    computeLayout: async (bytes) => computeZeroGLayout(bytes, await config.signer.getAddress()),
    upload: (path, root, onBroadcast) => sdkUpload(path, root, onBroadcast, { ...config, expectedFlowAddress: expectedFlow }),
    download: (root, path, withProof) => sdkDownload(root, path, withProof, config.indexerRpc),
  };
}

export function createEthersFinalityAdapter(provider: AbstractProvider): ChainFinalityAdapter {
  return {
    async waitForTransaction(txHash, confirmations, timeoutMs) {
      const network = await provider.getNetwork();
      const receipt = await provider.waitForTransaction(txHash, confirmations, timeoutMs);
      if (!receipt) return null;
      const transaction = await provider.getTransaction(txHash);
      if (!transaction) return null;
      return {
        chainId: Number(network.chainId),
        transactionHash: receipt.hash,
        status: receipt.status ?? 0,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        finalizedAtBlock: (await provider.getBlockNumber()).toString(),
        confirmations,
        from: receipt.from,
        to: receipt.to ?? "",
        input: transaction.data,
        logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
      };
    },
  };
}

type ValidatedOptions = Readonly<Required<StorageOptions> & { expectedFlowAddress: `0x${string}` }>;

function validateOptions(options: StorageOptions): ValidatedOptions {
  const settings = {
    confirmations: options?.confirmations ?? DEFAULT_CONFIRMATIONS,
    receiptTimeoutMs: options?.receiptTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxEvidenceBytes: options?.maxEvidenceBytes ?? DEFAULT_MAX_BYTES,
    expectedFlowAddress: requireAddress(options?.expectedFlowAddress, "WRONG_FLOW_CONTRACT"),
  };
  if (!boundedInteger(settings.confirmations, 1, MAX_CONFIRMATIONS)) invalidOptions();
  if (!boundedInteger(settings.receiptTimeoutMs, 1, MAX_TIMEOUT_MS)) invalidOptions();
  if (!boundedInteger(settings.maxEvidenceBytes, 1, DEFAULT_MAX_BYTES)) invalidOptions();
  return settings;
}

function validateAndSnapshot(
  input: Readonly<{ canonicalBytes: Uint8Array; envelopeDigest: Bytes32 }>,
  maximum: number,
) {
  if (!(input?.canonicalBytes instanceof Uint8Array) || input.canonicalBytes.length === 0) {
    throw new StorageProofError("INVALID_INPUT", false);
  }
  if (input.canonicalBytes.length > maximum) throw new StorageProofError("EVIDENCE_TOO_LARGE", false);
  const digest = requireBytes32(input.envelopeDigest, "INVALID_DIGEST");
  const bytes = Uint8Array.from(input.canonicalBytes);
  if (keccak256(bytes).toLowerCase() !== digest) throw new StorageProofError("DIGEST_MISMATCH", false);
  return bytes;
}

async function computeLayout(storage: StorageAdapter, bytes: Uint8Array) {
  try {
    const layout = await storage.computeLayout(bytes);
    requireBytes32(layout.storageRoot, "LOCAL_ROOT_FAILED");
    return layout;
  } catch (error) {
    if (error instanceof StorageProofError) throw error;
    throw new StorageProofError("LOCAL_ROOT_FAILED", false, "0G layout computation failed", error);
  }
}

async function resolveUpload(
  dependencies: StorageDependencies,
  files: StorageTempFiles,
  layout: StorageLayout,
  options: ValidatedOptions,
) {
  const existing = await getJournal(dependencies.journal, layout.storageRoot);
  if (existing?.uploadTxHash && existing.status !== "PREPARED") return existing.uploadTxHash;
  await recordJournal(dependencies.journal, journalEntry(layout.storageRoot, "PREPARED"));
  const onBroadcast = (value: string) => recordBroadcast(dependencies.journal, layout.storageRoot, value);
  const upload = await uploadAndDrain(dependencies.storage, files.uploadPath, layout.storageRoot, onBroadcast);
  validateUpload(upload, layout.storageRoot, options.expectedFlowAddress);
  const txHash = requireBytes32(upload.uploadTxHash, "INVALID_UPLOAD_TX");
  dependencies.journal.recordSubmitted(journalEntry(layout.storageRoot, "SUBMITTED", txHash));
  return txHash;
}

async function uploadAndDrain(
  storage: StorageAdapter,
  path: string,
  root: Bytes32,
  onBroadcast: (txHash: string) => void,
) {
  try {
    // No Promise.race: the SDK cannot abort, so cleanup waits for settlement.
    return await storage.upload(path, root, onBroadcast);
  } catch (error) {
    if (error instanceof StorageProofError) throw error;
    throw new StorageProofError("UPLOAD_FAILED", true, "0G upload failed", error);
  }
}

function validateUpload(upload: StorageUploadResult, localRoot: Bytes32, flow: string) {
  const returnedRoot = requireBytes32(upload?.storageRoot, "INVALID_STORAGE_ROOT");
  if (returnedRoot !== localRoot) throw new StorageProofError("LOCAL_ROOT_MISMATCH", false);
  requireBytes32(upload.uploadTxHash, "INVALID_UPLOAD_TX");
  if (upload.chainId !== MAINNET_CHAIN_ID) throw new StorageProofError("WRONG_STORAGE_CHAIN", false);
  if (requireAddress(upload.flowAddress, "WRONG_FLOW_CONTRACT") !== flow) {
    throw new StorageProofError("WRONG_FLOW_CONTRACT", false);
  }
}

async function finalizeUpload(
  chain: ChainFinalityAdapter,
  txHash: Bytes32,
  options: ValidatedOptions,
  layout: StorageLayout,
) {
  let receipt: FinalizedUploadReceipt | null;
  try {
    receipt = await chain.waitForTransaction(txHash, options.confirmations, options.receiptTimeoutMs);
  } catch (error) {
    throw new StorageProofError("FINALITY_FAILED", true, "failed to confirm upload", error);
  }
  validateReceipt(receipt, txHash, options);
  await validateFlowEvidence(receipt as FinalizedUploadReceipt, layout, options.expectedFlowAddress);
  return receipt as FinalizedUploadReceipt;
}

function validateReceipt(
  receipt: FinalizedUploadReceipt | null,
  txHash: Bytes32,
  options: ValidatedOptions,
) {
  if (!receipt) throw new StorageProofError("UPLOAD_UNFINALIZED", true);
  if (receipt.status !== 1) throw new StorageProofError("UPLOAD_REVERTED", false);
  if (!BYTES32.test(receipt.transactionHash) || receipt.transactionHash.toLowerCase() !== txHash) {
    throw new StorageProofError("UPLOAD_TX_MISMATCH", false);
  }
  if (receipt.chainId !== MAINNET_CHAIN_ID) throw new StorageProofError("WRONG_STORAGE_CHAIN", false);
  if (requireAddress(receipt.to, "WRONG_FLOW_CONTRACT") !== options.expectedFlowAddress) {
    throw new StorageProofError("WRONG_FLOW_CONTRACT", false);
  }
  if (!BYTES32.test(receipt.blockHash) || !validFinalityHeight(receipt, options.confirmations)) {
    throw new StorageProofError("UPLOAD_UNFINALIZED", true);
  }
}

async function validateFlowEvidence(receipt: FinalizedUploadReceipt, layout: StorageLayout, flow: string) {
  const { FixedPriceFlow__factory } = await import("@0gfoundation/0g-storage-ts-sdk");
  const contractInterface = FixedPriceFlow__factory.createInterface();
  let decoded: ReturnType<typeof contractInterface.parseTransaction>;
  try {
    decoded = contractInterface.parseTransaction({ data: receipt.input });
  } catch {
    decoded = null;
  }
  let transactionSubmission: StorageSubmission | null = null;
  try {
    if (decoded?.name === "submit") transactionSubmission = normalizeSubmission(decoded.args[0]);
  } catch {
    transactionSubmission = null;
  }
  if (!transactionSubmission || !sameSubmission(transactionSubmission, layout.submission)) {
    throw new StorageProofError("FLOW_SUBMISSION_MISMATCH", false);
  }
  validateSubmitEvent(contractInterface, receipt, layout.submission, flow);
}

function validateSubmitEvent(
  contractInterface: ReturnType<typeof import("@0gfoundation/0g-storage-ts-sdk").FixedPriceFlow__factory.createInterface>,
  receipt: FinalizedUploadReceipt,
  expected: StorageSubmission,
  flow: string,
) {
  const candidates = receipt.logs.filter((log) => log.address.toLowerCase() === flow);
  const submissions: StorageSubmission[] = [];
  for (const log of candidates) {
    try {
      const parsed = contractInterface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "Submit") continue;
      if (requireAddress(parsed.args.sender, "FLOW_EVENT_MISMATCH") !== requireAddress(receipt.from, "FLOW_EVENT_MISMATCH")) {
        throw new StorageProofError("FLOW_EVENT_MISMATCH", false);
      }
      submissions.push(normalizeSubmission({ data: parsed.args.submission, submitter: receipt.from }));
    } catch (error) {
      if (error instanceof StorageProofError) throw error;
    }
  }
  if (submissions.length === 0) throw new StorageProofError("FLOW_EVENT_MISSING", false);
  if (submissions.length !== 1 || !sameSubmission(submissions[0], expected)) {
    throw new StorageProofError("FLOW_EVENT_MISMATCH", false);
  }
}

async function retrieve(storage: StorageAdapter, files: StorageTempFiles, root: Bytes32) {
  try {
    // `true` requests proofs, but local root recomputation below is the verification boundary.
    await storage.download(root, files.downloadPath, true);
  } catch (error) {
    throw new StorageProofError("RETRIEVAL_FAILED", true, "0G retrieval failed", error);
  }
}

async function verifyRetrieved(
  storage: StorageAdapter,
  canonical: Uint8Array,
  retrieved: Uint8Array,
  digest: Bytes32,
  storageRoot: Bytes32,
) {
  if (!equalBytes(canonical, retrieved)) throw new StorageProofError("RETRIEVED_BYTES_MISMATCH", false);
  const retrievedDigest = keccak256(retrieved).toLowerCase() as Bytes32;
  if (retrievedDigest !== digest.toLowerCase()) throw new StorageProofError("RETRIEVED_DIGEST_MISMATCH", false);
  const retrievedLayout = await computeLayout(storage, retrieved);
  if (retrievedLayout.storageRoot !== storageRoot) throw new StorageProofError("RETRIEVED_ROOT_MISMATCH", false);
  return retrievedDigest;
}

function normalizeSubmission(value: unknown): StorageSubmission {
  const tuple = value as { 0?: unknown; 1?: unknown; data?: unknown; submitter?: unknown };
  const rawData = tuple?.data ?? tuple?.[0];
  const data = rawData as { 0?: unknown; 1?: unknown; 2?: unknown; length?: unknown; tags?: unknown; nodes?: unknown };
  const tupleData = Array.isArray(rawData);
  const rawNodes = tupleData ? data?.[2] : data?.nodes;
  if (!data || !Array.isArray(rawNodes)) throw new StorageProofError("LOCAL_ROOT_FAILED", false);
  const nodes = rawNodes.map((node) => {
    const item = node as { 0?: unknown; 1?: unknown; root?: unknown; height?: unknown };
    return {
      root: requireBytes32(item.root ?? item[0], "LOCAL_ROOT_FAILED"),
      height: normalizeDecimal(item.height ?? item[1], "LOCAL_ROOT_FAILED"),
    };
  });
  return Object.freeze({
    data: Object.freeze({
      length: normalizeDecimal(tupleData ? data[0] : data.length, "LOCAL_ROOT_FAILED"),
      tags: normalizeHex(tupleData ? data[1] : data.tags, "LOCAL_ROOT_FAILED"),
      nodes: Object.freeze(nodes),
    }),
    submitter: requireAddress(tuple.submitter ?? tuple[1], "LOCAL_ROOT_FAILED"),
  });
}

function sameSubmission(left: StorageSubmission, right: StorageSubmission) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeCanonicalBytes(files: StorageTempFiles, bytes: Uint8Array) {
  try {
    await files.writeUpload(bytes);
  } catch (error) {
    throw new StorageProofError("TEMP_FILE_FAILED", true, "failed to stage evidence", error);
  }
}

async function readRetrieved(files: StorageTempFiles, maximum: number) {
  try {
    return await files.readDownload(maximum);
  } catch (error) {
    throw new StorageProofError("RETRIEVAL_FAILED", true, "failed to read retrieved evidence", error);
  }
}

function makeCommitment(
  envelopeDigest: Bytes32,
  storageRoot: Bytes32,
  uploadTxHash: Bytes32,
  retrievedDigest: Bytes32,
  receipt: FinalizedUploadReceipt,
): StorageCommitment {
  return Object.freeze({
    envelopeDigest: envelopeDigest.toLowerCase() as Bytes32,
    storageRoot,
    uploadTxHash,
    retrievedDigest,
    finalizedAtBlock: (BigInt(receipt.blockNumber) + BigInt(receipt.confirmations) - 1n).toString(),
    retrievalVerified: true,
    networkProofVerified: false,
  });
}

async function sdkUpload(
  path: string,
  expectedRoot: Bytes32,
  onBroadcast: (txHash: string) => void,
  config: Readonly<{ indexerRpc: string; chainRpc: string; expectedFlowAddress: string; signer: Signer }>,
): Promise<StorageUploadResult> {
  const { Indexer, ZgFile } = await import("@0gfoundation/0g-storage-ts-sdk");
  const file = await ZgFile.fromFilePath(path);
  try {
    const indexer = new Indexer(config.indexerRpc);
    const [uploader, setupError] = await indexer.newUploaderFromIndexerNodes(config.chainRpc, config.signer, 1);
    if (setupError || !uploader) throw setupError ?? new Error("no uploader");
    const flowAddress = (await uploader.flow.getAddress()).toLowerCase();
    const chainId = Number((await uploader.provider.getNetwork()).chainId);
    if (chainId !== MAINNET_CHAIN_ID) throw new StorageProofError("WRONG_STORAGE_CHAIN", false);
    if (flowAddress !== config.expectedFlowAddress) throw new StorageProofError("WRONG_FLOW_CONTRACT", false);
    const submitter = await config.signer.getAddress();
    const [result, error] = await uploader.splitableUpload(file, {
      tags: "0x",
      submitter,
      skipIfFinalized: false,
      finalityRequired: true,
      fragmentSize: DEFAULT_MAX_BYTES,
      onProgress: (message) => captureBroadcast(message, onBroadcast),
    });
    if (error) throw error;
    const parsed = parseZeroGUploadResult(result);
    if (parsed.storageRoot.toLowerCase() !== expectedRoot) throw new StorageProofError("LOCAL_ROOT_MISMATCH", false);
    return { ...parsed, chainId, flowAddress };
  } finally {
    await file.close();
  }
}

async function sdkDownload(root: string, path: string, proof: true, indexerRpc: string) {
  const { Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
  const error = await new Indexer(indexerRpc).download(root, path, proof);
  if (error) throw error;
}

export function parseZeroGUploadResult(result: unknown) {
  if (!result || typeof result !== "object") return { storageRoot: "", uploadTxHash: "" };
  const value = result as Record<string, unknown>;
  if (typeof value.rootHash === "string" && typeof value.txHash === "string") {
    return { storageRoot: value.rootHash, uploadTxHash: value.txHash };
  }
  const roots = value.rootHashes;
  const transactions = value.txHashes;
  if (Array.isArray(roots) && roots.length === 1 && Array.isArray(transactions) && transactions.length === 1) {
    return { storageRoot: String(roots[0]), uploadTxHash: String(transactions[0]) };
  }
  return { storageRoot: "", uploadTxHash: "" };
}

function captureBroadcast(message: string, callback: (hash: string) => void) {
  const match = BROADCAST_MESSAGE.exec(message);
  if (match) callback(match[1]);
}

function recordBroadcast(journal: UploadJournal, root: Bytes32, value: string) {
  const txHash = requireBytes32(value, "INVALID_UPLOAD_TX");
  try {
    journal.recordSubmitted(journalEntry(root, "SUBMITTED", txHash));
  } catch (error) {
    throw new StorageProofError("JOURNAL_FAILED", true, "broadcast journal write failed", error);
  }
}

function journalEntry(
  storageRoot: Bytes32,
  status: UploadJournalEntry["status"],
  uploadTxHash?: Bytes32,
): UploadJournalEntry {
  return Object.freeze({ storageRoot, status, uploadTxHash, updatedAt: Date.now().toString() });
}

async function getJournal(journal: UploadJournal, root: Bytes32) {
  try {
    const entry = await journal.get(root);
    return entry ? validateJournalEntry(entry, root) : null;
  } catch (error) {
    throw new StorageProofError("JOURNAL_FAILED", true, "upload journal read failed", error);
  }
}

async function recordJournal(journal: UploadJournal, entry: UploadJournalEntry) {
  try {
    await journal.record(entry);
  } catch (error) {
    throw new StorageProofError("JOURNAL_FAILED", true, "upload journal write failed", error);
  }
}

function validateJournalEntry(entry: UploadJournalEntry, root: Bytes32) {
  if (entry.storageRoot !== root || !["PREPARED", "SUBMITTED", "FINALIZED"].includes(entry.status)) {
    throw new StorageProofError("JOURNAL_FAILED", false);
  }
  if (entry.status !== "PREPARED") requireBytes32(entry.uploadTxHash, "JOURNAL_FAILED");
  return entry;
}

function readJournalFile(directory: string, root: Bytes32) {
  try {
    const value = JSON.parse(readFileSync(journalPath(directory, root), "utf8"));
    return validateJournalEntry(value, root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

function writeJournalFile(directory: string, entry: UploadJournalEntry) {
  validateJournalEntry(entry, entry.storageRoot);
  const target = journalPath(directory, entry.storageRoot);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify(entry));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, target);
  const directoryHandle = openSync(directory, fsConstants.O_RDONLY);
  try {
    fsyncSync(directoryHandle);
  } finally {
    closeSync(directoryHandle);
  }
}

function journalPath(directory: string, root: Bytes32) {
  return join(directory, `${requireBytes32(root, "JOURNAL_FAILED").slice(2)}.json`);
}

async function readRegularFile(path: string, maximum: number) {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw new Error("retrieved path is not a bounded regular file");
    const bounded = Buffer.alloc(maximum + 1);
    let offset = 0;
    while (offset < bounded.length) {
      const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximum) throw new Error("retrieved file exceeds limit");
    return Uint8Array.from(bounded.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

async function cleanupTempFiles(directory: string, ...paths: string[]) {
  await Promise.all(paths.map((path) => unlink(path).catch(ignoreMissing)));
  await rmdir(directory).catch(ignoreMissing);
}

async function cleanupAfterRun(files: StorageTempFiles | undefined, failure: unknown) {
  if (!files) return;
  try {
    await files.cleanup();
  } catch (cleanupError) {
    if (failure instanceof StorageProofError) failure.cleanupFailure = cleanupError;
    else if (!failure) throw new StorageProofError("TEMP_FILE_FAILED", true, "temporary file cleanup failed", cleanupError);
  }
}

function ignoreMissing(error: unknown) {
  if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
}

function requireBytes32(value: unknown, code: StorageErrorCode): Bytes32 {
  if (typeof value !== "string" || !BYTES32.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new StorageProofError(code, false);
  }
  return value.toLowerCase() as Bytes32;
}

function requireAddress(value: unknown, code: StorageErrorCode) {
  if (typeof value !== "string" || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    throw new StorageProofError(code, false);
  }
  return value.toLowerCase() as `0x${string}`;
}

function normalizeDecimal(value: unknown, code: StorageErrorCode) {
  const decimal = typeof value === "bigint" ? value.toString() : String(value);
  if (!DECIMAL.test(decimal)) throw new StorageProofError(code, false);
  return decimal;
}

function normalizeHex(value: unknown, code: StorageErrorCode) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new StorageProofError(code, false);
  }
  return value.toLowerCase();
}

function validFinalityHeight(receipt: FinalizedUploadReceipt, confirmations: number) {
  const included = parseUint64(receipt.blockNumber);
  const finalized = parseUint64(receipt.finalizedAtBlock);
  return included !== null && finalized !== null &&
    Number.isSafeInteger(receipt.confirmations) && receipt.confirmations >= confirmations &&
    finalized >= included + BigInt(confirmations - 1);
}

function parseUint64(value: string) {
  if (typeof value !== "string" || value.length > 20 || !DECIMAL.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= UINT64_MAX ? parsed : null;
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function boundedInteger(value: number, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function invalidOptions(): never {
  throw new StorageProofError("INVALID_OPTIONS", false);
}

function requireEndpoint(value: string, label: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new StorageProofError("INVALID_OPTIONS", false, `${label} must be a URL`);
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") invalidOptions();
}
