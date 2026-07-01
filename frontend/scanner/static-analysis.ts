// File: scanner/static-analysis.ts
// Deterministic Solidity static-analysis pass. NO LLM, NO network — a pure function
// over the source text. This is the evidence spine that makes the code audit more than
// "an LLM reading Solidity": known vulnerability patterns are detected by fixed rules,
// so a VULNERABLE verdict has a reproducible, non-model ground truth behind it.

export type StaticSeverity = "info" | "warning" | "vulnerable";

export interface StaticFinding {
  id: string;
  title: string;
  severity: StaticSeverity;
  functionName: string;
  evidence: string;
}

export interface StaticAnalysisResult {
  risk: 0 | 1 | 2; // CLEAN | WARNING | VULNERABLE — max severity across findings
  findings: StaticFinding[];
  checksRun: string[]; // every rule evaluated, so "no finding" is provable coverage, not a gap
  summary: string; // compact human-readable findings line
}

const CHECKS = [
  "reentrancy",
  "unprotected-selfdestruct",
  "tx-origin-auth",
  "arbitrary-external-call",
  "unchecked-low-level-call",
];

const SEVERITY_RISK: Record<StaticSeverity, 0 | 1 | 2> = { info: 0, warning: 1, vulnerable: 2 };

/** Remove line and block comments so pattern rules never match commentary. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

interface FnBlock {
  name: string;
  header: string;
  body: string;
  lines: string[];
}

/** Split source into function blocks via brace matching. */
function extractFunctions(src: string): FnBlock[] {
  const fns: FnBlock[] = [];
  const re = /function\s+(\w+)\s*\(([^)]*)\)([^{;]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const bodyStart = re.lastIndex;
    let depth = 1;
    let i = bodyStart;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    const body = src.slice(bodyStart, i - 1);
    fns.push({ name: m[1], header: m[0] + m[3], body, lines: body.split("\n") });
  }
  return fns;
}

/** True when the function guards on ownership/role (modifier or msg.sender check). */
function isAccessControlled(fn: FnBlock): boolean {
  if (/\bonly[A-Z]\w*/.test(fn.header)) return true;
  return /require\s*\(\s*msg\.sender\s*==/.test(fn.body) || /_msgSender\(\)\s*==\s*owner/.test(fn.body);
}

const VALUE_CALL = /\.call\s*\{\s*value|\.transfer\s*\(|\.send\s*\(/;
const STATE_WRITE = /(\w+\s*\[[^\]]*\]|\b\w+(\.\w+)?)\s*(=|\+=|-=)\s*[^=]/;
const LOCAL_DECL = /^\s*(uint\d*|int\d*|bool|address|bytes\d*|string|mapping|\(|var\b)/;

function checkReentrancy(fn: FnBlock): StaticFinding | null {
  const call = VALUE_CALL.exec(fn.body);
  if (!call) return null;
  // A state write anywhere AFTER the external value call (same line or later) is a
  // checks-effects-interactions violation. Split the remainder into statements.
  const after = fn.body.slice(call.index + call[0].length);
  for (const stmt of after.split(/[;\n]/)) {
    if (LOCAL_DECL.test(stmt)) continue;
    if (STATE_WRITE.test(stmt)) {
      return {
        id: "reentrancy",
        title: "Reentrancy: state updated after an external value transfer (CEI violation)",
        severity: "vulnerable",
        functionName: fn.name,
        evidence: call[0].trim().slice(0, 80),
      };
    }
  }
  return null;
}

function checkSelfdestruct(fn: FnBlock): StaticFinding | null {
  if (!/\b(selfdestruct|suicide)\s*\(/.test(fn.body)) return null;
  const controlled = isAccessControlled(fn);
  return {
    id: "unprotected-selfdestruct",
    title: controlled ? "selfdestruct present (owner-gated)" : "Unprotected selfdestruct callable by anyone",
    severity: controlled ? "warning" : "vulnerable",
    functionName: fn.name,
    evidence: "selfdestruct(...)",
  };
}

function checkTxOrigin(fn: FnBlock): StaticFinding | null {
  if (!/tx\.origin/.test(fn.body)) return null;
  return {
    id: "tx-origin-auth",
    title: "tx.origin used in logic (phishing-prone authorization)",
    severity: "warning",
    functionName: fn.name,
    evidence: "tx.origin",
  };
}

/** External call/delegatecall whose target is a parameter or variable, not a constant. */
function checkArbitraryCall(fn: FnBlock): StaticFinding | null {
  const delegate = /(\w+)\.delegatecall\s*\(/.exec(fn.body);
  // Only plain .call(data) (no value) — value-bearing calls are the reentrancy sink, handled above.
  const rawCall = /(\w+)\.call\s*\(/.exec(fn.body);
  const hit = delegate || rawCall;
  if (!hit) return null;
  const target = hit[1];
  if (["msg", "sender", "address", "this"].includes(target)) return null; // msg.sender.call etc. handled elsewhere
  const controlled = isAccessControlled(fn);
  const isDelegate = Boolean(delegate);
  return {
    id: "arbitrary-external-call",
    title: `${isDelegate ? "delegatecall" : "External call"} to a dynamic target '${target}'${controlled ? " (owner-gated)" : ""}`,
    severity: isDelegate ? "vulnerable" : controlled ? "warning" : "vulnerable",
    functionName: fn.name,
    evidence: `${target}.${isDelegate ? "delegatecall" : "call"}(...)`,
  };
}

function checkUncheckedCall(fn: FnBlock): StaticFinding | null {
  for (const l of fn.lines) {
    if (!/\.call\s*(\{[^}]*\})?\s*\(/.test(l)) continue;
    const captured = /\(\s*bool\s+\w+/.test(l) || /=\s*[\w.]+\.call/.test(l);
    if (!captured) {
      return {
        id: "unchecked-low-level-call",
        title: "Low-level .call() return value not checked",
        severity: "warning",
        functionName: fn.name,
        evidence: l.trim().slice(0, 80),
      };
    }
  }
  return null;
}

/**
 * Run every deterministic rule over the contract source and return the combined result.
 * Findings are de-duplicated by (id, functionName); risk is the max severity found.
 */
export function analyzeSolidity(source: string): StaticAnalysisResult {
  const clean = stripComments(source || "");
  const fns = extractFunctions(clean);
  const rules = [checkReentrancy, checkSelfdestruct, checkTxOrigin, checkArbitraryCall, checkUncheckedCall];

  const findings: StaticFinding[] = [];
  const seen = new Set<string>();
  for (const fn of fns) {
    for (const rule of rules) {
      const f = rule(fn);
      if (f && !seen.has(f.id + f.functionName)) {
        seen.add(f.id + f.functionName);
        findings.push(f);
      }
    }
  }

  const risk = findings.reduce<0 | 1 | 2>((max, f) => {
    const r = SEVERITY_RISK[f.severity];
    return r > max ? r : max;
  }, 0);

  const summary = findings.length
    ? findings.map((f) => `${f.functionName}(): ${f.title}`).join("; ")
    : "no known-pattern vulnerabilities detected";

  return { risk, findings, checksRun: CHECKS, summary };
}
