// File: scanner/behavioral-seed.ts
// Pre-computed behavioral signal profiles for 0G Sentinel demo agents.
// Derived using the agent-auditor signal methodology: method concentration,
// timing regularity CV, hour entropy, counterparty HHI, nonce gap rate,
// and value entropy — replacing the naive 5-block raw data approach.

export interface BehavioralSignals {
  address: string;
  // Volume
  tx_count_30d: number;
  tx_count_7d: number;
  // Fund flow
  fund_outflow_pct: number;        // % of total balance transferred out
  max_single_transfer_pct: number; // largest single tx as % of balance
  // Pattern signals
  method_concentration: number;    // 0-1: 1 = always same selector (machine)
  timing_regularity_cv: number;    // coefficient of variation; low = mechanical regularity
  hour_entropy: number;            // Shannon entropy of hour-of-day distribution; high = spread (human)
  counterparty_herfindahl: number; // HHI of counterparties; high = concentrated to one target
  nonce_gap_rate: number;          // fraction of nonce slots with gaps; 0 = fully continuous (bot)
  value_entropy: number;           // Shannon entropy of value sizes; low = uniform (automated)
  // Anomaly flags
  call_frequency_spike: boolean;
  large_outflow_detected: boolean;
  burst_detected: boolean;
}

// Seed profiles for the three demo agents.
const SEED_PROFILES: Record<string, BehavioralSignals> = {
  // Agent Alpha — SAFE
  // Diverse method calls, low outflow, irregular human-like timing, many counterparties.
  "0xaaaa000000000000000000000000000000000001": {
    address: "0xAAaA000000000000000000000000000000000001",
    tx_count_30d: 28,
    tx_count_7d: 6,
    fund_outflow_pct: 12,
    max_single_transfer_pct: 4,
    method_concentration: 0.18,
    timing_regularity_cv: 0.82,
    hour_entropy: 3.2,
    counterparty_herfindahl: 0.09,
    nonce_gap_rate: 0.14,
    value_entropy: 2.9,
    call_frequency_spike: false,
    large_outflow_detected: false,
    burst_detected: false,
  },

  // Agent Beta — FLAGGED
  // Machine-precision method concentration, near-total fund drain, single-counterparty,
  // continuous nonce sequence (no gaps), extremely regular sub-second timing intervals.
  "0xbbbb000000000000000000000000000000000002": {
    address: "0xBbbb000000000000000000000000000000000002",
    tx_count_30d: 147,
    tx_count_7d: 89,
    fund_outflow_pct: 94,
    max_single_transfer_pct: 31,
    method_concentration: 0.97,
    timing_regularity_cv: 0.04,
    hour_entropy: 0.8,
    counterparty_herfindahl: 0.91,
    nonce_gap_rate: 0.0,
    value_entropy: 0.3,
    call_frequency_spike: true,
    large_outflow_detected: true,
    burst_detected: true,
  },

  // Agent Gamma — CAUTION
  // Burst-pattern activity, elevated outflow, moderate method concentration.
  // Not clearly malicious but shows coordinated short-window behavior.
  "0xcccc000000000000000000000000000000000003": {
    address: "0xccCc000000000000000000000000000000000003",
    tx_count_30d: 67,
    tx_count_7d: 52,
    fund_outflow_pct: 38,
    max_single_transfer_pct: 18,
    method_concentration: 0.51,
    timing_regularity_cv: 0.28,
    hour_entropy: 2.1,
    counterparty_herfindahl: 0.43,
    nonce_gap_rate: 0.12,
    value_entropy: 1.6,
    call_frequency_spike: true,
    large_outflow_detected: false,
    burst_detected: true,
  },
};

/** Returns the seeded behavioral profile for a known demo agent, or null for unknown addresses. */
export function getSeedProfile(address: string): BehavioralSignals | null {
  return SEED_PROFILES[address.toLowerCase()] ?? null;
}
