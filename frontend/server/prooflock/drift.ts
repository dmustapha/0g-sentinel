import { getAddress, keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "json-canonicalize";

import { GATE_REASON, type Bytes32, type HexAddress, type SubjectKind } from "./types";

const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Bytes32;
const UINT64_MAX = (1n << 64n) - 1n;

export type DriftFingerprint = Readonly<{
  owner: HexAddress;
  agentWallet: HexAddress;
  registrationDigest: Bytes32;
  subjectKind: SubjectKind;
  runtimeCodeHash: Bytes32;
  delegationTarget?: HexAddress;
  delegationCodeHash?: Bytes32;
  proxyImplementation?: HexAddress;
  proxyImplementationCodeHash?: Bytes32;
  policyVersion: number;
}>;

export type DriftField = keyof DriftFingerprint;

export type DriftComparison = Readonly<{
  drifted: boolean;
  changedFields: readonly DriftField[];
  expectedDigest: Bytes32;
  currentDigest: Bytes32;
  reason: typeof GATE_REASON.ALLOWED | typeof GATE_REASON.DRIFTED | typeof GATE_REASON.SUBJECT_CHANGED | typeof GATE_REASON.RUNTIME_CODE_DRIFT;
}>;

export type SealedDriftSnapshot = Readonly<{
  identityKey: Bytes32;
  version: bigint;
  fingerprint: DriftFingerprint;
}>;

export type VerifiedDriftWrite = Readonly<{
  transactionHash: Bytes32;
  version: bigint;
  reason: number;
}>;

export type OnDemandDriftDependencies = Readonly<{
  readSealedSnapshot(identityKey: Bytes32): Promise<SealedDriftSnapshot>;
  resolveCurrentFingerprint(identityKey: Bytes32): Promise<DriftFingerprint>;
  markDrift(request: Readonly<{ identityKey: Bytes32; expectedVersion: bigint; reason: number }>): Promise<VerifiedDriftWrite>;
}>;

export type OnDemandDriftResult = DriftComparison & Readonly<{
  mode: "ON_DEMAND";
  marked: boolean;
  transactionHash?: Bytes32;
  version: bigint;
}>;

const fields: readonly DriftField[] = [
  "owner",
  "agentWallet",
  "registrationDigest",
  "subjectKind",
  "runtimeCodeHash",
  "delegationTarget",
  "delegationCodeHash",
  "proxyImplementation",
  "proxyImplementationCodeHash",
  "policyVersion",
];

export function buildDriftFingerprint(input: DriftFingerprint): DriftFingerprint {
  const fingerprint = {
    owner: address(input.owner, "owner"),
    agentWallet: address(input.agentWallet, "agent wallet"),
    registrationDigest: bytes32(input.registrationDigest, false, "registration digest"),
    subjectKind: subjectKind(input.subjectKind),
    runtimeCodeHash: bytes32(input.runtimeCodeHash, true, "runtime code hash"),
    ...optionalBindings(input),
    policyVersion: version(input.policyVersion),
  };
  validateShape(fingerprint);
  return Object.freeze(fingerprint);
}

export function compareDriftFingerprints(
  expectedInput: DriftFingerprint,
  currentInput: DriftFingerprint,
): DriftComparison {
  const expected = buildDriftFingerprint(expectedInput);
  const current = buildDriftFingerprint(currentInput);
  const changedFields = fields.filter((field) => expected[field] !== current[field]);
  return Object.freeze({
    drifted: changedFields.length > 0,
    changedFields: Object.freeze(changedFields),
    expectedDigest: hashFingerprint(expected),
    currentDigest: hashFingerprint(current),
    reason: driftReason(changedFields),
  });
}

export async function runOnDemandDriftCheck(
  dependencies: OnDemandDriftDependencies,
  identityKeyInput: Bytes32,
  mark: boolean,
): Promise<OnDemandDriftResult> {
  const identityKey = bytes32(identityKeyInput, false, "identity key");
  const snapshot = await dependencies.readSealedSnapshot(identityKey);
  assertSnapshot(snapshot, identityKey);
  const current = await dependencies.resolveCurrentFingerprint(identityKey);
  const comparison = compareDriftFingerprints(snapshot.fingerprint, current);
  if (!comparison.drifted || !mark) {
    return Object.freeze({ mode: "ON_DEMAND", marked: false, version: snapshot.version, ...comparison });
  }
  const write = await dependencies.markDrift({
    identityKey, expectedVersion: snapshot.version, reason: comparison.reason,
  });
  assertVerifiedWrite(write, snapshot.version, comparison.reason);
  return Object.freeze({ mode: "ON_DEMAND", marked: true, version: write.version,
    transactionHash: write.transactionHash, ...comparison });
}

function assertSnapshot(snapshot: SealedDriftSnapshot, identityKey: Bytes32): void {
  if (!snapshot || bytes32(snapshot.identityKey, false, "snapshot identity key") !== identityKey
    || typeof snapshot.version !== "bigint" || snapshot.version < 1n || snapshot.version > UINT64_MAX) {
    throw new Error("Invalid sealed drift snapshot");
  }
  buildDriftFingerprint(snapshot.fingerprint);
}

function assertVerifiedWrite(write: VerifiedDriftWrite, version: bigint, reason: number): void {
  if (!write || bytes32(write.transactionHash, false, "drift transaction hash") === ZERO_BYTES32
    || write.version !== version || write.reason !== reason) {
    throw new Error("Drift chain result was not verified against the sealed snapshot");
  }
}

export function hashFingerprint(value: DriftFingerprint): Bytes32 {
  const normalized = buildDriftFingerprint(value);
  const serialized = canonicalize(normalized);
  if (typeof serialized !== "string") throw new Error("Cannot canonicalize drift fingerprint");
  return keccak256(toUtf8Bytes(serialized)) as Bytes32;
}

function optionalBindings(input: DriftFingerprint) {
  return {
    ...(input.delegationTarget ? { delegationTarget: address(input.delegationTarget, "delegation target") } : {}),
    ...(input.delegationCodeHash ? { delegationCodeHash: bytes32(input.delegationCodeHash, false, "delegation code hash") } : {}),
    ...(input.proxyImplementation ? { proxyImplementation: address(input.proxyImplementation, "proxy implementation") } : {}),
    ...(input.proxyImplementationCodeHash ? { proxyImplementationCodeHash: bytes32(input.proxyImplementationCodeHash, false, "proxy implementation code hash") } : {}),
  };
}

function validateShape(value: DriftFingerprint): void {
  const delegation = Boolean(value.delegationTarget || value.delegationCodeHash);
  const proxy = Boolean(value.proxyImplementation || value.proxyImplementationCodeHash);
  if (Boolean(value.delegationTarget) !== Boolean(value.delegationCodeHash)) {
    throw new Error("Delegation target and code hash must occur together");
  }
  if (Boolean(value.proxyImplementation) !== Boolean(value.proxyImplementationCodeHash)) {
    throw new Error("Proxy implementation and code hash must occur together");
  }
  if (value.subjectKind === "EOA" && value.runtimeCodeHash !== ZERO_BYTES32) {
    throw new Error("EOA runtime code hash must be zero");
  }
  if (value.subjectKind === "EOA" && (delegation || proxy)) throw new Error("EOA cannot carry targets");
  if (value.subjectKind === "EIP7702_DELEGATED_EOA" && (!delegation || proxy)) {
    throw new Error("EIP-7702 fingerprint requires only a delegation target");
  }
  if (value.subjectKind === "CONTRACT" && delegation) throw new Error("Contract cannot carry delegation");
  if (value.subjectKind !== "EOA" && value.runtimeCodeHash === ZERO_BYTES32) {
    throw new Error("Executable subject runtime code hash must be nonzero");
  }
}

function driftReason(changed: readonly DriftField[]): DriftComparison["reason"] {
  if (changed.length === 0) return GATE_REASON.ALLOWED;
  if (changed.includes("agentWallet") || changed.includes("subjectKind")) return GATE_REASON.SUBJECT_CHANGED;
  if (changed.includes("runtimeCodeHash")) return GATE_REASON.RUNTIME_CODE_DRIFT;
  return GATE_REASON.DRIFTED;
}

function address(value: string, label: string): HexAddress {
  try {
    const normalized = getAddress(value).toLowerCase() as HexAddress;
    if (/^0x0{40}$/.test(normalized)) throw new Error();
    return normalized;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function bytes32(value: string, allowZero: boolean, label: string): Bytes32 {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || (!allowZero && value.toLowerCase() === ZERO_BYTES32)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.toLowerCase() as Bytes32;
}

function subjectKind(value: string): SubjectKind {
  if (value !== "EOA" && value !== "EIP7702_DELEGATED_EOA" && value !== "CONTRACT") {
    throw new Error("Invalid subject kind");
  }
  return value;
}

function version(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4_294_967_295) {
    throw new Error("Invalid policy version");
  }
  return value;
}
