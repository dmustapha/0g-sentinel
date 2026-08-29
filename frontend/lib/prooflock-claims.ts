import { assertComputeCapability, assertObservation, observationStatusAt } from "./prooflock-observations";
import type {
  Bytes32,
  ComputeVerificationCapability,
  CurrentVerifiedConsumerObservation,
  CurrentVerifiedGateObservation,
  CurrentVerifiedLeaseObservation,
  CurrentVerifiedRegistryObservation,
  HexAddress,
  HistoricalVerifiedStorageObservation,
} from "./prooflock-types";

export const CLAIM_KEYS = Object.freeze([
  "compute", "storage", "chainHistory", "admission", "drift", "discovery", "verifier", "authority",
] as const);

export type ClaimKey = typeof CLAIM_KEYS[number];
export type ClaimContract = Readonly<{
  permitted: string;
  qualification: string;
  prohibited: string;
}>;

const claimContract = (contract: ClaimContract): ClaimContract => Object.freeze(contract);

export const CLAIM_REGISTRY = Object.freeze({
  compute: claimContract({
    permitted: "Capability-specific Compute verification.",
    qualification: "Name SDK version, method, provider/model, DECENTRALIZED_MODEL_TEE, processResponseVerified: true, and bound transcript/artifact hashes.",
    prohibited: "TEE-attested without the exact proof class and successful verification.",
  }),
  storage: claimContract({
    permitted: "Exact bytes retrieved, digest-matched, root-recomputed, and bound to the named finalized Flow upload transaction.",
    qualification: "Always disclose networkProofVerified: false.",
    prohibited: "Network-proof verified while networkProofVerified is false.",
  }),
  chainHistory: claimContract({
    permitted: "Current RegistryV2 record plus append-preserved ProofLocked event provenance.",
    qualification: "Keep the current record distinct from historical event provenance.",
    prohibited: "Immutable record or immutable verdict.",
  }),
  admission: claimContract({
    permitted: "Current lease plus current Gate and guarded-consumer checks permit access.",
    qualification: "Bind the claim to current observations and their TTL.",
    prohibited: "Safe agent.",
  }),
  drift: claimContract({
    permitted: "On-demand drift observation.",
    qualification: "Name when the observation was made.",
    prohibited: "Continuous monitoring.",
  }),
  discovery: claimContract({
    permitted: "Recent RegistryV2 activity from block X to Y, capped at N.",
    qualification: "Disclose the scanned range and cap.",
    prohibited: "All ProofLocks without a complete index.",
  }),
  verifier: claimContract({
    permitted: "Public evidence verifier; no new paid Compute.",
    qualification: "Verification may still require public network access.",
    prohibited: "Offline verifier.",
  }),
  authority: claimContract({
    permitted: "One of the named SCANNER_ROLE wallets submitted this lease write; guardian authority can mark drift.",
    qualification: "Name authorized scanners and disclose guardian authority.",
    prohibited: "No centralized oracle, or a single-validator claim when multiple scanners are authorized.",
  }),
} as const satisfies Record<ClaimKey, ClaimContract>);

