export type HexAddress = `0x${string}`;
export type Bytes32 = `0x${string}`;

export type CanonicalIdentity = Readonly<{
  identity: Readonly<{
    namespace: "eip155";
    chainId: 16661;
    registryAddress: HexAddress;
    agentId: string;
  }>;
  owner: HexAddress;
  agentWallet: HexAddress;
  agentURI: string;
  registrationDigest: Bytes32;
  sourceBlockNumber: string;
  sourceBlockHash: Bytes32;
  card: Readonly<Record<string, unknown>> | null;
}>;

export type ProofLockRecord = Readonly<{
  identityKey: Bytes32;
  proofId?: Bytes32;
  registryAddress?: HexAddress;
  subject: HexAddress;
  envelopeDigest: Bytes32;
  storageRoot: Bytes32;
  computeRoot: Bytes32;
  artifactHash: Bytes32;
  runtimeCodeHash: Bytes32;
  version: string;
  issuedAt: string;
  validUntil: string;
  policyVersion: number;
  behavioralScore: number;
  codeRisk: number;
  coverage: number;
  state: number;
  stateReason: number;
}>;

export type GateReasonCode =
  | "ALLOWED" | "NO_PROOF" | "REVOKED" | "DRIFTED" | "EXPIRED"
  | "SUBJECT_CHANGED" | "RUNTIME_CODE_DRIFT" | "POLICY_TOO_OLD"
  | "COVERAGE_INCOMPLETE" | "COMPUTE_UNVERIFIED" | "STORAGE_UNVERIFIED"
  | "BEHAVIORAL_RISK" | "CODE_RISK" | "IDENTITY_UNAVAILABLE"
  | "AGENT_NOT_FOUND" | "AGENT_WALLET_UNSET" | "IDENTITY_MISMATCH"
  | "UNKNOWN_REASON";

export type GateDecision = Readonly<{
  allowed: boolean;
  reason: number;
  subject: HexAddress;
  version: string;
}>;

export type LeaseStatus = "ACTIVE" | "EXPIRING" | "EXPIRED" | "REVOKED" | "DRIFTED" | "INCOMPLETE";
export type ProofVerificationState =
  | "IDLE" | "VERIFYING" | "MATCH" | "MISMATCH"
  | "HINT_REQUIRED" | "UNAVAILABLE" | "TIMEOUT" | "CANCELED" | "RETRYING";
export type HistoricalVerification =
  | Readonly<{ status: Exclude<ProofVerificationState, "MATCH"> }>
  | Readonly<{ status: "MATCH"; proof: VerifiedProof }>;
export type CurrentVerification =
  | Readonly<{ status: "IDLE" | "READING" | "UNAVAILABLE" | "TIMEOUT" | "CANCELED" }>
  | Readonly<{ status: "ADMITTED" | "BLOCKED"; reason: string }>;
export type VerificationState = Readonly<{
  generation: number;
  historical: HistoricalVerification;
  current: CurrentVerification;
}>;

export type ObservationScope = "HISTORICAL" | "CURRENT";
export type ObservationStatus = "VERIFIED" | "BLOCKED" | "UNAVAILABLE" | "STALE" | "MISMATCH" | "NOT_APPLICABLE";
export type ObservationSubsystem =
  | "identity" | "checks" | "compute" | "storage"
  | "registry" | "lease" | "gate" | "consumer";
export type ObservationReasonCode =
  | GateReasonCode | "EVIDENCE_UNAVAILABLE" | "EVIDENCE_MISMATCH";
export type BlockingObservationReasonCode = Exclude<ObservationReasonCode, "ALLOWED">;

export type CurrentObservationMetadata = Readonly<{
  scope: "CURRENT";
  observedAt: string;
  observationBlockNumber: string;
  observationBlockHash: Bytes32;
  serverIssuedAt: string;
  ttlMs: number;
  freshnessExpiresAt: string;
}>;

export type HistoricalObservationMetadata = Readonly<{
  scope: "HISTORICAL";
  observedAt: string;
}>;

