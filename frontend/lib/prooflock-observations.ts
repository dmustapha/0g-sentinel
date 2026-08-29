import type {
  ComputeVerificationCapability,
  ObservationReasonCode,
  ObservationStatus,
  ProofLockObservation,
} from "./prooflock-types";

export type { ObservationReasonCode, ProofLockObservation } from "./prooflock-types";

export const OBSERVATION_IDS = Object.freeze([
  "identity", "checks", "compute", "storage", "registry", "lease", "gate", "consumer",
] as const);

export const OBSERVATION_REASON_CODES = Object.freeze([
  "ALLOWED", "NO_PROOF", "REVOKED", "DRIFTED", "EXPIRED", "SUBJECT_CHANGED",
  "RUNTIME_CODE_DRIFT", "POLICY_TOO_OLD", "COVERAGE_INCOMPLETE", "COMPUTE_UNVERIFIED",
  "STORAGE_UNVERIFIED", "BEHAVIORAL_RISK", "CODE_RISK", "IDENTITY_UNAVAILABLE",
  "AGENT_NOT_FOUND", "AGENT_WALLET_UNSET", "IDENTITY_MISMATCH", "UNKNOWN_REASON",
  "EVIDENCE_UNAVAILABLE", "EVIDENCE_MISMATCH",
] as const satisfies readonly ObservationReasonCode[]);

export const OBSERVATION_PRESENTATION = Object.freeze({
  VERIFIED: { copyKey: "observation.verified", tone: "positive" },
  BLOCKED: { copyKey: "observation.blocked", tone: "negative" },
  UNAVAILABLE: { copyKey: "observation.unavailable", tone: "neutral" },
  STALE: { copyKey: "observation.stale", tone: "warning" },
  MISMATCH: { copyKey: "observation.mismatch", tone: "negative" },
  NOT_APPLICABLE: { copyKey: "observation.notApplicable", tone: "neutral" },
} as const satisfies Record<ObservationStatus, {
  copyKey: `observation.${string}`;
  tone: "positive" | "negative" | "neutral" | "warning";
}>);

const BASE_FIELDS = ["scope", "subsystem", "status", "observedAt"] as const;
const CURRENT_FIELDS = ["observationBlockNumber", "observationBlockHash", "serverIssuedAt",
  "ttlMs", "freshnessExpiresAt"] as const;
const VERIFIED_PAYLOAD_FIELDS = ["capability", "storageRoot", "artifactHash",
  "storageUploadTxHash", "registrySourceTxHash", "allowed", "accepted", "operation"] as const;
const UINT64_MAX = (1n << 64n) - 1n;

export function assertObservation(input: unknown): ProofLockObservation {
  const observation = requireRecord(frozenSnapshot(input, "observation"), "observation");
  requireMember(observation, "scope", ["HISTORICAL", "CURRENT"]);
  requireMember(observation, "status", Object.keys(OBSERVATION_PRESENTATION));
  requireMember(observation, "subsystem", OBSERVATION_IDS);
  validatePlane(observation);
  if (observation.status !== "VERIFIED") rejectVerifiedPayload(observation);
  assertExactKeys(observation, allowedObservationFields(observation), variantLabel(observation));
  validateMetadata(observation);
  validateObservationPayload(observation);
  return observation as ProofLockObservation;
}

export function observationStatusAt(
  observation: ProofLockObservation,
  nowMs = Date.now(),
): ObservationStatus {
  if (observation.scope !== "CURRENT"
    || !["VERIFIED", "BLOCKED"].includes(observation.status)) return observation.status;
  return nowMs >= Date.parse(observation.freshnessExpiresAt) ? "STALE" : observation.status;
}

export function assertComputeCapability(input: unknown): ComputeVerificationCapability {
  const capability = requireRecord(frozenSnapshot(input, "Compute capability"), "Compute capability");
  assertExactKeys(capability, ["sdkVersion", "method", "provider", "model", "proofClass",
    "processResponseVerified", "boundHashes"], "Compute capability");
  requireBoundedString(capability, "sdkVersion", 128);
  requireBoundedString(capability, "method", 128);
  requireNonzeroAddress(capability, "provider");
  requireBoundedString(capability, "model", 256);
  if (capability.proofClass !== "DECENTRALIZED_MODEL_TEE" || capability.processResponseVerified !== true) {
    throw new TypeError("Compute capability proofClass or processResponseVerified is invalid");
  }
  validateComputeHashes(capability.boundHashes);
  return capability as ComputeVerificationCapability;
}

