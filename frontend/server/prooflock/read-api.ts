import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { createReadOnlyInferenceBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { Interface, JsonRpcProvider, VoidSigner, isError, keccak256 } from "ethers";

import { canonicalizeEvidence } from "./canonical";
import { REGISTRY_V2_INTERFACE, computeIdentityKey, computeProofLockId, createEthersRegistryChainAdapter } from "./chain";
import { resolveAgentIdentity } from "./identity/erc8004";
import { verifyOfflineComputeProof, verifyStorageArtifactBinding } from "./offline-verifier";
import { resolveService } from "./compute/service";
import { computeProofRoot } from "./runner";
import { computeZeroGLayout, STORAGE_VERIFICATION_CAPABILITY } from "./storage";
import { assertZeroGMainnetRpc } from "./rpc";
import { StorageRecoveryMismatchError, recoverStorageCommitment } from "./storage-recovery";
import { ERC8004_IDENTITY_REGISTRY, type EvidenceEnvelopeV1, type ResolvedAgentIdentity } from "./types";
import { ProofMismatchError } from "./errors";
import type { HistoricalProofLock, ProofLockDetail, ProofLockReadDependencies } from "./api";
import type { RegistryProofLockRecord } from "./chain";
import { StrictComputeError } from "./compute/strict-error";

const CHAIN_ID = 16661;
const MAX_EVIDENCE_BYTES = 1_048_576;
const ZERO = "0x0000000000000000000000000000000000000001";
const LOG_CHUNK = 2_000;
const GATE = new Interface([
  "function checkAgent(uint256 agentId) view returns (bool allowed,uint8 reason,address subject,uint64 version)",
]);
const CONSUMER = new Interface([
  "function gate() view returns (address)", "function acceptAgent(uint256 agentId)",
]);

export type ProofLockDetailDependencies = Readonly<{
  downloadEvidence(root: string, signal: AbortSignal): Promise<Uint8Array>;
  verifyStorageRoot(bytes: Uint8Array, root: string, signal: AbortSignal): Promise<void>;
  resolveIdentity(agentId: string, signal: AbortSignal): Promise<ResolvedAgentIdentity>;
  checkGate(agentId: string, signal: AbortSignal): Promise<Readonly<{
    allowed: boolean; reason: number; subject: string; version: bigint;
  }>>;
  simulateConsumer(agentId: string, subject: string, signal: AbortSignal): Promise<Readonly<{
    accepted: boolean; address: string;
  }>>;
}>;

export function createProductionReadDependencies(env = process.env): ProofLockReadDependencies {
  const rpcUrl = requiredHttps(env.ZERO_G_RPC || env.NEXT_PUBLIC_RPC_URL, "ZERO_G_RPC");
  const registryAddress = optionalAddress(env.PROOFLOCK_REGISTRY_V2_ADDRESS);
  const provider = new JsonRpcProvider(rpcUrl);
  const adapter = registryAddress
    ? createEthersRegistryChainAdapter(provider, new VoidSigner(ZERO, provider), registryAddress)
    : undefined;
  const resolveIdentity = (agentId: string, signal: AbortSignal) =>
    resolveProductionIdentity(rpcUrl, provider, agentId, signal);
  return Object.freeze({
    registryAddress,
    resolveIdentity,
    readProofLock: async (identityKey, signal) => {
      if (!adapter) throw new Error("PROOFLOCK_REGISTRY_V2_ADDRESS is not configured");
      await assertZeroGMainnetRpc(rpcUrl, signal);
      signal.throwIfAborted();
      const record = await adapter.getProofLock(identityKey as `0x${string}`);
      signal.throwIfAborted();
      return record;
    },
    readProofById: async (identityKey, proofId, signal) => {
      if (!registryAddress) throw new Error("PROOFLOCK_REGISTRY_V2_ADDRESS is not configured");
      await assertZeroGMainnetRpc(rpcUrl, signal);
      return findHistoricalProofLock(provider, registryAddress, identityKey, proofId,
        requiredInteger(env.PROOFLOCK_REGISTRY_V2_FROM_BLOCK,
          "PROOFLOCK_REGISTRY_V2_FROM_BLOCK", 0), signal);
    },
    readProofLockDetail: (record, signal) => enrichProofLockDetail(record, {
      downloadEvidence: (root, innerSignal) => downloadEvidence(
        requiredHttps(env.ZERO_G_STORAGE_INDEXER, "ZERO_G_STORAGE_INDEXER"), root, innerSignal),
      verifyStorageRoot: verifyDownloadedRoot,
      resolveIdentity,
      checkGate: (agentId, innerSignal) => checkAgentGate(
        rpcUrl, provider, requiredAddress(env.PROOFLOCK_AGENT_GATE_V2_ADDRESS,
          "PROOFLOCK_AGENT_GATE_V2_ADDRESS"), agentId, innerSignal),
      simulateConsumer: (agentId, subject, innerSignal) => simulateProofLockConsumer(
        rpcUrl, provider, requiredAddress(env.PROOFLOCK_CONSUMER_ADDRESS,
          "PROOFLOCK_CONSUMER_ADDRESS"), requiredAddress(env.PROOFLOCK_AGENT_GATE_V2_ADDRESS,
          "PROOFLOCK_AGENT_GATE_V2_ADDRESS"), agentId, subject, innerSignal),
    }, signal),
    computeProofId: computeProofLockId,
    verifyStoredEvidence: (record, signal) => verifyStorageEvidence({
      indexerUrl: requiredHttps(env.ZERO_G_STORAGE_INDEXER, "ZERO_G_STORAGE_INDEXER"),
      rpcUrl, provider,
      flowAddress: requiredAddress(env.PROOFLOCK_STORAGE_FLOW_ADDRESS, "PROOFLOCK_STORAGE_FLOW_ADDRESS"),
      flowFromBlock: requiredInteger(env.PROOFLOCK_STORAGE_FLOW_FROM_BLOCK, "PROOFLOCK_STORAGE_FLOW_FROM_BLOCK", 0),
      confirmations: requiredInteger(env.PROOFLOCK_STORAGE_CONFIRMATIONS ?? "3", "PROOFLOCK_STORAGE_CONFIRMATIONS", 1),
    }, record, signal),
  });
}

export async function enrichProofLockDetail(
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
  dependencies: ProofLockDetailDependencies,
  signal: AbortSignal,
): Promise<ProofLockDetail> {
  const envelope = await recoverDetailEnvelope(record, dependencies, signal);
  if (!envelope.ok) return unavailable(envelope.code);
  const resolution = await resolveDetailIdentity(envelope.value, record, dependencies, signal);
  if (!resolution.ok) return unavailable(resolution.code);
  const gate = await readGateDetail(envelope.value.identity.agentId,
    resolution.value.agentWallet, record, dependencies, signal);
  const consumer = await readConsumerDetail(envelope.value.identity.agentId,
    resolution.value.agentWallet, gate, dependencies, signal);
  return Object.freeze({ status: "VERIFIED", identity: identitySummary(envelope.value, record),
    resolution: resolutionSummary(resolution.value), gate, consumer });
}

async function recoverDetailEnvelope(
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
  dependencies: ProofLockDetailDependencies,
  signal: AbortSignal,
) {
  let bytes: Uint8Array;
  try { bytes = await dependencies.downloadEvidence(record.storageRoot, signal); }
  catch (error) { rethrowAbort(error, signal); return { ok: false as const, code: "EVIDENCE_UNAVAILABLE" as const }; }
  try {
    if (bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES
      || keccak256(bytes).toLowerCase() !== record.envelopeDigest.toLowerCase()) throw new Error();
    await dependencies.verifyStorageRoot(bytes, record.storageRoot, signal);
    signal.throwIfAborted();
    const envelope = parseCanonicalEvidence(bytes);
    assertEnvelopeRecordBinding(envelope, record);
    assertStoredIdentityBinding(envelope, record);
    return { ok: true as const, value: envelope };
  } catch (error) { rethrowAbort(error, signal); return { ok: false as const, code: "EVIDENCE_INVALID" as const }; }
}

async function resolveDetailIdentity(
  envelope: EvidenceEnvelopeV1,
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
  dependencies: ProofLockDetailDependencies,
  signal: AbortSignal,
) {
  let resolution: ResolvedAgentIdentity;
  try { resolution = await dependencies.resolveIdentity(envelope.identity.agentId, signal); }
  catch (error) { rethrowAbort(error, signal); return { ok: false as const, code: "IDENTITY_UNAVAILABLE" as const }; }
  try {
    signal.throwIfAborted();
    assertResolvedIdentityBinding(envelope, resolution, record);
    return { ok: true as const, value: resolution };
  } catch (error) {
    rethrowAbort(error, signal);
    return { ok: false as const, code: "IDENTITY_INVALID" as const };
  }
}

async function readGateDetail(
  agentId: string,
  currentWallet: string,
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
  dependencies: ProofLockDetailDependencies,
  signal: AbortSignal,
) {
  try {
    const result = await dependencies.checkGate(agentId, signal);
    signal.throwIfAborted();
    if (!validGateResult(result, currentWallet, record)) throw new Error();
    return Object.freeze({ status: "VERIFIED" as const, allowed: result.allowed, reason: result.reason,
      subject: result.subject.toLowerCase() as `0x${string}`, version: result.version.toString() });
  } catch (error) {
    rethrowAbort(error, signal);
    return unknownGate();
  }
}

async function readConsumerDetail(
  agentId: string,
  currentWallet: string,
  gate: Awaited<ReturnType<typeof readGateDetail>>,
  dependencies: ProofLockDetailDependencies,
  signal: AbortSignal,
) {
  if (gate.status !== "VERIFIED") return unknownConsumer();
  try {
    const result = await dependencies.simulateConsumer(agentId, currentWallet, signal);
    signal.throwIfAborted();
    if (result.accepted !== gate.allowed || !/^0x[0-9a-fA-F]{40}$/.test(result.address)) throw new Error();
    return Object.freeze({ status: "VERIFIED" as const, accepted: result.accepted,
      address: result.address.toLowerCase() as `0x${string}`, subject: gate.subject, version: gate.version });
  } catch (error) {
    rethrowAbort(error, signal);
    return unknownConsumer();
  }
}

async function verifyStorageEvidence(
  config: Readonly<{ indexerUrl: string; rpcUrl: string; provider: JsonRpcProvider;
    flowAddress: `0x${string}`; flowFromBlock: number; confirmations: number }>,
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
  signal: AbortSignal,
) {
  const [blob, error] = await raceAbort(new Indexer(config.indexerUrl).downloadToBlob(record.storageRoot, { proof: true }), signal);
  if (error || blob.size === 0 || blob.size > MAX_EVIDENCE_BYTES) throw error ?? new Error("Storage evidence unavailable");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();
  if (keccak256(bytes).toLowerCase() !== record.envelopeDigest.toLowerCase()) mismatch();
  let envelope: EvidenceEnvelopeV1;
  try {
    const layout = await computeZeroGLayout(bytes, ZERO);
    if (layout.storageRoot.toLowerCase() !== record.storageRoot.toLowerCase()) mismatch();
    envelope = parseCanonicalEvidence(bytes);
    assertEnvelopeRecordBinding(envelope, record);
  } catch (error) { rethrowMismatch(error, signal); }
  await assertZeroGMainnetRpc(config.rpcUrl, signal);
  const broker = await raceAbort(createReadOnlyInferenceBroker(config.rpcUrl, CHAIN_ID), signal);
  const computeVerification = await Promise.all(envelope.computeProofs.map(async (proof) => {
    let live;
    try { live = await resolveService(broker, proof.provider, proof.model, signal); }
    catch (error) { if (computeMismatch(error)) mismatch(); throw error; }
    try { return verifyOfflineComputeProof(proof, live); }
    catch (error) { rethrowMismatch(error, signal); }
  }));
  await assertZeroGMainnetRpc(config.rpcUrl, signal);
  let storageCommitment;
  try { storageCommitment = await recoverStorageCommitment(config.provider, config.flowAddress,
    config.flowFromBlock, config.confirmations, record, signal); }
  catch (error) { if (error instanceof StorageRecoveryMismatchError) mismatch(); throw error; }
  try { verifyStorageArtifactBinding(record.artifactHash, storageCommitment); }
  catch (error) { rethrowMismatch(error, signal); }
  return Object.freeze({ envelope, computeVerification, storageCommitment, retrievalVerified: true as const,
    networkProofVerified: STORAGE_VERIFICATION_CAPABILITY.networkProofVerified });
}

async function findHistoricalProofLock(
  provider: JsonRpcProvider,
  registryAddress: `0x${string}`,
  identityKey: string,
  proofId: string,
  fromBlock: number,
  signal: AbortSignal,
): Promise<HistoricalProofLock | null> {
  const latest = await raceAbort(provider.getBlockNumber(), signal);
  const topics = REGISTRY_V2_INTERFACE.encodeFilterTopics("ProofLocked", [identityKey]);
  for (let end = latest; end >= fromBlock; end -= LOG_CHUNK) {
    signal.throwIfAborted();
    const start = Math.max(fromBlock, end - LOG_CHUNK + 1);
    const logs = await raceAbort(provider.getLogs({ address: registryAddress, topics,
      fromBlock: start, toBlock: end }), signal);
    const match = recoverHistoricalProofLock(registryAddress, identityKey, proofId, logs);
    if (match) return match;
  }
  return null;
}

export function recoverHistoricalProofLock(
  registryAddress: string,
  identityKey: string,
  proofId: string,
  logs: readonly Readonly<{ address: string; topics: readonly string[]; data: string;
    transactionHash: string; blockNumber: number }>[],
): HistoricalProofLock | null {
  const matches = logs.flatMap((log) => {
    try {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) return [];
      const parsed = REGISTRY_V2_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "ProofLocked") return [];
      const record = recordFromProofLocked(parsed.args);
      if (record.identityKey.toLowerCase() !== identityKey.toLowerCase()
        || computeProofLockId(registryAddress, record).toLowerCase() !== proofId.toLowerCase()
        || !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)
        || !Number.isSafeInteger(log.blockNumber) || log.blockNumber < 0) return [];
      return [{ record, source: { kind: "ProofLocked" as const,
        transactionHash: log.transactionHash.toLowerCase() as `0x${string}`, blockNumber: log.blockNumber } }];
    } catch { return []; }
  });
  if (matches.length > 1) mismatch();
  return matches[0] ?? null;
}

