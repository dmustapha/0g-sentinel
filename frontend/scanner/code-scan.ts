// File: scanner/code-scan.ts
import { callCompute } from "./compute";
import { analyzeSolidity, type StaticAnalysisResult } from "./static-analysis";

export interface CodeScanResult {
  code_risk: 0 | 1 | 2;    // CLEAN | WARNING | VULNERABLE — max(LLM, deterministic)
  code_findings: string;    // e.g. "reentrancy at withdraw()" or ""
  receipt_hash: string;
  // Deterministic static-analysis result. This is the non-LLM evidence spine: the code
  // audit is not "an LLM reading Solidity twice" but an LLM cross-checked against fixed
  // vulnerability rules with a reproducible ground truth. Absent on the no-source path.
  static_analysis?: StaticAnalysisResult;
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

/**
 * Pipeline 2: Smart contract vulnerability scan via 0G Compute.
 * Sends Solidity source to the LLM auditor and returns a risk level
 * (CLEAN/WARNING/VULNERABLE), specific findings, and a 0G Compute receipt hash.
 * Returns WARNING with a placeholder if no source is available.
 */
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

  if (contractSource.length > 6000) {
    console.warn(
      `[CodeScan] Contract source truncated from ${contractSource.length} to 6000 chars for ${agentAddress}`
    );
  }

  const userMessage = `Analyze this smart contract for security vulnerabilities:

Contract address: ${agentAddress}
Solidity source code:
\`\`\`solidity
${contractSource.slice(0, 6000)}
\`\`\`

Return JSON with code_risk and code_findings.`;

  // Deterministic pass runs independently of the LLM (no shared input, no prompt hint) so
  // the two audits are genuinely independent methods, not two prompts to one model.
  const staticResult = analyzeSolidity(contractSource);

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
  const llmRisk = codeRiskMap[parsed.code_risk] ?? 1;

  // Deterministic floor: a fixed-rule finding cannot be argued away by the model.
  const code_risk = (Math.max(llmRisk, staticResult.risk) as 0 | 1 | 2);

  // Merge both audits, deterministic first (it is the ground truth), within the 500-byte
  // on-chain MAX_FINDINGS_BYTES limit. Byte-safe: findings are ASCII descriptions.
  const llmFindings = (parsed.code_findings || "").trim();
  const merged = staticResult.findings.length
    ? `Static: ${staticResult.summary}` + (llmFindings ? ` | AI: ${llmFindings}` : "")
    : llmFindings;
  const code_findings = merged.slice(0, 500);

  return {
    code_risk,
    code_findings,
    receipt_hash: result.receipt_hash,
    static_analysis: staticResult,
  };
}
