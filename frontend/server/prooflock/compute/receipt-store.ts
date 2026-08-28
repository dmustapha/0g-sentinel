import { hexlify, randomBytes, sha256, toUtf8Bytes } from "ethers";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { z } from "zod";

import { computeFailure } from "./strict-error";

export const MIN_COMMITTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_PENDING_LEASE_MS = 15 * 60 * 1_000;

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

/** Bounded process-local helper for tests; production uses the SQLite store. */
export class MemoryReceiptClaimStore implements ReceiptClaimStore {
  private readonly records = new Map<string, MemoryRecord>();

  constructor(private readonly maximum = 10_000, private readonly clock = Date.now) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100_000) {
      throw new TypeError("MemoryReceiptClaimStore maximum is out of bounds");
    }
  }

  async claim(key: string, metadata: ReceiptClaimMetadata, leaseMs: number) {
    const now = this.clock();
    validateLeaseDuration(leaseMs);
    const existing = this.records.get(key);
    if (existing && !expired(existing, now)) return null;
    if (existing) this.records.delete(key);
    if (this.records.size >= this.maximum) storeFull("test-only receipt store is full");
    const token = randomToken();
    this.records.set(key, {
      token,
      state: "CLAIMED",
      metadata: Object.freeze({ ...metadata }),
      expiresAt: now + leaseMs,
    });
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
    if (!record || record.token !== token || record.state !== "CLAIMED" || record.expiresAt <= now) {
      storeConflict();
    }
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

/** Durable transactional store. The historical class name is retained for API compatibility. */
export class FileReceiptClaimStore implements ReceiptClaimStore {
  private readonly maximumRecords: number;
  private readonly maximumBytes: number;
  private readonly clock: () => number;
  private readonly databasePath: string;

  constructor(private readonly options: FileReceiptClaimStoreOptions) {
    if (!isAbsolute(options.stateDirectory)) throw new TypeError("state directory must be absolute");
    this.maximumRecords = options.maximumRecords ?? 10_000;
    this.maximumBytes = options.maximumBytes ?? 16 * 1_024 * 1_024;
    this.clock = options.clock ?? Date.now;
    this.databasePath = join(options.stateDirectory, "receipts.sqlite");
    validateCapacity(this.maximumRecords, this.maximumBytes);
  }

  async claim(key: string, metadata: ReceiptClaimMetadata, leaseMs: number) {
    validateLeaseDuration(leaseMs);
    return this.transaction((database) => {
      const now = this.clock();
      collectExpired(database, now);
      const keyHash = stableHash(key);
      if (selectRecord(database, keyHash)) return null;
      const record = newRecord(keyHash, metadata, now + leaseMs);
      this.assertCapacity(database, null, record);
      insertRecord(database, record);
      return record.token;
    });
  }

  async renew(key: string, token: string, leaseMs: number) {
    validateLeaseDuration(leaseMs);
    await this.transaction((database) => {
      const now = this.clock();
      collectExpired(database, now);
      const current = pendingRecord(database, stableHash(key), token, now);
      const updated = { ...current, expiresAt: now + leaseMs };
      this.assertCapacity(database, current, updated);
      replaceRecord(database, updated);
    });
  }

  async commit(key: string, token: string, retentionMs: number) {
    validateRetention(retentionMs);
    await this.transaction((database) => {
      const now = this.clock();
      collectExpired(database, now);
      const current = pendingRecord(database, stableHash(key), token, now);
      const updated = recordSchema.parse({
        ...current,
        state: "COMMITTED",
        retentionUntil: now + retentionMs,
      });
      this.assertCapacity(database, current, updated);
      replaceRecord(database, updated);
    });
  }

  async release(key: string, token: string) {
    await this.transaction((database) => {
      collectExpired(database, this.clock());
      database.prepare(
        "DELETE FROM receipts WHERE key_hash = ? AND token = ? AND state = 'CLAIMED'",
      ).run(stableHash(key), token);
    });
  }

  private async transaction<T>(operation: (database: DatabaseSync) => T): Promise<T> {
    await ensureStateDirectory(this.options.stateDirectory, this.databasePath);
    const database = openDatabase(this.databasePath);
    await chmod(this.databasePath, 0o600);
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(database);
      database.exec("COMMIT");
      return result;
    } catch (error) {
      rollback(database);
      throw error;
    } finally {
      database.close();
    }
  }

  private assertCapacity(
    database: DatabaseSync,
    oldRecord: ReceiptRecord | null,
    newRecord: ReceiptRecord,
  ) {
    const totals = database.prepare(
      "SELECT COUNT(*) AS records, COALESCE(SUM(payload_bytes), 0) AS bytes FROM receipts",
    ).get() as { records: number; bytes: number };
    const oldBytes = oldRecord ? serializedBytes(oldRecord) : 0;
    const recordDelta = oldRecord ? 0 : 1;
    if (
      Number(totals.records) + recordDelta > this.maximumRecords ||
      Number(totals.bytes) - oldBytes + serializedBytes(newRecord) > this.maximumBytes
    ) {
      storeFull("durable receipt store is full");
    }
  }
}

async function ensureStateDirectory(directory: string, databasePath: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new TypeError("unsafe state directory");
  }
  await chmod(directory, 0o700);
  try {
    const databaseInfo = await lstat(databasePath);
    if (!databaseInfo.isFile() || databaseInfo.isSymbolicLink()) {
      throw new TypeError("unsafe receipt database");
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

function openDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path, { timeout: 5_000 });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA trusted_schema = OFF");
  database.exec(schema);
  return database;
}

