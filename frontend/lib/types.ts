// File: frontend/lib/types.ts
export interface AgentWithAttestation {
  address: string;
  name: string;
  behavioral_score: number;
  threat_level: 0 | 1 | 2;
  code_risk: 0 | 1 | 2;
  code_findings: string;
  behavioral_receipt_hash: string;
  code_receipt_hash: string;
  evidence_hash: string;
  attestation_timestamp: number;
  has_attestation: boolean;
}

export interface AttestationData {
  agentAddress: string;
  behavioralScore: number;
  threatLevel: number;
  codeRisk: number;
  codeFindings: string;
  reasoning: string;
  behavioralReceiptHash: string;
  codeReceiptHash: string;
  evidenceHash: string;
  attestationTimestamp: number;
}

export const THREAT_LABELS = ["SAFE", "CAUTION", "FLAGGED"] as const;
export const CODE_RISK_LABELS = ["CLEAN", "WARNING", "VULNERABLE"] as const;

// Tailwind class arrays — indexed by threat_level / code_risk (0 | 1 | 2)
export const THREAT_COLORS = ["text-green-500", "text-yellow-500", "text-red-500"] as const;
export const CODE_RISK_COLORS = ["text-green-500", "text-yellow-500", "text-red-500"] as const;
export const THREAT_BG = ["bg-green-100", "bg-yellow-100", "bg-red-100"] as const;
export const CODE_RISK_BG = ["bg-green-100", "bg-yellow-100", "bg-red-100"] as const;
