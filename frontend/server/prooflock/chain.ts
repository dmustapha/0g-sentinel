import { AbiCoder, Interface, getAddress, keccak256, toUtf8Bytes, type Provider, type Signer } from "ethers";
import { canonicalize } from "json-canonicalize";

import { ERC8004_IDENTITY_REGISTRY, type AgentIdentity, type Bytes32, type HexAddress } from "./types";

const MAINNET_CHAIN_ID = 16661n;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Bytes32;
const STATE_ACTIVE = 1;
const MAX_CONFIRMATIONS = 64;
const MAX_TIMEOUT_MS = 120_000;
const UINT64_MAX = (1n << 64n) - 1n;

export const REGISTRY_V2_INTERFACE = new Interface([
  "function seal(bytes32 identityKey,address subject,(bytes32 envelopeDigest,bytes32 storageRoot,bytes32 computeRoot,bytes32 artifactHash,bytes32 expectedRuntimeCodeHash,uint48 validForSeconds,uint32 policyVersion,uint8 behavioralScore,uint8 codeRisk,uint8 coverage) input)",
  "function reseal(bytes32 identityKey,address subject,uint64 expectedPriorVersion,(bytes32 envelopeDigest,bytes32 storageRoot,bytes32 computeRoot,bytes32 artifactHash,bytes32 expectedRuntimeCodeHash,uint48 validForSeconds,uint32 policyVersion,uint8 behavioralScore,uint8 codeRisk,uint8 coverage) input)",
  "function markDrift(bytes32 identityKey,uint8 reason,uint64 expectedVersion)",
  "function getProofLock(bytes32 identityKey) view returns ((bytes32 identityKey,address subject,bytes32 envelopeDigest,bytes32 storageRoot,bytes32 computeRoot,bytes32 artifactHash,bytes32 runtimeCodeHash,uint64 version,uint48 issuedAt,uint48 validUntil,uint32 policyVersion,uint8 behavioralScore,uint8 codeRisk,uint8 coverage,uint8 state,uint8 stateReason))",
  "event ProofLocked(bytes32 indexed identityKey,address indexed subject,uint64 indexed version,uint48 issuedAt,uint48 validUntil,bytes32 envelopeDigest,bytes32 storageRoot,bytes32 computeRoot,bytes32 artifactHash,bytes32 runtimeCodeHash,uint32 policyVersion,uint8 behavioralScore,uint8 codeRisk,uint8 coverage)",
  "event DriftMarked(bytes32 indexed identityKey,uint64 indexed version,uint8 reason)",
]);

export type ChainErrorCode =
  | "INVALID_INPUT" | "WRONG_CHAIN" | "REGISTRY_UNAVAILABLE" | "LOCK_STATE_MISMATCH"
  | "TRANSACTION_FAILED" | "TRANSACTION_MISMATCH" | "TRANSACTION_REVERTED"
  | "FINALITY_INCOMPLETE" | "LOCK_EVENT_MISSING" | "LOCK_EVENT_MISMATCH" | "READBACK_MISMATCH";

export class ChainProofError extends Error {
  constructor(readonly code: ChainErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ChainProofError";
  }
}

export type RegistryProofLockRecord = Readonly<{
  identityKey: Bytes32; subject: HexAddress; envelopeDigest: Bytes32; storageRoot: Bytes32;
  computeRoot: Bytes32; artifactHash: Bytes32; runtimeCodeHash: Bytes32; version: bigint;
  issuedAt: bigint; validUntil: bigint; policyVersion: number; behavioralScore: number;
  codeRisk: number; coverage: number; state: number; stateReason: number;
}>;

export type ChainWriteRequest = Readonly<{
  registryAddress: HexAddress; scanner: HexAddress; mode: "SEAL" | "RESEAL"; expectedPriorVersion?: bigint; previousProofId?: Bytes32;
  identityKey: Bytes32; subject: HexAddress; envelopeDigest: Bytes32; storageRoot: Bytes32;
  computeRoot: Bytes32; artifactHash: Bytes32; runtimeCodeHash: Bytes32;
  validForSeconds: number; policyVersion: number; behavioralScore: number;
  codeRisk: number; coverage: number;
}>;

