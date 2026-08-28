import { constants as fsConstants } from "node:fs";
import { mkdtemp, open, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { keccak256, type AbstractProvider, type Signer } from "ethers";

import type { Bytes32, StorageCommitment } from "./types";

const DEFAULT_CONFIRMATIONS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const MAX_CONFIRMATIONS = 64;
const MAX_TIMEOUT_MS = 120_000;
const UINT64_MAX = (1n << 64n) - 1n;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9]\d*)$/;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;

export type StorageErrorCode =
  | "INVALID_INPUT"
  | "INVALID_DIGEST"
  | "DIGEST_MISMATCH"
  | "EVIDENCE_TOO_LARGE"
  | "INVALID_OPTIONS"
  | "TEMP_FILE_FAILED"
  | "UPLOAD_FAILED"
  | "UPLOAD_TIMEOUT"
  | "INVALID_STORAGE_ROOT"
  | "INVALID_UPLOAD_TX"
  | "FINALITY_FAILED"
  | "UPLOAD_UNFINALIZED"
  | "UPLOAD_REVERTED"
  | "UPLOAD_TX_MISMATCH"
  | "RETRIEVAL_FAILED"
  | "RETRIEVAL_TIMEOUT"
  | "RETRIEVED_BYTES_MISMATCH"
  | "RETRIEVED_DIGEST_MISMATCH";

