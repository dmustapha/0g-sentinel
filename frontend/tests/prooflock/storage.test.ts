import { keccak256, toUtf8Bytes } from "ethers";
import { access, symlink, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  createSecureTempFiles,
  createZeroGStorageAdapter,
  parseZeroGUploadResult,
  persistVerifiedEvidence,
  type ChainFinalityAdapter,
  type StorageAdapter,
  type StorageTempFiles,
} from "../../server/prooflock/storage";
import type { Bytes32 } from "../../server/prooflock/types";

const ROOT = `0x${"11".repeat(32)}` as Bytes32;
const TX_HASH = `0x${"22".repeat(32)}` as Bytes32;
const OTHER_TX = `0x${"33".repeat(32)}` as Bytes32;
const ZERO = `0x${"00".repeat(32)}` as Bytes32;
const BYTES = toUtf8Bytes('{"proof":"canonical"}');
const DIGEST = keccak256(BYTES) as Bytes32;

type HarnessOptions = {
  upload?: () => Promise<{ storageRoot: string; uploadTxHash: string }>;
  wait?: ChainFinalityAdapter["waitForTransaction"];
  download?: StorageAdapter["download"];
  downloaded?: Uint8Array;
};

function harness(options: HarnessOptions = {}) {
  const writes: Uint8Array[] = [];
  let downloaded = options.downloaded ?? BYTES;
  const temp: StorageTempFiles = {
    uploadPath: "/isolated/upload.json",
    downloadPath: "/isolated/download.json",
    writeUpload: async (bytes) => { writes.push(Uint8Array.from(bytes)); },
    readDownload: async () => Uint8Array.from(downloaded),
    cleanup: vi.fn(async () => undefined),
  };
  const createTempFiles = vi.fn(async () => temp);
  const storage: StorageAdapter = {
    upload: vi.fn(options.upload ?? (async () => ({ storageRoot: ROOT, uploadTxHash: TX_HASH }))),
    download: vi.fn(options.download ?? (async () => undefined)),
  };
  const chain: ChainFinalityAdapter = {
    waitForTransaction: vi.fn(options.wait ?? (async () => ({
      transactionHash: TX_HASH,
      status: 1,
      blockNumber: "100",
      finalizedAtBlock: "102",
      confirmations: 3,
    }))),
  };
  return {
    deps: { storage, chain, createTempFiles },
    storage,
    chain,
    createTempFiles,
    temp,
    writes,
    setDownloaded(value: Uint8Array) { downloaded = value; },
  };
}

function run(fake = harness(), overrides: Record<string, unknown> = {}) {
  return persistVerifiedEvidence(
    { canonicalBytes: BYTES, envelopeDigest: DIGEST, ...overrides },
    fake.deps,
    { confirmations: 3, operationTimeoutMs: 100 },
  );
}

async function expectCode(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ name: "StorageProofError", code });
}