export type ChainWriteResult = Readonly<{ transactionHash: Bytes32; expectedVersion: bigint; signer: HexAddress }>;
export type DriftWriteRequest = Readonly<{
  registryAddress: HexAddress; identityKey: Bytes32; expectedVersion: bigint; reason: number;
}>;
export type DriftWriteResult = Readonly<{ transactionHash: Bytes32; version: bigint; reason: number }>;
export type RegistryLog = Readonly<{ address: string; topics: readonly string[]; data: string }>;
export type RegistryReceipt = Readonly<{
  transactionHash: string; status: number; blockNumber: bigint; blockHash: string;
  confirmations: number; logs: readonly RegistryLog[];
}>;

export interface RegistryChainAdapter {
  readonly registryAddress: HexAddress;
  getChainId(): Promise<bigint>;
  getCode(address: string): Promise<string>;
  getProofLock(identityKey: Bytes32): Promise<RegistryProofLockRecord>;
  sendTransaction(transaction: Readonly<{ to: HexAddress; data: string }>): Promise<Readonly<{ hash: string; to: string; data: string; from: string }>>;
  waitForReceipt(hash: string, confirmations: number, timeoutMs: number): Promise<RegistryReceipt | null>;
  getTransaction(hash: string): Promise<Readonly<{ hash: string; to: string; data: string; from: string }> | null>;
}

export function createEthersRegistryChainAdapter(
  provider: Provider,
  signer: Signer,
  registryAddress: string,
): RegistryChainAdapter {
  const registry = normalizeAddress(registryAddress, "registry");
  const adapter: RegistryChainAdapter = {
    registryAddress: registry,
    getChainId: async () => (await provider.getNetwork()).chainId,
    getCode: (address) => provider.getCode(address),
    getProofLock: (identityKey) => getEthersProofLock(provider, registry, identityKey),
    sendTransaction: async (transaction) => {
      const sent = await signer.sendTransaction(transaction);
      return { hash: sent.hash, to: transaction.to, data: transaction.data, from: sent.from };
    },
    waitForReceipt: async (hash, confirmations, timeoutMs) => {
      const receipt = await provider.waitForTransaction(hash, confirmations, timeoutMs);
      if (!receipt) return null;
      return {
        transactionHash: receipt.hash,
        status: receipt.status ?? 0,
        blockNumber: BigInt(receipt.blockNumber),
        blockHash: receipt.blockHash,
        confirmations: await receipt.confirmations(),
        logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
      };
    },
    getTransaction: async (hash) => {
      const transaction = await provider.getTransaction(hash);
      if (!transaction?.to) return null;
      return { hash: transaction.hash, to: transaction.to, data: transaction.data, from: transaction.from };
    },
  };
  return Object.freeze(adapter);
}

async function getEthersProofLock(
  provider: Provider,
  registry: HexAddress,
  identityKey: Bytes32,
): Promise<RegistryProofLockRecord> {
  const data = REGISTRY_V2_INTERFACE.encodeFunctionData("getProofLock", [identityKey]);
  const raw = await provider.call({ to: registry, data });
  const decoded = REGISTRY_V2_INTERFACE.decodeFunctionResult("getProofLock", raw)[0];
  return normalizeRecord(decoded);
}

