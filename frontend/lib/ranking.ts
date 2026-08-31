// File: frontend/lib/ranking.ts
// Threat-board ranking logic. Orders agents so the riskiest surface first — the core data
// behavior of the ProofLock risk leaderboard. Kept in the data layer so any UI inherits ranked
// data without re-implementing the sort.
//
// Two entry points share one risk model:
//   riskKey/rankByRisk    — legacy AgentWithAttestation shape (archived V1 attestations).
//   proofLockRiskKey/rankProofLocksByRisk — real sealed ProofLock V2 inventory records.
import { AgentWithAttestation } from "@/lib/types";
import type { ProofLockInventoryItem } from "@/lib/prooflock-types";

/**
 * Combined risk key for sorting. Higher = more dangerous.
 * - Unscanned agents rank last (-1).
 * - Otherwise the dominant risk level (max of behavioral threat_level and code_risk) leads,
 *   so a FLAGGED/VULNERABLE agent always outranks a CAUTION one regardless of score.
 * - Within a level, higher behavioral_score is more dangerous.
 */
export function riskKey(a: AgentWithAttestation): number {
  if (!a.has_attestation) return -1;
  const level = Math.max(a.threat_level, a.code_risk); // 0..2
  return level * 1000 + a.behavioral_score; // e.g. FLAGGED 95 => 2095, CAUTION 40 => 1040
}

/** Return a new array ranked by risk (riskiest first), tie-broken by most recently attested. */
export function rankByRisk(agents: AgentWithAttestation[]): AgentWithAttestation[] {
  return [...agents].sort((a, b) => {
    const rk = riskKey(b) - riskKey(a);
    if (rk !== 0) return rk;
    return b.attestation_timestamp - a.attestation_timestamp;
  });
}

// --- ProofLock V2 inventory ranking (real on-chain sealed-proof records) ---

/** Band a 0..100 behavioral score into the same 0/1/2 threat level the board colors by. */
export function behavioralLevel(behavioralScore: number): 0 | 1 | 2 {
  if (behavioralScore >= 70) return 2; // FLAGGED
  if (behavioralScore >= 34) return 1; // CAUTION
  return 0; // SAFE
}

/** Clamp the on-chain codeRisk field into the same 0/1/2 band (CLEAN / WARNING / VULNERABLE). */
export function codeRiskLevel(codeRisk: number): 0 | 1 | 2 {
  if (codeRisk >= 2) return 2;
  if (codeRisk === 1) return 1;
  return 0;
}

/**
 * Combined risk key for a sealed ProofLock record. Higher = more dangerous.
 * - Records without an enriched proofLock (enrichment unavailable) rank last (-1).
 * - Dominant risk level (max of behavioral band and code band) leads, so a FLAGGED/VULNERABLE
 *   agent always outranks a CAUTION one regardless of raw score.
 * - Within a level, higher behavioralScore is more dangerous.
 */
export function proofLockRiskKey(item: ProofLockInventoryItem): number {
  if (item.status !== "VERIFIED") return -1;
  const behavioral = item.proofLock.behavioralScore;
  const level = Math.max(behavioralLevel(behavioral), codeRiskLevel(item.proofLock.codeRisk));
  return level * 1000 + Math.max(0, Math.min(100, behavioral));
}

/**
 * Return a new array of sealed ProofLocks ranked by risk (riskiest first), tie-broken by
 * newest source block, then identity key — the same deterministic tie-break the inventory uses.
 */
export function rankProofLocksByRisk(
  items: readonly ProofLockInventoryItem[],
): ProofLockInventoryItem[] {
  return [...items].sort((left, right) => {
    const rk = proofLockRiskKey(right) - proofLockRiskKey(left);
    if (rk !== 0) return rk;
    const block = right.blockNumber - left.blockNumber;
    if (block !== 0) return block;
    return left.identityKey.toLowerCase().localeCompare(right.identityKey.toLowerCase());
  });
}
