import { hexlify, randomBytes, sha256, toUtf8Bytes } from "ethers";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, rm, unlink, utimes } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

import { computeFailure } from "./strict-error";

export const MIN_COMMITTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_PENDING_LEASE_MS = 15 * 60 * 1_000;
const LOCK_STALE_MS = 30_000;

export type ReceiptClaimMetadata = Readonly<{
  model: string;
  requestSha256: `0x${string}`;
  responseSha256: `0x${string}`;
}>;

export type ReceiptClaimStore = Readonly<{
  claim(key: string, metadata: ReceiptClaimMetadata, leaseMs: number): Promise<string | null>;
  renew(key: string, token: string, leaseMs: number): Promise<void>;
  commit(key: string, token: string, retentionMs: number): Promise<void>;
  release(key: string, token: string): Promise<void>;
}>;

type MemoryRecord = {
  token: string;
  state: "CLAIMED" | "COMMITTED";
  metadata: ReceiptClaimMetadata;
  expiresAt: number;
  retentionUntil?: number;
};

/** Bounded process-local helper for tests; production must use the file store. */
export class MemoryReceiptClaimStore implements ReceiptClaimStore {
  private readonly records = new Map<string, MemoryRecord>();

  constructor(private readonly maximum = 10_000, private readonly clock = Date.now) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100_000) throw new TypeError("MemoryReceiptClaimStore maximum is out of bounds");
  }

  async claim(key: string, metadata: ReceiptClaimMetadata, leaseMs: number) {
    const now = this.clock();
    validateLeaseDuration(leaseMs);
    const existing = this.records.get(key);
    if (existing && !expired(existing, now)) return null;
    if (existing) this.records.delete(key);
    if (this.records.size >= this.maximum) storeFull("test-only receipt store is full");
    const token = hexlify(randomBytes(32));
    this.records.set(key, { token, state: "CLAIMED", metadata: Object.freeze({ ...metadata }), expiresAt: now + leaseMs });
    return token;
  }

  async renew(key: string, token: string, leaseMs: number) {
    const now = this.clock();
    validateLeaseDuration(leaseMs);
    this.pending(key, token, now).expiresAt = now + leaseMs;
  }

  async commit(key: string, token: string, retentionMs: number) {
    const now = this.clock();
    validateRetention(retentionMs);
    const record = this.pending(key, token, now);
    record.state = "COMMITTED";
    record.retentionUntil = now + retentionMs;
  }

  async release(key: string, token: string) {
    const record = this.records.get(key);
    if (record?.token === token && record.state === "CLAIMED") this.records.delete(key);
  }

  private pending(key: string, token: string, now: number): MemoryRecord {
    const record = this.records.get(key);
    if (!record || record.token !== token || record.state !== "CLAIMED" || record.expiresAt <= now) storeConflict();
    return record;
  }
}

const metadataSchema = z.object({
  model: z.string().trim().min(1).max(256),
  requestSha256: z.string().regex(/^0x[0-9a-f]{64}$/),
  responseSha256: z.string().regex(/^0x[0-9a-f]{64}$/),
}).strict();
const recordSchema = z.object({
  version: z.literal(1),
  keyHash: z.string().regex(/^[0-9a-f]{64}$/),
  token: z.string().regex(/^0x[0-9a-f]{64}$/),
  state: z.enum(["CLAIMED", "COMMITTED"]),
  metadata: metadataSchema,
  expiresAt: z.number().int().safe().nonnegative(),
  retentionUntil: z.number().int().safe().nonnegative().optional(),
}).strict();
type ReceiptRecord = z.infer<typeof recordSchema>;

type FileReceiptClaimStoreOptions = Readonly<{
  stateDirectory: string;
  maximumRecords?: number;
  maximumBytes?: number;
  clock?: () => number;
  /** Deterministic fencing test seam; never configured by production. */
  testBeforeRecordWrite?: () => Promise<void>;
}>;

export class FileReceiptClaimStore implements ReceiptClaimStore {
  private readonly maximumRecords: number;
  private readonly maximumBytes: number;
  private readonly clock: () => number;

  constructor(private readonly options: FileReceiptClaimStoreOptions) {
    if (!isAbsolute(options.stateDirectory)) throw new TypeError("state directory must be absolute");
    this.maximumRecords = options.maximumRecords ?? 10_000;
    this.maximumBytes = options.maximumBytes ?? 16 * 1_024 * 1_024;
    this.clock = options.clock ?? Date.now;
    validateCapacity(this.maximumRecords, this.maximumBytes);
  }

  async claim(key: string, metadata: ReceiptClaimMetadata, leaseMs: number) {
    validateLeaseDuration(leaseMs);
    return this.withGlobalLock(async (fence) => {
      const now = this.clock();
      await this.collectResidue(fence);
      await this.collectExpired(now, fence);
      const keyHash = stableHash(key);
      const current = await this.read(keyHash, fence);
      if (current) return null;
      const record = this.newRecord(keyHash, metadata, now + leaseMs);
      await this.write(record, fence);
      return record.token;
    });
  }

