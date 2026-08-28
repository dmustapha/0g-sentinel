import { access, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FixedPriceFlow__factory } from "@0gfoundation/0g-storage-ts-sdk";
import { keccak256, toUtf8Bytes } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  STORAGE_VERIFICATION_CAPABILITY,
  computeZeroGLayout,
  createFileUploadJournal,
  createSecureTempFiles,
  parseZeroGUploadResult,
  persistVerifiedEvidence,
  type ChainFinalityAdapter,
  type StorageAdapter,
  type StorageLayout,
  type StorageTempFiles,
  type UploadJournal,
  type UploadJournalEntry,
} from "../../server/prooflock/storage";
import type { Bytes32 } from "../../server/prooflock/types";

const FLOW = "0x62d4144db0f0a6fbbaeb6296c785c71b3d57c526" as const;
const SENDER = "0x4444444444444444444444444444444444444444" as const;
const ROOT = `0x${"11".repeat(32)}` as Bytes32;
const OTHER_ROOT = `0x${"12".repeat(32)}` as Bytes32;
const TX_HASH = `0x${"22".repeat(32)}` as Bytes32;
const OTHER_TX = `0x${"33".repeat(32)}` as Bytes32;
const BLOCK_HASH = `0x${"44".repeat(32)}` as Bytes32;
const ZERO = `0x${"00".repeat(32)}` as Bytes32;
const IDENTITY = `0x${"55".repeat(32)}` as Bytes32;
const BYTES = toUtf8Bytes('{"proof":"canonical"}');
const DIGEST = keccak256(BYTES) as Bytes32;
const FLOW_INTERFACE = FixedPriceFlow__factory.createInterface();

function submission(root = ROOT) {
  return {
    data: { length: BYTES.length, tags: "0x", nodes: [{ root, height: 0 }] },
    submitter: SENDER,
  };
}

function layout(root = ROOT): StorageLayout {
  const value = submission(root);
  return {
    storageRoot: root,
    submission: {
      data: {
        length: value.data.length.toString(),
        tags: value.data.tags,
        nodes: value.data.nodes.map((node) => ({ root: node.root, height: node.height.toString() })),
      },
      submitter: value.submitter,
    },
  };
}

function flowLog(root: Bytes32 = ROOT, address: string = FLOW, sender: string = SENDER) {
  const data = submission(root).data;
  const encoded = FLOW_INTERFACE.encodeEventLog(
    FLOW_INTERFACE.getEvent("Submit"),
    [sender, IDENTITY, 7, 0, BYTES.length, data],
  );
  return { address, topics: encoded.topics, data: encoded.data };
}

function finalizedReceipt(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 16661,
    transactionHash: TX_HASH,
    status: 1,
    blockNumber: "100",
    blockHash: BLOCK_HASH,
    finalizedAtBlock: "102",
    confirmations: 3,
    from: SENDER,
    to: FLOW,
    input: FLOW_INTERFACE.encodeFunctionData("submit", [submission()]),
    logs: [flowLog()],
    ...overrides,
  };
}

class MemoryJournal implements UploadJournal {
  readonly entries = new Map<string, UploadJournalEntry>();
  readonly writes: UploadJournalEntry[] = [];

  async get(root: Bytes32) { return this.entries.get(root) ?? null; }
  async record(entry: UploadJournalEntry) {
    this.entries.set(entry.storageRoot, Object.freeze({ ...entry }));
    this.writes.push(entry);
  }
  recordSubmitted(entry: UploadJournalEntry) {
    this.entries.set(entry.storageRoot, Object.freeze({ ...entry }));
    this.writes.push(entry);
  }
}

type HarnessOptions = {
  layouts?: StorageLayout[];
  upload?: StorageAdapter["upload"];
  wait?: ChainFinalityAdapter["waitForTransaction"];
  download?: StorageAdapter["download"];
  downloaded?: Uint8Array;
  journal?: MemoryJournal;
};

