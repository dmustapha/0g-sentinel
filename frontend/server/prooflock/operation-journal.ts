import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { canonicalizeStorageCommitment } from "./canonical";
import type { ChainWriteRequest } from "./chain";
import type { Bytes32, HexAddress } from "./types";

export type OperationPhase = "REQUESTED" | "COMPUTE_VERIFIED" | "STORAGE_VERIFIED" | "CHAIN_INPUT_COMMITTED"
  | "SUBMISSION_ATTEMPTED" | "HASH_KNOWN" | "FINALIZED" | "RECOVERY_REQUIRED" | "TERMINAL";
export type PaidStage = "COMPUTE_BEHAVIORAL" | "COMPUTE_CONTRACT" | "STORAGE" | "REGISTRY";
export type PublicWriteOutcome =
  | Readonly<{ status: "NOT_BROADCAST"; recoveryId: string }>
  | Readonly<{ status: "SUBMISSION_OUTCOME_UNKNOWN"; recoveryId: string; transactionHash?: Bytes32 }>
  | Readonly<{ status: "FINALIZED_READBACK_UNAVAILABLE"; recoveryId: string; transactionHash: Bytes32; identityKey: Bytes32; version: string }>
  | Readonly<{ status: "SEALED"; recoveryId: string; transactionHash: Bytes32; identityKey: Bytes32; version: string }>
  | Readonly<{ status: "REVERTED"; recoveryId: string; transactionHash: Bytes32 }>;
export type OperationAdmission = Readonly<{ idempotencyKey: string; inputDigest: Bytes32; identityKey: Bytes32;
  operator: HexAddress; subject: HexAddress; expectedVersion: string; policyVersion: number; runtimeCodeHash: Bytes32;
  reservedCostUnits: number }>;
export type ComputeProofJournalCommitment = Readonly<{ purpose: "behavioral-risk" | "contract-risk"; provider: HexAddress;
  model: string; proofClass: "DECENTRALIZED_MODEL_TEE"; processResponseVerified: true; receiptDigest: Bytes32;
  requestDigest: Bytes32; responseDigest: Bytes32; signedTextSha256: Bytes32; requestSha256: Bytes32;
  rawResponseSha256: Bytes32; responseHeadersSha256: Bytes32 }>;
export type ComputeJournalCommitment = Readonly<{ computeRoot: Bytes32; commitments: readonly ComputeProofJournalCommitment[] }>;
export type StorageJournalCommitment = Readonly<{ envelopeDigest: Bytes32; storageRoot: Bytes32; uploadTxHash: Bytes32;
  artifactHash: Bytes32; retrievedDigest: Bytes32; finalizedAtBlock: string; retrievalVerified: true; networkProofVerified: false }>;
export type FinalityJournalRecord = Readonly<{ transactionHash: Bytes32; blockHash: Bytes32; blockNumber: string; confirmations: number }>;
export type OperationRecord = OperationAdmission & Readonly<{ recoveryId: string; phase: OperationPhase; createdAt: string;
  updatedAt: string; compute?: ComputeJournalCommitment; storage?: StorageJournalCommitment; chainInput?: ChainWriteRequest;
  transactionHash?: Bytes32; finality?: FinalityJournalRecord; terminalOutcome?: PublicWriteOutcome;
  reservedCostUnits?: number; reconciledCostUnits?: number }>;
export type OperationBeginResult = Readonly<{ kind: "ACCEPTED" | "DEDUPLICATED"; operation: OperationRecord }>;
export type OperationJournalLimits = Readonly<{ maxConcurrency: number; globalMaxConcurrency: number; rateWindowMs: number;
  rateLimit: number; dailyCeremonyLimit: number; dailyCostUnitsLimit: number }>;
export type OperationAuditEvent = Readonly<{ event: "accepted" | "deduplicated" | "rejected" | "submitted" | "recovered" | "completed";
  recoveryId?: string; identityKey?: Bytes32; code?: string; at: string }>;
