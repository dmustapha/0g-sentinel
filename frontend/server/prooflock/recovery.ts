import { getAddress } from "ethers";
import { REGISTRY_V2_INTERFACE, type ChainWriteRequest, type RegistryChainAdapter,
  type RegistryProofLockRecord, type RegistryReceipt } from "./chain";
import { validateOperationCommitments, type OperationJournal, type OperationRecord, type PublicWriteOutcome } from "./operation-journal";
import type { Bytes32 } from "./types";

export class WriteRecoveryError extends Error { constructor(readonly code: "INVALID_RECOVERY_INPUT" | "RECOVERY_NOT_FOUND" | "RECOVERY_OPERATION_LIVE",
  message = "Recovery request is invalid") { super(message); this.name = "WriteRecoveryError"; } }
type Journal = Pick<OperationJournal, "get"> & Partial<Pick<OperationJournal,
  "recordTransactionHash" | "recordFinalized" | "recordRecovered" | "complete" | "reconcileRecoveryCosts">>;

export function createWriteRecoveryService(options: Readonly<{ journal: Journal; chain: RegistryChainAdapter;
  confirmations: number; timeoutMs: number; livenessGraceMs: number; now?: () => number }>) {
  if (!Number.isFinite(options.livenessGraceMs) || options.livenessGraceMs <= 0)
    throw new WriteRecoveryError("INVALID_RECOVERY_INPUT", "livenessGraceMs must be a positive number");
  const now = options.now ?? Date.now;
  return Object.freeze({ async recover(recoveryId: string, suppliedHash?: string, signal?: AbortSignal): Promise<PublicWriteOutcome> {
    validateInput(recoveryId, suppliedHash); signal?.throwIfAborted();
    const operation = options.journal.get(recoveryId);
    if (!operation) throw new WriteRecoveryError("RECOVERY_NOT_FOUND", "Recovery operation was not found");
    if (operation.terminalOutcome && ["SEALED", "REVERTED", "NOT_BROADCAST"].includes(operation.terminalOutcome.status))
      return operation.terminalOutcome;
    if (isPreSend(operation.phase)) {
      // A pre-send phase means nothing was broadcast — but a live runner advancing through
      // compute/storage/chain-input can be microseconds from sending. Declaring NOT_BROADCAST
      // here would drive the operation TERMINAL and let a retry double-spend the very send in
      // flight. Refuse until the operation is provably stale (no journal update within the grace
      // window). Fail closed on an unparseable timestamp.
      const updatedMs = Date.parse(operation.updatedAt);
      if (!Number.isFinite(updatedMs) || now() - updatedMs < options.livenessGraceMs)
        throw new WriteRecoveryError("RECOVERY_OPERATION_LIVE",
          "Operation may still be in flight; refuse pre-send recovery until it goes stale");
      const outcome = Object.freeze({ status: "NOT_BROADCAST" as const, recoveryId });
      options.journal.reconcileRecoveryCosts?.(recoveryId, "RELEASED"); options.journal.complete?.(recoveryId, outcome); return outcome;
    }
    if (!operation.chainInput) return unknown(operation, suppliedHash);
    try { validateOperationCommitments(operation); } catch { return unknown(operation, suppliedHash); }
    const hash = await trustedHash(operation, suppliedHash, options.chain, options.confirmations, signal);
    if (!hash) return unknown(operation);
    const result = await inspect(options.chain, operation.chainInput, hash, options.confirmations, options.timeoutMs, signal);
    if (result.status === "UNKNOWN") return unknown(operation, hash);
    if (result.status === "REVERTED") {
      const outcome = Object.freeze({ status: "REVERTED" as const, recoveryId, transactionHash: hash });
      if (operation.phase === "SUBMISSION_ATTEMPTED") options.journal.recordTransactionHash?.(recoveryId, hash);
      options.journal.reconcileRecoveryCosts?.(recoveryId, "CONSUMED");
      options.journal.recordRecovered?.(recoveryId); options.journal.complete?.(recoveryId, outcome); return outcome;
    }
    if (operation.phase === "SUBMISSION_ATTEMPTED") options.journal.recordTransactionHash?.(recoveryId, hash);
    if (operation.phase !== "FINALIZED") options.journal.recordFinalized?.(recoveryId, result.finality);
    options.journal.reconcileRecoveryCosts?.(recoveryId, "CONSUMED");
    options.journal.recordRecovered?.(recoveryId); const version = expectedVersion(operation.chainInput).toString();
    try {
      const record = await abortable(options.chain.getProofLock(operation.chainInput.identityKey, signal), signal);
      if (!recordMatches(operation.chainInput, record, BigInt(version))) throw new Error("readback mismatch");
      const outcome = Object.freeze({ status: "SEALED" as const, recoveryId, transactionHash: hash,
        identityKey: operation.identityKey, version }); options.journal.complete?.(recoveryId, outcome); return outcome;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const outcome = Object.freeze({ status: "FINALIZED_READBACK_UNAVAILABLE" as const, recoveryId,
        transactionHash: hash, identityKey: operation.identityKey, version }); options.journal.complete?.(recoveryId, outcome); return outcome;
    }
  } });
}

