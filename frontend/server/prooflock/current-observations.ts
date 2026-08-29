import { assertObservation } from "../../lib/prooflock-observations";
import { gateReasonMeta } from "../../lib/prooflock-status";
import type {
  Bytes32,
  CurrentAccessV1,
  CurrentConsumerValue,
  CurrentGateValue,
  CurrentIdentityValue,
  CurrentObservationCapability,
  CurrentObservationEntry,
  CurrentObservationReason,
  ProofLockObservation,
  ProofLockRecord,
} from "../../lib/prooflock-types";
import { isCanonicalAgentId, parseNonZeroBytes32 } from "../../lib/prooflock-validation";
import { computeIdentityKey, type RegistryProofLockRecord } from "./chain";
import { ProofMismatchError } from "./errors";
import {
  ERC8004_IDENTITY_REGISTRY,
  type ResolvedAgentIdentity,
} from "./types";

export const CURRENT_OBSERVATION_CAPABILITIES = Object.freeze({
  identity: "ERC8004_IDENTITY_AT_FINALIZED_BLOCK",
  lease: "REGISTRY_V2_LEASE_AT_FINALIZED_BLOCK",
  gate: "AGENT_GATE_V2_AT_FINALIZED_BLOCK",
  consumer: "GUARDED_CONSUMER_AT_FINALIZED_BLOCK",
} as const satisfies Record<string, CurrentObservationCapability>);

type GateRead = Readonly<{
  allowed: boolean;
  reason: number;
  subject: string;
  version: bigint;
}>;
type ConsumerRead = Readonly<{
  accepted: boolean;
  address: string;
  subject: string;
  version: bigint;
}>;
type PinnedBlock = Readonly<{ number: number; hash: string; timestamp: number }>;

export type CurrentObservationDependencies = Readonly<{
  pinFinalizedBlock(signal: AbortSignal): Promise<PinnedBlock>;
  confirmPinnedBlock(number: number, hash: string, signal: AbortSignal): Promise<boolean>;
  resolveIdentity(agentId: string, blockNumber: number, signal: AbortSignal): Promise<ResolvedAgentIdentity>;
  readLease(identityKey: string, blockNumber: number, signal: AbortSignal): Promise<RegistryProofLockRecord>;
  readGate(agentId: string, blockNumber: number, signal: AbortSignal): Promise<GateRead>;
  readConsumer(agentId: string, identityKey: string, blockNumber: number, signal: AbortSignal): Promise<ConsumerRead>;
}>;

export type CurrentObservationOptions = Readonly<{
  ttlMs: number;
  readTimeoutMs: number;
  confirmationTimeoutMs: number;
  now?: () => Date;
  signal: AbortSignal;
}>;

type SettledReads = readonly [
  PromiseSettledResult<ResolvedAgentIdentity>,
  PromiseSettledResult<RegistryProofLockRecord>,
  PromiseSettledResult<GateRead>,
  PromiseSettledResult<ConsumerRead>,
];

export async function observeCurrentAccess(
  input: Readonly<{ agentId: string; identityKey: string }>,
  dependencies: CurrentObservationDependencies,
  options: CurrentObservationOptions,
): Promise<CurrentAccessV1> {
  const identityKey = validateInputBinding(input);
  const settings = validateOptions(options);
  const pinned = validatePinnedBlock(await dependencies.pinFinalizedBlock(settings.signal));
  settings.signal.throwIfAborted();
  const reads = await settleReads(input.agentId, identityKey, pinned.number, dependencies,
    settings.readTimeoutMs, settings.signal);
  settings.signal.throwIfAborted();
  assertResolvedBinding(reads[0], input.agentId, identityKey, pinned);
  const confirmed = await boundedCall((signal) => dependencies.confirmPinnedBlock(
    pinned.number, pinned.hash, signal), settings.confirmationTimeoutMs,
  settings.signal, "Current observation confirmation");
  if (!confirmed) {
    throw new ProofMismatchError();
  }
  settings.signal.throwIfAborted();
  return buildSnapshot(input.agentId, identityKey, pinned, reads, settings);
}

function validateInputBinding(input: Readonly<{ agentId: string; identityKey: string }>): Bytes32 {
  const identityKey = parseNonZeroBytes32(input.identityKey);
  if (!identityKey || !isCanonicalAgentId(input.agentId)) throw new TypeError("Current observation input is invalid");
  const expected = computeIdentityKey({ namespace: "eip155", chainId: 16661,
    registryAddress: ERC8004_IDENTITY_REGISTRY, agentId: input.agentId });
  if (expected.toLowerCase() !== identityKey) throw new ProofMismatchError();
  return identityKey as Bytes32;
}