export type ComputeVerificationCapability = Readonly<{
  sdkVersion: string;
  method: string;
  provider: HexAddress;
  model: string;
  proofClass: "DECENTRALIZED_MODEL_TEE";
  processResponseVerified: true;
  boundHashes: Readonly<{
    receiptDigest: Bytes32;
    requestDigest: Bytes32;
    responseDigest: Bytes32;
    signedTextSha256: Bytes32;
    requestSha256: Bytes32;
    rawResponseSha256: Bytes32;
    responseHeadersSha256: Bytes32;
    artifactHash: Bytes32;
  }>;
}>;

export type StorageVerificationCapability = Readonly<{
  proofClass: "ROOT_MATCHED_NO_NETWORK_PROOF";
  retrievalVerified: true;
  networkProofVerified: false;
}>;

type ObservationIdentity = Readonly<{
  registrySourceTxHash: Bytes32;
}>;
type ObservationCompute = Readonly<{
  capability: ComputeVerificationCapability;
}>;
type ObservationStorage = Readonly<{
  storageRoot: Bytes32;
  artifactHash: Bytes32;
  storageUploadTxHash: Bytes32;
  registrySourceTxHash?: Bytes32;
  capability: StorageVerificationCapability;
}>;
type HistoricalVerifiedObservation = HistoricalObservationMetadata & Readonly<{ status: "VERIFIED" }> & (
  | Readonly<{ subsystem: "identity" | "checks" }>
  | (Readonly<{ subsystem: "registry" }> & ObservationIdentity)
  | (Readonly<{ subsystem: "compute" }> & ObservationCompute)
  | (Readonly<{ subsystem: "storage" }> & ObservationStorage)
);
type CurrentVerifiedObservation = CurrentObservationMetadata & Readonly<{ status: "VERIFIED" }> & (
  | Readonly<{ subsystem: "identity" }>
  | Readonly<{ subsystem: "lease" }>
  | Readonly<{ subsystem: "consumer"; accepted: true }>
  | Readonly<{ subsystem: "gate"; allowed: true; reasonCode: "ALLOWED" }>
  | Readonly<{ subsystem: "registry"; operation: "CURRENT_RECORD_READ"; registrySourceTxHash: Bytes32 }>
);
type HistoricalNonVerifiedObservation = HistoricalObservationMetadata & Readonly<{
  subsystem: ObservationSubsystem;
  status: Exclude<ObservationStatus, "VERIFIED" | "BLOCKED" | "STALE">;
  reasonCode?: ObservationReasonCode;
}>;
type CurrentBlockedObservation = CurrentObservationMetadata & Readonly<{
  subsystem: "lease" | "gate" | "consumer";
  status: "BLOCKED";
  reasonCode?: BlockingObservationReasonCode;
}>;
type CurrentNonVerifiedObservation = CurrentObservationMetadata & Readonly<{
  subsystem: ObservationSubsystem;
  status: Exclude<ObservationStatus, "VERIFIED" | "BLOCKED">;
  reasonCode?: ObservationReasonCode;
}>;

export type ProofLockObservation =
  | HistoricalVerifiedObservation | CurrentVerifiedObservation
  | HistoricalNonVerifiedObservation | CurrentBlockedObservation | CurrentNonVerifiedObservation;
export type HistoricalVerifiedStorageObservation = Extract<ProofLockObservation, {
  scope: "HISTORICAL"; status: "VERIFIED"; subsystem: "storage";
}>;
export type CurrentVerifiedLeaseObservation = Extract<ProofLockObservation, {
  scope: "CURRENT"; status: "VERIFIED"; subsystem: "lease";
}>;
export type CurrentVerifiedGateObservation = Extract<ProofLockObservation, {
  scope: "CURRENT"; status: "VERIFIED"; subsystem: "gate";
}>;
export type CurrentVerifiedConsumerObservation = Extract<ProofLockObservation, {
  scope: "CURRENT"; status: "VERIFIED"; subsystem: "consumer";
}>;
export type CurrentVerifiedRegistryObservation = Extract<ProofLockObservation, {
  scope: "CURRENT"; status: "VERIFIED"; subsystem: "registry";
}>;