export class StorageProofError extends Error {
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

export interface StorageAdapter {
  upload(filePath: string): Promise<{ storageRoot: string; uploadTxHash: string }>;
  download(storageRoot: string, filePath: string, withProof: true): Promise<void>;
}

export type FinalizedUploadReceipt = Readonly<{
  transactionHash: string;
  status: number;
  blockNumber: string;
  finalizedAtBlock: string;
  confirmations: number;
}>;

export interface ChainFinalityAdapter {
  waitForTransaction(
    txHash: string,
    confirmations: number,
    timeoutMs: number,
  ): Promise<FinalizedUploadReceipt | null>;
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
  createTempFiles?: () => Promise<StorageTempFiles>;
}>;

export type StorageOptions = Readonly<{
  confirmations?: number;
  operationTimeoutMs?: number;
  maxEvidenceBytes?: number;
}>;

export async function persistVerifiedEvidence(
  input: Readonly<{ canonicalBytes: Uint8Array; envelopeDigest: Bytes32 }>,
  dependencies: StorageDependencies,
  options: StorageOptions = {},
): Promise<StorageCommitment> {
  const settings = validateOptions(options);
  const bytes = validateAndSnapshot(input, settings.maxEvidenceBytes);
  let files: StorageTempFiles | undefined;
  let failed = false;
  try {
    files = await (dependencies.createTempFiles ?? createSecureTempFiles)();
    await writeCanonicalBytes(files, bytes);
    const uploaded = await uploadWithDeadline(dependencies.storage, files, settings);
    const storageRoot = requireBytes32(uploaded.storageRoot, "INVALID_STORAGE_ROOT");
    const uploadTxHash = requireBytes32(uploaded.uploadTxHash, "INVALID_UPLOAD_TX");
    const receipt = await finalizeUpload(dependencies.chain, uploadTxHash, settings);
    await retrieveWithProof(dependencies.storage, files, storageRoot, settings);
    const retrieved = await readRetrieved(files, settings.maxEvidenceBytes);
    const retrievedDigest = verifyRetrieved(bytes, retrieved, input.envelopeDigest);
    return makeCommitment(input.envelopeDigest, storageRoot, uploadTxHash, retrievedDigest, receipt);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await cleanupAfterRun(files, failed);
  }
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

export function createZeroGStorageAdapter(config: Readonly<{
  indexerRpc: string;
  chainRpc: string;
  signer: Signer;
}>): StorageAdapter {
  requireEndpoint(config.indexerRpc, "indexerRpc");
  requireEndpoint(config.chainRpc, "chainRpc");
  return {
    upload: (path) => sdkUpload(path, config),
    download: (root, path, withProof) => sdkDownload(root, path, withProof, config.indexerRpc),
  };
}

export function createEthersFinalityAdapter(provider: AbstractProvider): ChainFinalityAdapter {
  return {
    async waitForTransaction(txHash, confirmations, timeoutMs) {
      const receipt = await provider.waitForTransaction(txHash, confirmations, timeoutMs);
      if (!receipt) return null;
      const finalizedAtBlock = await provider.getBlockNumber();
      return {
        transactionHash: receipt.hash,
        status: receipt.status ?? 0,
        blockNumber: receipt.blockNumber.toString(),
        finalizedAtBlock: finalizedAtBlock.toString(),
        confirmations,
      };
    },
  };
}

type ValidatedOptions = Required<StorageOptions>;

function validateOptions(options: StorageOptions): ValidatedOptions {
  const settings = {
    confirmations: options.confirmations ?? DEFAULT_CONFIRMATIONS,
    operationTimeoutMs: options.operationTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxEvidenceBytes: options.maxEvidenceBytes ?? DEFAULT_MAX_BYTES,
  };
  if (!boundedInteger(settings.confirmations, 1, MAX_CONFIRMATIONS)) invalidOptions();
  if (!boundedInteger(settings.operationTimeoutMs, 1, MAX_TIMEOUT_MS)) invalidOptions();
  if (!boundedInteger(settings.maxEvidenceBytes, 1, DEFAULT_MAX_BYTES)) invalidOptions();
  return settings;
}

function validateAndSnapshot(
  input: Readonly<{ canonicalBytes: Uint8Array; envelopeDigest: Bytes32 }>,
  maximum: number,
): Uint8Array {
  if (!(input?.canonicalBytes instanceof Uint8Array) || input.canonicalBytes.length === 0) {
    throw new StorageProofError("INVALID_INPUT", false);
  }
  if (input.canonicalBytes.length > maximum) {
    throw new StorageProofError("EVIDENCE_TOO_LARGE", false);
  }
  const digest = requireBytes32(input.envelopeDigest, "INVALID_DIGEST");
  const bytes = Uint8Array.from(input.canonicalBytes);
  if (keccak256(bytes).toLowerCase() !== digest) {
    throw new StorageProofError("DIGEST_MISMATCH", false);
  }
  return bytes;
}

async function writeCanonicalBytes(files: StorageTempFiles, bytes: Uint8Array) {
  try {
    await files.writeUpload(bytes);
  } catch (error) {
    throw new StorageProofError("TEMP_FILE_FAILED", true, "failed to stage evidence", error);
  }
}

async function uploadWithDeadline(
  storage: StorageAdapter,
  files: StorageTempFiles,
  options: ValidatedOptions,
) {
  return deadline(
    () => storage.upload(files.uploadPath),
    options.operationTimeoutMs,
    "UPLOAD_TIMEOUT",
    "UPLOAD_FAILED",
  );
}

async function finalizeUpload(
  chain: ChainFinalityAdapter,
  txHash: Bytes32,
  options: ValidatedOptions,
) {
  let receipt: FinalizedUploadReceipt | null;
  receipt = await deadline(
    () => chain.waitForTransaction(txHash, options.confirmations, options.operationTimeoutMs),
    options.operationTimeoutMs,
    "UPLOAD_UNFINALIZED",
    "FINALITY_FAILED",
  );
  validateReceipt(receipt, txHash, options.confirmations);
  return receipt as FinalizedUploadReceipt;
}

function validateReceipt(
  receipt: FinalizedUploadReceipt | null,
  txHash: Bytes32,
  requiredConfirmations: number,
) {
  if (!receipt) throw new StorageProofError("UPLOAD_UNFINALIZED", true);
  if (receipt.status !== 1) throw new StorageProofError("UPLOAD_REVERTED", false);
  if (!BYTES32.test(receipt.transactionHash) || receipt.transactionHash.toLowerCase() !== txHash) {
    throw new StorageProofError("UPLOAD_TX_MISMATCH", false);
  }
  if (!Number.isSafeInteger(receipt.confirmations) ||
      receipt.confirmations < requiredConfirmations ||
      !validFinalityHeight(receipt, requiredConfirmations)) {
    throw new StorageProofError("UPLOAD_UNFINALIZED", true);
  }
}

async function retrieveWithProof(
  storage: StorageAdapter,
  files: StorageTempFiles,
  root: Bytes32,
  options: ValidatedOptions,
) {
  await deadline(
    () => storage.download(root, files.downloadPath, true),
    options.operationTimeoutMs,
    "RETRIEVAL_TIMEOUT",
    "RETRIEVAL_FAILED",
  );
}

async function readRetrieved(files: StorageTempFiles, maximum: number) {
  try {
    return await files.readDownload(maximum);
  } catch (error) {
    throw new StorageProofError("RETRIEVAL_FAILED", true, "failed to read retrieved evidence", error);
  }
}

function verifyRetrieved(canonical: Uint8Array, retrieved: Uint8Array, digest: Bytes32): Bytes32 {
  if (!equalBytes(canonical, retrieved)) {
    throw new StorageProofError("RETRIEVED_BYTES_MISMATCH", false);
  }
  const retrievedDigest = keccak256(retrieved).toLowerCase() as Bytes32;
  if (retrievedDigest !== digest.toLowerCase()) {
    throw new StorageProofError("RETRIEVED_DIGEST_MISMATCH", false);
  }
  return retrievedDigest;
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
    finalizedAtBlock: receipt.finalizedAtBlock,
    retrievalVerified: true,
  });
}

