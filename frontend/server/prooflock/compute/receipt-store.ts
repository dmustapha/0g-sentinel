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
    return this.withGlobalLock(async () => {
      const now = this.clock();
      await this.collectExpired(now);
      const keyHash = stableHash(key);
      const current = await this.read(keyHash);
      if (current) return null;
      const record = this.newRecord(keyHash, metadata, now + leaseMs);
      await this.assertCapacity(Buffer.byteLength(JSON.stringify(record)));
      await this.write(record);
      return record.token;
    });
  }

  async renew(key: string, token: string, leaseMs: number) {
    validateLeaseDuration(leaseMs);
    await this.withGlobalLock(async () => {
      const now = this.clock();
      const record = await this.pending(stableHash(key), token, now);
      await this.write({ ...record, expiresAt: now + leaseMs });
    });
  }

  async commit(key: string, token: string, retentionMs: number) {
    validateRetention(retentionMs);
    await this.withGlobalLock(async () => {
      const now = this.clock();
      const record = await this.pending(stableHash(key), token, now);
      await this.write({ ...record, state: "COMMITTED", retentionUntil: now + retentionMs });
    });
  }

  async release(key: string, token: string) {
    await this.withGlobalLock(async () => {
      const record = await this.read(stableHash(key));
      if (record?.state === "CLAIMED" && record.token === token) await this.removeRecord(record.keyHash);
    });
  }

  private async pending(keyHash: string, token: string, now: number) {
    const record = await this.read(keyHash);
    if (!record || record.state !== "CLAIMED" || record.token !== token || record.expiresAt <= now) storeConflict();
    return record;
  }

  private newRecord(keyHash: string, metadata: ReceiptClaimMetadata, expiresAt: number) {
    return recordSchema.parse({ version: 1, keyHash, token: hexlify(randomBytes(32)), state: "CLAIMED", metadata, expiresAt });
  }

  private async withGlobalLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureDirectory();
    const lock = await acquireGlobalLock(this.options.stateDirectory);
    try {
      return await operation();
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

  private async read(keyHash: string): Promise<ReceiptRecord | null> {
    let handle;
    try {
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

  private async write(record: ReceiptRecord) {
    const target = this.path(record.keyHash);
    const temporary = `${target}.${record.token.slice(2)}.tmp`;
    let handle;
    try {
      handle = await open(temporary, writeFlags(), 0o600);
      await handle.writeFile(JSON.stringify(record), { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, target);
      await syncDirectory(this.options.stateDirectory);
    } finally {
      await handle?.close();
      await unlink(temporary).catch((error) => { if (errorCode(error) !== "ENOENT") throw error; });
    }
  }

  private async removeRecord(keyHash: string) {
    await unlink(this.path(keyHash));
    await syncDirectory(this.options.stateDirectory);
  }

  private async collectExpired(now: number) {
    const entries = await readdir(this.options.stateDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new TypeError("unsafe state entry");
      const record = await this.read(entry.name.slice(0, 64));
      if (record && expired(record, now)) await this.removeRecord(record.keyHash);
    }
  }

  private async assertCapacity(incomingBytes: number) {
    const entries = await readdir(this.options.stateDirectory, { withFileTypes: true });
    const records = entries.filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry.name));
    let bytes = 0;
    for (const entry of records) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new TypeError("unsafe state entry");
      bytes += (await lstat(join(this.options.stateDirectory, entry.name))).size;
    }
    if (records.length >= this.maximumRecords || bytes + incomingBytes > this.maximumBytes) storeFull("durable receipt store is full");
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
      const heartbeat = setInterval(() => void touch(owner, lock), LOCK_STALE_MS / 3);
      heartbeat.unref();
      return { release: () => releaseGlobalLock(directory, lock, owner, token, heartbeat) };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      await recoverStaleLock(directory, lock);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw computeFailure("COMPUTE_BROKER_ERROR", "receipt store lock is unavailable");
}

async function touch(owner: string, lock: string) {
  const now = new Date();
  await utimes(owner, now, now).catch(() => undefined);
  await utimes(lock, now, now).catch(() => undefined);
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

async function releaseGlobalLock(directory: string, lock: string, owner: string, token: string, heartbeat: NodeJS.Timeout) {
  clearInterval(heartbeat);
  let handle;
  try {
    handle = await open(owner, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    if ((await handle.readFile({ encoding: "utf8" })) !== token) return;
  } catch (error) { if (errorCode(error) === "ENOENT") return; throw error; }
  finally { await handle?.close(); }
  const released = join(directory, `.store.release-${token}`);
  try {
    await rename(lock, released);
    await syncDirectory(directory);
    await rm(released, { recursive: true, force: true });
    await syncDirectory(directory);
  } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
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