function normalizeRecord(value: Record<string, unknown>): RegistryProofLockRecord {
  return Object.freeze({
    identityKey: bytes32(String(value.identityKey), true, "readback identity key"),
    subject: readbackAddress(String(value.subject)),
    envelopeDigest: bytes32(String(value.envelopeDigest), true, "readback envelope digest"),
    storageRoot: bytes32(String(value.storageRoot), true, "readback storage root"),
    computeRoot: bytes32(String(value.computeRoot), true, "readback compute root"),
    artifactHash: bytes32(String(value.artifactHash), true, "readback artifact hash"),
    runtimeCodeHash: bytes32(String(value.runtimeCodeHash), true, "readback runtime code hash"),
    version: BigInt(String(value.version)), issuedAt: BigInt(String(value.issuedAt)),
    validUntil: BigInt(String(value.validUntil)), policyVersion: Number(value.policyVersion),
    behavioralScore: Number(value.behavioralScore), codeRisk: Number(value.codeRisk),
    coverage: Number(value.coverage), state: Number(value.state), stateReason: Number(value.stateReason),
  });
}

function readbackAddress(value: string): HexAddress {
  if (/^0x0{40}$/i.test(value)) return value.toLowerCase() as HexAddress;
  return normalizeAddress(value, "readback subject");
}

export function computeIdentityKey(identity: AgentIdentity): Bytes32 {
  if (identity.namespace !== "eip155" || identity.chainId !== 16661 || !/^(0|[1-9]\d*)$/.test(identity.agentId)) invalid("identity");
  if (BigInt(identity.agentId) >= 1n << 256n) invalid("identity agent ID");
  const registry = normalizeAddress(identity.registryAddress, "identity registry");
  if (registry !== ERC8004_IDENTITY_REGISTRY) invalid("identity registry");
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"], [16661, registry, BigInt(identity.agentId)],
  )) as Bytes32;
}

export async function writeProofLock(
  adapter: RegistryChainAdapter,
  rawRequest: ChainWriteRequest,
  rawOptions: Readonly<{ confirmations: number; timeoutMs: number }>,
): Promise<ChainWriteResult> {
  const request = validateRequest(rawRequest);
  const options = validateOptions(rawOptions);
  await requireRegistry(adapter, request.registryAddress);
  await requireRuntimeBinding(adapter, request.subject, request.runtimeCodeHash);
  const current = await adapter.getProofLock(request.identityKey);
  const expectedVersion = requireWriteState(request, current);
  const data = encodeWrite(request);
  const transaction = await send(adapter, request.registryAddress, data, request.scanner);
  const receipt = await finalize(adapter, transaction.hash, options);
  await assertTransaction(adapter, transaction.hash, request.registryAddress, data, request.scanner);
  assertLockEvent(receipt, request, expectedVersion);
  return Object.freeze({ transactionHash: bytes32(transaction.hash, false, "transaction hash"),
    expectedVersion, signer: request.scanner });
}

export const PROOF_LOCK_ID_SCHEMA = "sentinel.prooflock/id-v1" as const;

export function computeProofLockId(registryAddress: string, record: RegistryProofLockRecord): Bytes32 {
  const registry = normalizeAddress(registryAddress, "registry");
  if (record.version < 1n) invalid("proof version");
  const value = {
    schema: PROOF_LOCK_ID_SCHEMA, chainId: 16661, registryAddress: registry,
    identityKey: bytes32(record.identityKey, false, "proof identity key"),
    subject: normalizeAddress(record.subject, "proof subject"), version: record.version.toString(),
    issuedAt: record.issuedAt.toString(), validUntil: record.validUntil.toString(),
    envelopeDigest: bytes32(record.envelopeDigest, false, "proof envelope"),
    storageRoot: bytes32(record.storageRoot, false, "proof storage root"),
    computeRoot: bytes32(record.computeRoot, false, "proof compute root"),
    artifactHash: bytes32(record.artifactHash, false, "proof artifact hash"),
    runtimeCodeHash: bytes32(record.runtimeCodeHash, true, "proof runtime hash"),
    policyVersion: record.policyVersion, behavioralScore: record.behavioralScore,
    codeRisk: record.codeRisk, coverage: record.coverage,
  };
  const encoded = canonicalize(value);
  if (typeof encoded !== "string") invalid("proof ID");
  return keccak256(toUtf8Bytes(encoded)) as Bytes32;
}