export const VERIFIER_CLAIM_COPY = deepFreeze({
  title: "Public evidence verifier",
  entry: {
    invalidTitle: "Check verifier identifiers",
    invalidDetail: "Required values and any supplied source transaction must be exact nonzero bytes32 identifiers.",
    proofError: "Enter an exact nonzero bytes32 proof ID.",
    identityError: "Enter an exact nonzero bytes32 identity key.",
    sourceError: "Enter an exact nonzero bytes32 source transaction.",
    openAction: "Open verifier",
  },
  detail: {
    invalidSource: "Invalid value",
    invalidTitle: "Invalid verification link",
    invalidDetail: "Proof ID, identity key, and optional source transaction must be exact nonzero bytes32 identifiers.",
  },
  health: {
    eyebrow: "Independent live probes",
    heading: "Subsystem health",
    independence: "Each cell is probed independently. One probe never determines a sibling.",
    loadingTitle: "Probing six dependencies",
    loadingDetail: "Each probe settles independently.",
    unavailableTitle: "Health response unavailable",
    unavailableDetail: "No dependency status is inferred from the failed response.",
    retryAction: "Retry probes",
    retryingAction: "Retrying probes",
    directObservation: "Direct dependency probe",
    computeObservation: "Service discovery only",
    computeInferenceLabel: "inferenceExecuted",
    storageObservation: "Retrieval canary",
    storageNetworkProofLabel: "networkProofVerified",
  },
  historical: {
    labels: {
      IDLE: "Ready to verify",
      VERIFYING: "Verifying exact stored bytes…",
      MATCH: "Historical artifact matches",
      MISMATCH: "Historical artifact mismatch",
      HINT_REQUIRED: "Source transaction required",
      UNAVAILABLE: "Evidence unavailable",
      TIMEOUT: "Verification timed out",
      CANCELED: "Verification canceled",
      RETRYING: "Retrying verification",
    },
    boundaryTitle: "Historical evidence status",
    boundaryDetail: "Historical evidence and current access are reported separately.",
  },
  current: {
    headingPrefix: "Current access",
    boundaryTitle: "Current access status",
    reasonPrefix: "Reason",
    noReason: "No reason code was returned.",
  },
  evidence: {
    storageFlagLabel: "Storage verifier flag",
    storageFlagValue: "networkProofVerified: false",
    providerFallback: "Provider not provided",
    modelFallback: "Model not provided",
    unavailableValue: "Unavailable",
  },
  locator: {
    staleTitle: "Stale proof link",
    staleDetail: "The supplied Registry source transaction does not identify the current record. No historical match is claimed.",
    staleAction: "Retry current record without source locator",
    mismatchTitle: "Historical proof mismatch",
    mismatchDetail: "The linked artifact failed cryptographic or finalized provenance checks. No historical match is claimed.",
    hintTitle: "Source transaction required",
    hintDetail: "This proof is outside the bounded historical lookup. Open a link carrying its exact Registry source transaction.",
    unavailableTitle: "Historical evidence unavailable",
    unavailableDetail: "The current record remains visible, but its historical artifact was not verified.",
  },
  actions: {
    verify: "Verify exact evidence",
    verifying: "Verifying exact evidence",
    retry: "Retry",
    retrying: "Retrying",
    cancelHistorical: "Cancel historical verification",
    cancelCurrent: "Cancel current access read",
  },
} as const);

export type ClaimContextMap = Readonly<{
  storage: HistoricalVerifiedStorageObservation;
  chainHistory: CurrentVerifiedRegistryObservation;
  admission: Readonly<{
    lease: CurrentVerifiedLeaseObservation;
    gate: CurrentVerifiedGateObservation;
    consumer: CurrentVerifiedConsumerObservation;
  }>;
  drift: Readonly<{ observedAt: string }>;
  discovery: Readonly<{ fromBlock: string; toBlock: string; cap: number }>;
  authority: Readonly<{
    submittedBy: HexAddress;
    authorizedScanners: readonly HexAddress[];
    sourceTxHash: Bytes32;
    guardianAddress: HexAddress;
    guardianCanMarkDrift: true;
  }>;
}>;

type ContextClaimKey = keyof ClaimContextMap;
type StaticClaimKey = "verifier";
type StaticGovernedClaim = Readonly<{ source: "STATIC_REGISTRY"; key: StaticClaimKey; text: string }>;
type ContextGovernedClaim = {
  [K in ContextClaimKey]: Readonly<{
    source: "EVIDENCE_CONTEXT";
    key: K;
    text: string;
    context: ClaimContextMap[K];
  }>;
}[ContextClaimKey];
type ComputeGovernedClaim = Readonly<{
  source: "COMPUTE_CAPABILITY";
  key: "compute";
  text: string;
  capability: ComputeVerificationCapability;
}>;

export type GovernedClaim = StaticGovernedClaim | ContextGovernedClaim | ComputeGovernedClaim;

const PROHIBITED_PATTERNS: Readonly<Record<ClaimKey, RegExp>> = Object.freeze({
  compute: /\bTEE[- ]attested\b/i,
  storage: /networkProofVerified\s*:\s*true|\bnetwork[- ](?:merkle[- ])?proof (?:is |was )?verified\b/i,
  chainHistory: /\bimmutable (?:record|verdict)\b/i,
  admission: /\b(?:universally )?safe\b/i,
  drift: /\bcontinuous(?:ly)? (?:drift )?monitor(?:ing|s|ed)?\b/i,
  discovery: /\ball ProofLocks\b/i,
  verifier: /\boffline verifier\b/i,
  authority: /\bno centralized oracle\b|\bsingle[- ]validator\b/i,
});
const UINT64_MAX = (1n << 64n) - 1n;

export function claimFor(key: StaticClaimKey): StaticGovernedClaim;
export function claimFor<K extends ContextClaimKey>(
  key: K,
  context: ClaimContextMap[K],
): Extract<ContextGovernedClaim, { key: K }>;
export function claimFor(key: ClaimKey, context?: unknown): GovernedClaim {
  if (key === "compute") throw new TypeError("Compute claims require the capability formatter");
  if (key === "verifier") return staticClaim(key, context);
  if (!isContextClaimKey(key) || context === undefined) throw new TypeError(`${key} claim context is required`);
  const snapshot = validateContext(key, context);
  return deepFreeze({ source: "EVIDENCE_CONTEXT", key, text: contextClaimText(key, snapshot), context: snapshot }) as GovernedClaim;
}

