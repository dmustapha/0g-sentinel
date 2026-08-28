import type { GateReasonCode, LeaseStatus, ProofLockDetail, ProofLockRecord } from "./prooflock-types";

export function admittedConsumerState(record: Pick<ProofLockRecord, "subject" | "version">,
  gate: ProofLockDetail["gate"], consumer: ProofLockDetail["consumer"], expectedSubject: string): boolean {
  return gate.status === "VERIFIED" && gate.allowed && gate.reason === 0 &&
    consumer.status === "VERIFIED" && consumer.accepted &&
    same(record.subject, expectedSubject, gate.subject, consumer.subject) &&
    gate.version === record.version && consumer.version === record.version;
}

function same(...values: readonly string[]): boolean { return values.every((value) => value.toLowerCase() === values[0]?.toLowerCase()); }

const EXPIRING_WINDOW_SECONDS = 24 * 60 * 60;

const GATE_REASONS: Readonly<Record<number, Readonly<{ code: GateReasonCode; label: string }>>> = {
  0: { code: "ALLOWED", label: "Allowed" },
  1: { code: "NO_PROOF", label: "No ProofLock" },
  2: { code: "REVOKED", label: "Revoked" },
  3: { code: "DRIFTED", label: "Drift detected" },
  4: { code: "EXPIRED", label: "Lease expired" },
  5: { code: "SUBJECT_CHANGED", label: "Agent wallet changed" },
  6: { code: "RUNTIME_CODE_DRIFT", label: "Runtime code drift" },
  7: { code: "POLICY_TOO_OLD", label: "Policy too old" },
  8: { code: "COVERAGE_INCOMPLETE", label: "Coverage incomplete" },
  9: { code: "COMPUTE_UNVERIFIED", label: "Compute unverified" },
  10: { code: "STORAGE_UNVERIFIED", label: "Storage unverified" },
  11: { code: "BEHAVIORAL_RISK", label: "Behavioral policy denied" },
  12: { code: "CODE_RISK", label: "Code policy denied" },
  13: { code: "IDENTITY_UNAVAILABLE", label: "Identity unavailable" },
  14: { code: "AGENT_NOT_FOUND", label: "Agent not found" },
  15: { code: "AGENT_WALLET_UNSET", label: "Agent wallet unset" },
  16: { code: "IDENTITY_MISMATCH", label: "Identity mismatch" },
};

export function gateReasonMeta(reason: number) {
  const match = GATE_REASONS[reason] ?? { code: "UNKNOWN_REASON" as const, label: "Unknown Gate reason" };
  return Object.freeze({ ...match, allowed: reason === 0, reason });
}

export function leaseStatus(lock: ProofLockRecord, nowSeconds = Math.floor(Date.now() / 1000)): LeaseStatus {
  if (lock.state === 3) return "DRIFTED";
  if (lock.state === 2) return "REVOKED";
  if (lock.coverage !== 0x7f || lock.state !== 1) return "INCOMPLETE";
  const validUntil = safeSeconds(lock.validUntil);
  if (validUntil <= nowSeconds) return "EXPIRED";
  return validUntil - nowSeconds <= EXPIRING_WINDOW_SECONDS ? "EXPIRING" : "ACTIVE";
}

export function proofLockUrgency(lock: ProofLockRecord, nowSeconds = Math.floor(Date.now() / 1000)): number {
  const status = leaseStatus(lock, nowSeconds);
  return ({ DRIFTED: 0, REVOKED: 1, EXPIRED: 2, EXPIRING: 2, INCOMPLETE: 3, ACTIVE: 4 } as const)[status];
}

const COVERAGE_ITEMS = [
  [0x01, "ERC-8004 identity"], [0x02, "Subject classification"],
  [0x04, "Deterministic checks"], [0x08, "Behavioral Compute"],
  [0x10, "Code Compute / N/A"], [0x20, "Evidence Storage"],
  [0x40, "Policy evaluation"],
] as const;

export function coverageItems(mask: number) {
  return COVERAGE_ITEMS.map(([bit, label]) => Object.freeze({ bit, label, covered: (mask & bit) === bit }));
}

export function verificationSummary(input: Readonly<{
  historicalMatch: boolean;
  lease: LeaseStatus;
  gateReason: number;
}>) {
  const gate = gateReasonMeta(input.gateReason);
  const admitted = input.lease === "ACTIVE" && gate.allowed;
  return Object.freeze({ historical: input.historicalMatch ? "MATCH" as const : "MISMATCH" as const,
    current: admitted ? "ADMITTED" as const : "BLOCKED" as const, admitted });
}

function safeSeconds(value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}