export type StorageVerification = Readonly<{
  retrievalVerified: true;
  networkProofVerified: false;
  envelope: Readonly<Record<string, unknown>>;
  computeVerification?: readonly unknown[];
  storageCommitment?: Readonly<Record<string, unknown>>;
}>;

export type VerifiedProof = Readonly<{
  proofId: Bytes32;
  identityKey: Bytes32;
  source: Readonly<{ kind: "ProofLocked"; registryAddress: HexAddress; transactionHash: Bytes32;
    blockNumber: number; blockHash: Bytes32; logIndex: number }>;
  proofLock: ProofLockRecord;
  storage: StorageVerification;
}>;

export type DiscoveryRecord = Readonly<{
  identityKey: Bytes32;
  transactionHash: Bytes32;
  blockNumber: number;
  locator?: RegistryProofSourceLocator;
}>;

export type RegistryProofLocator = Readonly<{
  identityKey: Bytes32;
  proofId: Bytes32;
  registryAddress: HexAddress;
}>;
export type RegistryProofSourceLocator = RegistryProofLocator & Readonly<{
  transactionHash: Bytes32;
  blockNumber: number;
}>;
export type ResolvedIdentityLocator = Readonly<{
  identity: CanonicalIdentity;
  identityKey: Bytes32;
}>;

// The structured evidence recovered from the sealed compute request: threat-intel source results,
// contract bytecode flags, and per-signal evidence. Optional on legacy/terse seals.
export type ProofLockRiskEvidenceSource = Readonly<{ name: string; status: "HIT" | "CLEAR" | "UNAVAILABLE"; detail?: string }>;
export type ProofLockRiskEvidenceSignal = Readonly<{ label: string; strength: number; hard: boolean; detail?: string }>;
export type ProofLockRiskEvidence = Readonly<{
  sanctioned: boolean; scamFlagged: boolean;
  sources: readonly ProofLockRiskEvidenceSource[];
  bytecodeFlags: readonly string[]; sourceFindings: readonly string[];
  signals: readonly ProofLockRiskEvidenceSignal[];
}>;

// Plain-English risk narrative (restored from v1), re-parsed from the enclave-signed compute output.
export type ProofLockRiskAnalysis = Readonly<{
  behavioralScore: number; codeRisk: number; label: string;
  behavioralSummary: string | null; behavioralFactors: readonly string[];
  codeSummary: string | null; codeFactors: readonly string[];
  evidence?: ProofLockRiskEvidence | null;
}>;
export type ProofLockDetail =
  | Readonly<{ status: "VERIFIED"; identity: Readonly<{
      identityKey: Bytes32; namespace: "eip155"; chainId: 16661; registryAddress: HexAddress; agentId: string;
      owner: HexAddress; agentWallet: HexAddress; registrationUri: string; registrationDigest: Bytes32;
      sourceBlockNumber: string; sourceBlockHash: Bytes32;
    }>; resolution: Readonly<{ owner: HexAddress; agentWallet: HexAddress; agentURI: string;
      registrationDigest: Bytes32; sourceBlockNumber: string; sourceBlockHash: Bytes32 }>;
      gate: Readonly<{ status: "VERIFIED"; allowed: boolean; reason: number; subject: HexAddress; version: string }>
        | Readonly<{ status: "UNKNOWN"; allowed: false; reason: null }>;
      consumer: Readonly<{ status: "VERIFIED"; accepted: boolean; address: HexAddress; subject: HexAddress; version: string }>
        | Readonly<{ status: "UNKNOWN"; accepted: false }>;
      analysis?: ProofLockRiskAnalysis }>
  | Readonly<{ status: "UNAVAILABLE"; code: "EVIDENCE_UNAVAILABLE" | "EVIDENCE_INVALID" | "IDENTITY_UNAVAILABLE" | "IDENTITY_INVALID";
      identity: null; resolution: null; gate: Readonly<{ status: "UNKNOWN"; allowed: false; reason: null }>;
      consumer: Readonly<{ status: "UNKNOWN"; accepted: false }> }>;