function validateOptions(options: CurrentObservationOptions) {
  if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs <= 0 || options.ttlMs > 3_600_000) {
    throw new TypeError("Current observation ttlMs is invalid");
  }
  const now = options.now ?? (() => new Date());
  const observed = now();
  if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) {
    throw new TypeError("Current observation clock is invalid");
  }
  validateTimeout(options.readTimeoutMs, "readTimeoutMs");
  validateTimeout(options.confirmationTimeoutMs, "confirmationTimeoutMs");
  return Object.freeze({ ttlMs: options.ttlMs, readTimeoutMs: options.readTimeoutMs,
    confirmationTimeoutMs: options.confirmationTimeoutMs, signal: options.signal,
    observedAt: observed.toISOString(), freshnessExpiresAt: new Date(observed.getTime() + options.ttlMs).toISOString() });
}

function validateTimeout(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 60_000) {
    throw new TypeError(`Current observation ${name} is invalid`);
  }
}

function validatePinnedBlock(block: PinnedBlock): Readonly<{ number: number; hash: Bytes32; timestamp: number }> {
  if (!Number.isSafeInteger(block?.number) || block.number <= 0
    || !/^0x[0-9a-fA-F]{64}$/.test(block?.hash) || /^0x0{64}$/i.test(block.hash)
    || !Number.isSafeInteger(block?.timestamp) || block.timestamp <= 0) {
    throw new TypeError("Finalized block is invalid");
  }
  return Object.freeze({ number: block.number, hash: block.hash.toLowerCase() as Bytes32,
    timestamp: block.timestamp });
}

function settleReads(agentId: string, identityKey: Bytes32, blockNumber: number,
  dependencies: CurrentObservationDependencies, timeoutMs: number,
  signal: AbortSignal): Promise<SettledReads> {
  return Promise.allSettled([
    boundedCall((readSignal) => dependencies.resolveIdentity(agentId, blockNumber, readSignal),
      timeoutMs, signal, "Current identity read"),
    boundedCall((readSignal) => dependencies.readLease(identityKey, blockNumber, readSignal),
      timeoutMs, signal, "Current lease read"),
    boundedCall((readSignal) => dependencies.readGate(agentId, blockNumber, readSignal),
      timeoutMs, signal, "Current gate read"),
    boundedCall((readSignal) => dependencies.readConsumer(agentId, identityKey, blockNumber, readSignal),
      timeoutMs, signal, "Current consumer read"),
  ]) as Promise<SettledReads>;
}

function boundedCall<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number,
  signal: AbortSignal, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const controller = new AbortController();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => {
      controller.abort(signal.reason);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    });
    const timer = setTimeout(() => finish(() => {
      const error = new Error(`${label} timed out`);
      controller.abort(error);
      reject(error);
    }), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => operation(controller.signal)).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function assertResolvedBinding(result: SettledReads[0], agentId: string, identityKey: Bytes32,
  block: Readonly<{ number: number; hash: Bytes32 }>): void {
  if (result.status !== "fulfilled") return;
  const resolved = result.value.identity;
  if (resolved.namespace !== "eip155" || resolved.chainId !== 16661
    || resolved.registryAddress.toLowerCase() !== ERC8004_IDENTITY_REGISTRY
    || resolved.agentId !== agentId
    || computeIdentityKey(resolved).toLowerCase() !== identityKey
    || result.value.sourceBlockNumber !== String(block.number)
    || result.value.sourceBlockHash.toLowerCase() !== block.hash) {
    throw new ProofMismatchError();
  }
}

function buildSnapshot(agentId: string, identityKey: Bytes32,
  block: Readonly<{ number: number; hash: Bytes32; timestamp: number }>, reads: SettledReads,
  settings: Readonly<{ ttlMs: number; observedAt: string; freshnessExpiresAt: string }>): CurrentAccessV1 {
  const metadata = observationMetadata(block, settings);
  const gateConsistent = gateProvenanceConsistent(reads, identityKey, block.timestamp);
  const consumerConsistent = consumerProvenanceConsistent(reads);
  return deepFreeze({ schema: "sentinel.prooflock/current-access-v1", version: 1,
    agentId, identityKey, observationBlock: { number: String(block.number), hash: block.hash,
      timestamp: String(block.timestamp) },
    observedAt: settings.observedAt, freshnessExpiresAt: settings.freshnessExpiresAt,
    observations: {
      identity: identityEntry(reads[0], metadata),
      lease: leaseEntry(reads[1], identityKey, metadata, block.timestamp),
      gate: gateConsistent ? gateEntry(reads[2], metadata) : mismatchEntry(
        CURRENT_OBSERVATION_CAPABILITIES.gate, "CURRENT_GATE_MISMATCH", "gate", metadata),
      consumer: consumerConsistent ? consumerEntry(reads[3], metadata) : mismatchEntry(
        CURRENT_OBSERVATION_CAPABILITIES.consumer, "CURRENT_CONSUMER_MISMATCH", "consumer", metadata),
    } } satisfies CurrentAccessV1);
}

