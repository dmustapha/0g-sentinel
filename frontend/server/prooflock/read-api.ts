import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { createReadOnlyInferenceBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { Interface, JsonRpcProvider, VoidSigner, keccak256 } from "ethers";

import { canonicalizeEvidence } from "./canonical";
import { computeIdentityKey, computeProofLockId, createEthersRegistryChainAdapter } from "./chain";
import { resolveAgentIdentity } from "./identity/erc8004";
import { verifyOfflineComputeProof, verifyStorageArtifactBinding } from "./offline-verifier";
import { resolveService } from "./compute/service";
import { computeProofRoot } from "./runner";
import { computeZeroGLayout, STORAGE_VERIFICATION_CAPABILITY } from "./storage";
import { assertZeroGMainnetRpc } from "./rpc";
import { recoverStorageCommitment } from "./storage-recovery";
import { ERC8004_IDENTITY_REGISTRY, type EvidenceEnvelopeV1, type ResolvedAgentIdentity } from "./types";
import type { ProofLockDetail, ProofLockReadDependencies } from "./api";

const CHAIN_ID = 16661;
const MAX_EVIDENCE_BYTES = 1_048_576;
const ZERO = "0x0000000000000000000000000000000000000001";
const GATE = new Interface([
  "function checkAgent(uint256 agentId) view returns (bool allowed,uint8 reason,address subject,uint64 version)",
]);

export type ProofLockDetailDependencies = Readonly<{
  downloadEvidence(root: string, signal: AbortSignal): Promise<Uint8Array>;
  verifyStorageRoot(bytes: Uint8Array, root: string, signal: AbortSignal): Promise<void>;
  resolveIdentity(agentId: string, signal: AbortSignal): Promise<ResolvedAgentIdentity>;
  checkGate(agentId: string, signal: AbortSignal): Promise<Readonly<{
    allowed: boolean; reason: number; subject: string; version: bigint;
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
    readProofLockDetail: (record, signal) => enrichProofLockDetail(record, {
      downloadEvidence: (root, innerSignal) => downloadEvidence(
        requiredHttps(env.ZERO_G_STORAGE_INDEXER, "ZERO_G_STORAGE_INDEXER"), root, innerSignal),
      verifyStorageRoot: verifyDownloadedRoot,
      resolveIdentity,
      checkGate: (agentId, innerSignal) => checkAgentGate(
        rpcUrl, provider, requiredAddress(env.PROOFLOCK_AGENT_GATE_V2_ADDRESS,
          "PROOFLOCK_AGENT_GATE_V2_ADDRESS"), agentId, innerSignal),
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
  const gate = await readGateDetail(envelope.value.identity.agentId, record, dependencies, signal);
  return Object.freeze({ status: "VERIFIED", identity: identitySummary(envelope.value, record),
    resolution: resolutionSummary(resolution.value), gate });
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
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
  dependencies: ProofLockDetailDependencies,
  signal: AbortSignal,
) {
  try {
    const result = await dependencies.checkGate(agentId, signal);
    signal.throwIfAborted();
    if (!validGateResult(result, record)) throw new Error();
    return Object.freeze({ status: "VERIFIED" as const, allowed: result.allowed, reason: result.reason });
  } catch (error) {
    rethrowAbort(error, signal);
    return unknownGate();
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
  if (keccak256(bytes).toLowerCase() !== record.envelopeDigest.toLowerCase()) throw new Error("Envelope digest mismatch");
  const layout = await computeZeroGLayout(bytes, ZERO);
  if (layout.storageRoot.toLowerCase() !== record.storageRoot.toLowerCase()) throw new Error("Storage root mismatch");
  const envelope = parseCanonicalEvidence(bytes);
  assertEnvelopeRecordBinding(envelope, record);
  await assertZeroGMainnetRpc(config.rpcUrl, signal);
  const broker = await raceAbort(createReadOnlyInferenceBroker(config.rpcUrl, CHAIN_ID), signal);
  const computeVerification = await Promise.all(envelope.computeProofs.map(async (proof) => {
    const live = await resolveService(broker, proof.provider, proof.model, signal);
    return verifyOfflineComputeProof(proof, live);
  }));
  await assertZeroGMainnetRpc(config.rpcUrl, signal);
  const storageCommitment = await recoverStorageCommitment(config.provider, config.flowAddress,
    config.flowFromBlock, config.confirmations, record, signal);
  verifyStorageArtifactBinding(record.artifactHash, storageCommitment);
  return Object.freeze({ envelope, computeVerification, storageCommitment, retrievalVerified: true as const,
    networkProofVerified: STORAGE_VERIFICATION_CAPABILITY.networkProofVerified });
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
    || computeIdentityKey(current).toLowerCase() !== record.identityKey.toLowerCase()
    || resolution.agentWallet.toLowerCase() !== record.subject.toLowerCase()) throw new Error();
}

function validGateResult(
  result: Readonly<{ allowed: boolean; reason: number; subject: string; version: bigint }>,
  record: Awaited<ReturnType<ProofLockReadDependencies["readProofLock"]>>,
): boolean {
  return Number.isInteger(result.reason) && result.reason >= 0 && result.reason <= 16
    && result.allowed === (result.reason === 0)
    && result.subject.toLowerCase() === record.subject.toLowerCase()
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
  return Object.freeze({ status: "UNAVAILABLE", code, identity: null, resolution: null, gate: unknownGate() });
}

function unknownGate() { return Object.freeze({ status: "UNKNOWN" as const, allowed: false as const, reason: null }); }

function rethrowAbort(error: unknown, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? error;
}

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