export type CurrentObservationCapability =
  | "ERC8004_IDENTITY_AT_FINALIZED_BLOCK"
  | "REGISTRY_V2_LEASE_AT_FINALIZED_BLOCK"
  | "AGENT_GATE_V2_AT_FINALIZED_BLOCK"
  | "GUARDED_CONSUMER_AT_FINALIZED_BLOCK";
export type CurrentObservationReason =
  | "OBSERVED" | "CURRENT_IDENTITY_UNAVAILABLE" | "CURRENT_LEASE_UNAVAILABLE"
  | "CURRENT_GATE_UNAVAILABLE" | "CURRENT_CONSUMER_UNAVAILABLE"
  | "CURRENT_LEASE_MISMATCH" | "CURRENT_GATE_MISMATCH"
  | "CURRENT_CONSUMER_MISMATCH" | "GUARDED_CONSUMER_BLOCKED"
  | GateReasonCode;
export type CurrentIdentityValue = Readonly<{
  identity: CanonicalIdentity["identity"];
  owner: HexAddress;
  agentWallet: HexAddress;
  agentURI: string;
  registrationDigest: Bytes32;
  sourceBlockNumber: string;
  sourceBlockHash: Bytes32;
}>;
export type CurrentGateValue = Readonly<{
  allowed: boolean;
  reason: number;
  subject: HexAddress;
  version: string;
}>;
export type CurrentConsumerValue = Readonly<{
  accepted: boolean;
  address: HexAddress;
  subject: HexAddress;
  version: string;
}>;
export type CurrentObservationEntry<T> = Readonly<{
  capability: CurrentObservationCapability;
  reason: CurrentObservationReason;
  observation: ProofLockObservation;
  value: T | null;
}>;
export type CurrentAccessV1 = Readonly<{
  schema: "sentinel.prooflock/current-access-v1";
  version: 1;
  agentId: string;
  identityKey: Bytes32;
  observationBlock: Readonly<{ number: string; hash: Bytes32; timestamp: string }>;
  observedAt: string;
  freshnessExpiresAt: string;
  observations: Readonly<{
    identity: CurrentObservationEntry<CurrentIdentityValue>;
    lease: CurrentObservationEntry<ProofLockRecord>;
    gate: CurrentObservationEntry<CurrentGateValue>;
    consumer: CurrentObservationEntry<CurrentConsumerValue>;
  }>;
}>;
export type SealedEvidenceV1 = Readonly<{
  schema: "sentinel.prooflock/sealed-evidence-v1";
  version: 1;
  proofLock: ProofLockRecord;
  detail: ProofLockDetail;
}>;
type LegacyProofLockDetailResponse = Readonly<{
  identityKey: Bytes32;
  proofLock: ProofLockRecord;
  detail: ProofLockDetail;
}>;
export type ProofLockDetailResponse = LegacyProofLockDetailResponse & Readonly<{
  responseVersion?: 2;
  proofId?: Bytes32;
  registryAddress?: HexAddress;
  locator?: RegistryProofLocator;
  sealedEvidence?: SealedEvidenceV1;
  currentAccess?: CurrentAccessV1;
}>;
export type ProofLockCurrentDetailResponse = LegacyProofLockDetailResponse & Readonly<{
  responseVersion: 2;
  proofId: Bytes32;
  registryAddress: HexAddress;
  locator: RegistryProofLocator;
  sealedEvidence: SealedEvidenceV1;
  currentAccess: CurrentAccessV1;
}>;
export type VerifiedProofLockInventoryItem = DiscoveryRecord & ProofLockDetailResponse & Readonly<{
  status: "VERIFIED";
  proofId: Bytes32;
}>;
export type UnavailableProofLockInventoryItem = DiscoveryRecord & Readonly<{
  status: "ENRICHMENT_UNAVAILABLE";
  code: "DEPENDENCY_UNAVAILABLE";
}>;
export type ProofLockInventoryItem = VerifiedProofLockInventoryItem | UnavailableProofLockInventoryItem;
export type ProofLockDiscoveryResponse = Readonly<{
  identities: readonly ProofLockInventoryItem[];
  latestBlock: number;
  fromBlock: number;
  toBlock: number;
  confirmations: number;
  observedAt: string;
  cap: number;
  returned: number;
  complete: false;
}>;