  async renew(key: string, token: string, leaseMs: number) {
    validateLeaseDuration(leaseMs);
    await this.withGlobalLock(async (fence) => {
      const now = this.clock();
      await this.collectResidue(fence);
      const record = await this.pending(stableHash(key), token, now, fence);
      await this.write({ ...record, expiresAt: now + leaseMs }, fence);
    });
  }

  async commit(key: string, token: string, retentionMs: number) {
    validateRetention(retentionMs);
    await this.withGlobalLock(async (fence) => {
      const now = this.clock();
      await this.collectResidue(fence);
      const record = await this.pending(stableHash(key), token, now, fence);
      await this.write({ ...record, state: "COMMITTED", retentionUntil: now + retentionMs }, fence);
    });
  }

  async release(key: string, token: string) {
    await this.withGlobalLock(async (fence) => {
      await this.collectResidue(fence);
      const record = await this.read(stableHash(key), fence);
      if (record?.state === "CLAIMED" && record.token === token) await this.removeRecord(record.keyHash, fence);
    });
  }

  private async pending(keyHash: string, token: string, now: number, fence: LockFence) {
    const record = await this.read(keyHash, fence);
    if (!record || record.state !== "CLAIMED" || record.token !== token || record.expiresAt <= now) storeConflict();
    return record;
  }

  private newRecord(keyHash: string, metadata: ReceiptClaimMetadata, expiresAt: number) {
    return recordSchema.parse({ version: 1, keyHash, token: hexlify(randomBytes(32)), state: "CLAIMED", metadata, expiresAt });
  }

  private async withGlobalLock<T>(operation: (fence: LockFence) => Promise<T>): Promise<T> {
    await this.ensureDirectory();
    const lock = await acquireGlobalLock(this.options.stateDirectory);
    try {
      return await operation(lock);
    } finally {
      await lock.release();
    }
  }

  private async ensureDirectory() {
    await mkdir(this.options.stateDirectory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.options.stateDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("unsafe state directory");
    await chmod(this.options.stateDirectory, 0o700);
  }

  private path(keyHash: string) { return join(this.options.stateDirectory, `${keyHash}.json`); }

  private async read(keyHash: string, fence: LockFence): Promise<ReceiptRecord | null> {
    let handle;
    try {
      await fence.assertOwner();
      handle = await open(this.path(keyHash), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > 8_192) throw new TypeError("unsafe receipt record");
      const record = recordSchema.parse(JSON.parse(await handle.readFile({ encoding: "utf8" })));
      if (record.keyHash !== keyHash) throw new TypeError("receipt key hash mismatch");
      return record;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    } finally { await handle?.close(); }
  }

  private async write(record: ReceiptRecord, fence: LockFence) {
    const target = this.path(record.keyHash);
    const temporary = `${target}.${record.token.slice(2)}.tmp`;
    const serialized = JSON.stringify(record);
    let handle;
    let renamed = false;
    try {
      await this.assertReplacementCapacity(record.keyHash, Buffer.byteLength(serialized), fence);
      await this.options.testBeforeRecordWrite?.();
      await fence.assertOwner();
      handle = await open(temporary, writeFlags(), 0o600);
      await handle.writeFile(serialized, { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fence.assertOwner();
      await rename(temporary, target);
      renamed = true;
      await syncDirectory(this.options.stateDirectory);
    } finally {
      await handle?.close();
      if (!renamed) {
        await fence.assertOwner();
        await unlink(temporary)
          .then(() => syncDirectory(this.options.stateDirectory))
          .catch((error) => {
            if (errorCode(error) !== "ENOENT") throw error;
          });
      }
    }
  }

  private async removeRecord(keyHash: string, fence: LockFence) {
    await fence.assertOwner();
    await unlink(this.path(keyHash));
    await syncDirectory(this.options.stateDirectory);
  }

  private async collectExpired(now: number, fence: LockFence) {
    await fence.assertOwner();
    const entries = await readdir(this.options.stateDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new TypeError("unsafe state entry");
      const record = await this.read(entry.name.slice(0, 64), fence);
      if (record && expired(record, now)) await this.removeRecord(record.keyHash, fence);
    }
  }

  private async assertReplacementCapacity(keyHash: string, incomingBytes: number, fence: LockFence) {
    await fence.assertOwner();
    const entries = await readdir(this.options.stateDirectory, { withFileTypes: true });
    const records = entries.filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry.name));
    let bytes = 0;
    let replacedBytes = 0;
    for (const entry of records) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new TypeError("unsafe state entry");
      await fence.assertOwner();
      const size = (await lstat(join(this.options.stateDirectory, entry.name))).size;
      bytes += size;
      if (entry.name === `${keyHash}.json`) replacedBytes = size;
    }
    const recordDelta = replacedBytes === 0 ? 1 : 0;
    if (records.length + recordDelta > this.maximumRecords || bytes - replacedBytes + incomingBytes > this.maximumBytes) storeFull("durable receipt store is full");
  }