function recordFromProofLocked(args: Record<string, unknown>): RegistryProofLockRecord {
  return {
    identityKey: String(args.identityKey).toLowerCase() as `0x${string}`,
    subject: String(args.subject).toLowerCase() as `0x${string}`,
    envelopeDigest: String(args.envelopeDigest).toLowerCase() as `0x${string}`,
    storageRoot: String(args.storageRoot).toLowerCase() as `0x${string}`,
    computeRoot: String(args.computeRoot).toLowerCase() as `0x${string}`,
    artifactHash: String(args.artifactHash).toLowerCase() as `0x${string}`,
    runtimeCodeHash: String(args.runtimeCodeHash).toLowerCase() as `0x${string}`,
    version: BigInt(String(args.version)), issuedAt: BigInt(String(args.issuedAt)),
    validUntil: BigInt(String(args.validUntil)), policyVersion: Number(args.policyVersion),
    behavioralScore: Number(args.behavioralScore), codeRisk: Number(args.codeRisk),
    coverage: Number(args.coverage), state: 1, stateReason: 0,
  };
}

async function resolveProductionIdentity(
  rpcUrl: string,
  provider: JsonRpcProvider,
  agentId: string,
  signal: AbortSignal,
): Promise<ResolvedAgentIdentity> {
  await assertZeroGMainnetRpc(rpcUrl, signal);
  signal.throwIfAborted();
  const result = await resolveAgentIdentity({ namespace: "eip155", chainId: CHAIN_ID,
    registryAddress: ERC8004_IDENTITY_REGISTRY, agentId }, { provider, finalityConfirmations: 5 });
  signal.throwIfAborted();
  return result;
}

