import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { canonicalizeStorageCommitment } from "../../server/prooflock/canonical";

import {
  OperationJournalError,
  createSqliteOperationJournal,
  type OperationAdmission,
} from "../../server/prooflock/operation-journal";

const H = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const ADDRESS = `0x${"11".repeat(20)}` as `0x${string}`;
const OTHER = `0x${"22".repeat(20)}` as `0x${string}`;
const directories: string[] = [];

function admission(overrides: Partial<OperationAdmission> = {}): OperationAdmission {
  return {
    idempotencyKey: "idem-12345678", inputDigest: H("a"), identityKey: H("1"),
    operator: ADDRESS, subject: OTHER, expectedVersion: "1", policyVersion: 1,
    runtimeCodeHash: H("0"), reservedCostUnits: 4, ...overrides,
  };
}

async function journal(overrides: Record<string, number> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "prooflock-operations-"));
  directories.push(directory);
  return createSqliteOperationJournal({ directory, limits: {
    maxConcurrency: 2, globalMaxConcurrency: 3, rateWindowMs: 60_000, rateLimit: 4,
    dailyCeremonyLimit: 8, dailyCostUnitsLimit: 20, ...overrides,
  } });
}

afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("phased operation journal", () => {
  it("rejects skipped and same-phase transitions without mutating the record", async () => {
    const store = await journal(); const operation = store.begin(admission()).operation;
    expect(operation).toMatchObject({ phase: "REQUESTED", reservedCostUnits: 4 });
    expect(() => store.recordStorage(operation.recoveryId, storageCommitment())).toThrowError(
      expect.objectContaining({ code: "PHASE_CONFLICT" }));
    store.recordCompute(operation.recoveryId, computeCommitment());
    expect(() => store.recordCompute(operation.recoveryId, computeCommitment())).toThrowError(
      expect.objectContaining({ code: "PHASE_CONFLICT" }));
    expect(store.get(operation.recoveryId)?.phase).toBe("COMPUTE_VERIFIED");
  });

  it("rejects chain input not bound to every prior immutable commitment", async () => {
    const store = await journal(); const operation = store.begin(admission()).operation;
    store.recordCompute(operation.recoveryId, computeCommitment());
    const storage = storageCommitment(); store.recordStorage(operation.recoveryId, storage);
    for (const mismatch of [
      { identityKey: H("a") }, { subject: ADDRESS }, { policyVersion: 2 }, { runtimeCodeHash: H("f") },
      { computeRoot: H("f") }, { storageRoot: H("f") }, { envelopeDigest: H("f") }, { artifactHash: H("f") },
    ]) expect(() => store.recordChainInput(operation.recoveryId, { ...chainInput(storage), ...mismatch }))
      .toThrowError(expect.objectContaining({ code: "COMMITMENT_MISMATCH" }));
    expect(store.get(operation.recoveryId)?.phase).toBe("STORAGE_VERIFIED");
  });

  it("reserves each paid unit atomically and enforces per-operator plus global concurrency", async () => {
    const store = await journal({ maxConcurrency: 1, globalMaxConcurrency: 2, dailyCostUnitsLimit: 3 });
    const first = store.begin(admission({ identityKey: H("a"), reservedCostUnits: 3 })).operation;
    store.reserveCost(first.recoveryId, "COMPUTE_BEHAVIORAL", 2);
    expect(() => store.reserveCost(first.recoveryId, "COMPUTE_BEHAVIORAL", 2))
      .toThrowError(expect.objectContaining({ code: "COST_ALREADY_RESERVED" }));
    expect(() => store.begin(admission({ idempotencyKey: "same-operator", inputDigest: H("b"), identityKey: H("b") })))
      .toThrowError(expect.objectContaining({ code: "OPERATOR_CONCURRENCY_LIMIT" }));
    const second = store.begin(admission({ idempotencyKey: "other-operator", inputDigest: H("c"), identityKey: H("c"),
      operator: OTHER, subject: ADDRESS, reservedCostUnits: 3 })).operation;
    expect(() => store.begin(admission({ idempotencyKey: "global-third", inputDigest: H("d"), identityKey: H("d"),
      operator: `0x${"33".repeat(20)}`, subject: ADDRESS, reservedCostUnits: 3 })))
      .toThrowError(expect.objectContaining({ code: "GLOBAL_CONCURRENCY_LIMIT" }));
    expect(() => store.reserveCost(first.recoveryId, "STORAGE", 2))
      .toThrowError(expect.objectContaining({ code: "DAILY_COST_LIMIT" }));
  });
  it("deduplicates the same key and digest across process restarts", async () => {
    const first = await journal();
    const accepted = first.begin(admission());
    const restarted = createSqliteOperationJournal({ directory: first.directory, limits: first.limits });
    const duplicate = restarted.begin(admission());
    expect(accepted.kind).toBe("ACCEPTED");
    expect(duplicate).toMatchObject({ kind: "DEDUPLICATED", operation: { recoveryId: accepted.operation.recoveryId } });
  });

  it("rejects key reuse with a different canonical digest without starting work", async () => {
    const store = await journal();
    store.begin(admission());
    expect(() => store.begin(admission({ inputDigest: H("b") })))
      .toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
  });

  it("persists monotonic Compute, Storage, chain, submission, finality, and terminal phases", async () => {
    const store = await journal();
    const { operation } = store.begin(admission());
    const compute = computeCommitment(); const storage = storageCommitment();
    store.recordCompute(operation.recoveryId, compute);
    store.recordStorage(operation.recoveryId, storage);
    store.recordChainInput(operation.recoveryId, chainInput(storage));
    store.recordSubmissionAttempt(operation.recoveryId);
    store.recordTransactionHash(operation.recoveryId, H("8"));
    store.recordFinalized(operation.recoveryId, { transactionHash: H("8"), blockHash: H("9"), blockNumber: "7", confirmations: 3 });
    store.complete(operation.recoveryId, { status: "SEALED", recoveryId: operation.recoveryId,
      transactionHash: H("8"), identityKey: H("1"), version: "1" });
    const restarted = createSqliteOperationJournal({ directory: store.directory, limits: store.limits });
    expect(restarted.get(operation.recoveryId)).toMatchObject({ phase: "TERMINAL", compute: { computeRoot: compute.computeRoot },
      storage: { storageRoot: storage.storageRoot }, chainInput: { envelopeDigest: storage.envelopeDigest }, transactionHash: H("8"),
      terminalOutcome: { status: "SEALED" } });
  });

  it("reloads safely after every durable phase boundary", async () => {
    const first = await journal();
    const id = first.begin(admission()).operation.recoveryId;
    const reopen = () => createSqliteOperationJournal({ directory: first.directory, limits: first.limits });
    expect(reopen().get(id)?.phase).toBe("REQUESTED");
    const compute = computeCommitment(); const storage = storageCommitment();
    first.recordCompute(id, compute);
    expect(reopen().get(id)?.phase).toBe("COMPUTE_VERIFIED");
    first.recordStorage(id, storage);
    expect(reopen().get(id)?.phase).toBe("STORAGE_VERIFIED");
    first.recordChainInput(id, chainInput(storage));
    expect(reopen().get(id)?.phase).toBe("CHAIN_INPUT_COMMITTED");
    first.recordSubmissionAttempt(id); expect(reopen().get(id)?.phase).toBe("SUBMISSION_ATTEMPTED");
    first.recordTransactionHash(id, H("8")); expect(reopen().get(id)?.phase).toBe("HASH_KNOWN");
    first.recordFinalized(id, { transactionHash: H("8"), blockHash: H("9"), blockNumber: "7", confirmations: 3 });
    expect(reopen().get(id)?.phase).toBe("FINALIZED");
  });

  it("enforces one active ceremony per identity and configured concurrency, rate, and daily budgets", async () => {
    const identityStore = await journal();
    identityStore.begin(admission());
    expect(() => identityStore.begin(admission({ idempotencyKey: "identity-conflict", inputDigest: H("b") })))
      .toThrowError(expect.objectContaining({ code: "IDENTITY_ACTIVE" }));

    const budgetStore = await journal({ dailyCostUnitsLimit: 2 });
    const budget = budgetStore.begin(admission({ identityKey: H("a"), reservedCostUnits: 2 })).operation;
    budgetStore.reserveCost(budget.recoveryId, "COMPUTE_BEHAVIORAL", 2);
    expect(() => budgetStore.reserveCost(budget.recoveryId, "STORAGE", 1))
      .toThrowError(expect.objectContaining({ code: "DAILY_COST_LIMIT" }));
  });

  it("reconciles reserved cost units to conservative stage consumption on terminal outcome", async () => {
    const store = await journal({ dailyCostUnitsLimit: 2 });
    const first = store.begin(admission({ identityKey: H("a"), reservedCostUnits: 2 })).operation;
    store.reserveCost(first.recoveryId, "COMPUTE_BEHAVIORAL", 1);
    store.reconcileCost(first.recoveryId, "COMPUTE_BEHAVIORAL", "CONSUMED");
    store.complete(first.recoveryId, { status: "NOT_BROADCAST", recoveryId: first.recoveryId });
    expect(store.get(first.recoveryId)).toMatchObject({ reconciledCostUnits: 1 });
    expect(() => store.begin(admission({ idempotencyKey: "after-reconcile", inputDigest: H("b"),
      identityKey: H("b"), reservedCostUnits: 1 }))).not.toThrow();
  });

  it("keeps an uncertain write active until read-only recovery resolves it", async () => {
    const store = await journal();
    const first = store.begin(admission()).operation;
    const compute = computeCommitment(); const storage = storageCommitment();
    store.recordCompute(first.recoveryId, compute); store.recordStorage(first.recoveryId, storage);
    store.recordChainInput(first.recoveryId, chainInput(storage)); store.recordSubmissionAttempt(first.recoveryId);
    store.complete(first.recoveryId, { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: first.recoveryId });
    expect(store.get(first.recoveryId)).toMatchObject({ phase: "RECOVERY_REQUIRED" });
    expect(() => store.begin(admission({ idempotencyKey: "blocked-uncertain", inputDigest: H("b") })))
      .toThrowError(expect.objectContaining({ code: "IDENTITY_ACTIVE" }));
    store.complete(first.recoveryId, { status: "REVERTED", recoveryId: first.recoveryId, transactionHash: H("8") });
    expect(() => store.begin(admission({ idempotencyKey: "after-recovery", inputDigest: H("c") }))).not.toThrow();
  });

  it("emits structured audits without persisting or emitting credentials", async () => {
    const audit = vi.fn();
    const directory = await mkdtemp(join(tmpdir(), "prooflock-audit-")); directories.push(directory);
    const store = createSqliteOperationJournal({ directory, limits: { maxConcurrency: 1, globalMaxConcurrency: 1,
      rateWindowMs: 60_000, rateLimit: 2, dailyCeremonyLimit: 2, dailyCostUnitsLimit: 4 }, audit });
    store.begin(admission());
    const serialized = JSON.stringify(audit.mock.calls);
    expect(serialized).toContain("accepted");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("token");
  });

  it("rejects non-positive or non-integer limits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prooflock-invalid-")); directories.push(directory);
    expect(() => createSqliteOperationJournal({ directory, limits: { maxConcurrency: 0, globalMaxConcurrency: 1,
      rateWindowMs: 1, rateLimit: 1, dailyCeremonyLimit: 1, dailyCostUnitsLimit: 1 } }))
      .toThrow(OperationJournalError);
  });
});

