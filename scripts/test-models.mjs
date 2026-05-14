// Test which models are available on 0G Compute
import { config } from 'dotenv';
config();

const key = process.env.ZERO_G_COMPUTE_API_KEY;
const baseUrl = process.env.ZERO_G_COMPUTE_URL || 'https://router-api.0g.ai/v1';

const modelsToTry = [
  'Qwen/Qwen2.5-72B-Instruct',
  'Qwen/Qwen2.5-7B-Instruct',
  'meta-llama/Meta-Llama-3.1-8B-Instruct',
  'meta-llama/Meta-Llama-3-8B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.3',
];

async function tryModel(model) {
  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      max_tokens: 10,
    }),
  });
  const data = await response.json();
  return { status: response.status, content: data.choices?.[0]?.message?.content || data.error?.message };
}

for (const model of modelsToTry) {
  process.stdout.write(`Testing ${model}... `);
  try {
    const result = await tryModel(model);
    console.log(`[${result.status}] ${result.content}`);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}
