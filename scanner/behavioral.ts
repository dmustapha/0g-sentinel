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
  "reasoning": <string, 2-3 sentences citing specific signal values that drove the verdict>
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
  const userMessage = `Analyze these pre-computed behavioral signals for AI agent ${signals.address}:

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

Return JSON with behavioral_score, threat_level, and reasoning.`;

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
  const threat_level = threatLevelMap[parsed.threat_level] ?? 1;

  return {
    behavioral_score: Math.min(100, Math.max(0, Math.round(parsed.behavioral_score))),
    threat_level,
    reasoning: parsed.reasoning || "",
    receipt_hash: result.receipt_hash,
  };
}
