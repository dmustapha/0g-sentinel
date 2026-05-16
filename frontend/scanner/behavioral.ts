// File: scanner/behavioral.ts
import { callCompute } from "./compute";
import { BehavioralSignals } from "./behavioral-seed";

export type { BehavioralSignals };

export interface BehavioralResult {
  behavioral_score: number;    // 0-100
  threat_level: 0 | 1 | 2;    // SAFE | CAUTION | FLAGGED
  reasoning: string;
  receipt_hash: string;
}

// Legacy alias — kept so scanner.ts can still import AgentActivityData by name
// without a breaking change to internal call sites. New code should use BehavioralSignals.
export type AgentActivityData = BehavioralSignals;

const BEHAVIORAL_SYSTEM_PROMPT = `You are a blockchain agent security auditor specializing in behavioral analysis of AI agents on 0G mainnet.

You are given pre-computed behavioral signals derived from the agent's full 30-day transaction history. Synthesize these signals into a risk verdict.

Signal interpretation:
- method_concentration (0–1): 1 = always the same contract method selector (machine precision); 0 = diverse calls (human/normal)
- timing_regularity_cv: coefficient of variation of inter-transaction intervals; near-0 = machine-regular (suspicious); >0.5 = human-irregular (normal)
- hour_entropy (0–3.58 bits): high = spread across all hours (normal); low = narrow time window (automated)
- counterparty_herfindahl (0–1): 1 = all funds to one address (drain target); <0.2 = diverse interactions (normal)
- nonce_gap_rate: 0 = no gaps (fully automated, continuous); >0.1 = human gaps (normal)
- value_entropy: high = varied amounts (normal); near-0 = identical amounts per transaction (automated)
- fund_outflow_pct: >80% is critical drain behavior; 30–79% elevated; <30% normal
- max_single_transfer_pct: >25% in one transaction is a red flag

FLAGGED pattern: high method_concentration + low timing_regularity_cv + high fund_outflow_pct + high counterparty_herfindahl = automated fund drain.
SAFE pattern: low method_concentration + high timing_regularity_cv + low fund_outflow_pct + low counterparty_herfindahl.

Return a JSON object with these exact fields:
{
  "behavioral_score": <integer 0-100, where 100 is highest risk>,
  "threat_level": <"SAFE" | "CAUTION" | "FLAGGED">,
  "reasoning": <string, 2-3 sentences in plain English for a non-technical user. Describe what the agent's behavior looks like and why it is safe, risky, or unknown. Do NOT mention metric names (method_concentration, timing_regularity_cv, counterparty_herfindahl, HHI, CV, hour_entropy, nonce_gap_rate, value_entropy) or raw numeric values. Do NOT include data source labels like "ARCHETYPE MODEL" or "no_history". Write naturally: e.g. "This agent shows varied, human-like transaction patterns with no signs of fund draining or automation.", "No transaction history found yet, so safety cannot be confirmed.", "Suspicious activity detected: funds are moving repeatedly to a single address with machine-like precision.">
}

Classification:
- SAFE (0-29): Normal behavioral signals across the board.
- CAUTION (30-59): One or more signals are elevated but the full pattern is ambiguous.
- FLAGGED (60-100): Multiple signals align to a clear anomaly pattern (drain, bot, or takeover).`;

/**
 * Pipeline 1: Behavioral analysis via 0G Compute.
 * Sends pre-computed on-chain signals to the LLM and returns a risk verdict
 * (SAFE/CAUTION/FLAGGED), a 0-100 score, LLM reasoning, and a 0G Compute receipt hash.
 */
export async function runBehavioralAnalysis(
  signals: BehavioralSignals
): Promise<BehavioralResult> {
  const dataSourceNote =
    signals.data_source === "chain_history"
      ? `Data source: LIVE 0G chain history (${signals.tx_count_analyzed} real transactions analyzed)`
      : signals.data_source === "limited_history"
      ? `Data source: PARTIAL 0G chain history (${signals.tx_count_analyzed} txs found in recent blocks; some signals estimated)`
      : signals.data_source === "no_history"
      ? `Data source: NO HISTORY — zero outgoing transactions found. This agent has no verifiable on-chain activity. Absence of history is NOT a safety signal — treat this as UNKNOWN/CAUTION, not SAFE.`
      : `Data source: ARCHETYPE MODEL (demo scenario — not real on-chain history)`;

  const userMessage = `Analyze these pre-computed behavioral signals for AI agent ${signals.address}.

${dataSourceNote}

Transaction volume (30-day window):
  Total transactions: ${signals.tx_count_30d}
  Last 7-day transactions: ${signals.tx_count_7d}

Fund flow:
  Outflow as % of balance: ${signals.fund_outflow_pct}%
  Largest single transfer: ${signals.max_single_transfer_pct}% of balance
  Large outflow flag: ${signals.large_outflow_detected}

Behavioral pattern signals:
  Method concentration (0=diverse, 1=always same): ${signals.method_concentration.toFixed(2)}
  Timing regularity CV (0=machine, >0.5=human): ${signals.timing_regularity_cv.toFixed(2)}
  Hour entropy bits (high=spread): ${signals.hour_entropy.toFixed(1)}
  Counterparty HHI (0=diverse, 1=single target): ${signals.counterparty_herfindahl.toFixed(2)}
  Nonce gap rate (0=continuous bot, >0.1=human): ${signals.nonce_gap_rate.toFixed(2)}
  Value entropy bits (low=uniform amounts): ${signals.value_entropy.toFixed(1)}

Anomaly flags:
  Call frequency spike: ${signals.call_frequency_spike}
  Burst activity detected: ${signals.burst_detected}

Return JSON with behavioral_score, threat_level, and reasoning. Write the reasoning in plain English for a non-technical user. No metric names, no raw numbers. Just describe what the behavior looks like and why it is safe, risky, or unknown.`;

  const result = await callCompute(BEHAVIORAL_SYSTEM_PROMPT, userMessage);

  let parsed: { behavioral_score: number; threat_level: string; reasoning: string };
  try {
    parsed = JSON.parse(result.content);
  } catch {
    throw new Error(`Failed to parse 0G Compute behavioral response: ${result.content}`);
  }

  const threatLevelMap: Record<string, 0 | 1 | 2> = {
    SAFE: 0,
    CAUTION: 1,
    FLAGGED: 2,
  };
  const raw_level = threatLevelMap[parsed.threat_level] ?? 1;
  let behavioral_score = Math.min(100, Math.max(0, Math.round(parsed.behavioral_score)));

  // Cross-validate score and threat_level — the LLM can produce contradictory values.
  // Clamp score into the correct range for the declared threat level:
  //   SAFE (0):    score must be 0-29
  //   CAUTION (1): score must be 30-59
  //   FLAGGED (2): score must be 60-100
  let threat_level = raw_level;
  if (raw_level === 2 && behavioral_score < 60) behavioral_score = 60;
  else if (raw_level === 1 && behavioral_score < 30) behavioral_score = 30;
  else if (raw_level === 1 && behavioral_score >= 60) behavioral_score = 59;
  else if (raw_level === 0 && behavioral_score >= 60) threat_level = 2;  // score says FLAGGED, trust score
  else if (raw_level === 0 && behavioral_score >= 30) threat_level = 1;  // SAFE label but CAUTION score → upgrade

  // Truncate reasoning to MAX_REASONING_BYTES (1000) — matching the on-chain contract limit.
  const reasoning = (parsed.reasoning || "").slice(0, 1000);

  return {
    behavioral_score,
    threat_level,
    reasoning,
    receipt_hash: result.receipt_hash,
  };
}
