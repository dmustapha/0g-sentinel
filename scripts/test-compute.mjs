// Quick live test of 0G Compute API — verifies receipt hash field location in response
import { config } from 'dotenv';
config();

const key = process.env.ZERO_G_COMPUTE_API_KEY;
const baseUrl = process.env.ZERO_G_COMPUTE_URL || 'https://router-api.0g.ai/v1';

if (!key) {
  console.error('ZERO_G_COMPUTE_API_KEY not set');
  process.exit(1);
}

console.log('[test-compute] Calling 0G Compute API...');
console.log('[test-compute] URL:', baseUrl + '/chat/completions');

const response = await fetch(baseUrl + '/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({
    model: '0GM-1.0-35B-A3B',
    messages: [
      { role: 'system', content: 'Respond with JSON only.' },
      { role: 'user', content: 'Return {"hello": "world"}' },
    ],
    response_format: { type: 'json_object' },
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: 64,
  }),
});

console.log('[test-compute] Status:', response.status, response.statusText);

// Log ALL response headers to find receipt hash location
console.log('\n[test-compute] === RESPONSE HEADERS ===');
for (const [k, v] of response.headers.entries()) {
  console.log(`  ${k}: ${v}`);
}

const data = await response.json();
console.log('\n[test-compute] === RESPONSE BODY ===');
console.log(JSON.stringify(data, null, 2));

// Check specific receipt hash locations
console.log('\n[test-compute] === RECEIPT HASH SEARCH ===');
console.log('data.usage?.receipt_hash:', data.usage?.receipt_hash);
console.log('data.usage?.compute_receipt:', data.usage?.compute_receipt);
console.log('x-receipt-hash header:', response.headers.get('x-receipt-hash'));
console.log('x-compute-receipt header:', response.headers.get('x-compute-receipt'));
console.log('x-compute-receipt-hash header:', response.headers.get('x-compute-receipt-hash'));
console.log('zg-res-key header:', response.headers.get('zg-res-key'));
