import { describe, expect, it, vi } from "vitest";
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REGISTRY_V2_INTERFACE, type RegistryChainAdapter } from "../../server/prooflock/chain";
import { createWriteRecoveryService } from "../../server/prooflock/recovery";
import { createSqliteOperationJournal, type OperationRecord } from "../../server/prooflock/operation-journal";
import { canonicalizeStorageCommitment } from "../../server/prooflock/canonical";

const H = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const REGISTRY = `0x${"11".repeat(20)}` as `0x${string}`;
const SCANNER = `0x${"22".repeat(20)}` as `0x${string}`;
const SUBJECT = `0x${"33".repeat(20)}` as `0x${string}`;

function operation(): OperationRecord {
  const receiptDigest = H("6");
  const compute = { computeRoot: keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [[receiptDigest]])) as `0x${string}`,
    commitments: [{ purpose: "behavioral-risk" as const, provider: SCANNER, model: "model", proofClass: "DECENTRALIZED_MODEL_TEE" as const,
      processResponseVerified: true as const, receiptDigest, requestDigest: H("7"), responseDigest: H("8"), signedTextSha256: H("9"),
      requestSha256: H("a"), rawResponseSha256: H("b"), responseHeadersSha256: H("c") }] };
  const storageBase = { envelopeDigest: H("2"), storageRoot: H("3"), uploadTxHash: H("7"), retrievedDigest: H("2"),
    finalizedAtBlock: "9", retrievalVerified: true as const, networkProofVerified: false as const };
  const storage = { ...storageBase, artifactHash: keccak256(toUtf8Bytes(canonicalizeStorageCommitment(storageBase))) as `0x${string}` };
  const chainInput = { registryAddress: REGISTRY, scanner: SCANNER, mode: "SEAL" as const,
    identityKey: H("1"), subject: SUBJECT, envelopeDigest: storage.envelopeDigest, storageRoot: storage.storageRoot,
    computeRoot: compute.computeRoot, artifactHash: storage.artifactHash, runtimeCodeHash: H("0"), validForSeconds: 604800,
    policyVersion: 1, behavioralScore: 12, codeRisk: 0, coverage: 127 };
  return { recoveryId: "rec_1234567890abcdef", idempotencyKey: "idem-12345678", inputDigest: H("a"),
    identityKey: H("1"), operator: SCANNER, subject: SUBJECT, expectedVersion: "1", policyVersion: 1,
    runtimeCodeHash: H("0"), reservedCostUnits: 2, phase: "HASH_KNOWN", createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z", compute, storage, chainInput, transactionHash: H("8") };
}

function adapter(overrides: Partial<RegistryChainAdapter> = {}): RegistryChainAdapter {
  const input = operation().chainInput!;
  const data = REGISTRY_V2_INTERFACE.encodeFunctionData("seal", [input.identityKey, input.subject,
    [input.envelopeDigest, input.storageRoot, input.computeRoot, input.artifactHash, input.runtimeCodeHash,
      input.validForSeconds, input.policyVersion, input.behavioralScore, input.codeRisk, input.coverage]]);
  const event = REGISTRY_V2_INTERFACE.encodeEventLog(REGISTRY_V2_INTERFACE.getEvent("ProofLocked")!,
    [input.identityKey, input.subject, 1n, 1n, 604801n, input.envelopeDigest, input.storageRoot,
      input.computeRoot, input.artifactHash, input.runtimeCodeHash, input.policyVersion,
      input.behavioralScore, input.codeRisk, input.coverage]);
  return { registryAddress: REGISTRY, getChainId: vi.fn().mockResolvedValue(16661n),
    getCode: vi.fn().mockResolvedValue("0x"), getProofLock: vi.fn().mockResolvedValue({ ...input,
      version: 1n, issuedAt: 1n, validUntil: 604801n, state: 1, stateReason: 0 }),
    sendTransaction: vi.fn(), getTransaction: vi.fn().mockResolvedValue({ hash: H("8"), to: REGISTRY, from: SCANNER, data }),
    waitForReceipt: vi.fn().mockResolvedValue({ transactionHash: H("8"), status: 1, blockNumber: 10n,
      blockHash: H("9"), confirmations: 3, logs: [{ address: REGISTRY, topics: event.topics, data: event.data }] }),
    ...overrides };
}