async function trustedHash(operation: OperationRecord, supplied: string | undefined, chain: RegistryChainAdapter,
  confirmations: number, signal?: AbortSignal): Promise<Bytes32 | null> {
  const terminalHash = operation.terminalOutcome && "transactionHash" in operation.terminalOutcome
    ? operation.terminalOutcome.transactionHash : undefined;
  const known = (operation.transactionHash ?? terminalHash)?.toLowerCase();
  if (supplied && known && supplied.toLowerCase() !== known) return null;
  const selected = supplied?.toLowerCase() ?? known;
  if (selected) return selected as Bytes32;
  if (operation.phase !== "SUBMISSION_ATTEMPTED" && operation.phase !== "RECOVERY_REQUIRED") return null;
  const candidates = chain.findProofLockTransactionHashes
    ? await abortable(chain.findProofLockTransactionHashes(operation.chainInput!, confirmations, signal), signal) : [];
  return candidates.length === 1 ? candidates[0]! : null;
}
async function inspect(chain: RegistryChainAdapter, input: ChainWriteRequest, hash: Bytes32, confirmations: number,
  timeoutMs: number, signal?: AbortSignal): Promise<{ status: "UNKNOWN" } | { status: "REVERTED" }
  | { status: "FINALIZED"; finality: { transactionHash: Bytes32; blockHash: Bytes32; blockNumber: string; confirmations: number } }> {
  try {
    if (await abortable(chain.getChainId(signal), signal) !== 16661n) return { status: "UNKNOWN" };
    const transaction = await abortable(chain.getTransaction(hash, signal), signal);
    if (!transaction || transaction.hash.toLowerCase() !== hash || address(transaction.to) !== input.registryAddress
      || address(transaction.from) !== input.scanner || transaction.data !== encodeWrite(input)) return { status: "UNKNOWN" };
    const receipt = await abortable(chain.waitForReceipt(hash, confirmations, timeoutMs, signal), signal);
    if (!receipt || receipt.transactionHash.toLowerCase() !== hash || receipt.confirmations < confirmations) return { status: "UNKNOWN" };
    if (receipt.status === 0) return { status: "REVERTED" };
    if (receipt.status !== 1 || !eventMatches(receipt, input, expectedVersion(input)) || !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash))
      return { status: "UNKNOWN" };
    return { status: "FINALIZED", finality: { transactionHash: hash, blockHash: receipt.blockHash.toLowerCase() as Bytes32,
      blockNumber: receipt.blockNumber.toString(), confirmations: receipt.confirmations } };
  } catch (error) { if (signal?.aborted) throw signal.reason; return { status: "UNKNOWN" }; }
}
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> { if (!signal) return promise; signal.throwIfAborted();
  return Promise.race([promise, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]); }