export function indexComputeCapabilities(
  capabilities: readonly ComputeVerificationCapability[],
): Readonly<Record<string, ComputeVerificationCapability>> {
  const entries = capabilities.map((capability) => {
    const snapshot = assertComputeCapability(capability);
    return [computeCapabilityKey(snapshot), snapshot] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

function computeCapabilityKey(capability: ComputeVerificationCapability): string {
  const hashes = capability.boundHashes;
  return JSON.stringify([
    capability.sdkVersion, capability.method, capability.provider, capability.model,
    capability.proofClass, capability.processResponseVerified, hashes.receiptDigest,
    hashes.requestDigest, hashes.responseDigest, hashes.signedTextSha256,
    hashes.requestSha256, hashes.rawResponseSha256, hashes.responseHeadersSha256,
    hashes.artifactHash,
  ]);
}

function allowedObservationFields(observation: Record<string, unknown>): readonly string[] {
  const fields: string[] = [...BASE_FIELDS];
  if (observation.scope === "CURRENT") fields.push(...CURRENT_FIELDS);
  if (observation.status !== "VERIFIED") fields.push("reasonCode");
  if (observation.status === "VERIFIED" && observation.subsystem === "compute") fields.push("capability");
  if (observation.status === "VERIFIED" && observation.subsystem === "storage") {
    fields.push("storageRoot", "artifactHash", "storageUploadTxHash", "registrySourceTxHash", "capability");
  }
  if (observation.status === "VERIFIED" && observation.subsystem === "registry") fields.push("registrySourceTxHash");
  if (observation.status === "VERIFIED" && observation.subsystem === "gate") fields.push("allowed", "reasonCode");
  if (observation.status === "VERIFIED" && observation.subsystem === "consumer") fields.push("accepted");
  if (observation.status === "VERIFIED" && observation.scope === "CURRENT" && observation.subsystem === "registry") {
    fields.push("operation");
  }
  return fields;
}

function validatePlane(observation: Record<string, unknown>) {
  if (observation.scope === "HISTORICAL" && observation.status === "STALE") {
    throw new TypeError("HISTORICAL observations cannot be STALE");
  }
  if (observation.status === "BLOCKED") return validateBlockedPlane(observation);
  if (observation.status !== "VERIFIED") return;
  const currentOnly = ["lease", "gate", "consumer"];
  const historicalOnly = ["checks", "compute", "storage"];
  if (observation.scope === "HISTORICAL" && currentOnly.includes(String(observation.subsystem))) {
    throw new TypeError(`HISTORICAL VERIFIED ${String(observation.subsystem)} is not allowed`);
  }
  if (observation.scope === "CURRENT" && historicalOnly.includes(String(observation.subsystem))) {
    throw new TypeError(`CURRENT VERIFIED ${String(observation.subsystem)} is not allowed`);
  }
  if (observation.scope === "CURRENT" && observation.subsystem === "registry" &&
      observation.operation !== "CURRENT_RECORD_READ") {
    throw new TypeError("CURRENT VERIFIED registry requires CURRENT_RECORD_READ");
  }
}

function validateBlockedPlane(observation: Record<string, unknown>) {
  if (observation.scope !== "CURRENT") throw new TypeError("BLOCKED observations must be CURRENT");
  if (observation.reasonCode === "ALLOWED") throw new TypeError("BLOCKED observations cannot use ALLOWED");
  if (!["lease", "gate", "consumer"].includes(String(observation.subsystem))) {
    throw new TypeError("BLOCKED observations must describe current policy");
  }
}

function rejectVerifiedPayload(observation: Record<string, unknown>) {
  if (VERIFIED_PAYLOAD_FIELDS.some((field) => field in observation)) {
    throw new TypeError("non-VERIFIED observations cannot carry verified payload fields");
  }
}

function validateMetadata(observation: Record<string, unknown>) {
  if (observation.scope !== "CURRENT") return requireIsoTimestamp(observation, "observedAt");
  try {
    validateCurrentMetadata(observation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid fields";
    throw new TypeError(`CURRENT observation metadata is invalid: ${message}`);
  }
}

function validateCurrentMetadata(observation: Record<string, unknown>) {
  requireIsoTimestamp(observation, "observedAt");
  requirePositiveDecimal(observation, "observationBlockNumber");
  requireNonzeroHash(observation, "observationBlockHash");
  requireIsoTimestamp(observation, "serverIssuedAt");
  requireIsoTimestamp(observation, "freshnessExpiresAt");
  if (!Number.isSafeInteger(observation.ttlMs) || Number(observation.ttlMs) <= 0) {
    throw new TypeError("CURRENT observation metadata ttlMs must be a positive integer");
  }
  validateFreshness(observation);
}

function validateFreshness(observation: Record<string, unknown>) {
  const observedAt = Date.parse(String(observation.observedAt));
  const serverIssuedAt = Date.parse(String(observation.serverIssuedAt));
  const freshnessExpiresAt = Date.parse(String(observation.freshnessExpiresAt));
  if (serverIssuedAt < observedAt) throw new TypeError("serverIssuedAt cannot precede observedAt");
  if (freshnessExpiresAt !== observedAt + Number(observation.ttlMs)) {
    throw new TypeError("freshnessExpiresAt must equal observedAt plus ttlMs");
  }
}

function validateObservationPayload(observation: Record<string, unknown>) {
  if (observation.status !== "VERIFIED") return validateReasonCode(observation);
  if (observation.subsystem === "compute") assertComputeCapability(observation.capability);
  if (observation.subsystem === "storage") validateStorage(observation);
  if (observation.subsystem === "registry") requireNonzeroHash(observation, "registrySourceTxHash");
  if (observation.subsystem === "gate" && (observation.allowed !== true || observation.reasonCode !== "ALLOWED")) {
    throw new TypeError("VERIFIED Gate observations require allowed with ALLOWED");
  }
  if (observation.subsystem === "consumer" && observation.accepted !== true) {
    throw new TypeError("VERIFIED consumer observations require accepted: true");
  }
}

function validateStorage(observation: Record<string, unknown>) {
  requireNonzeroHash(observation, "storageRoot");
  requireNonzeroHash(observation, "artifactHash");
  requireNonzeroHash(observation, "storageUploadTxHash");
  if (observation.registrySourceTxHash !== undefined) requireNonzeroHash(observation, "registrySourceTxHash");
  const capability = requireRecord(observation.capability, "Storage capability");
  assertExactKeys(capability, ["proofClass", "retrievalVerified", "networkProofVerified"], "Storage capability");
  if (capability.proofClass !== "ROOT_MATCHED_NO_NETWORK_PROOF" ||
      capability.retrievalVerified !== true || capability.networkProofVerified !== false) {
    throw new TypeError("Storage capability requires networkProofVerified: false and exact root matching");
  }
}

function validateComputeHashes(input: unknown) {
  const hashes = requireRecord(input, "Compute boundHashes");
  const fields = ["receiptDigest", "requestDigest", "responseDigest", "signedTextSha256",
    "requestSha256", "rawResponseSha256", "responseHeadersSha256", "artifactHash"] as const;
  assertExactKeys(hashes, fields, "Compute boundHashes");
  for (const field of fields) requireNonzeroHash(hashes, field);
}

function validateReasonCode(observation: Record<string, unknown>) {
  if (observation.reasonCode === undefined) return;
  if (typeof observation.reasonCode !== "string" || !OBSERVATION_REASON_CODES.includes(
    observation.reasonCode as typeof OBSERVATION_REASON_CODES[number],
  )) throw new TypeError("reasonCode is invalid");
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unknown = Object.keys(record).find((field) => !allowed.includes(field));
  if (unknown) throw new TypeError(`unknown field ${unknown} for ${label}`);
}

function variantLabel(observation: Record<string, unknown>): string {
  return `${String(observation.scope)} ${String(observation.status)} ${String(observation.subsystem)}`;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireMember(record: Record<string, unknown>, field: string, values: readonly string[]) {
  if (typeof record[field] !== "string" || !values.includes(record[field])) throw new TypeError(`${field} is invalid`);
}

function requireBoundedString(record: Record<string, unknown>, field: string, maximum: number) {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new TypeError(`${field} must be a nonempty string of at most ${maximum} characters`);
  }
}

function requireIsoTimestamp(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${field} must be a strict ISO timestamp`);
  }
}

function requirePositiveDecimal(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || BigInt(value) > UINT64_MAX) {
    throw new TypeError(`${field} must be a canonical positive decimal uint64`);
  }
}

function requireNonzeroHash(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new TypeError(`${field} must be a nonzero bytes32 hash`);
  }
}

function requireNonzeroAddress(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new TypeError(`${field} must be a nonzero address`);
  }
}

function frozenSnapshot<T>(value: T, label: string): T {
  return deepFreeze(clonePlainData(value, label));
}

function clonePlainData<T>(value: T, label: string): T {
  if (value === null || typeof value !== "object") return clonePrimitive(value, label);
  if (Array.isArray(value)) return clonePlainArray(value, label) as T;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} has a non-plain prototype`);
  return clonePlainRecord(value as Record<string, unknown>, label) as T;
}

function clonePrimitive<T>(value: T, label: string): T {
  if (["function", "symbol", "bigint"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value))) throw new TypeError(`${label} is not plain data`);
  return value;
}

function clonePlainArray(value: readonly unknown[], label: string): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${label} has a non-plain prototype`);
  assertPlainDescriptors(value, label, true);
  return value.map((item, index) => clonePlainData(item, `${label}[${index}]`));
}

function clonePlainRecord(value: Record<string, unknown>, label: string): Record<string, unknown> {
  assertPlainDescriptors(value, label, false);
  return Object.fromEntries(Object.keys(value).map((key) => [key, clonePlainData(value[key], `${label}.${key}`)]));
}

function assertPlainDescriptors(value: object, label: string, array: boolean) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw new TypeError(`${label} has a symbol field`);
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(`${label}.${key} has an accessor or hidden field`);
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