export interface OperationJournal {
  lookup(idempotencyKey: string, inputDigest: Bytes32): OperationBeginResult | null;
  begin(input: OperationAdmission): OperationBeginResult; get(id: string): OperationRecord | null;
  reserveCost(id: string, stage: PaidStage, units: number): void;
  reconcileCost(id: string, stage: PaidStage, disposition: "CONSUMED" | "RELEASED"): void;
  releaseReservedCosts?(id: string): void;
  reconcileRecoveryCosts?(id: string, registry: "CONSUMED" | "RELEASED"): void;
  recordCompute(id: string, value: ComputeJournalCommitment): void;
  recordStorage(id: string, value: StorageJournalCommitment): void;
  recordChainInput(id: string, value: ChainWriteRequest): void;
  recordSubmissionAttempt(id: string): void; recordTransactionHash(id: string, value: Bytes32): void;
  recordFinalized(id: string, value: FinalityJournalRecord): void; recordRecovered?(id: string): void;
  complete(id: string, outcome: PublicWriteOutcome): void;
}
type ErrorCode = "INVALID_JOURNAL_CONFIG" | "INVALID_OPERATION" | "IDEMPOTENCY_CONFLICT" | "IDENTITY_ACTIVE"
  | "OPERATOR_CONCURRENCY_LIMIT" | "GLOBAL_CONCURRENCY_LIMIT" | "RATE_LIMIT" | "DAILY_CEREMONY_LIMIT"
  | "DAILY_COST_LIMIT" | "PHASE_CONFLICT" | "COMMITMENT_MISMATCH" | "COST_ALREADY_RESERVED";
export class OperationJournalError extends Error { constructor(readonly code: ErrorCode, message = "Operation journal rejected the request") {
  super(message); this.name = "OperationJournalError"; } }

type Row = { payload: string };
const predecessor: Partial<Record<OperationPhase, OperationPhase>> = { COMPUTE_VERIFIED: "REQUESTED",
  STORAGE_VERIFIED: "COMPUTE_VERIFIED", CHAIN_INPUT_COMMITTED: "STORAGE_VERIFIED",
  SUBMISSION_ATTEMPTED: "CHAIN_INPUT_COMMITTED", HASH_KNOWN: "SUBMISSION_ATTEMPTED", FINALIZED: "HASH_KNOWN" };

