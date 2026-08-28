import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { createReadOnlyInferenceBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { JsonRpcProvider, VoidSigner, keccak256 } from "ethers";

import { canonicalizeEvidence } from "./canonical";
import { computeIdentityKey, computeProofLockId, createEthersRegistryChainAdapter } from "./chain";
import { resolveAgentIdentity } from "./identity/erc8004";
import { verifyOfflineComputeProof, verifyStorageArtifactBinding } from "./offline-verifier";
import { resolveService } from "./compute/service";
import { computeProofRoot } from "./runner";
import { computeZeroGLayout, STORAGE_VERIFICATION_CAPABILITY } from "./storage";
import { assertZeroGMainnetRpc } from "./rpc";
import { recoverStorageCommitment } from "./storage-recovery";
import { ERC8004_IDENTITY_REGISTRY, type EvidenceEnvelopeV1 } from "./types";
import type { ProofLockReadDependencies } from "./api";

const CHAIN_ID = 16661;
const MAX_EVIDENCE_BYTES = 1_048_576;
const ZERO = "0x0000000000000000000000000000000000000001";

export function createProductionReadDependencies(env = process.env): ProofLockReadDependencies {
  const rpcUrl = requiredHttps(env.ZERO_G_RPC || env.NEXT_PUBLIC_RPC_URL, "ZERO_G_RPC");
  const registryAddress = optionalAddress(env.PROOFLOCK_REGISTRY_V2_ADDRESS);
  const provider = new JsonRpcProvider(rpcUrl);
  const adapter = registryAddress
    ? createEthersRegistryChainAdapter(provider, new VoidSigner(ZERO, provider), registryAddress)
    : undefined;
  return Object.freeze({
    registryAddress,
    resolveIdentity: async (agentId, signal) => {
      await assertZeroGMainnetRpc(rpcUrl, signal);
      signal.throwIfAborted();
      const result = await resolveAgentIdentity({ namespace: "eip155", chainId: CHAIN_ID,
        registryAddress: ERC8004_IDENTITY_REGISTRY, agentId }, { provider, finalityConfirmations: 5 });
      signal.throwIfAborted();
      return result;
    },
    readProofLock: async (identityKey, signal) => {
      if (!adapter) throw new Error("PROOFLOCK_REGISTRY_V2_ADDRESS is not configured");
      await assertZeroGMainnetRpc(rpcUrl, signal);
      signal.throwIfAborted();
      const record = await adapter.getProofLock(identityKey as `0x${string}`);
      signal.throwIfAborted();
      return record;
    },
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
