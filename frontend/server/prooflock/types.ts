export type HexAddress = `0x${string}`;
export type Bytes32 = `0x${string}`;

export type AgentIdentity = Readonly<{
  namespace: "eip155";
  chainId: 16661;
  registryAddress: HexAddress;
  agentId: string;
}>;

export type SubjectKind = "EOA" | "EIP7702_DELEGATED_EOA" | "CONTRACT";
export type ProofStage =
  | "IDENTITY_VERIFIED"
  | "DETERMINISTIC_COMPLETE"
  | "COMPUTE_VERIFIED"
  | "STORAGE_VERIFIED"
  | "SEALED";
export type ProofClass =
  | "DETERMINISTIC"
  | "COMPUTE_VERIFIED"
  | "STORAGE_VERIFIED"
  | "SEALED";
export type CheckStatus = "PASS" | "WARN" | "FAIL" | "NOT_APPLICABLE";
export type ProofLifecycle =
  | "NONE"
  | "ACTIVE"
  | "REVOKED"
  | "DRIFTED"
  | "SUPERSEDED"
  | "EXPIRED";

export const GATE_REASON = {
  ALLOWED: 0,
  NO_PROOF: 1,
  REVOKED: 2,
  DRIFTED: 3,
  EXPIRED: 4,
  SUBJECT_CHANGED: 5,
  RUNTIME_CODE_DRIFT: 6,
  POLICY_TOO_OLD: 7,
  COVERAGE_INCOMPLETE: 8,
  COMPUTE_UNVERIFIED: 9,
  STORAGE_UNVERIFIED: 10,
  BEHAVIORAL_RISK: 11,
  CODE_RISK: 12,
  IDENTITY_UNAVAILABLE: 13,
  AGENT_NOT_FOUND: 14,
  AGENT_WALLET_UNSET: 15,
  IDENTITY_MISMATCH: 16,
} as const;

export type GateReason = (typeof GATE_REASON)[keyof typeof GATE_REASON];

export const COVERAGE = {
  IDENTITY_VALIDATED: 0x01,
  SUBJECT_CLASSIFIED: 0x02,
  DETERMINISTIC_CHECKS_RUN: 0x04,
  BEHAVIORAL_COMPUTE_VERIFIED: 0x08,
  CODE_COMPUTE_VERIFIED_OR_NOT_APPLICABLE: 0x10,
  EVIDENCE_STORAGE_VERIFIED: 0x20,
  POLICY_EVALUATED: 0x40,
} as const;

export const REQUIRED_COVERAGE = 0x7f as const;

export type DeterministicCheck = Readonly<{
  id: string;
  version: string;
  status: CheckStatus;
  inputDigest: Bytes32;
  outputDigest: Bytes32;
  findings: readonly string[];
}>;

export type ComputeProof = Readonly<{
  purpose: "behavioral-risk" | "contract-risk";
  provider: HexAddress;
  model: string;
  chatId: string;
  receiptDigest: Bytes32;
  requestDigest: Bytes32;
  responseDigest: Bytes32;
  usage: Readonly<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
  processResponseVerified: true;
}>;

export type EvidenceEnvelopeV1 = Readonly<{
  schema: "sentinel.prooflock/evidence-v1";
  proofClass: "COMPUTE_VERIFIED";
  schemaVersion: 1;
  policyVersion: number;
  coverage: Readonly<{
    preStorageMask: 0x5f;
    requiredSealMask: 0x7f;
    identityValidated: true;
    subjectClassified: true;
    deterministicChecksRun: true;
    behavioralComputeVerified: true;
    codeCompute:
      | Readonly<{ status: "VERIFIED" }>
      | Readonly<{ status: "NOT_APPLICABLE"; reason: string }>;
    evidenceStorage: "PENDING_EXTERNAL_COMMITMENT";
    policyEvaluated: true;
  }>;
  identity: AgentIdentity &
    Readonly<{
      owner: HexAddress;
      agentWallet: HexAddress;
      registrationUri: string;
      registrationDigest: Bytes32;
    }>;
  source: Readonly<{ blockNumber: string; blockHash: Bytes32 }>;
  subject: Readonly<{
    address: HexAddress;
    kind: SubjectKind;
    runtimeCodeHash: Bytes32;
    delegationTarget?: HexAddress;
    delegationCodeHash?: Bytes32;
    proxyImplementation?: HexAddress;
    proxyImplementationCodeHash?: Bytes32;
  }>;
  deterministicChecks: readonly DeterministicCheck[];
  computeProofs: readonly ComputeProof[];
  verdict: Readonly<{
    riskScore: number;
    label: "SAFE" | "CAUTION" | "FLAGGED";
  }>;
  omissions: readonly string[];
  scanner: Readonly<{ address: HexAddress; softwareVersion: string }>;
  previousProofId?: Bytes32;
}>;

export type StorageCommitment = Readonly<{
  envelopeDigest: Bytes32;
  storageRoot: Bytes32;
  uploadTxHash: Bytes32;
  retrievedDigest: Bytes32;
  finalizedAtBlock: string;
  retrievalVerified: true;
}>;