async function deadline<T>(
  action: () => Promise<T>,
  timeoutMs: number,
  timeoutCode: StorageErrorCode,
  failureCode: StorageErrorCode,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StorageProofError(timeoutCode, true)), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof StorageProofError) throw error;
    throw new StorageProofError(failureCode, true, failureCode, error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sdkUpload(
  path: string,
  config: Readonly<{ indexerRpc: string; chainRpc: string; signer: Signer }>,
) {
  const { Indexer, ZgFile } = await import("@0gfoundation/0g-storage-ts-sdk");
  const file = await ZgFile.fromFilePath(path);
  try {
    const [result, error] = await new Indexer(config.indexerRpc).upload(
      file,
      config.chainRpc,
      config.signer,
    );
    if (error) throw error;
    return parseZeroGUploadResult(result);
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

async function readRegularFile(path: string, maximum: number) {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) {
      throw new Error("retrieved path is not a bounded regular file");
    }
    const bounded = Buffer.alloc(maximum + 1);
    const { bytesRead } = await handle.read(bounded, 0, bounded.length, 0);
    if (bytesRead > maximum) throw new Error("retrieved file exceeds limit");
    return Uint8Array.from(bounded.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function cleanupTempFiles(directory: string, ...paths: string[]) {
  await Promise.all(paths.map((path) => unlink(path).catch(ignoreMissing)));
  await rmdir(directory).catch(ignoreMissing);
}

async function cleanupAfterRun(files: StorageTempFiles | undefined, failed: boolean) {
  if (!files) return;
  try {
    await files.cleanup();
  } catch (error) {
    if (!failed) {
      throw new StorageProofError("TEMP_FILE_FAILED", true, "temporary file cleanup failed", error);
    }
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

function validFinalityHeight(receipt: FinalizedUploadReceipt, confirmations: number) {
  const included = parseUint64(receipt.blockNumber);
  const finalized = parseUint64(receipt.finalizedAtBlock);
  if (included === null || finalized === null) return false;
  return finalized >= included + BigInt(confirmations - 1);
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