export function formatComputeClaim(input: unknown): ComputeGovernedClaim {
  const capability = assertComputeCapability(input);
  return Object.freeze({
    source: "COMPUTE_CAPABILITY",
    key: "compute",
    text: computeClaimText(capability),
    capability,
  });
}

export function assertClaimAllowed(input: unknown): string {
  if (typeof input === "string") rejectUngovernedText(input);
  const claim = requireRecord(frozenSnapshot(input, "claim"), "Ungoverned claim");
  if (claim.source === "STATIC_REGISTRY") return validateStaticClaim(claim);
  if (claim.source === "EVIDENCE_CONTEXT") return validateContextClaim(claim);
  if (claim.source === "COMPUTE_CAPABILITY") return validateComputeClaim(claim);
  throw new TypeError("Ungoverned claim");
}

function staticClaim(key: StaticClaimKey, context: unknown): StaticGovernedClaim {
  if (context !== undefined) throw new TypeError(`${key} does not accept claim context`);
  return Object.freeze({ source: "STATIC_REGISTRY", key, text: staticClaimText(key) });
}

function staticClaimText(key: StaticClaimKey): string {
  return `${CLAIM_REGISTRY[key].permitted} ${CLAIM_REGISTRY[key].qualification}`;
}

function validateStaticClaim(claim: Record<string, unknown>): string {
  assertExactKeys(claim, ["source", "key", "text"], "static claim");
  if (claim.key !== "verifier") throw new TypeError("Ungoverned static claim key");
  const expected = staticClaimText(claim.key);
  if (claim.text !== expected) throw new TypeError("Ungoverned static claim text");
  return expected;
}

function validateContextClaim(claim: Record<string, unknown>): string {
  assertExactKeys(claim, ["source", "key", "text", "context"], "context claim");
  if (!isContextClaimKey(claim.key)) throw new TypeError("Ungoverned context claim key");
  const context = validateContext(claim.key, claim.context);
  const expected = contextClaimText(claim.key, context);
  if (claim.text !== expected) throw new TypeError("Ungoverned context claim text");
  return expected;
}

function validateComputeClaim(claim: Record<string, unknown>): string {
  assertExactKeys(claim, ["source", "key", "text", "capability"], "Compute claim");
  if (claim.key !== "compute") throw new TypeError("Ungoverned Compute claim key");
  const capability = assertComputeCapability(claim.capability);
  const expected = computeClaimText(capability);
  if (claim.text !== expected) throw new TypeError("Ungoverned Compute claim text");
  return expected;
}

function validateContext<K extends ContextClaimKey>(key: K, input: unknown): ClaimContextMap[K] {
  if (key === "storage") return validateStorageContext(input) as ClaimContextMap[K];
  if (key === "chainHistory") return validateChainHistoryContext(input) as ClaimContextMap[K];
  if (key === "admission") return validateAdmissionContext(input) as ClaimContextMap[K];
  if (key === "drift") return validateDriftContext(input) as ClaimContextMap[K];
  if (key === "discovery") return validateDiscoveryContext(input) as ClaimContextMap[K];
  return validateAuthorityContext(input) as ClaimContextMap[K];
}

function validateStorageContext(input: unknown): ClaimContextMap["storage"] {
  const observation = decodeClaimObservation(input, "storage");
  if (observation.scope !== "HISTORICAL" || observation.status !== "VERIFIED" ||
      observation.subsystem !== "storage") {
    throw new TypeError("storage claim context requires a HISTORICAL VERIFIED storage observation");
  }
  return observation;
}

function validateChainHistoryContext(input: unknown): ClaimContextMap["chainHistory"] {
  const observation = decodeClaimObservation(input, "chainHistory");
  if (observation.scope !== "CURRENT" || observation.status !== "VERIFIED" ||
      observation.subsystem !== "registry" || observation.operation !== "CURRENT_RECORD_READ") {
    throw new TypeError("chainHistory claim context requires a verified current Registry record read");
  }
  requireFreshObservation(observation, "chainHistory Registry");
  return observation;
}

function validateAdmissionContext(input: unknown): ClaimContextMap["admission"] {
  const context = requireRecord(frozenSnapshot(input, "admission claim context"), "admission claim context");
  assertExactKeys(context, ["lease", "gate", "consumer"], "admission claim context");
  const lease = requireCurrentSuccess(context.lease, "lease");
  const gate = requireCurrentSuccess(context.gate, "gate");
  const consumer = requireCurrentSuccess(context.consumer, "consumer");
  assertSharedCoordinate([lease, gate, consumer]);
  return deepFreeze({ lease, gate, consumer });
}