export function createSqliteOperationJournal(options: Readonly<{ directory: string; limits: OperationJournalLimits;
  audit?: (event: OperationAuditEvent) => void }>): OperationJournal & { directory: string; limits: OperationJournalLimits } {
  validateLimits(options.limits); if (!options.directory?.trim()) invalidConfig();
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(options.directory, "operations.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
  db.exec(`CREATE TABLE IF NOT EXISTS operations (recovery_id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,
    input_digest TEXT NOT NULL,identity_key TEXT NOT NULL,operator_address TEXT NOT NULL,phase TEXT NOT NULL,
    reserved_cost_units INTEGER NOT NULL DEFAULT 0,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS operation_identity_phase ON operations(identity_key,phase);
    CREATE TABLE IF NOT EXISTS operation_costs (recovery_id TEXT NOT NULL,stage TEXT NOT NULL,units INTEGER NOT NULL,
    disposition TEXT NOT NULL DEFAULT 'RESERVED',PRIMARY KEY(recovery_id,stage));`);
  const audit = (event: Omit<OperationAuditEvent, "at">) => { try { options.audit?.({ ...event, at: new Date().toISOString() }); } catch {} };
  const read = (id: string) => parse(db.prepare("SELECT payload FROM operations WHERE recovery_id=?").get(id) as Row | undefined);
  const change = (id: string, next: OperationPhase, mutate: (record: OperationRecord) => OperationRecord, from = predecessor[next]) => tx(db, () => {
    const current = read(id); if (!current) throw new OperationJournalError("INVALID_OPERATION");
    if (current.phase !== from) throw new OperationJournalError("PHASE_CONFLICT");
    const updated = Object.freeze({ ...mutate(current), phase: next, updatedAt: new Date().toISOString() });
    db.prepare("UPDATE operations SET phase=?,updated_ms=?,payload=? WHERE recovery_id=?")
      .run(next, Date.parse(updated.updatedAt), serialize(updated), id);
  });
  const totals = (id: string) => db.prepare(`SELECT COALESCE(SUM(units),0) total,
    COALESCE(SUM(CASE WHEN disposition='CONSUMED' THEN units ELSE 0 END),0) consumed FROM operation_costs WHERE recovery_id=?`)
    .get(id) as { total: number; consumed: number };
  const persistTotals = (id: string) => { const record = read(id); if (!record) throw new OperationJournalError("INVALID_OPERATION");
    const cost = totals(id); const updated = { ...record, reconciledCostUnits: cost.consumed,
      updatedAt: new Date().toISOString() }; db.prepare("UPDATE operations SET reserved_cost_units=?,updated_ms=?,payload=? WHERE recovery_id=?")
      .run(record.reservedCostUnits, Date.parse(updated.updatedAt), serialize(updated), id); };
  const journal: OperationJournal & { directory: string; limits: OperationJournalLimits } = {
    directory: options.directory, limits: Object.freeze({ ...options.limits }),
    lookup(idempotencyKey, inputDigest) { const old = parse(db.prepare("SELECT payload FROM operations WHERE idempotency_key=?").get(idempotencyKey) as Row | undefined);
      if (!old) return null; if (old.inputDigest !== inputDigest) throw new OperationJournalError("IDEMPOTENCY_CONFLICT");
      audit({ event: "deduplicated", recoveryId: old.recoveryId, identityKey: old.identityKey });
      return Object.freeze({ kind: "DEDUPLICATED", operation: old }); },
    begin(input) { validateAdmission(input); try { return tx(db, () => {
      const old = parse(db.prepare("SELECT payload FROM operations WHERE idempotency_key=?").get(input.idempotencyKey) as Row | undefined);
      if (old) { if (old.inputDigest !== input.inputDigest) throw new OperationJournalError("IDEMPOTENCY_CONFLICT");
        audit({ event: "deduplicated", recoveryId: old.recoveryId, identityKey: old.identityKey });
        return Object.freeze({ kind: "DEDUPLICATED" as const, operation: old }); }
      enforceAdmission(db, input, options.limits); const now = new Date();
      const operation = Object.freeze({ ...input, recoveryId: `rec_${randomUUID().replaceAll("-", "")}`,
        phase: "REQUESTED" as const, createdAt: now.toISOString(), updatedAt: now.toISOString() });
      db.prepare(`INSERT INTO operations(recovery_id,idempotency_key,input_digest,identity_key,operator_address,phase,
        reserved_cost_units,created_ms,updated_ms,payload) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(operation.recoveryId,
        input.idempotencyKey, input.inputDigest, input.identityKey, input.operator, operation.phase,
        input.reservedCostUnits, now.getTime(), now.getTime(), serialize(operation));
      audit({ event: "accepted", recoveryId: operation.recoveryId, identityKey: input.identityKey });
      return Object.freeze({ kind: "ACCEPTED" as const, operation });
    }); } catch (error) { if (error instanceof OperationJournalError) audit({ event: "rejected", identityKey: input.identityKey, code: error.code }); throw error; } },
    get: read,
    reserveCost(id, stage, units) { if (!Number.isSafeInteger(units) || units < 1) throw new OperationJournalError("INVALID_OPERATION");
      tx(db, () => { const operation = read(id); if (!operation) throw new OperationJournalError("INVALID_OPERATION");
        if (db.prepare("SELECT 1 found FROM operation_costs WHERE recovery_id=? AND stage=?").get(id, stage))
          throw new OperationJournalError("COST_ALREADY_RESERVED");
        if (totals(id).total + units > operation.reservedCostUnits) throw new OperationJournalError("DAILY_COST_LIMIT");
        db.prepare("INSERT INTO operation_costs(recovery_id,stage,units) VALUES(?,?,?)").run(id, stage, units); persistTotals(id); }); },
    reconcileCost(id, stage, disposition) { tx(db, () => { const result = db.prepare(`UPDATE operation_costs SET disposition=?
        WHERE recovery_id=? AND stage=? AND disposition='RESERVED'`).run(disposition, id, stage);
      if (Number(result.changes) !== 1) throw new OperationJournalError("INVALID_OPERATION"); persistTotals(id); }); },
    releaseReservedCosts(id) { tx(db, () => { db.prepare("UPDATE operation_costs SET disposition='RELEASED' WHERE recovery_id=? AND disposition='RESERVED'").run(id); persistTotals(id); }); },
    reconcileRecoveryCosts(id, registry) { tx(db, () => { db.prepare(`UPDATE operation_costs SET disposition=CASE
        WHEN stage='REGISTRY' THEN ? ELSE 'CONSUMED' END WHERE recovery_id=? AND disposition='RESERVED'`).run(registry, id); persistTotals(id); }); },
    recordCompute(id, value) { validateCompute(value); change(id, "COMPUTE_VERIFIED", (r) => ({ ...r, compute: value })); },
    recordStorage(id, value) { validateStorage(value); change(id, "STORAGE_VERIFIED", (r) => ({ ...r, storage: value })); },
    recordChainInput(id, value) { change(id, "CHAIN_INPUT_COMMITTED", (r) => { validateChain(r, value); return { ...r, chainInput: value }; }); },
    recordSubmissionAttempt(id) { change(id, "SUBMISSION_ATTEMPTED", (r) => r); const record = read(id);
      audit({ event: "submitted", recoveryId: id, identityKey: record?.identityKey }); },
    recordTransactionHash(id, value) { change(id, "HASH_KNOWN", (r) => ({ ...r, transactionHash: value })); },
    recordFinalized(id, value) { const record = read(id); const from = record?.phase === "RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED" : "HASH_KNOWN";
      if (record?.transactionHash && record.transactionHash !== value.transactionHash) throw new OperationJournalError("COMMITMENT_MISMATCH");
      change(id, "FINALIZED", (r) => ({ ...r, transactionHash: value.transactionHash, finality: value }), from); },
    recordRecovered(id) { const record = read(id); audit({ event: "recovered", recoveryId: id, identityKey: record?.identityKey }); },
    complete(id, outcome) { const record = read(id); if (!record) throw new OperationJournalError("INVALID_OPERATION"); bindOutcome(record, outcome);
      if (outcome.status === "SUBMISSION_OUTCOME_UNKNOWN" || outcome.status === "FINALIZED_READBACK_UNAVAILABLE") {
        const allowed = outcome.status === "SUBMISSION_OUTCOME_UNKNOWN" ? ["SUBMISSION_ATTEMPTED", "HASH_KNOWN"] : ["FINALIZED"];
        if (!allowed.includes(record.phase)) throw new OperationJournalError("PHASE_CONFLICT");
        change(id, "RECOVERY_REQUIRED", (r) => ({ ...r, terminalOutcome: outcome }), record.phase);
      } else { const allowed = outcome.status === "NOT_BROADCAST" ? ["REQUESTED", "COMPUTE_VERIFIED", "STORAGE_VERIFIED", "CHAIN_INPUT_COMMITTED"]
          : outcome.status === "SEALED" ? ["FINALIZED"] : ["HASH_KNOWN", "RECOVERY_REQUIRED"];
        if (!allowed.includes(record.phase)) throw new OperationJournalError("PHASE_CONFLICT");
        change(id, "TERMINAL", (r) => ({ ...r, terminalOutcome: outcome }), record.phase); }
      audit({ event: "completed", recoveryId: id, identityKey: record.identityKey }); },
  };
  return Object.freeze(journal);
}

export function validateOperationCommitments(record: OperationRecord): void { if (!record.compute || !record.storage || !record.chainInput)
  throw new OperationJournalError("COMMITMENT_MISMATCH"); validateCompute(record.compute); validateStorage(record.storage); validateChain(record, record.chainInput); }
function validateCompute(value: ComputeJournalCommitment) { if (!value.commitments.length || new Set(value.commitments.map((c) => c.purpose)).size !== value.commitments.length)
  throw new OperationJournalError("COMMITMENT_MISMATCH"); const receipts = [...value.commitments].sort((a, b) => a.purpose.localeCompare(b.purpose)).map((c) => c.receiptDigest);
  if (keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [receipts])).toLowerCase() !== value.computeRoot.toLowerCase())
    throw new OperationJournalError("COMMITMENT_MISMATCH"); }
function validateStorage(value: StorageJournalCommitment) { const { artifactHash, ...commitment } = value;
  if (value.envelopeDigest !== value.retrievedDigest || keccak256(toUtf8Bytes(canonicalizeStorageCommitment(commitment))).toLowerCase() !== artifactHash.toLowerCase())
    throw new OperationJournalError("COMMITMENT_MISMATCH"); }
function validateChain(record: OperationRecord, value: ChainWriteRequest) { if (!record.compute || !record.storage
  || value.identityKey !== record.identityKey || value.subject !== record.subject || value.scanner !== record.operator
  || value.policyVersion !== record.policyVersion || value.runtimeCodeHash !== record.runtimeCodeHash
  || (value.mode === "SEAL" ? "1" : String(value.expectedPriorVersion! + 1n)) !== record.expectedVersion
  || value.computeRoot !== record.compute.computeRoot || value.envelopeDigest !== record.storage.envelopeDigest
  || value.storageRoot !== record.storage.storageRoot || value.artifactHash !== record.storage.artifactHash)
  throw new OperationJournalError("COMMITMENT_MISMATCH"); }
function bindOutcome(record: OperationRecord, outcome: PublicWriteOutcome) { if (outcome.recoveryId !== record.recoveryId
  || ("transactionHash" in outcome && record.transactionHash && outcome.transactionHash !== record.transactionHash)
  || ("identityKey" in outcome && outcome.identityKey !== record.identityKey) || ("version" in outcome && outcome.version !== record.expectedVersion))
  throw new OperationJournalError("COMMITMENT_MISMATCH"); }
function enforceAdmission(db: DatabaseSync, input: OperationAdmission, limits: OperationJournalLimits) { const count = (sql: string, ...args: (string | number)[]) =>
  Number((db.prepare(sql).get(...args) as { value: number }).value); if (count("SELECT COUNT(*) value FROM operations WHERE identity_key=? AND phase!='TERMINAL'", input.identityKey))
  throw new OperationJournalError("IDENTITY_ACTIVE"); if (count("SELECT COUNT(*) value FROM operations WHERE operator_address=? AND phase!='TERMINAL'", input.operator) >= limits.maxConcurrency)
  throw new OperationJournalError("OPERATOR_CONCURRENCY_LIMIT"); if (count("SELECT COUNT(*) value FROM operations WHERE phase!='TERMINAL'") >= limits.globalMaxConcurrency)
  throw new OperationJournalError("GLOBAL_CONCURRENCY_LIMIT"); const now = Date.now();
  if (count("SELECT COUNT(*) value FROM operations WHERE operator_address=? AND created_ms>=?", input.operator, now - limits.rateWindowMs) >= limits.rateLimit)
    throw new OperationJournalError("RATE_LIMIT"); if (count("SELECT COUNT(*) value FROM operations WHERE operator_address=? AND created_ms>=?", input.operator, now - 86_400_000) >= limits.dailyCeremonyLimit)
    throw new OperationJournalError("DAILY_CEREMONY_LIMIT");
  if (count(`SELECT COALESCE(SUM(CASE WHEN phase='TERMINAL' THEN
      COALESCE((SELECT SUM(c.units) FROM operation_costs c WHERE c.recovery_id=operations.recovery_id AND c.disposition='CONSUMED'),0)
      ELSE reserved_cost_units END),0) value FROM operations WHERE operator_address=? AND created_ms>=?`, input.operator,
    now - 86_400_000) + input.reservedCostUnits > limits.dailyCostUnitsLimit) throw new OperationJournalError("DAILY_COST_LIMIT"); }
function tx<T>(db: DatabaseSync, run: () => T): T { db.exec("BEGIN IMMEDIATE"); try { const result = run(); db.exec("COMMIT"); return result; }
  catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; } }
function parse(row?: Row): OperationRecord | null { if (!row) return null; const value = JSON.parse(row.payload) as OperationRecord;
  const chainInput = value.chainInput?.expectedPriorVersion !== undefined ? { ...value.chainInput, expectedPriorVersion: BigInt(value.chainInput.expectedPriorVersion) } : value.chainInput;
  return Object.freeze({ ...value, ...(chainInput ? { chainInput: Object.freeze(chainInput) } : {}) }); }
function serialize(value: unknown) { return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item); }
function validateLimits(limits: OperationJournalLimits) { for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) invalidConfig(); }
function validateAdmission(input: OperationAdmission) { if (!input || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)
  || !/^0x[0-9a-f]{64}$/i.test(input.inputDigest) || !/^0x[0-9a-f]{64}$/i.test(input.identityKey) || !/^0x[0-9a-f]{40}$/i.test(input.operator)
  || !/^0x[0-9a-f]{40}$/i.test(input.subject) || !/^[1-9]\d*$/.test(input.expectedVersion) || !Number.isSafeInteger(input.policyVersion)
  || input.policyVersion < 1 || !/^0x[0-9a-f]{64}$/i.test(input.runtimeCodeHash)
  || !Number.isSafeInteger(input.reservedCostUnits) || input.reservedCostUnits < 1) throw new OperationJournalError("INVALID_OPERATION"); }
function invalidConfig(): never { throw new OperationJournalError("INVALID_JOURNAL_CONFIG", "Operation journal limits must be positive integers"); }