export async function markProofLockDrift(
  adapter: RegistryChainAdapter,
  rawRequest: DriftWriteRequest,
  rawOptions: Readonly<{ confirmations: number; timeoutMs: number }>,
): Promise<DriftWriteResult> {
  const request = validateDriftRequest(rawRequest);
  const options = validateOptions(rawOptions);
  await requireRegistry(adapter, request.registryAddress);
  const current = await adapter.getProofLock(request.identityKey);
  assertDriftSource(current, request);
  const data = REGISTRY_V2_INTERFACE.encodeFunctionData("markDrift", [
    request.identityKey, request.reason, request.expectedVersion,
  ]);
  const transaction = await send(adapter, request.registryAddress, data);
  const receipt = await finalize(adapter, transaction.hash, options);
  await assertTransaction(adapter, transaction.hash, request.registryAddress, data);
  assertDriftEvent(receipt, request);
  await assertDriftReadback(adapter, request);
  return Object.freeze({ transactionHash: bytes32(transaction.hash, false, "transaction hash"),
    version: request.expectedVersion, reason: request.reason });
}

export async function readProofLockBack(
  adapter: RegistryChainAdapter,
  rawRequest: ChainWriteRequest,
  write: ChainWriteResult,
): Promise<RegistryProofLockRecord> {
  const request = validateRequest(rawRequest);
  const expectedWrite = validateWriteResult(write);
  await requireRegistry(adapter, request.registryAddress);
  const requiredVersion = request.mode === "SEAL" ? 1n : request.expectedPriorVersion! + 1n;
  if (expectedWrite.expectedVersion !== requiredVersion) {
    throw new ChainProofError("READBACK_MISMATCH", "Write result version mismatch");
  }
  const record = await adapter.getProofLock(request.identityKey);
  const expected = expectedRecord(request, expectedWrite.expectedVersion);
  for (const [key, value] of Object.entries(expected)) {
    if (!same(record[key as keyof RegistryProofLockRecord], value)) {
      throw new ChainProofError("READBACK_MISMATCH", `Registry readback mismatch: ${key}`);
    }
  }
  if (record.validUntil - record.issuedAt !== BigInt(request.validForSeconds)) {
    throw new ChainProofError("READBACK_MISMATCH", "Registry readback TTL mismatch");
  }
  return Object.freeze(record);
}

async function requireRuntimeBinding(
  adapter: RegistryChainAdapter,
  subject: HexAddress,
  expectedHash: Bytes32,
): Promise<void> {
  const code = await adapter.getCode(subject);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) invalid("subject runtime code");
  const actual = code === "0x" ? ZERO_BYTES32 : keccak256(code) as Bytes32;
  if (actual.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new ChainProofError("LOCK_STATE_MISMATCH", "Subject runtime changed before Registry write");
  }
}

function validateRequest(value: ChainWriteRequest): ChainWriteRequest {
  if (!value || (value.mode !== "SEAL" && value.mode !== "RESEAL")) invalid("mode");
  const snapshot = { ...value };
  const request = {
    ...snapshot,
    registryAddress: normalizeAddress(snapshot.registryAddress, "registry"),
    scanner: normalizeAddress(snapshot.scanner, "scanner"),
    subject: normalizeAddress(snapshot.subject, "subject"),
    identityKey: bytes32(snapshot.identityKey, false, "identity key"),
    envelopeDigest: bytes32(snapshot.envelopeDigest, false, "envelope digest"),
    storageRoot: bytes32(snapshot.storageRoot, false, "storage root"),
    computeRoot: bytes32(snapshot.computeRoot, false, "compute root"),
    artifactHash: bytes32(snapshot.artifactHash, false, "artifact hash"),
    runtimeCodeHash: bytes32(snapshot.runtimeCodeHash, true, "runtime code hash"),
    ...(snapshot.previousProofId ? { previousProofId: bytes32(snapshot.previousProofId, false, "previous proof ID") } : {}),
  };
  integer(request.validForSeconds, 1, 30 * 86400, "TTL");
  integer(request.policyVersion, 1, 4_294_967_295, "policy version");
  integer(request.behavioralScore, 0, 100, "behavioral score");
  integer(request.codeRisk, 0, 2, "code risk");
  integer(request.coverage, 0, 0xff, "coverage");
  if ((request.coverage & 0x7f) !== 0x7f) invalid("coverage");
  if (request.mode === "RESEAL" && (typeof request.expectedPriorVersion !== "bigint"
    || request.expectedPriorVersion < 1n || request.expectedPriorVersion > UINT64_MAX)) {
    invalid("expected prior version");
  }
  if (request.mode === "RESEAL" && !request.previousProofId) invalid("previous proof ID");
  if (request.mode === "SEAL" && (request.expectedPriorVersion !== undefined || request.previousProofId !== undefined)) {
    invalid("seal predecessor");
  }
  return Object.freeze(request);
}

