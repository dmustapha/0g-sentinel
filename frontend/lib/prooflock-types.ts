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
  card: Readonly<Record<string, unknown>>;
}>;

export type ProofLockRecord = Readonly<{
  identityKey: Bytes32;
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
export type ProofVerificationState = "IDLE" | "VERIFYING" | "MATCH" | "MISMATCH" | "UNAVAILABLE" | "TIMEOUT" | "RETRYING";

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
  proofLock: ProofLockRecord;
  storage: StorageVerification;
}>;

export type DiscoveryRecord = Readonly<{
  identityKey: Bytes32;
  transactionHash: Bytes32;
  blockNumber: number;
}>;

export type SubsystemName = "rpc" | "identity" | "registry" | "gate" | "compute" | "storage";
export type SubsystemHealth = Readonly<{
  status: "HEALTHY" | "UNHEALTHY" | "UNKNOWN";
  latencyMs: number;
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

export type OperatorRunInput = Readonly<{
  identity: CanonicalIdentity["identity"];
  registryAddress: HexAddress;
  policyVersion: number;
  scanner: HexAddress;
  scannerSoftwareVersion: string;
  validForSeconds: 604800;
  mode: "SEAL" | "RESEAL";
  expectedPriorVersion?: string;
  previousProofId?: Bytes32;
}>;

