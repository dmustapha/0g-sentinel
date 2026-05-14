// Quick test of behavioral analysis pipeline
import { config } from 'dotenv';
config();

// Inline the behavioral analysis call using the fixed compute module
const key = process.env.ZERO_G_COMPUTE_API_KEY;
const baseUrl = process.env.ZERO_G_COMPUTE_URL || 'https://router-api.0g.ai/v1';

const SYSTEM_PROMPT = `You are a blockchain agent security auditor specializing in behavioral analysis of AI agents on 0G mainnet.

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

const userMessage = `Analyze this AI agent's behavioral risk on 0G mainnet:

Agent address: 0xAAAA000000000000000000000000000000000001
Activity window: Last 30 days
Transaction count: 3
Fund outflow: 95% of balance transferred out
Max single transfer: 90% of balance in one transaction
Unique contracts called: 1
Call frequency spike detected: false

Recent transactions (last 5):
  - 0x123abc... to 0xDeadBeef... value: 1.5 at 2026-05-10T12:00:00.000Z

Return JSON with behavioral_score, threat_level, and reasoning.`;

console.log('[test-behavioral] Calling 0G Compute for behavioral analysis...');

const response = await fetch(baseUrl + '/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: '0GM-1.0-35B-A3B',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: 1024,
  }),
});

console.log('[test-behavioral] Status:', response.status);

const zgResKey = response.headers.get('zg-res-key');
console.log('[test-behavioral] zg-res-key:', zgResKey);
const receiptHash = zgResKey ? '0x' + zgResKey.replace(/-/g, '').padEnd(64, '0') : null;
console.log('[test-behavioral] receipt_hash (bytes32):', receiptHash);

const data = await response.json();
const content = data.choices?.[0]?.message?.content || '';
console.log('\n[test-behavioral] Raw content:', content);

try {
  const parsed = JSON.parse(content);
  console.log('\n[test-behavioral] PARSED RESULT:');
  console.log('  behavioral_score:', parsed.behavioral_score);
  console.log('  threat_level:', parsed.threat_level);
  console.log('  reasoning:', parsed.reasoning);
} catch (e) {
  console.error('[test-behavioral] JSON parse failed:', e.message);
}