function validateOptions(value: Readonly<{ confirmations: number; timeoutMs: number }>) {
  const confirmations = value?.confirmations;
  const timeoutMs = value?.timeoutMs;
  integer(confirmations, 1, MAX_CONFIRMATIONS, "confirmations");
  integer(timeoutMs, 1, MAX_TIMEOUT_MS, "receipt timeout");
  return Object.freeze({ confirmations, timeoutMs });
}

function validateDriftRequest(value: DriftWriteRequest): DriftWriteRequest {
  if (!value) invalid("drift request");
  const snapshot = { ...value };
  if (typeof snapshot.expectedVersion !== "bigint"
    || snapshot.expectedVersion < 1n || snapshot.expectedVersion > UINT64_MAX) invalid("drift version");
  integer(snapshot.reason, 1, 16, "drift reason");
  return Object.freeze({ registryAddress: normalizeAddress(snapshot.registryAddress, "registry"),
    identityKey: bytes32(snapshot.identityKey, false, "identity key"),
    expectedVersion: snapshot.expectedVersion, reason: snapshot.reason });
}

function validateWriteResult(value: ChainWriteResult): ChainWriteResult {
  if (!value || typeof value.expectedVersion !== "bigint"
    || value.expectedVersion < 1n || value.expectedVersion > UINT64_MAX) invalid("write version");
  return Object.freeze({ transactionHash: bytes32(value.transactionHash, false, "write transaction hash"),
    expectedVersion: value.expectedVersion, signer: normalizeAddress(value.signer, "write signer") });
}

async function requireRegistry(adapter: RegistryChainAdapter, registry: HexAddress): Promise<void> {
  if (adapter.registryAddress.toLowerCase() !== registry.toLowerCase()) {
    throw new ChainProofError("REGISTRY_UNAVAILABLE", "Registry adapter address mismatch");
  }
  if (await adapter.getChainId() !== MAINNET_CHAIN_ID) {
    throw new ChainProofError("WRONG_CHAIN", "ProofLock writes require 0G mainnet chain 16661");
  }
  const code = await adapter.getCode(registry);
  if (!/^0x[0-9a-fA-F]+$/.test(code) || /^0x0*$/.test(code)) {
    throw new ChainProofError("REGISTRY_UNAVAILABLE", "Registry v2 has no runtime bytecode");
  }
}

function requireWriteState(request: ChainWriteRequest, current: RegistryProofLockRecord): bigint {
  if (request.mode === "SEAL" && current.version !== 0n) {
    throw new ChainProofError("LOCK_STATE_MISMATCH", "Seal requires an absent ProofLock");
  }
  if (request.mode === "RESEAL" && current.version !== request.expectedPriorVersion) {
    throw new ChainProofError("LOCK_STATE_MISMATCH", "Reseal prior version mismatch");
  }
  if (request.mode === "RESEAL" && current.state !== 1 && current.state !== 3) {
    throw new ChainProofError("LOCK_STATE_MISMATCH", "Reseal source is not active or drifted");
  }
  if (request.mode === "RESEAL"
    && computeProofLockId(request.registryAddress, current) !== request.previousProofId) {
    throw new ChainProofError("LOCK_STATE_MISMATCH", "Reseal previous proof ID mismatch");
  }
  return request.mode === "SEAL" ? 1n : current.version + 1n;
}