describe("read-only write recovery", () => {
  it.each([1, 0] as const)("recovers a real restarted SUBMISSION_ATTEMPTED journal with receipt status %s", async (status) => {
    const directory = await mkdtemp(join(tmpdir(), "prooflock-recovery-real-"));
    try {
      const limits = { maxConcurrency: 2, globalMaxConcurrency: 2, rateWindowMs: 60_000, rateLimit: 4,
        dailyCeremonyLimit: 8, dailyCostUnitsLimit: 20 };
      const store = createSqliteOperationJournal({ directory, limits }); const source = operation();
      const admitted = store.begin({ idempotencyKey: source.idempotencyKey, inputDigest: source.inputDigest,
        identityKey: source.identityKey, operator: source.operator, subject: source.subject,
        expectedVersion: source.expectedVersion, policyVersion: source.policyVersion,
        runtimeCodeHash: source.runtimeCodeHash, reservedCostUnits: 4 }).operation;
      store.recordCompute(admitted.recoveryId, source.compute!); store.recordStorage(admitted.recoveryId, source.storage!);
      store.recordChainInput(admitted.recoveryId, source.chainInput!); store.recordSubmissionAttempt(admitted.recoveryId);
      const restarted = createSqliteOperationJournal({ directory, limits });
      const chain = status === 1 ? adapter() : adapter({ waitForReceipt: vi.fn().mockResolvedValue({ transactionHash: H("8"),
        status: 0, blockNumber: 10n, blockHash: H("9"), confirmations: 3, logs: [] }) });
      const result = await createWriteRecoveryService({ journal: restarted, chain, confirmations: 3, timeoutMs: 1_000 })
        .recover(admitted.recoveryId, H("8"));
      expect(result.status).toBe(status === 1 ? "SEALED" : "REVERTED");
      expect(restarted.get(admitted.recoveryId)?.phase).toBe("TERMINAL");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("conservatively consumes attempted paid costs but releases an unattempted Registry reservation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prooflock-recovery-cost-"));
    try {
      const store = createSqliteOperationJournal({ directory, limits: { maxConcurrency: 2, globalMaxConcurrency: 2,
        rateWindowMs: 60_000, rateLimit: 4, dailyCeremonyLimit: 8, dailyCostUnitsLimit: 20 } }); const source = operation();
      const admitted = store.begin({ idempotencyKey: source.idempotencyKey, inputDigest: source.inputDigest,
        identityKey: source.identityKey, operator: source.operator, subject: source.subject, expectedVersion: "1",
        policyVersion: 1, runtimeCodeHash: source.runtimeCodeHash, reservedCostUnits: 4 }).operation;
      store.reserveCost(admitted.recoveryId, "COMPUTE_BEHAVIORAL", 1);
      store.reserveCost(admitted.recoveryId, "STORAGE", 1); store.reserveCost(admitted.recoveryId, "REGISTRY", 1);
      await createWriteRecoveryService({ journal: store, chain: adapter(), confirmations: 3, timeoutMs: 1_000 })
        .recover(admitted.recoveryId);
      expect(store.get(admitted.recoveryId)).toMatchObject({ phase: "TERMINAL", reservedCostUnits: 4, reconciledCostUnits: 2 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("recovers a known finalized transaction only when every commitment is bound", async () => {
    const store = { get: vi.fn().mockReturnValue(operation()), recordFinalized: vi.fn(), complete: vi.fn() };
    const result = await createWriteRecoveryService({ journal: store, chain: adapter(), confirmations: 3, timeoutMs: 1_000 })
      .recover(operation().recoveryId, H("8"));
    expect(result).toMatchObject({ status: "SEALED", transactionHash: H("8"), identityKey: H("1"), version: "1" });
    expect(store.complete).toHaveBeenCalled();
  });

  it("rechecks a prior uncertain terminal outcome instead of freezing it forever", async () => {
    const uncertain = { ...operation(), phase: "TERMINAL" as const,
      terminalOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN" as const,
        recoveryId: operation().recoveryId, transactionHash: H("8") } };
    const store = { get: vi.fn().mockReturnValue(uncertain), recordFinalized: vi.fn(), complete: vi.fn() };
    const result = await createWriteRecoveryService({ journal: store, chain: adapter(), confirmations: 3, timeoutMs: 1_000 })
      .recover(operation().recoveryId, H("8"));
    expect(result.status).toBe("SEALED");
  });

  it("reuses a durably recorded terminal hash when the dedicated hash append failed", async () => {
    const uncertain = { ...operation(), transactionHash: undefined, phase: "RECOVERY_REQUIRED" as const,
      terminalOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN" as const,
        recoveryId: operation().recoveryId, transactionHash: H("8") } };
    const result = await createWriteRecoveryService({ journal: { get: () => uncertain }, chain: adapter(),
      confirmations: 3, timeoutMs: 1_000 }).recover(operation().recoveryId);
    expect(result.status).toBe("SEALED");
  });

  it("returns reverted for a proven failed transaction", async () => {
    const chain = adapter({ waitForReceipt: vi.fn().mockResolvedValue({ transactionHash: H("8"), status: 0,
      blockNumber: 10n, blockHash: H("9"), confirmations: 3, logs: [] }) });
    const result = await createWriteRecoveryService({ journal: { get: () => operation() }, chain,
      confirmations: 3, timeoutMs: 1_000 }).recover(operation().recoveryId, H("8"));
    expect(result.status).toBe("REVERTED");
  });

  it.each([
    ["unknown transaction", { getTransaction: vi.fn().mockResolvedValue(null), waitForReceipt: vi.fn().mockResolvedValue(null) }],
    ["RPC outage", { getTransaction: vi.fn().mockRejectedValue(new Error("private rpc token")) }],
    ["wrong chain", { getChainId: vi.fn().mockResolvedValue(1n) }],
    ["competing scanner", { getTransaction: vi.fn().mockResolvedValue({ hash: H("8"), to: REGISTRY,
      from: SUBJECT, data: "0x" }) }],
  ])("keeps attribution unknown for %s", async (_name, overrides) => {
    const result = await createWriteRecoveryService({ journal: { get: () => operation() }, chain: adapter(overrides),
      confirmations: 3, timeoutMs: 1_000 }).recover(operation().recoveryId, H("8"));
    expect(result.status).toBe("SUBMISSION_OUTCOME_UNKNOWN");
    expect(JSON.stringify(result)).not.toContain("private rpc token");
  });

  it("does not infer ownership from identity and version without a trustworthy transaction hash", async () => {
    const chain = adapter();
    const result = await createWriteRecoveryService({ journal: { get: () => ({ ...operation(), transactionHash: undefined }) },
      chain, confirmations: 3, timeoutMs: 1_000 }).recover(operation().recoveryId);
    expect(result.status).toBe("SUBMISSION_OUTCOME_UNKNOWN");
    expect(chain.getProofLock).not.toHaveBeenCalled();
  });

  it.each(["REQUESTED", "COMPUTE_VERIFIED", "STORAGE_VERIFIED", "CHAIN_INPUT_COMMITTED"] as const)(
    "resolves pre-send phase %s definitively as NOT_BROADCAST without RPC",
    async (phase) => {
      const chain = adapter(); const complete = vi.fn();
      const result = await createWriteRecoveryService({ journal: { get: () => ({ ...operation(), phase,
        transactionHash: undefined, terminalOutcome: undefined }), complete }, chain,
      confirmations: 3, timeoutMs: 1_000 }).recover(operation().recoveryId);
      expect(result.status).toBe("NOT_BROADCAST"); expect(complete).toHaveBeenCalled();
      expect(chain.getTransaction).not.toHaveBeenCalled();
    },
  );

  it("attributes submission-without-hash only through one exact full-commitment candidate", async () => {
    const chain = adapter({ findProofLockTransactionHashes: vi.fn().mockResolvedValue([H("8")]) } as never);
    const result = await createWriteRecoveryService({ journal: { get: () => ({ ...operation(),
      phase: "SUBMISSION_ATTEMPTED", transactionHash: undefined }) }, chain,
    confirmations: 3, timeoutMs: 1_000 }).recover(operation().recoveryId);
    expect(result.status).toBe("SEALED");
  });

  it("keeps no-hash recovery unknown for zero or competing candidates", async () => {
    for (const candidates of [[], [H("8"), H("9")]]) {
      const chain = adapter({ findProofLockTransactionHashes: vi.fn().mockResolvedValue(candidates) } as never);
      const result = await createWriteRecoveryService({ journal: { get: () => ({ ...operation(),
        phase: "SUBMISSION_ATTEMPTED", transactionHash: undefined }) }, chain,
      confirmations: 3, timeoutMs: 1_000 }).recover(operation().recoveryId);
      expect(result.status).toBe("SUBMISSION_OUTCOME_UNKNOWN");
    }
  });

  it("carries one abort deadline through discovery and every recovery RPC", async () => {
    const signal = AbortSignal.timeout(20);
    const chain = adapter({ getChainId: vi.fn(async (_signal?: AbortSignal) => {
      await new Promise((resolve) => setTimeout(resolve, 50)); return 16661n;
    }) } as never);
    await expect(createWriteRecoveryService({ journal: { get: () => operation() }, chain,
      confirmations: 3, timeoutMs: 1_000 }).recover(operation().recoveryId, H("8"), signal))
      .rejects.toMatchObject({ name: "TimeoutError" });
    expect(chain.getChainId).toHaveBeenCalledWith(signal);
  });

  it("never invokes paid or write capabilities during recovery", async () => {
    const chain = adapter();
    await createWriteRecoveryService({ journal: { get: () => operation() }, chain,
      confirmations: 3, timeoutMs: 1_000 }).recover(operation().recoveryId, H("8"));
    expect(chain.sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects malformed recovery identifiers before dependencies are used", async () => {
    const get = vi.fn();
    await expect(createWriteRecoveryService({ journal: { get }, chain: adapter(), confirmations: 3, timeoutMs: 1_000 })
      .recover("../bad", H("8"))).rejects.toMatchObject({ code: "INVALID_RECOVERY_INPUT" });
    expect(get).not.toHaveBeenCalled();
    await expect(createWriteRecoveryService({ journal: { get }, chain: adapter(), confirmations: 3, timeoutMs: 1_000 })
      .recover(operation().recoveryId, H("0"))).rejects.toMatchObject({ code: "INVALID_RECOVERY_INPUT" });
  });
});
