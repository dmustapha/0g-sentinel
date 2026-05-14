// Quick test of code vulnerability scan pipeline
import { config } from 'dotenv';
config();

const key = process.env.ZERO_G_COMPUTE_API_KEY;
const baseUrl = process.env.ZERO_G_COMPUTE_URL || 'https://router-api.0g.ai/v1';

const SYSTEM_PROMPT = `You are a smart contract security auditor. Analyze Solidity source code for these specific vulnerabilities:

1. REENTRANCY: External calls before state updates. Pattern: .call() or .transfer() before balance/state change.
2. BROKEN ACCESS CONTROL: Missing onlyOwner/modifier on privileged functions.
3. UNPROTECTED SELFDESTRUCT: selfdestruct() callable by arbitrary addresses.
4. DANGEROUS DELEGATECALL: delegatecall() to user-controlled addresses.
5. INTEGER OVERFLOW: Arithmetic without SafeMath in Solidity <0.8.x (less relevant in 0.8.x but check).

Return a JSON object with these exact fields:
{
  "code_risk": <"CLEAN" | "WARNING" | "VULNERABLE">,
  "code_findings": <string — specific vulnerability with function name, or "" if clean>
}`;

const vulnerableContract = `
pragma solidity ^0.7.0;
contract AgentB {
  mapping(address => uint256) public balances;
  function deposit() external payable { balances[msg.sender] += msg.value; }
  function withdraw() external {
    uint256 amount = balances[msg.sender];
    (bool ok,) = msg.sender.call{value: amount}("");  // reentrancy: external call before state update
    require(ok);
    balances[msg.sender] = 0;  // state update AFTER call = reentrancy vulnerability
  }
}`;

const userMessage = `Analyze this smart contract for security vulnerabilities:

Contract address: 0xBBBB000000000000000000000000000000000002
Solidity source code:
\`\`\`solidity
${vulnerableContract}
\`\`\`

Return JSON with code_risk and code_findings.`;

console.log('[test-codescan] Calling 0G Compute for code scan...');

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

console.log('[test-codescan] Status:', response.status);

const zgResKey = response.headers.get('zg-res-key');
console.log('[test-codescan] zg-res-key:', zgResKey);
const receiptHash = zgResKey ? '0x' + zgResKey.replace(/-/g, '').padEnd(64, '0') : null;
console.log('[test-codescan] receipt_hash (bytes32):', receiptHash);

const data = await response.json();
const content = data.choices?.[0]?.message?.content || '';
console.log('\n[test-codescan] Raw content:', content);

try {
  const parsed = JSON.parse(content);
  console.log('\n[test-codescan] PARSED RESULT:');
  console.log('  code_risk:', parsed.code_risk);
  console.log('  code_findings:', parsed.code_findings);
} catch (e) {
  console.error('[test-codescan] JSON parse failed:', e.message);
}