function assertDriftSource(record: RegistryProofLockRecord, request: DriftWriteRequest): void {
  if (record.identityKey.toLowerCase() !== request.identityKey || record.version !== request.expectedVersion
    || record.state !== STATE_ACTIVE) {
    throw new ChainProofError("LOCK_STATE_MISMATCH", "Drift source version is not active and current");
  }
}

function assertDriftEvent(receipt: RegistryReceipt, request: DriftWriteRequest): void {
  const matches = parseRegistryEvents(receipt.logs, request.registryAddress, "DriftMarked");
  if (matches.length === 0) throw new ChainProofError("LOCK_EVENT_MISSING", "DriftMarked event missing");
  const args = matches[0]?.args;
  if (matches.length !== 1 || !args || !same(args.identityKey, request.identityKey)
    || asBigInt(args.version) !== request.expectedVersion || Number(args.reason) !== request.reason) {
    throw new ChainProofError("LOCK_EVENT_MISMATCH", "DriftMarked event mismatch");
  }
}

async function assertDriftReadback(adapter: RegistryChainAdapter, request: DriftWriteRequest): Promise<void> {
  const record = await adapter.getProofLock(request.identityKey);
  if (record.identityKey.toLowerCase() !== request.identityKey || record.version !== request.expectedVersion
    || record.state !== 3 || record.stateReason !== request.reason) {
    throw new ChainProofError("READBACK_MISMATCH", "Drifted record readback mismatch");
  }
}

function encodeWrite(request: ChainWriteRequest): string {
  const input = [request.envelopeDigest, request.storageRoot, request.computeRoot, request.artifactHash,
    request.runtimeCodeHash, request.validForSeconds, request.policyVersion,
    request.behavioralScore, request.codeRisk, request.coverage];
  const prefix = request.mode === "SEAL"
    ? [request.identityKey, request.subject]
    : [request.identityKey, request.subject, request.expectedPriorVersion!];
  return REGISTRY_V2_INTERFACE.encodeFunctionData(request.mode === "SEAL" ? "seal" : "reseal", [
    ...prefix, input,
  ]);
}

async function send(adapter: RegistryChainAdapter, to: HexAddress, data: string, expectedFrom?: HexAddress) {
  try {
    const transaction = await adapter.sendTransaction({ to, data });
    if (!transaction || normalizeAddress(transaction.to, "transaction target") !== to || transaction.data !== data
      || (expectedFrom && normalizeAddress(transaction.from, "transaction sender") !== expectedFrom)) {
      throw new ChainProofError("TRANSACTION_MISMATCH", "Submitted transaction differs from request");
    }
    bytes32(transaction.hash, false, "transaction hash");
    return transaction;
  } catch (error) {
    if (error instanceof ChainProofError) throw error;
    throw new ChainProofError("TRANSACTION_FAILED", "Registry transaction submission failed", error);
  }
}

async function finalize(adapter: RegistryChainAdapter, hash: string, options: { confirmations: number; timeoutMs: number }) {
  const receipt = await adapter.waitForReceipt(hash, options.confirmations, options.timeoutMs);
  if (!receipt || receipt.status !== 1) throw new ChainProofError("TRANSACTION_REVERTED", "Registry transaction did not succeed");
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
    throw new ChainProofError("TRANSACTION_MISMATCH", "Receipt transaction hash mismatch");
  }
  if (!Number.isSafeInteger(receipt.confirmations) || receipt.confirmations < options.confirmations) {
    throw new ChainProofError("FINALITY_INCOMPLETE", "Registry transaction lacks required confirmations");
  }
  bytes32(receipt.blockHash, false, "receipt block hash");
  return receipt;
}