describe("strict 0G Storage evidence", () => {
  it("uploads exact bytes, finalizes the real transaction, and retrieves with proof", async () => {
    const fake = harness();
    const result = await run(fake);

    expect(fake.writes).toEqual([BYTES]);
    expect(fake.storage.upload).toHaveBeenCalledWith(fake.temp.uploadPath);
    expect(fake.chain.waitForTransaction).toHaveBeenCalledWith(TX_HASH, 3, 100);
    expect(fake.storage.download).toHaveBeenCalledWith(ROOT, fake.temp.downloadPath, true);
    expect(result).toEqual({
      envelopeDigest: DIGEST,
      storageRoot: ROOT,
      uploadTxHash: TX_HASH,
      retrievedDigest: DIGEST,
      finalizedAtBlock: "102",
      retrievalVerified: true,
    });
    expect(fake.temp.cleanup).toHaveBeenCalledOnce();
  });

  it("snapshots caller-owned bytes before asynchronous work", async () => {
    const bytes = Uint8Array.from(BYTES);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const fake = harness({ upload: async () => { await waiting; return { storageRoot: ROOT, uploadTxHash: TX_HASH }; } });
    const result = persistVerifiedEvidence(
      { canonicalBytes: bytes, envelopeDigest: DIGEST },
      fake.deps,
      { confirmations: 3, operationTimeoutMs: 100 },
    );
    await vi.waitFor(() => expect(fake.writes).toHaveLength(1));
    bytes.fill(0);
    release();

    await expect(result).resolves.toMatchObject({ envelopeDigest: DIGEST });
    expect(fake.writes[0]).toEqual(BYTES);
  });

  it.each([
    ["empty bytes", new Uint8Array(), DIGEST, "INVALID_INPUT"],
    ["wrong runtime input", "not bytes", DIGEST, "INVALID_INPUT"],
    ["zero digest", BYTES, ZERO, "INVALID_DIGEST"],
    ["malformed digest", BYTES, "0x1234", "INVALID_DIGEST"],
    ["content/digest mismatch", BYTES, ROOT, "DIGEST_MISMATCH"],
  ])("rejects %s before creating files", async (_name, bytes, digest, code) => {
    const fake = harness();
    await expectCode(run(fake, { canonicalBytes: bytes, envelopeDigest: digest }), code);
    expect(fake.createTempFiles).not.toHaveBeenCalled();
    expect(fake.storage.upload).not.toHaveBeenCalled();
  });

  it("rejects oversized evidence before creating files", async () => {
    const bytes = new Uint8Array(33);
    const fake = harness();
    await expectCode(
      persistVerifiedEvidence(
        { canonicalBytes: bytes, envelopeDigest: keccak256(bytes) as Bytes32 },
        fake.deps,
        { maxEvidenceBytes: 32 },
      ),
      "EVIDENCE_TOO_LARGE",
    );
    expect(fake.createTempFiles).not.toHaveBeenCalled();
  });

  it.each([
    ["zero root", { storageRoot: ZERO, uploadTxHash: TX_HASH }, "INVALID_STORAGE_ROOT"],
    ["malformed root", { storageRoot: "sha256:abc", uploadTxHash: TX_HASH }, "INVALID_STORAGE_ROOT"],
    ["missing root", { uploadTxHash: TX_HASH }, "INVALID_STORAGE_ROOT"],
    ["zero transaction", { storageRoot: ROOT, uploadTxHash: ZERO }, "INVALID_UPLOAD_TX"],
    ["malformed transaction", { storageRoot: ROOT, uploadTxHash: "0x1234" }, "INVALID_UPLOAD_TX"],
    ["missing transaction", { storageRoot: ROOT }, "INVALID_UPLOAD_TX"],
  ])("rejects a synthetic or malformed %s", async (_name, upload, code) => {
    const fake = harness({ upload: async () => upload as never });
    await expectCode(run(fake), code);
    expect(fake.chain.waitForTransaction).not.toHaveBeenCalled();
    expect(fake.storage.download).not.toHaveBeenCalled();
    expect(fake.temp.cleanup).toHaveBeenCalledOnce();
  });

  it("stops on upload errors with no content-hash fallback", async () => {
    const fake = harness({ upload: async () => { throw new Error("offline"); } });
    await expectCode(run(fake), "UPLOAD_FAILED");
    expect(fake.chain.waitForTransaction).not.toHaveBeenCalled();
    expect(fake.storage.download).not.toHaveBeenCalled();
  });

  it("stops an upload timeout and still cleans temporary files", async () => {
    const fake = harness({ upload: () => new Promise(() => undefined) });
    await expectCode(
      persistVerifiedEvidence(
        { canonicalBytes: BYTES, envelopeDigest: DIGEST },
        fake.deps,
        { operationTimeoutMs: 5 },
      ),
      "UPLOAD_TIMEOUT",
    );
    expect(fake.temp.cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing receipt", async () => null, "UPLOAD_UNFINALIZED"],
    ["failed receipt", async () => ({ transactionHash: TX_HASH, status: 0, blockNumber: "100", finalizedAtBlock: "102", confirmations: 3 }), "UPLOAD_REVERTED"],
    ["wrong receipt transaction", async () => ({ transactionHash: OTHER_TX, status: 1, blockNumber: "100", finalizedAtBlock: "102", confirmations: 3 }), "UPLOAD_TX_MISMATCH"],
    ["insufficient confirmations", async () => ({ transactionHash: TX_HASH, status: 1, blockNumber: "100", finalizedAtBlock: "101", confirmations: 2 }), "UPLOAD_UNFINALIZED"],
    ["early finalized block", async () => ({ transactionHash: TX_HASH, status: 1, blockNumber: "100", finalizedAtBlock: "101", confirmations: 3 }), "UPLOAD_UNFINALIZED"],
    ["malformed receipt block", async () => ({ transactionHash: TX_HASH, status: 1, blockNumber: "1e2", finalizedAtBlock: "102", confirmations: 3 }), "UPLOAD_UNFINALIZED"],
    ["overflow receipt block", async () => ({ transactionHash: TX_HASH, status: 1, blockNumber: (1n << 64n).toString(), finalizedAtBlock: (1n << 64n).toString(), confirmations: 3 }), "UPLOAD_UNFINALIZED"],
  ])("rejects %s", async (_name, wait, code) => {
    const fake = harness({ wait: wait as ChainFinalityAdapter["waitForTransaction"] });
    await expectCode(run(fake), code);
    expect(fake.storage.download).not.toHaveBeenCalled();
  });

  it("stops when waiting for finality throws", async () => {
    const fake = harness({ wait: async () => { throw new Error("rpc down"); } });
    await expectCode(run(fake), "FINALITY_FAILED");
    expect(fake.storage.download).not.toHaveBeenCalled();
  });

  it("bounds a finality adapter that ignores its timeout argument", async () => {
    const fake = harness({ wait: () => new Promise(() => undefined) });
    await expectCode(
      persistVerifiedEvidence(
        { canonicalBytes: BYTES, envelopeDigest: DIGEST },
        fake.deps,
        { operationTimeoutMs: 5 },
      ),
      "UPLOAD_UNFINALIZED",
    );
    expect(fake.storage.download).not.toHaveBeenCalled();
  });

  it("stops when retrieval or proof validation fails", async () => {
    const fake = harness({ download: async () => { throw new Error("invalid Merkle proof"); } });
    await expectCode(run(fake), "RETRIEVAL_FAILED");
    expect(fake.storage.download).toHaveBeenCalledWith(ROOT, fake.temp.downloadPath, true);
  });

  it("stops a retrieval timeout", async () => {
    const fake = harness({ download: () => new Promise(() => undefined) });
    await expectCode(
      persistVerifiedEvidence(
        { canonicalBytes: BYTES, envelopeDigest: DIGEST },
        fake.deps,
        { confirmations: 3, operationTimeoutMs: 5 },
      ),
      "RETRIEVAL_TIMEOUT",
    );
  });

  it("rejects byte mismatch after successful proof retrieval", async () => {
    const fake = harness({ downloaded: toUtf8Bytes('{"proof":"tampered"}') });
    await expectCode(run(fake), "RETRIEVED_BYTES_MISMATCH");
  });

  it("rejects invalid safety options", async () => {
    const fake = harness();
    await expectCode(
      persistVerifiedEvidence(
        { canonicalBytes: BYTES, envelopeDigest: DIGEST },
        fake.deps,
        { confirmations: 0, operationTimeoutMs: 100 },
      ),
      "INVALID_OPTIONS",
    );
    expect(fake.storage.upload).not.toHaveBeenCalled();
  });

  it("does not report a verified commitment when secure cleanup fails", async () => {
    const fake = harness();
    fake.temp.cleanup = vi.fn(async () => { throw new Error("disk busy"); });
    await expectCode(run(fake), "TEMP_FILE_FAILED");
  });

  it("uses collision-resistant private files and cleans both paths", async () => {
    const first = await createSecureTempFiles();
    const second = await createSecureTempFiles();
    expect(first.uploadPath).not.toBe(second.uploadPath);
    await first.writeUpload(BYTES);
    await writeFile(first.downloadPath, BYTES, { flag: "wx" });
    await expect(first.readDownload(BYTES.length)).resolves.toEqual(BYTES);
    await first.cleanup();
    await expect(access(first.uploadPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(first.downloadPath)).rejects.toMatchObject({ code: "ENOENT" });
    await second.cleanup();
  });

  it("refuses a symlink at the SDK download destination", async () => {
    const files = await createSecureTempFiles();
    try {
      await files.writeUpload(BYTES);
      await symlink(files.uploadPath, files.downloadPath);
      await expect(files.readDownload()).rejects.toBeInstanceOf(Error);
    } finally {
      await files.cleanup();
    }
  });

  it("bounds the retrieved file before reading it into memory", async () => {
    const files = await createSecureTempFiles();
    try {
      await writeFile(files.downloadPath, new Uint8Array(33), { flag: "wx" });
      await expect(files.readDownload(32)).rejects.toThrow("bounded regular file");
    } finally {
      await files.cleanup();
    }
  });

  it("runtime-validates both upload result shapes exposed by SDK 1.2.11", () => {
    expect(parseZeroGUploadResult({ rootHash: ROOT, txHash: TX_HASH })).toEqual({
      storageRoot: ROOT,
      uploadTxHash: TX_HASH,
    });
    expect(parseZeroGUploadResult({ rootHashes: [ROOT], txHashes: [TX_HASH] })).toEqual({
      storageRoot: ROOT,
      uploadTxHash: TX_HASH,
    });
    expect(parseZeroGUploadResult({ rootHashes: [ROOT, ROOT], txHashes: [TX_HASH, TX_HASH] }))
      .toEqual({ storageRoot: "", uploadTxHash: "" });
    expect(parseZeroGUploadResult(null)).toEqual({ storageRoot: "", uploadTxHash: "" });
  });

  it("rejects invalid SDK endpoint configuration without making a network call", () => {
    expect(() => createZeroGStorageAdapter({
      indexerRpc: "file:///etc/passwd",
      chainRpc: "https://evmrpc.0g.ai",
      signer: {} as never,
    })).toThrowError(expect.objectContaining({ code: "INVALID_OPTIONS" }));
  });
});
