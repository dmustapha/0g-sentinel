// File: scanner/code-scan.ts
import { callCompute } from "./compute";

export interface CodeScanResult {
  code_risk: 0 | 1 | 2;    // CLEAN | WARNING | VULNERABLE
  code_findings: string;    // e.g. "reentrancy at withdraw()" or ""
  receipt_hash: string;
}

const CODE_SCAN_SYSTEM_PROMPT = `You are a smart contract security auditor. Analyze Solidity source code for these specific vulnerabilities:

1. REENTRANCY: External calls before state updates. Pattern: .call() or .transfer() before balance/state change.
2. BROKEN ACCESS CONTROL: Missing onlyOwner/modifier on privileged functions.
3. UNPROTECTED SELFDESTRUCT: selfdestruct() callable by arbitrary addresses.
4. DANGEROUS DELEGATECALL: delegatecall() to user-controlled addresses.
5. INTEGER OVERFLOW: Arithmetic without SafeMath in Solidity <0.8.x (less relevant in 0.8.x but check).

Return a JSON object with these exact fields:
{
  "code_risk": <"CLEAN" | "WARNING" | "VULNERABLE">,
  "code_findings": <string — specific vulnerability with function name, or "" if clean>
}

Classification:
- CLEAN: No vulnerabilities found.
- WARNING: Potential issue that may be intentional or low-impact (e.g., missing event, centralization risk).
- VULNERABLE: Clear, exploitable vulnerability found. Be specific: name the function and the pattern.

Examples of code_findings:
- "reentrancy at withdraw(): external .call() before balance update"
- "broken access control: setOwner() has no modifier"
- "unprotected selfdestruct in kill()"
- "" (for CLEAN)`;

export async function runCodeScan(
  agentAddress: string,
  contractSource: string
): Promise<CodeScanResult> {
  if (!contractSource || contractSource.length < 20) {
    // No source code available — return WARNING
    return {
      code_risk: 1,
      code_findings: "Contract source not available for analysis",
      receipt_hash: "0x" + "0".repeat(64),
    };
  }

  const userMessage = `Analyze this smart contract for security vulnerabilities:

Contract address: ${agentAddress}
Solidity source code:
\`\`\`solidity
${contractSource.slice(0, 6000)}
\`\`\`

Return JSON with code_risk and code_findings.`;

  const result = await callCompute(CODE_SCAN_SYSTEM_PROMPT, userMessage);

  let parsed: { code_risk: string; code_findings: string };
  try {
    parsed = JSON.parse(result.content);
  } catch {
    throw new Error(`Failed to parse 0G Compute code scan response: ${result.content}`);
  }

  const codeRiskMap: Record<string, 0 | 1 | 2> = {
    CLEAN: 0,
    WARNING: 1,
    VULNERABLE: 2,
  };
  const code_risk = codeRiskMap[parsed.code_risk] ?? 1;

  return {
    code_risk,
    code_findings: parsed.code_findings || "",
    receipt_hash: result.receipt_hash,
  };
}