function validateDriftContext(input: unknown): ClaimContextMap["drift"] {
  const context = requireRecord(frozenSnapshot(input, "drift claim context"), "drift claim context");
  assertExactKeys(context, ["observedAt"], "drift claim context");
  requireIsoTimestamp(context, "observedAt");
  return context as ClaimContextMap["drift"];
}

function validateDiscoveryContext(input: unknown): ClaimContextMap["discovery"] {
  const context = requireRecord(frozenSnapshot(input, "discovery claim context"), "discovery claim context");
  assertExactKeys(context, ["fromBlock", "toBlock", "cap"], "discovery claim context");
  requirePositiveDecimal(context, "fromBlock");
  requirePositiveDecimal(context, "toBlock");
  if (BigInt(String(context.fromBlock)) > BigInt(String(context.toBlock))) {
    throw new TypeError("discovery claim block range is invalid");
  }
  if (!Number.isSafeInteger(context.cap) || Number(context.cap) <= 0) throw new TypeError("discovery claim cap is invalid");
  return context as ClaimContextMap["discovery"];
}

function validateAuthorityContext(input: unknown): ClaimContextMap["authority"] {
  const context = requireRecord(frozenSnapshot(input, "authority claim context"), "authority claim context");
  const fields = ["submittedBy", "authorizedScanners", "sourceTxHash", "guardianAddress", "guardianCanMarkDrift"];
  assertExactKeys(context, fields, "authority claim context");
  if (!Array.isArray(context.authorizedScanners) || context.authorizedScanners.length === 0) {
    throw new TypeError("authority claim context requires authorized scanners");
  }
  for (const scanner of context.authorizedScanners) requireCanonicalAddress(scanner, "authorized scanner");
  if (new Set(context.authorizedScanners).size !== context.authorizedScanners.length) {
    throw new TypeError("authorized scanner addresses must be unique");
  }
  requireCanonicalAddress(context.submittedBy, "submittedBy");
  if (!context.authorizedScanners.includes(context.submittedBy)) {
    throw new TypeError("submittedBy must be an authorized scanner");
  }
  requireNonzeroHash(context, "sourceTxHash");
  requireCanonicalAddress(context.guardianAddress, "guardian address");
  if (context.guardianCanMarkDrift !== true) throw new TypeError("guardian authority to mark drift must be disclosed");
  return context as ClaimContextMap["authority"];
}