function computeCommitment() {
  const receiptDigest = H("3");
  return { computeRoot: keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [[receiptDigest]])) as `0x${string}`,
    commitments: [{ purpose: "behavioral-risk" as const, provider: ADDRESS, model: "model-tee",
      proofClass: "DECENTRALIZED_MODEL_TEE" as const, processResponseVerified: true as const,
      receiptDigest, requestDigest: H("4"), responseDigest: H("5"), signedTextSha256: H("6"),
      requestSha256: H("7"), rawResponseSha256: H("8"), responseHeadersSha256: H("9") }] };
}

function storageCommitment() {
  const value = { envelopeDigest: H("7"), storageRoot: H("4"), uploadTxHash: H("5"), retrievedDigest: H("7"),
    finalizedAtBlock: "456", retrievalVerified: true as const, networkProofVerified: false as const };
  return { ...value, artifactHash: keccak256(toUtf8Bytes(canonicalizeStorageCommitment(value))) as `0x${string}` };
}

function chainInput(storage = storageCommitment()) {
  return { registryAddress: ADDRESS, scanner: ADDRESS, mode: "SEAL" as const, identityKey: H("1"), subject: OTHER,
    envelopeDigest: storage.envelopeDigest, storageRoot: storage.storageRoot, computeRoot: computeCommitment().computeRoot,
    artifactHash: storage.artifactHash, runtimeCodeHash: H("0"), validForSeconds: 604800, policyVersion: 1,
    behavioralScore: 12, codeRisk: 0, coverage: 127 };
}