async function downloadEvidence(indexerUrl: string, root: string, signal: AbortSignal): Promise<Uint8Array> {
  const [blob, error] = await raceAbort(new Indexer(indexerUrl).downloadToBlob(root, { proof: true }), signal);
  if (error || blob.size === 0 || blob.size > MAX_EVIDENCE_BYTES) throw error ?? new Error("Storage evidence unavailable");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();
  return bytes;
}

async function verifyDownloadedRoot(bytes: Uint8Array, root: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const layout = await computeZeroGLayout(bytes, ZERO);
  signal.throwIfAborted();
  if (layout.storageRoot.toLowerCase() !== root.toLowerCase()) throw new Error("Storage root mismatch");
}

async function checkAgentGate(
  rpcUrl: string,
  provider: JsonRpcProvider,
  gateAddress: `0x${string}`,
  agentId: string,
  signal: AbortSignal,
) {
  await assertZeroGMainnetRpc(rpcUrl, signal);
  signal.throwIfAborted();
  const data = GATE.encodeFunctionData("checkAgent", [BigInt(agentId)]);
  const raw = await raceAbort(provider.call({ to: gateAddress, data }), signal);
  const decoded = GATE.decodeFunctionResult("checkAgent", raw);
  return { allowed: Boolean(decoded.allowed), reason: Number(decoded.reason),
    subject: String(decoded.subject).toLowerCase(), version: BigInt(decoded.version) };
}