const schema = `
  CREATE TABLE IF NOT EXISTS receipts (
    key_hash TEXT PRIMARY KEY CHECK(
      length(key_hash) = 64 AND key_hash NOT GLOB '*[^0-9a-f]*'
    ),
    token TEXT NOT NULL CHECK(
      length(token) = 66 AND substr(token, 1, 2) = '0x' AND
      substr(token, 3) NOT GLOB '*[^0-9a-f]*'
    ),
    state TEXT NOT NULL CHECK(state IN ('CLAIMED', 'COMMITTED')),
    expires_at INTEGER NOT NULL CHECK(expires_at >= 0),
    retention_until INTEGER,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    payload_bytes INTEGER NOT NULL CHECK(payload_bytes = length(CAST(payload_json AS BLOB))),
    CHECK(json_extract(payload_json, '$.keyHash') = key_hash),
    CHECK(json_extract(payload_json, '$.token') = token),
    CHECK(json_extract(payload_json, '$.state') = state),
    CHECK(json_extract(payload_json, '$.expiresAt') = expires_at),
    CHECK(json_extract(payload_json, '$.retentionUntil') IS retention_until),
    CHECK(
      (state = 'CLAIMED' AND retention_until IS NULL) OR
      (state = 'COMMITTED' AND retention_until IS NOT NULL)
    )
  ) STRICT;
  PRAGMA user_version = 1;
`;

function collectExpired(database: DatabaseSync, now: number) {
  database.prepare(`
    DELETE FROM receipts
    WHERE (state = 'CLAIMED' AND expires_at <= ?)
       OR (state = 'COMMITTED' AND retention_until <= ?)
  `).run(now, now);
}

function selectRecord(database: DatabaseSync, keyHash: string): ReceiptRecord | null {
  const row = database.prepare("SELECT payload_json FROM receipts WHERE key_hash = ?").get(keyHash) as
    | { payload_json: string }
    | undefined;
  return row ? recordSchema.parse(JSON.parse(row.payload_json)) : null;
}

function pendingRecord(database: DatabaseSync, keyHash: string, token: string, now: number) {
  const record = selectRecord(database, keyHash);
  if (!record || record.state !== "CLAIMED" || record.token !== token || record.expiresAt <= now) {
    storeConflict();
  }
  return record;
}

function insertRecord(database: DatabaseSync, record: ReceiptRecord) {
  const serialized = JSON.stringify(record);
  database.prepare(`
    INSERT INTO receipts
      (key_hash, token, state, expires_at, retention_until, payload_json, payload_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(...recordValues(record, serialized));
}

function replaceRecord(database: DatabaseSync, record: ReceiptRecord) {
  const serialized = JSON.stringify(record);
  const result = database.prepare(`
    UPDATE receipts SET
      token = ?, state = ?, expires_at = ?, retention_until = ?, payload_json = ?, payload_bytes = ?
    WHERE key_hash = ?
  `).run(
    record.token,
    record.state,
    record.expiresAt,
    record.retentionUntil ?? null,
    serialized,
    Buffer.byteLength(serialized),
    record.keyHash,
  );
  if (result.changes !== 1) storeConflict();
}

function recordValues(record: ReceiptRecord, serialized: string): SQLInputValue[] {
  return [
    record.keyHash,
    record.token,
    record.state,
    record.expiresAt,
    record.retentionUntil ?? null,
    serialized,
    Buffer.byteLength(serialized),
  ];
}

function rollback(database: DatabaseSync) {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the transaction's original failure.
  }
}

function newRecord(keyHash: string, metadata: ReceiptClaimMetadata, expiresAt: number) {
  return recordSchema.parse({
    version: 1,
    keyHash,
    token: randomToken(),
    state: "CLAIMED",
    metadata,
    expiresAt,
  });
}

const randomToken = () => hexlify(randomBytes(32));
const stableHash = (key: string) => sha256(toUtf8Bytes(key)).slice(2);
const serializedBytes = (record: ReceiptRecord) => Buffer.byteLength(JSON.stringify(record));
const expired = (record: MemoryRecord, now: number) =>
  record.state === "CLAIMED"
    ? record.expiresAt <= now
    : (record.retentionUntil ?? Number.MAX_SAFE_INTEGER) <= now;

function validateCapacity(records: number, bytes: number) {
  if (records < 1 || records > 100_000) throw new TypeError("record capacity out of bounds");
  if (bytes < 4_096 || bytes > 256 * 1_024 * 1_024) {
    throw new TypeError("byte capacity out of bounds");
  }
}

function validateLeaseDuration(duration: number) {
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > MAX_PENDING_LEASE_MS) {
    throw new TypeError("receipt claim lease is out of bounds");
  }
}

function validateRetention(duration: number) {
  if (!Number.isSafeInteger(duration) || duration < MIN_COMMITTED_RETENTION_MS) {
    throw new TypeError("committed receipt retention must be at least 7 days");
  }
}

function storeConflict(): never {
  throw computeFailure("COMPUTE_RECEIPT_REPLAY", "receipt claim token is stale or invalid");
}

function storeFull(message: string): never {
  throw computeFailure("COMPUTE_REPLAY_STORE_FULL", message);
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}