  private async collectResidue(fence: LockFence) {
    await fence.assertOwner();
    const entries = await readdir(this.options.stateDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.endsWith(".tmp")) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new TypeError("unsafe temp residue");
      await fence.assertOwner();
      await unlink(join(this.options.stateDirectory, entry.name));
      await syncDirectory(this.options.stateDirectory);
    }
  }
}

async function acquireGlobalLock(directory: string) {
  const lock = join(directory, ".store.lock");
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const token = hexlify(randomBytes(16)).slice(2);
    try {
      await mkdir(lock, { mode: 0o700 });
      const owner = join(lock, token);
      const handle = await open(owner, writeFlags(), 0o600);
      await handle.writeFile(token);
      await handle.sync();
      await handle.close();
      await syncDirectory(lock);
      return new LockFence(directory, lock, owner, token);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      await recoverStaleLock(directory, lock);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw computeFailure("COMPUTE_BROKER_ERROR", "receipt store lock is unavailable");
}

class LockFence {
  private valid = true;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly directory: string,
    private readonly lock: string,
    private readonly owner: string,
    private readonly token: string,
  ) {
    this.heartbeat = setInterval(() => void this.touch(), LOCK_STALE_MS / 3);
    this.heartbeat.unref();
  }

  async assertOwner(): Promise<void> {
    if (!this.valid) return fenceFailure();
    let handle;
    try {
      const lockInfo = await lstat(this.lock);
      if (!lockInfo.isDirectory() || lockInfo.isSymbolicLink()) return fenceFailure();
      handle = await open(this.owner, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      if ((await handle.readFile({ encoding: "utf8" })) !== this.token) return fenceFailure();
    } catch (error) {
      this.valid = false;
      throw computeFailure("COMPUTE_BROKER_ERROR", "receipt store lock ownership was lost", error);
    } finally {
      await handle?.close();
    }
  }

  async release(): Promise<void> {
    clearInterval(this.heartbeat);
    if (!this.valid) return;
    try {
      await this.assertOwner();
      await releaseGlobalLock(this.directory, this.lock, this.owner, this.token);
    } finally {
      this.valid = false;
    }
  }

  private async touch() {
    try {
      await this.assertOwner();
      const now = new Date();
      await utimes(this.owner, now, now);
      await utimes(this.lock, now, now);
    } catch {
      this.valid = false;
    }
  }
}

async function recoverStaleLock(directory: string, lock: string) {
  let info;
  try { info = await lstat(lock); } catch (error) { if (errorCode(error) === "ENOENT") return; throw error; }
  if (Date.now() - info.mtimeMs <= LOCK_STALE_MS) return;
  const stale = join(directory, `.store.stale-${hexlify(randomBytes(8)).slice(2)}`);
  try {
    await rename(lock, stale);
    await syncDirectory(directory);
    await rm(stale, { recursive: true, force: true });
    await syncDirectory(directory);
  } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
}

async function releaseGlobalLock(directory: string, lock: string, _owner: string, token: string) {
  const released = join(directory, `.store.release-${token}`);
  try {
    await rename(lock, released);
    await syncDirectory(directory);
    await rm(released, { recursive: true, force: true });
    await syncDirectory(directory);
  } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
}

function fenceFailure(): never {
  throw computeFailure("COMPUTE_BROKER_ERROR", "receipt store lock ownership was lost");
}

async function syncDirectory(path: string) {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

const writeFlags = () => fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW;
const stableHash = (key: string) => sha256(toUtf8Bytes(key)).slice(2);
const expired = (record: MemoryRecord | ReceiptRecord, now: number) => record.state === "CLAIMED" ? record.expiresAt <= now : (record.retentionUntil ?? Number.MAX_SAFE_INTEGER) <= now;

function validateCapacity(records: number, bytes: number) {
  if (records < 1 || records > 100_000) throw new TypeError("record capacity out of bounds");
  if (bytes < 4_096 || bytes > 256 * 1_024 * 1_024) throw new TypeError("byte capacity out of bounds");
}
function validateLeaseDuration(duration: number) {
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > MAX_PENDING_LEASE_MS) throw new TypeError("receipt claim lease is out of bounds");
}
function validateRetention(duration: number) {
  if (!Number.isSafeInteger(duration) || duration < MIN_COMMITTED_RETENTION_MS) throw new TypeError("committed receipt retention must be at least 7 days");
}
function storeConflict(): never { throw computeFailure("COMPUTE_RECEIPT_REPLAY", "receipt claim token is stale or invalid"); }
function storeFull(message: string): never { throw computeFailure("COMPUTE_REPLAY_STORE_FULL", message); }
function errorCode(error: unknown) { return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined; }