function observationMetadata(block: Readonly<{ number: number; hash: Bytes32 }>,
  settings: Readonly<{ ttlMs: number; observedAt: string; freshnessExpiresAt: string }>) {
  return Object.freeze({ scope: "CURRENT" as const, observedAt: settings.observedAt,
    observationBlockNumber: String(block.number), observationBlockHash: block.hash,
    serverIssuedAt: settings.observedAt, ttlMs: settings.ttlMs,
    freshnessExpiresAt: settings.freshnessExpiresAt });
}

function identityEntry(result: SettledReads[0], metadata: ReturnType<typeof observationMetadata>) {
  if (result.status === "rejected") return unavailableEntry(CURRENT_OBSERVATION_CAPABILITIES.identity,
    "CURRENT_IDENTITY_UNAVAILABLE", "identity", "IDENTITY_UNAVAILABLE", metadata);
  return entry(CURRENT_OBSERVATION_CAPABILITIES.identity, "OBSERVED",
    verifiedObservation("identity", metadata), identityValue(result.value));
}

function identityValue(value: ResolvedAgentIdentity): CurrentIdentityValue {
  return Object.freeze({ identity: Object.freeze({ ...value.identity }), owner: value.owner,
    agentWallet: value.agentWallet, agentURI: value.agentURI,
    registrationDigest: value.registrationDigest, sourceBlockNumber: value.sourceBlockNumber,
    sourceBlockHash: value.sourceBlockHash });
}

function leaseEntry(result: SettledReads[1], identityKey: Bytes32,
  metadata: ReturnType<typeof observationMetadata>, blockTimestamp: number) {
  if (result.status === "rejected") return unavailableEntry(CURRENT_OBSERVATION_CAPABILITIES.lease,
    "CURRENT_LEASE_UNAVAILABLE", "lease", "EVIDENCE_UNAVAILABLE", metadata);
  if (result.value.version === 0n) return blockedEntry(CURRENT_OBSERVATION_CAPABILITIES.lease,
    "NO_PROOF", "lease", "NO_PROOF", metadata, null);
  if (result.value.identityKey.toLowerCase() !== identityKey) return mismatchEntry(
    CURRENT_OBSERVATION_CAPABILITIES.lease, "CURRENT_LEASE_MISMATCH", "lease", metadata);
  const blocked = leaseBlockReason(result.value, blockTimestamp);
  const value = leaseValue(result.value);
  return blocked ? blockedEntry(CURRENT_OBSERVATION_CAPABILITIES.lease, blocked,
    "lease", blocked, metadata, value) : entry(CURRENT_OBSERVATION_CAPABILITIES.lease,
    "OBSERVED", verifiedObservation("lease", metadata), value);
}

function leaseBlockReason(record: RegistryProofLockRecord, nowSeconds: number) {
  if (record.state === 2) return "REVOKED" as const;
  if (record.state === 3) return "DRIFTED" as const;
  if (record.state !== 1 || record.coverage !== 0x7f) return "COVERAGE_INCOMPLETE" as const;
  if (record.validUntil <= BigInt(nowSeconds)) return "EXPIRED" as const;
  return null;
}

function leaseValue(value: RegistryProofLockRecord): ProofLockRecord {
  return Object.freeze({ identityKey: value.identityKey, subject: value.subject,
    envelopeDigest: value.envelopeDigest, storageRoot: value.storageRoot,
    computeRoot: value.computeRoot, artifactHash: value.artifactHash,
    runtimeCodeHash: value.runtimeCodeHash, version: value.version.toString(),
    issuedAt: value.issuedAt.toString(), validUntil: value.validUntil.toString(),
    policyVersion: value.policyVersion, behavioralScore: value.behavioralScore,
    codeRisk: value.codeRisk, coverage: value.coverage, state: value.state,
    stateReason: value.stateReason });
}