function decodeClaimObservation(input: unknown, key: string) {
  try {
    return assertObservation(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid observation";
    throw new TypeError(`${key} claim context is invalid: ${message}`);
  }
}

function requireCurrentSuccess(input: unknown, subsystem: "lease"): CurrentVerifiedLeaseObservation;
function requireCurrentSuccess(input: unknown, subsystem: "gate"): CurrentVerifiedGateObservation;
function requireCurrentSuccess(input: unknown, subsystem: "consumer"): CurrentVerifiedConsumerObservation;
function requireCurrentSuccess(input: unknown, subsystem: "lease" | "gate" | "consumer"): CurrentObservation {
  const observation = decodeClaimObservation(input, `admission ${subsystem}`);
  if (observation.scope !== "CURRENT" || observation.status !== "VERIFIED" ||
      observation.subsystem !== subsystem) {
    throw new TypeError(`admission ${subsystem} must be CURRENT VERIFIED`);
  }
  requireFreshObservation(observation, `admission ${subsystem}`);
  return observation as CurrentObservation;
}

function requireFreshObservation(observation: CurrentObservation | CurrentVerifiedRegistryObservation, label: string) {
  if (observationStatusAt(observation) === "STALE") throw new TypeError(`${label} observation is stale`);
}

function assertSharedCoordinate(observations: readonly CurrentObservation[]) {
  const expected = coordinateKey(observations[0]);
  if (observations.some((observation) => coordinateKey(observation) !== expected)) {
    throw new TypeError("admission observations must share one coordinate");
  }
}

type CurrentObservation = CurrentVerifiedLeaseObservation | CurrentVerifiedGateObservation |
  CurrentVerifiedConsumerObservation;

function coordinateKey(observation: CurrentObservation): string {
  return JSON.stringify([observation.observationBlockNumber, observation.observationBlockHash,
    observation.observedAt, observation.serverIssuedAt, observation.ttlMs,
    observation.freshnessExpiresAt]);
}

function contextClaimText(key: ContextClaimKey, context: ClaimContextMap[ContextClaimKey]): string {
  if (key === "storage") return storageClaimText(context as ClaimContextMap["storage"]);
  if (key === "chainHistory") return chainHistoryClaimText(context as ClaimContextMap["chainHistory"]);
  if (key === "admission") return admissionClaimText(context as ClaimContextMap["admission"]);
  if (key === "drift") return `${CLAIM_REGISTRY.drift.permitted} observedAt: ${(context as ClaimContextMap["drift"]).observedAt}.`;
  if (key === "discovery") return discoveryClaimText(context as ClaimContextMap["discovery"]);
  return authorityClaimText(context as ClaimContextMap["authority"]);
}

function storageClaimText(context: ClaimContextMap["storage"]): string {
  return `${CLAIM_REGISTRY.storage.permitted} proofClass: ${context.capability.proofClass}; retrievalVerified: true; networkProofVerified: false; storageRoot: ${context.storageRoot}; artifactHash: ${context.artifactHash}; storageUploadTxHash: ${context.storageUploadTxHash}.`;
}

function chainHistoryClaimText(context: ClaimContextMap["chainHistory"]): string {
  return `${CLAIM_REGISTRY.chainHistory.permitted} CURRENT_RECORD_READ at block ${context.observationBlockNumber} (${context.observationBlockHash}), observedAt: ${context.observedAt}; registrySourceTxHash: ${context.registrySourceTxHash}.`;
}

function admissionClaimText(context: ClaimContextMap["admission"]): string {
  const coordinate = context.gate;
  return `${CLAIM_REGISTRY.admission.permitted} Lease VERIFIED; Gate allowed: true (ALLOWED); consumer accepted: true. Observed at block ${coordinate.observationBlockNumber} (${coordinate.observationBlockHash}) at ${coordinate.observedAt}; freshnessExpiresAt: ${coordinate.freshnessExpiresAt}.`;
}

function discoveryClaimText(context: ClaimContextMap["discovery"]): string {
  return `Recent RegistryV2 activity from block ${context.fromBlock} to ${context.toBlock}, capped at ${context.cap}.`;
}

function authorityClaimText(context: ClaimContextMap["authority"]): string {
  return `${CLAIM_REGISTRY.authority.permitted} submittedBy: ${context.submittedBy}; authorizedScanners: ${context.authorizedScanners.join(", ")}; sourceTxHash: ${context.sourceTxHash}; guardian ${context.guardianAddress} can mark drift.`;
}

function computeClaimText(capability: ComputeVerificationCapability): string {
  const hashes = capability.boundHashes;
  const tuple = {
    sdkVersion: capability.sdkVersion, method: capability.method, provider: capability.provider,
    model: capability.model, proofClass: capability.proofClass,
    processResponseVerified: capability.processResponseVerified, ...hashes,
  };
  return `TEE-attested ${JSON.stringify(tuple)}`;
}

function rejectUngovernedText(text: string): never {
  const key = prohibitedKeyFor(text);
  if (key) throw new TypeError(`Prohibited claim: ${key}`);
  throw new TypeError("Ungoverned claim text");
}

function prohibitedKeyFor(text: string): ClaimKey | undefined {
  return CLAIM_KEYS.find((key) => {
    if (key === "compute") return hasUnqualifiedTeeClaim(text);
    return PROHIBITED_PATTERNS[key].test(text);
  });
}

function hasUnqualifiedTeeClaim(text: string): boolean {
  const qualified = /\bTEE[- ]attested\b\s*\(\s*proofClass\s*:\s*DECENTRALIZED_MODEL_TEE\s*;\s*processResponseVerified\s*:\s*true\s*\)/gi;
  return /\bTEE[- ]attested\b/i.test(text.replace(qualified, ""));
}

function isContextClaimKey(value: unknown): value is ContextClaimKey {
  return value === "storage" || value === "chainHistory" || value === "admission" || value === "drift" ||
    value === "discovery" || value === "authority";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown) throw new TypeError(`${label} has unknown field ${unknown}`);
}

function requireNonzeroHash(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0{64}$/.test(value)) {
    throw new TypeError(`${field} must be a canonical nonzero bytes32 hash`);
  }
}

function requireCanonicalAddress(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value) || /^0x0{40}$/.test(value)) {
    throw new TypeError(`${label} must be a canonical nonzero address`);
  }
}

function requirePositiveDecimal(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || BigInt(value) > UINT64_MAX) {
    throw new TypeError(`${field} must be a canonical positive decimal uint64`);
  }
}

function requireIsoTimestamp(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${field} must be a strict ISO timestamp`);
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