export function encodeWrite(input: ChainWriteRequest): string { const lock = [input.envelopeDigest, input.storageRoot, input.computeRoot,
  input.artifactHash, input.runtimeCodeHash, input.validForSeconds, input.policyVersion, input.behavioralScore, input.codeRisk, input.coverage];
  return input.mode === "SEAL" ? REGISTRY_V2_INTERFACE.encodeFunctionData("seal", [input.identityKey, input.subject, lock])
    : REGISTRY_V2_INTERFACE.encodeFunctionData("reseal", [input.identityKey, input.subject, input.expectedPriorVersion!, lock]); }
function eventMatches(receipt: RegistryReceipt, input: ChainWriteRequest, version: bigint): boolean { const events = receipt.logs
  .filter((log) => address(log.address) === input.registryAddress).flatMap((log) => { try { const parsed = REGISTRY_V2_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
    return parsed?.name === "ProofLocked" ? [parsed.args] : []; } catch { return []; } }); if (events.length !== 1) return false; const args = events[0]!;
  return equal(args.identityKey, input.identityKey) && equal(args.subject, input.subject) && BigInt(String(args.version)) === version
    && BigInt(String(args.validUntil)) - BigInt(String(args.issuedAt)) === BigInt(input.validForSeconds)
    && equal(args.envelopeDigest, input.envelopeDigest) && equal(args.storageRoot, input.storageRoot) && equal(args.computeRoot, input.computeRoot)
    && equal(args.artifactHash, input.artifactHash) && equal(args.runtimeCodeHash, input.runtimeCodeHash) && Number(args.policyVersion) === input.policyVersion
    && Number(args.behavioralScore) === input.behavioralScore && Number(args.codeRisk) === input.codeRisk && Number(args.coverage) === input.coverage; }
function recordMatches(input: ChainWriteRequest, record: RegistryProofLockRecord, version: bigint) { return equal(record.identityKey, input.identityKey)
  && equal(record.subject, input.subject) && equal(record.envelopeDigest, input.envelopeDigest) && equal(record.storageRoot, input.storageRoot)
  && equal(record.computeRoot, input.computeRoot) && equal(record.artifactHash, input.artifactHash) && equal(record.runtimeCodeHash, input.runtimeCodeHash)
  && record.version === version && record.validUntil - record.issuedAt === BigInt(input.validForSeconds) && record.policyVersion === input.policyVersion
  && record.behavioralScore === input.behavioralScore && record.codeRisk === input.codeRisk && record.coverage === input.coverage && record.state === 1 && record.stateReason === 0; }
function validateInput(id: string, hash?: string) { if (!/^rec_[0-9a-f]{16,64}$/i.test(id) || (hash !== undefined
  && (!/^0x[0-9a-f]{64}$/i.test(hash) || /^0x0{64}$/i.test(hash)))) throw new WriteRecoveryError("INVALID_RECOVERY_INPUT"); }
function isPreSend(phase: OperationRecord["phase"]) { return ["REQUESTED", "COMPUTE_VERIFIED", "STORAGE_VERIFIED", "CHAIN_INPUT_COMMITTED"].includes(phase); }
function unknown(operation: OperationRecord, hash?: string): PublicWriteOutcome { return Object.freeze({ status: "SUBMISSION_OUTCOME_UNKNOWN",
  recoveryId: operation.recoveryId, ...(hash && /^0x[0-9a-f]{64}$/i.test(hash) ? { transactionHash: hash.toLowerCase() as Bytes32 } : {}) }); }
function expectedVersion(input: ChainWriteRequest) { return input.mode === "SEAL" ? 1n : input.expectedPriorVersion! + 1n; }
function equal(left: unknown, right: unknown) { return String(left).toLowerCase() === String(right).toLowerCase(); }
function address(value: string) { try { return getAddress(value).toLowerCase(); } catch { return ""; } }