function harness(options: HarnessOptions = {}) {
  const writes: Uint8Array[] = [];
  let downloaded = options.downloaded ?? BYTES;
  const layouts = [...(options.layouts ?? [layout()])];
  let lastLayout = layouts[layouts.length - 1];
  const temp: StorageTempFiles = {
    uploadPath: "/isolated/upload.json",
    downloadPath: "/isolated/download.json",
    writeUpload: async (bytes) => { writes.push(Uint8Array.from(bytes)); },
    readDownload: async () => Uint8Array.from(downloaded),
    cleanup: vi.fn(async () => undefined),
  };
  const createTempFiles = vi.fn(async () => temp);
  const storage: StorageAdapter = {
    computeLayout: vi.fn(async () => {
      lastLayout = layouts.shift() ?? lastLayout;
      return lastLayout;
    }),
    upload: vi.fn(options.upload ?? (async (_path, _expectedRoot, onBroadcast) => {
      onBroadcast(TX_HASH);
      return { storageRoot: ROOT, uploadTxHash: TX_HASH, chainId: 16661, flowAddress: FLOW };
    })),
    download: vi.fn(options.download ?? (async () => undefined)),
  };
  const chain: ChainFinalityAdapter = {
    waitForTransaction: vi.fn(options.wait ?? (async () => finalizedReceipt())),
  };
  const journal = options.journal ?? new MemoryJournal();
  return {
    deps: { storage, chain, journal, createTempFiles }, storage, chain, journal,
    createTempFiles, temp, writes,
    setDownloaded(value: Uint8Array) { downloaded = value; },
  };
}

function run(fake = harness(), overrides: Record<string, unknown> = {}) {
  return persistVerifiedEvidence(
    { canonicalBytes: BYTES, envelopeDigest: DIGEST, ...overrides },
    fake.deps,
    { confirmations: 3, receiptTimeoutMs: 100, expectedFlowAddress: FLOW },
  );
}

async function expectCode(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ name: "StorageProofError", code });
}