async function assertTransaction(
  adapter: RegistryChainAdapter,
  hash: string,
  to: HexAddress,
  data: string,
  expectedFrom?: HexAddress,
) {
  const transaction = await adapter.getTransaction(hash);
  if (!transaction || transaction.hash.toLowerCase() !== hash.toLowerCase()
    || normalizeAddress(transaction.to, "transaction target") !== to || transaction.data !== data
    || (expectedFrom && normalizeAddress(transaction.from, "transaction sender") !== expectedFrom)) {
    throw new ChainProofError("TRANSACTION_MISMATCH", "Finalized transaction calldata mismatch");
  }
}

function assertLockEvent(receipt: RegistryReceipt, request: ChainWriteRequest, version: bigint): void {
  const matches = parseRegistryEvents(receipt.logs, request.registryAddress, "ProofLocked");
  if (matches.length === 0) throw new ChainProofError("LOCK_EVENT_MISSING", "ProofLocked event missing");
  if (matches.length !== 1 || !eventMatches(matches[0]!.args, request, version)) {
    throw new ChainProofError("LOCK_EVENT_MISMATCH", "ProofLocked event does not bind the requested lock");
  }
}

function parseRegistryEvents(logs: readonly RegistryLog[], registry: HexAddress, name: string) {
  return logs.filter((log) => normalizeAddress(log.address, "event registry") === registry)
    .map((log) => { try { return REGISTRY_V2_INTERFACE.parseLog({ topics: [...log.topics], data: log.data }); } catch { return null; } })
    .filter((event) => event?.name === name);
}

function eventMatches(args: Record<string, unknown>, request: ChainWriteRequest, version: bigint): boolean {
  return same(args.identityKey, request.identityKey) && same(args.subject, request.subject)
    && asBigInt(args.version) === version
    && asBigInt(args.validUntil) - asBigInt(args.issuedAt) === BigInt(request.validForSeconds)
    && same(args.envelopeDigest, request.envelopeDigest) && same(args.storageRoot, request.storageRoot)
    && same(args.computeRoot, request.computeRoot) && same(args.artifactHash, request.artifactHash)
    && same(args.runtimeCodeHash, request.runtimeCodeHash) && Number(args.policyVersion) === request.policyVersion
    && Number(args.behavioralScore) === request.behavioralScore && Number(args.codeRisk) === request.codeRisk
    && Number(args.coverage) === request.coverage;
}

function asBigInt(value: unknown): bigint {
  if (typeof value !== "bigint") throw new ChainProofError("LOCK_EVENT_MISMATCH", "Invalid event integer");
  return value;
}

function expectedRecord(request: ChainWriteRequest, version: bigint): Partial<RegistryProofLockRecord> {
  return { identityKey: request.identityKey, subject: request.subject, envelopeDigest: request.envelopeDigest,
    storageRoot: request.storageRoot, computeRoot: request.computeRoot, artifactHash: request.artifactHash,
    runtimeCodeHash: request.runtimeCodeHash, version, policyVersion: request.policyVersion,
    behavioralScore: request.behavioralScore, codeRisk: request.codeRisk, coverage: request.coverage,
    state: STATE_ACTIVE, stateReason: 0 };
}

function same(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function normalizeAddress(value: string, label: string): HexAddress {
  try { const result = getAddress(value).toLowerCase() as HexAddress; if (/^0x0{40}$/.test(result)) throw new Error(); return result; }
  catch { invalid(label); }
}

function bytes32(value: string, allowZero: boolean, label: string): Bytes32 {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || (!allowZero && value.toLowerCase() === ZERO_BYTES32)) invalid(label);
  return value.toLowerCase() as Bytes32;
}

function integer(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(label);
}

function invalid(label: string): never { throw new ChainProofError("INVALID_INPUT", `Invalid ${label}`); }