async function simulateProofLockConsumer(
  rpcUrl: string,
  provider: JsonRpcProvider,
  consumerAddress: `0x${string}`,
  gateAddress: `0x${string}`,
  agentId: string,
  subject: string,
  signal: AbortSignal,
) {
  await assertZeroGMainnetRpc(rpcUrl, signal);
  signal.throwIfAborted();
  const code = await raceAbort(provider.getCode(consumerAddress), signal);
  if (code === "0x") throw new Error("ProofLock consumer is unavailable");
  const pointerRaw = await raceAbort(provider.call({ to: consumerAddress,
    data: CONSUMER.encodeFunctionData("gate") }), signal);
  const pointer = String(CONSUMER.decodeFunctionResult("gate", pointerRaw)[0]).toLowerCase();
  if (pointer !== gateAddress.toLowerCase()) throw new Error("ProofLock consumer Gate mismatch");
  try {
    await raceAbort(provider.call({ to: consumerAddress, from: subject,
      data: CONSUMER.encodeFunctionData("acceptAgent", [BigInt(agentId)]) }), signal);
    return { accepted: true, address: consumerAddress };
  } catch (error) {
    if (isError(error, "CALL_EXCEPTION")) return { accepted: false, address: consumerAddress };
    throw error;
  }
}

function assertStoredIdentityBinding(
  envelope: EvidenceEnvelopeV1,
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
): void {
  if (computeIdentityKey(envelope.identity).toLowerCase() !== record.identityKey.toLowerCase()
    || envelope.identity.chainId !== CHAIN_ID
    || envelope.identity.registryAddress !== ERC8004_IDENTITY_REGISTRY
    || envelope.identity.agentWallet.toLowerCase() !== record.subject.toLowerCase()
    || envelope.subject.address.toLowerCase() !== envelope.identity.agentWallet.toLowerCase()) throw new Error();
}

