// File: frontend/lib/ranking.ts
// D3 (threat board) ranking logic. Orders agents so the riskiest surface first — the core
// data behavior of "0G Agent Watch". Kept in the data layer so any UI (current table or the
// redesigned board) inherits ranked data without re-implementing the sort.
import { AgentWithAttestation } from "@/lib/types";

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