describe("strict 0G Storage evidence", () => {
  it("binds exact bytes, local 0G root, Flow transaction, retrieval, and digest", async () => {
    const fake = harness();
    const result = await run(fake);
    expect(fake.writes).toEqual([BYTES]);
    expect(fake.storage.upload).toHaveBeenCalledWith(fake.temp.uploadPath, ROOT, expect.any(Function));
    expect(fake.chain.waitForTransaction).toHaveBeenCalledWith(TX_HASH, 3, 100);
    expect(fake.storage.download).toHaveBeenCalledWith(ROOT, fake.temp.downloadPath, true);
    expect(result).toEqual({
      envelopeDigest: DIGEST, storageRoot: ROOT, uploadTxHash: TX_HASH,
      retrievedDigest: DIGEST, finalizedAtBlock: "102", retrievalVerified: true,
    });
    expect(fake.journal.writes.map((entry) => entry.status)).toEqual([
      "PREPARED", "SUBMITTED", "SUBMITTED", "FINALIZED",
    ]);
    expect(fake.temp.cleanup).toHaveBeenCalledOnce();
  });

  it("defines retrievalVerified without claiming SDK network-proof validation", () => {
    expect(STORAGE_VERIFICATION_CAPABILITY).toEqual({
      localRootVerified: true,
      exactBytesVerified: true,
      digestVerified: true,
      networkProofVerified: false,
      sdkProofParameter: "REQUESTED_NOT_VALIDATED_BY_SDK_1_2_11",
    });
  });

  it("recomputes the exact SDK 0G root and submission layout from bytes", async () => {
    const actual = await computeZeroGLayout(BYTES, SENDER);
    expect(actual.storageRoot).toBe(
      "0xa36249a09a47c5eec4c9b85892b2e0b44e4280acebe6add0e683f462cfc01467",
    );
    expect(actual.submission).toMatchObject({
      data: { length: BYTES.length.toString(), tags: "0x" }, submitter: SENDER,
    });
  });

  it("accepts only one-file SDK upload result shapes", () => {
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
  });

  it("rejects a returned root that differs from the pre-upload local root", async () => {
    const fake = harness({
      upload: async (_path, _root, onBroadcast) => {
        onBroadcast(TX_HASH);
        return { storageRoot: OTHER_ROOT, uploadTxHash: TX_HASH, chainId: 16661, flowAddress: FLOW };
      },
    });
    await expectCode(run(fake), "LOCAL_ROOT_MISMATCH");
    expect(fake.chain.waitForTransaction).not.toHaveBeenCalled();
  });

  it("rejects retrieved bytes whose independently recomputed 0G root differs", async () => {
    const fake = harness({ layouts: [layout(), layout(OTHER_ROOT)] });
    await expectCode(run(fake), "RETRIEVED_ROOT_MISMATCH");
  });

  it("snapshots caller-owned bytes before asynchronous work", async () => {
    const bytes = Uint8Array.from(BYTES);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const fake = harness({
      upload: async (_path, _root, onBroadcast) => {
        await waiting;
        onBroadcast(TX_HASH);
        return { storageRoot: ROOT, uploadTxHash: TX_HASH, chainId: 16661, flowAddress: FLOW };
      },
    });
    const result = persistVerifiedEvidence(
      { canonicalBytes: bytes, envelopeDigest: DIGEST }, fake.deps,
      { confirmations: 3, receiptTimeoutMs: 100, expectedFlowAddress: FLOW },
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
  });

  it("rejects oversized evidence and invalid safety options before side effects", async () => {
    const bytes = new Uint8Array(33);
    const fake = harness();
    await expectCode(
      persistVerifiedEvidence(
        { canonicalBytes: bytes, envelopeDigest: keccak256(bytes) as Bytes32 },
        fake.deps,
        { maxEvidenceBytes: 32, expectedFlowAddress: FLOW },
      ),
      "EVIDENCE_TOO_LARGE",
    );
    await expectCode(
      persistVerifiedEvidence(
        { canonicalBytes: BYTES, envelopeDigest: DIGEST },
        fake.deps,
        { confirmations: 0, expectedFlowAddress: FLOW },
      ),
      "INVALID_OPTIONS",
    );
    expect(fake.storage.upload).not.toHaveBeenCalled();
  });

  it.each([
    ["zero root", { storageRoot: ZERO, uploadTxHash: TX_HASH, chainId: 16661, flowAddress: FLOW }, "INVALID_STORAGE_ROOT"],
    ["missing root", { uploadTxHash: TX_HASH, chainId: 16661, flowAddress: FLOW }, "INVALID_STORAGE_ROOT"],
    ["zero transaction", { storageRoot: ROOT, uploadTxHash: ZERO, chainId: 16661, flowAddress: FLOW }, "INVALID_UPLOAD_TX"],
    ["wrong upload chain", { storageRoot: ROOT, uploadTxHash: TX_HASH, chainId: 1, flowAddress: FLOW }, "WRONG_STORAGE_CHAIN"],
    ["wrong discovered Flow", { storageRoot: ROOT, uploadTxHash: TX_HASH, chainId: 16661, flowAddress: SENDER }, "WRONG_FLOW_CONTRACT"],
  ])("rejects malformed upload provenance: %s", async (_name, upload, code) => {
    const fake = harness({ upload: async () => upload as never });
    await expectCode(run(fake), code);
    expect(fake.chain.waitForTransaction).not.toHaveBeenCalled();
  });

  it("never races cleanup against a late upload", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const fake = harness({
      upload: async (_path, _root, onBroadcast) => {
        await waiting;
        onBroadcast(TX_HASH);
        return { storageRoot: ROOT, uploadTxHash: TX_HASH, chainId: 16661, flowAddress: FLOW };
      },
    });
    const result = run(fake);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.temp.cleanup).not.toHaveBeenCalled();
    release();
    await expect(result).resolves.toMatchObject({ storageRoot: ROOT });
    expect(fake.temp.cleanup).toHaveBeenCalledOnce();
  });

  it("never races cleanup against a late retrieval", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const fake = harness({ download: async () => { await waiting; } });
    const result = run(fake);
    await vi.waitFor(() => expect(fake.storage.download).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.temp.cleanup).not.toHaveBeenCalled();
    release();
    await expect(result).resolves.toMatchObject({ storageRoot: ROOT });
  });

  it("persists a broadcast transaction even when the SDK later fails", async () => {
    const journal = new MemoryJournal();
    const first = harness({
      journal,
      upload: async (_path, _root, onBroadcast) => {
        onBroadcast(TX_HASH);
        throw new Error("segments unavailable");
      },
    });
    await expectCode(run(first), "UPLOAD_FAILED");
    expect(await journal.get(ROOT)).toMatchObject({ status: "SUBMITTED", uploadTxHash: TX_HASH });
    const retry = harness({ journal });
    await expect(run(retry)).resolves.toMatchObject({ uploadTxHash: TX_HASH });
    expect(retry.storage.upload).not.toHaveBeenCalled();
  });

  it("retries PREPARED work and reconciles SUBMITTED work", async () => {
    const prepared = new MemoryJournal();
    await prepared.record({ storageRoot: ROOT, status: "PREPARED", updatedAt: "1" });
    const first = harness({ journal: prepared });
    await expect(run(first)).resolves.toMatchObject({ storageRoot: ROOT });
    expect(first.storage.upload).toHaveBeenCalledOnce();

    const submitted = new MemoryJournal();
    submitted.recordSubmitted({ storageRoot: ROOT, uploadTxHash: TX_HASH, status: "SUBMITTED", updatedAt: "1" });
    const retry = harness({ journal: submitted });
    await expect(run(retry)).resolves.toMatchObject({ uploadTxHash: TX_HASH });
    expect(retry.storage.upload).not.toHaveBeenCalled();
  });

  it.each([
    ["missing receipt", null, "UPLOAD_UNFINALIZED"],
    ["failed receipt", finalizedReceipt({ status: 0 }), "UPLOAD_REVERTED"],
    ["wrong receipt transaction", finalizedReceipt({ transactionHash: OTHER_TX }), "UPLOAD_TX_MISMATCH"],
    ["wrong chain", finalizedReceipt({ chainId: 1 }), "WRONG_STORAGE_CHAIN"],
    ["wrong Flow target", finalizedReceipt({ to: SENDER }), "WRONG_FLOW_CONTRACT"],
    ["malformed block hash", finalizedReceipt({ blockHash: "0x1234" }), "UPLOAD_UNFINALIZED"],
    ["insufficient confirmations", finalizedReceipt({ finalizedAtBlock: "101", confirmations: 2 }), "UPLOAD_UNFINALIZED"],
  ])("rejects receipt provenance: %s", async (_name, receipt, code) => {
    const fake = harness({ wait: async () => receipt as never });
    await expectCode(run(fake), code);
    expect(fake.storage.download).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong root in submit calldata", finalizedReceipt({ input: FLOW_INTERFACE.encodeFunctionData("submit", [submission(OTHER_ROOT)]) }), "FLOW_SUBMISSION_MISMATCH"],
    ["wrong root in Submit event", finalizedReceipt({ logs: [flowLog(OTHER_ROOT)] }), "FLOW_EVENT_MISMATCH"],
    ["wrong event emitter", finalizedReceipt({ logs: [flowLog(ROOT, SENDER)] }), "FLOW_EVENT_MISSING"],
    ["missing Submit event", finalizedReceipt({ logs: [] }), "FLOW_EVENT_MISSING"],
    ["duplicate Submit events", finalizedReceipt({ logs: [flowLog(), flowLog()] }), "FLOW_EVENT_MISMATCH"],
    ["malformed transaction input", finalizedReceipt({ input: "0x1234" }), "FLOW_SUBMISSION_MISMATCH"],
    ["wrong Submit sender", finalizedReceipt({ logs: [flowLog(ROOT, FLOW, "0x6666666666666666666666666666666666666666")] }), "FLOW_EVENT_MISMATCH"],
  ])("rejects Flow binding: %s", async (_name, receipt, code) => {
    const fake = harness({ wait: async () => receipt as never });
    await expectCode(run(fake), code);
    expect(fake.storage.download).not.toHaveBeenCalled();
  });

  it("stops when finality or retrieval fails", async () => {
    await expectCode(run(harness({ wait: async () => { throw new Error("rpc down"); } })), "FINALITY_FAILED");
    await expectCode(run(harness({ download: async () => { throw new Error("offline"); } })), "RETRIEVAL_FAILED");
  });

  it("rejects byte mismatch after retrieval", async () => {
    await expectCode(run(harness({ downloaded: toUtf8Bytes('{"proof":"tampered"}') })), "RETRIEVED_BYTES_MISMATCH");
  });

  it("uses collision-resistant files, rejects symlinks, and bounds reads", async () => {
    const first = await createSecureTempFiles();
    const second = await createSecureTempFiles();
    expect(first.uploadPath).not.toBe(second.uploadPath);
    await first.writeUpload(BYTES);
    await symlink(first.uploadPath, first.downloadPath);
    await expect(first.readDownload()).rejects.toBeInstanceOf(Error);
    await first.cleanup();
    await expect(access(first.uploadPath)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(second.downloadPath, new Uint8Array(33), { flag: "wx" });
    await expect(second.readDownload(32)).rejects.toThrow("bounded regular file");
    await second.cleanup();
  });

  it("persists journaled broadcast state across journal instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prooflock-journal-test-"));
    try {
      const first = createFileUploadJournal(directory);
      first.recordSubmitted({
        storageRoot: ROOT,
        uploadTxHash: TX_HASH,
        status: "SUBMITTED",
        updatedAt: "1",
      });
      const reopened = createFileUploadJournal(directory);
      await expect(reopened.get(ROOT)).resolves.toMatchObject({
        storageRoot: ROOT,
        uploadTxHash: TX_HASH,
        status: "SUBMITTED",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("attaches cleanup failure to the primary failure", async () => {
    const fake = harness({ upload: async () => { throw new Error("offline"); } });
    fake.temp.cleanup = vi.fn(async () => { throw new Error("cleanup failed"); });
    const error = await run(fake).catch((caught) => caught);
    expect(error).toMatchObject({ code: "UPLOAD_FAILED", cleanupFailure: expect.any(Error) });
  });

  it("withholds a verified result when cleanup fails after success", async () => {
    const fake = harness();
    fake.temp.cleanup = vi.fn(async () => { throw new Error("cleanup failed"); });
    await expectCode(run(fake), "TEMP_FILE_FAILED");
  });
});