export type SubsystemName = "rpc" | "identity" | "registry" | "gate" | "compute" | "storage";
export type SubsystemHealth = Readonly<{
  status: "HEALTHY" | "UNHEALTHY" | "UNKNOWN";
  latencyMs: number;
  observedAt: string;
  detail?: Readonly<Record<string, unknown>>;
}>;

export type HealthSnapshot = Readonly<{
  status: "HEALTHY" | "DEGRADED";
  dependencies: Readonly<Record<SubsystemName, SubsystemHealth>>;
}>;

export type RunnerStage =
  | "VALIDATING_IDENTITY" | "CLASSIFYING_SUBJECT" | "RUNNING_DETERMINISTIC_CHECKS"
  | "RUNNING_COMPUTE" | "CANONICALIZING_EVIDENCE" | "UPLOADING_STORAGE"
  | "VERIFYING_STORAGE" | "WRITING_CHAIN" | "READING_CHAIN_BACK" | "SEALED";

export type ApiErrorShape = Readonly<{
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  requestId: string;
}>;

export type ProofLockWriteOutcome =
  | Readonly<{ status: "NOT_BROADCAST"; recoveryId: string }>
  | Readonly<{ status: "SUBMISSION_OUTCOME_UNKNOWN"; recoveryId: string; transactionHash?: Bytes32 }>
  | Readonly<{ status: "FINALIZED_READBACK_UNAVAILABLE"; recoveryId: string; transactionHash: Bytes32;
      identityKey: Bytes32; version: string }>
  | Readonly<{ status: "SEALED"; recoveryId: string; transactionHash: Bytes32;
      identityKey: Bytes32; version: string }>
  | Readonly<{ status: "REVERTED"; recoveryId: string; transactionHash: Bytes32 }>;

export type OperatorRunProgress =
  | Readonly<{ type: "admission"; state: "ACCEPTED" | "DEDUPLICATED";
      recoveryId: string; idempotencyKey: string }>
  | Readonly<{ phase: "PRE_SEND" | "SUBMISSION_ATTEMPTED" }>
  | Readonly<{ phase: "HASH_KNOWN" | "REVERTED"; transactionHash: Bytes32 }>
  | Readonly<{ phase: "FINALIZED"; transactionHash: Bytes32; blockHash: Bytes32;
      blockNumber: string; confirmations: number }>;

export type OperatorTerminalResult =
  | Readonly<{ kind: "SEALED"; stage: "SEALED"; identity?: Readonly<Record<string, unknown>>;
      subject?: Readonly<Record<string, unknown>>; envelope?: Readonly<Record<string, unknown>>;
      storage?: Readonly<Record<string, unknown>>; chain?: Readonly<Record<string, unknown>>;
      proofLock?: Readonly<Record<string, unknown>>; writeOutcome: Extract<ProofLockWriteOutcome, { status: "SEALED" }> }>
  | Readonly<{ kind: "EXISTING_OPERATION"; operation: Readonly<{ recoveryId: string;
      phase: "REQUESTED" | "COMPUTE_VERIFIED" | "STORAGE_VERIFIED" | "CHAIN_INPUT_COMMITTED"
        | "SUBMISSION_ATTEMPTED" | "HASH_KNOWN" | "FINALIZED" | "RECOVERY_REQUIRED" | "TERMINAL";
      writeOutcome?: ProofLockWriteOutcome }> }>;

export type OperatorRunInput = Readonly<{
  identity: CanonicalIdentity["identity"];
  mode: "SEAL" | "RESEAL";
  expectedPriorVersion?: string;
  previousProofId?: Bytes32;
}>;