function assertResolvedIdentityBinding(
  envelope: EvidenceEnvelopeV1,
  resolution: ResolvedAgentIdentity,
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
): void {
  const stored = envelope.identity;
  const current = resolution.identity;
  if (current.namespace !== stored.namespace || current.chainId !== stored.chainId
    || current.registryAddress.toLowerCase() !== stored.registryAddress.toLowerCase()
    || current.agentId !== stored.agentId
    || computeIdentityKey(current).toLowerCase() !== record.identityKey.toLowerCase()) throw new Error();
}

function validGateResult(
  result: Readonly<{ allowed: boolean; reason: number; subject: string; version: bigint }>,
  currentWallet: string,
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
): boolean {
  return Number.isInteger(result.reason) && result.reason >= 0 && result.reason <= 16
    && result.allowed === (result.reason === 0)
    && result.subject.toLowerCase() === currentWallet.toLowerCase()
    && result.version === record.version;
}

function identitySummary(envelope: EvidenceEnvelopeV1,
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>) {
  const identity = envelope.identity;
  return Object.freeze({ identityKey: record.identityKey, namespace: identity.namespace,
    chainId: identity.chainId, registryAddress: identity.registryAddress, agentId: identity.agentId,
    owner: identity.owner, agentWallet: identity.agentWallet, registrationUri: identity.registrationUri,
    registrationDigest: identity.registrationDigest, sourceBlockNumber: envelope.source.blockNumber,
    sourceBlockHash: envelope.source.blockHash });
}