function gateEntry(result: SettledReads[2], metadata: ReturnType<typeof observationMetadata>) {
  if (result.status === "rejected") return unavailableEntry(CURRENT_OBSERVATION_CAPABILITIES.gate,
    "CURRENT_GATE_UNAVAILABLE", "gate", "EVIDENCE_UNAVAILABLE", metadata);
  if (!validGate(result.value)) return mismatchEntry(CURRENT_OBSERVATION_CAPABILITIES.gate,
    "CURRENT_GATE_MISMATCH", "gate", metadata);
  const value = gateValue(result.value);
  const reason = gateReasonMeta(result.value.reason).code;
  return result.value.allowed
    ? entry(CURRENT_OBSERVATION_CAPABILITIES.gate, reason,
      assertObservation({ ...metadata, subsystem: "gate", status: "VERIFIED",
        allowed: true, reasonCode: "ALLOWED" }), value)
    : blockedEntry(CURRENT_OBSERVATION_CAPABILITIES.gate, reason,
      "gate", reason, metadata, value);
}

function validGate(value: GateRead): boolean {
  if (typeof value.allowed !== "boolean" || !Number.isInteger(value.reason)
    || value.reason < 0 || value.reason > 16 || value.allowed !== (value.reason === 0)
    || typeof value.version !== "bigint" || value.version < 0n) return false;
  if (isIdentityFailure(value)) return /^0x0{40}$/i.test(value.subject) && value.version === 0n;
  return validAddress(value.subject);
}

function gateValue(value: GateRead): CurrentGateValue {
  return Object.freeze({ allowed: value.allowed, reason: value.reason,
    subject: value.subject.toLowerCase() as `0x${string}`, version: value.version.toString() });
}

function consumerEntry(result: SettledReads[3], metadata: ReturnType<typeof observationMetadata>) {
  if (result.status === "rejected") return unavailableEntry(CURRENT_OBSERVATION_CAPABILITIES.consumer,
    "CURRENT_CONSUMER_UNAVAILABLE", "consumer", "EVIDENCE_UNAVAILABLE", metadata);
  if (!validConsumer(result.value)) return mismatchEntry(CURRENT_OBSERVATION_CAPABILITIES.consumer,
    "CURRENT_CONSUMER_MISMATCH", "consumer", metadata);
  const value = consumerValue(result.value);
  return result.value.accepted
    ? entry(CURRENT_OBSERVATION_CAPABILITIES.consumer, "OBSERVED",
      assertObservation({ ...metadata, subsystem: "consumer", status: "VERIFIED", accepted: true }), value)
    : blockedEntry(CURRENT_OBSERVATION_CAPABILITIES.consumer, "GUARDED_CONSUMER_BLOCKED",
      "consumer", "UNKNOWN_REASON", metadata, value);
}

function validConsumer(value: ConsumerRead): boolean {
  return typeof value.accepted === "boolean" && validAddress(value.address)
    && validAddress(value.subject) && typeof value.version === "bigint" && value.version >= 0n;
}

function gateProvenanceConsistent(reads: SettledReads, identityKey: Bytes32,
  blockTimestamp: number): boolean {
  const [identity, lease, gate, consumer] = reads;
  if (gate.status !== "fulfilled" || !validGate(gate.value)) return true;
  if (isIdentityFailure(gate.value)) return identity.status !== "fulfilled"
    && pairMatches(gate.value, consumer);
  if (identity.status === "fulfilled"
    && gate.value.subject.toLowerCase() !== identity.value.agentWallet.toLowerCase()) return false;
  if (lease.status === "fulfilled"
    && !gateMatchesLease(gate.value, lease.value, identityKey, blockTimestamp)) return false;
  return pairMatches(gate.value, consumer);
}

function gateMatchesLease(gate: GateRead, lease: RegistryProofLockRecord,
  identityKey: Bytes32, blockTimestamp: number): boolean {
  if (gate.version !== lease.version) return false;
  const intrinsic = intrinsicGateReason(gate, lease, identityKey, blockTimestamp);
  if (intrinsic !== null) return gate.reason === intrinsic;
  return ![1, 2, 3, 5, 8, 9, 10, 16].includes(gate.reason);
}

function intrinsicGateReason(gate: GateRead, lease: RegistryProofLockRecord,
  identityKey: Bytes32, blockTimestamp: number): number | null {
  if (lease.version === 0n) return 1;
  if (lease.identityKey.toLowerCase() !== identityKey) return 16;
  if (lease.subject.toLowerCase() !== gate.subject.toLowerCase()) return 5;
  if (lease.state === 2) return 2;
  if (lease.state === 3) return 3;
  if (lease.state !== 1) return 16;
  if (lease.issuedAt > BigInt(blockTimestamp) || lease.validUntil <= BigInt(blockTimestamp)) return 4;
  if ((lease.coverage & 0x08) === 0) return 9;
  if ((lease.coverage & 0x20) === 0) return 10;
  if ((lease.coverage & 0x7f) !== 0x7f) return 8;
  return null;
}

