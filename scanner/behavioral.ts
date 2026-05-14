// File: scanner/behavioral.ts
import { callCompute } from "./compute";

export interface BehavioralResult {
  behavioral_score: number;    // 0-100
  threat_level: 0 | 1 | 2;    // SAFE | CAUTION | FLAGGED
  reasoning: string;
  receipt_hash: string;
}

export interface AgentActivityData {
  address: string;
  transaction_count_30d: number;
  fund_outflow_pct: number;      // % of balance transferred out in 30d
  unique_contracts_called: number;
  max_single_transfer_pct: number; // % of balance in single tx
  call_frequency_spike: boolean;  // True if call rate anomalous
  recent_transactions: Array<{
    hash: string;
    value: string;
    to: string;
    timestamp: number;
  }>;
}

const BEHAVIORAL_SYSTEM_PROMPT = `You are a blockchain agent security auditor specializing in behavioral analysis of AI agents on 0G mainnet.

Analyze the provided agent activity data and classify the agent's behavioral risk.

Return a JSON object with these exact fields:
{
  "behavioral_score": <integer 0-100, where 100 is highest risk>,
  "threat_level": <"SAFE" | "CAUTION" | "FLAGGED">,
  "reasoning": <string, 1-2 sentences explaining the verdict>
}

Classification guidelines:
- SAFE (score 0-29): Normal agent behavior. No suspicious patterns.
- CAUTION (score 30-59): Some concerning patterns but not clearly malicious.
- FLAGGED (score 60-100): Clear anomaly detected. Fund drain, access control bypass, or abnormal call patterns.

Be conservative: only flag clear anomalies. Agents with low activity should default to CAUTION, not FLAGGED.`;

export async function runBehavioralAnalysis(
  activity: AgentActivityData
): Promise<BehavioralResult> {
  const userMessage = `Analyze this AI agent's behavioral risk on 0G mainnet:

Agent address: ${activity.address}
Activity window: Last 30 days
Transaction count: ${activity.transaction_count_30d}
Fund outflow: ${activity.fund_outflow_pct}% of balance transferred out
Max single transfer: ${activity.max_single_transfer_pct}% of balance in one transaction
Unique contracts called: ${activity.unique_contracts_called}
Call frequency spike detected: ${activity.call_frequency_spike}

Recent transactions (last 5):
${activity.recent_transactions
    .slice(0, 5)
    .map(
      (tx) =>
        `  - ${tx.hash.slice(0, 10)}... to ${tx.to.slice(0, 10)}... value: ${tx.value} at ${new Date(tx.timestamp * 1000).toISOString()}`
    )
    .join("\n")}

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