function resolutionSummary(resolution: ResolvedAgentIdentity) {
  return Object.freeze({ owner: resolution.owner, agentWallet: resolution.agentWallet,
    agentURI: resolution.agentURI, registrationDigest: resolution.registrationDigest,
    sourceBlockNumber: resolution.sourceBlockNumber, sourceBlockHash: resolution.sourceBlockHash });
}

function unavailable(code: "EVIDENCE_UNAVAILABLE" | "EVIDENCE_INVALID" | "IDENTITY_UNAVAILABLE" | "IDENTITY_INVALID"): ProofLockDetail {
  return Object.freeze({ status: "UNAVAILABLE", code, identity: null, resolution: null,
    gate: unknownGate(), consumer: unknownConsumer() });
}

function unknownGate() { return Object.freeze({ status: "UNKNOWN" as const, allowed: false as const, reason: null }); }
function unknownConsumer() { return Object.freeze({ status: "UNKNOWN" as const, accepted: false as const }); }

function rethrowAbort(error: unknown, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? error;
}

function rethrowMismatch(error: unknown, signal: AbortSignal): never {
  rethrowAbort(error, signal);
  if (error instanceof ProofMismatchError) throw error;
  mismatch();
}

function computeMismatch(error: unknown): boolean {
  return error instanceof StrictComputeError && ["COMPUTE_METADATA_INVALID", "COMPUTE_PROOF_CLASS_UNSUPPORTED",
    "COMPUTE_MODEL_MISMATCH", "COMPUTE_SIGNER_UNACKNOWLEDGED", "COMPUTE_SIGNER_MISMATCH"]
    .includes(error.code);
}

function mismatch(): never { throw new ProofMismatchError(); }

function parseCanonicalEvidence(bytes: Uint8Array): EvidenceEnvelopeV1 {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (canonicalizeEvidence(value) !== text) throw new Error("Stored evidence is not canonical");
  return value as EvidenceEnvelopeV1;
}

function assertEnvelopeRecordBinding(envelope: EvidenceEnvelopeV1, record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>): void {
  const identityKey = computeIdentityKey(envelope.identity);
  const computeRoot = computeProofRoot(envelope.computeProofs);
  if (identityKey.toLowerCase() !== record.identityKey.toLowerCase()
    || envelope.subject.address.toLowerCase() !== record.subject.toLowerCase()
    || envelope.subject.runtimeCodeHash.toLowerCase() !== record.runtimeCodeHash.toLowerCase()
    || computeRoot.toLowerCase() !== record.computeRoot.toLowerCase()
    || envelope.policyVersion !== record.policyVersion
    || envelope.verdict.riskScore !== record.behavioralScore
    || record.coverage !== 0x7f) {
    throw new Error("Evidence does not bind to ProofLock record");
  }
}

function optionalAddress(value: string | undefined, name = "PROOFLOCK_REGISTRY_V2_ADDRESS"): `0x${string}` | undefined {
  if (!value) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new Error(`${name} is invalid`);
  return value.toLowerCase() as `0x${string}`;
}

function requiredAddress(value: string | undefined, name: string): `0x${string}` {
  const normalized = optionalAddress(value, name);
  if (!normalized) throw new Error(`${name} is not configured`);
  return normalized;
}

function requiredInteger(value: string | undefined, name: string, minimum: number): number {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${name} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} is invalid`);
  return parsed;
}

function requiredHttps(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not configured`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  return url.href;
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