function consumerProvenanceConsistent(reads: SettledReads): boolean {
  const [identity, lease, gate, consumer] = reads;
  if (consumer.status !== "fulfilled" || !validConsumer(consumer.value)) return true;
  if (identity.status === "fulfilled"
    && consumer.value.subject.toLowerCase() !== identity.value.agentWallet.toLowerCase()) return false;
  if (lease.status === "fulfilled" && (consumer.value.version !== lease.value.version
    || consumerSubjectContradictsLease(consumer.value, lease.value, gate))) return false;
  if (gate.status !== "fulfilled" || !validGate(gate.value)) return true;
  return gate.value.allowed === consumer.value.accepted
    && gate.value.subject.toLowerCase() === consumer.value.subject.toLowerCase()
    && gate.value.version === consumer.value.version;
}

function consumerSubjectContradictsLease(consumer: ConsumerRead, lease: RegistryProofLockRecord,
  gate: SettledReads[2]): boolean {
  if (consumer.accepted) return consumer.subject.toLowerCase() !== lease.subject.toLowerCase();
  if (gate.status === "fulfilled" && validGate(gate.value)
    && [1, 5, 13, 14, 15].includes(gate.value.reason)) return false;
  return consumer.subject.toLowerCase() !== lease.subject.toLowerCase();
}

function pairMatches(gate: GateRead, consumer: SettledReads[3]): boolean {
  if (consumer.status !== "fulfilled" || !validConsumer(consumer.value)) return true;
  return gate.allowed === consumer.value.accepted
    && gate.subject.toLowerCase() === consumer.value.subject.toLowerCase()
    && gate.version === consumer.value.version;
}

function isIdentityFailure(gate: GateRead): boolean {
  return !gate.allowed && [13, 14, 15].includes(gate.reason);
}

function consumerValue(value: ConsumerRead): CurrentConsumerValue {
  return Object.freeze({ accepted: value.accepted, address: value.address.toLowerCase() as `0x${string}`,
    subject: value.subject.toLowerCase() as `0x${string}`, version: value.version.toString() });
}

function verifiedObservation(subsystem: "identity" | "lease",
  metadata: ReturnType<typeof observationMetadata>): ProofLockObservation {
  return assertObservation({ ...metadata, subsystem, status: "VERIFIED" });
}

function unavailableEntry(capability: CurrentObservationCapability, reason: CurrentObservationReason,
  subsystem: "identity" | "lease" | "gate" | "consumer", reasonCode: "IDENTITY_UNAVAILABLE" | "EVIDENCE_UNAVAILABLE",
  metadata: ReturnType<typeof observationMetadata>) {
  return entry(capability, reason, assertObservation({ ...metadata, subsystem,
    status: "UNAVAILABLE", reasonCode }), null);
}

function mismatchEntry(capability: CurrentObservationCapability, reason: CurrentObservationReason,
  subsystem: "lease" | "gate" | "consumer", metadata: ReturnType<typeof observationMetadata>) {
  return entry(capability, reason, assertObservation({ ...metadata, subsystem,
    status: "MISMATCH", reasonCode: "EVIDENCE_MISMATCH" }), null);
}

function blockedEntry<T>(capability: CurrentObservationCapability, reason: CurrentObservationReason,
  subsystem: "lease" | "gate" | "consumer", reasonCode: Exclude<CurrentObservationReason,
    "OBSERVED" | "CURRENT_IDENTITY_UNAVAILABLE" | "CURRENT_LEASE_UNAVAILABLE" | "CURRENT_GATE_UNAVAILABLE"
    | "CURRENT_CONSUMER_UNAVAILABLE" | "CURRENT_LEASE_MISMATCH" | "CURRENT_GATE_MISMATCH"
    | "CURRENT_CONSUMER_MISMATCH" | "GUARDED_CONSUMER_BLOCKED"> | "UNKNOWN_REASON",
  metadata: ReturnType<typeof observationMetadata>, value: T | null) {
  return entry(capability, reason, assertObservation({ ...metadata, subsystem,
    status: "BLOCKED", reasonCode }), value);
}

function entry<T>(capability: CurrentObservationCapability, reason: CurrentObservationReason,
  observation: ProofLockObservation, value: T | null): CurrentObservationEntry<T> {
  return Object.freeze({ capability, reason, observation, value });
}

function validAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
