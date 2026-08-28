export type StaticSeverity = "info" | "warning" | "vulnerable";

export interface StaticFinding {
  id: string;
  title: string;
  severity: StaticSeverity;
  functionName: string;
  evidence: string;
}

export interface StaticAnalysisResult {
  risk: 0 | 1 | 2;
  findings: StaticFinding[];
  checksRun: string[];
  summary: string;
}

export interface SourcePatternAnalysis {
  engine: "solidity-source-pattern-analysis-v1";
  method: "REGEX_AND_BRACE_MATCHING";
  admissionImpact: "INFORMATIONAL_ONLY";
  signalLevel: 0 | 1 | 2;
  findings: StaticFinding[];
  checksRun: string[];
  summary: string;
}

const LEGACY_CHECKS = [
  "reentrancy",
  "unprotected-selfdestruct",
  "tx-origin-auth",
  "arbitrary-external-call",
  "unchecked-low-level-call",
];

const PROOFLOCK_CHECKS = [
  "privileged-admin-signal",
  "delegatecall-signal",
  "unprotected-selfdestruct",
  "unchecked-low-level-call",
  "arbitrary-external-call",
  "reentrancy-pattern",
  "tx-origin-auth",
];

const SEVERITY_RISK: Record<StaticSeverity, 0 | 1 | 2> = {
  info: 0,
  warning: 1,
  vulnerable: 2,
};

interface FnBlock {
  name: string;
  header: string;
  body: string;
  lines: string[];
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function extractFunctions(source: string): FnBlock[] {
  const functions: FnBlock[] = [];
  const matcher = /function\s+(\w+)\s*\(([^)]*)\)([^{;]*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) !== null) {
    const start = matcher.lastIndex;
    let depth = 1;
    let cursor = start;
    for (; cursor < source.length && depth > 0; cursor++) {
      if (source[cursor] === "{") depth++;
      if (source[cursor] === "}") depth--;
    }
    const body = source.slice(start, cursor - 1);
    functions.push({ name: match[1], header: match[0], body, lines: body.split("\n") });
  }
  return functions;
}

function isAccessControlled(fn: FnBlock): boolean {
  return /\bonly[A-Z]\w*/.test(fn.header)
    || /require\s*\(\s*msg\.sender\s*==/.test(fn.body)
    || /_msgSender\(\)\s*==\s*owner/.test(fn.body);
}

const VALUE_CALL = /\.call\s*\{\s*value|\.transfer\s*\(|\.send\s*\(/;
const STATE_WRITE = /(\w+\s*\[[^\]]*\]|\b\w+(\.\w+)?)\s*(=|\+=|-=)\s*[^=]/;
const LOCAL_DECL = /^\s*(uint\d*|int\d*|bool|address|bytes\d*|string|mapping|\(|var\b)/;

function finding(
  id: string,
  title: string,
  severity: StaticSeverity,
  fn: FnBlock,
  evidence: string,
): StaticFinding {
  return { id, title, severity, functionName: fn.name, evidence };
}

function checkReentrancy(fn: FnBlock): StaticFinding | null {
  const call = VALUE_CALL.exec(fn.body);
  if (!call) return null;
  const after = fn.body.slice(call.index + call[0].length);
  for (const statement of after.split(/[;\n]/)) {
    if (LOCAL_DECL.test(statement)) continue;
    if (STATE_WRITE.test(statement)) {
      return finding(
        "reentrancy",
        "State updated after an external value transfer (CEI pattern)",
        "vulnerable",
        fn,
        call[0].trim().slice(0, 80),
      );
    }
  }
  return null;
}

function checkSelfdestruct(fn: FnBlock): StaticFinding | null {
  if (!/\b(selfdestruct|suicide)\s*\(/.test(fn.body)) return null;
  const controlled = isAccessControlled(fn);
  return finding(
    "unprotected-selfdestruct",
    controlled ? "selfdestruct pattern is access-controlled" : "Unprotected selfdestruct pattern",
    controlled ? "warning" : "vulnerable",
    fn,
    "selfdestruct(...)",
  );
}

function checkTxOrigin(fn: FnBlock): StaticFinding | null {
  return /tx\.origin/.test(fn.body)
    ? finding("tx-origin-auth", "tx.origin appears in function logic", "warning", fn, "tx.origin")
    : null;
}

function checkArbitraryCall(fn: FnBlock): StaticFinding | null {
  const delegate = /(\w+)\.delegatecall\s*\(/.exec(fn.body);
  const rawCall = /(\w+)\.call\s*\(/.exec(fn.body);
  const hit = delegate || rawCall;
  if (!hit || ["msg", "sender", "address", "this"].includes(hit[1])) return null;
  const controlled = isAccessControlled(fn);
  const isDelegate = Boolean(delegate);
  return finding(
    "arbitrary-external-call",
    `${isDelegate ? "delegatecall" : "External call"} to dynamic target '${hit[1]}'`,
    isDelegate || !controlled ? "vulnerable" : "warning",
    fn,
    `${hit[1]}.${isDelegate ? "delegatecall" : "call"}(...)`,
  );
}

function checkUncheckedCall(fn: FnBlock): StaticFinding | null {
  for (const line of fn.lines) {
    if (!/\.call\s*(\{[^}]*\})?\s*\(/.test(line)) continue;
    const captured = /\(\s*bool\s+\w+/.test(line) || /=\s*[\w.]+\.call/.test(line);
    if (!captured) {
      return finding(
        "unchecked-low-level-call",
        "Low-level call return value is not captured on this line",
        "warning",
        fn,
        line.trim().slice(0, 80),
      );
    }
  }
  return null;
}

function summarize(findings: StaticFinding[]): Pick<StaticAnalysisResult, "risk" | "summary"> {
  const risk = findings.reduce<0 | 1 | 2>((maximum, item) => {
    const value = SEVERITY_RISK[item.severity];
    return value > maximum ? value : maximum;
  }, 0);
  const summary = findings.length
    ? findings.map((item) => `${item.functionName}(): ${item.title}`).join("; ")
    : "no configured source patterns detected";
  return { risk, summary };
}

function runLegacyRules(source: string): StaticFinding[] {
  const rules = [
    checkReentrancy,
    checkSelfdestruct,
    checkTxOrigin,
    checkArbitraryCall,
    checkUncheckedCall,
  ];
  const findings: StaticFinding[] = [];
  const seen = new Set<string>();
  for (const fn of extractFunctions(stripComments(source || ""))) {
    for (const rule of rules) {
      const item = rule(fn);
      const key = item ? `${item.id}:${item.functionName}` : "";
      if (item && !seen.has(key)) {
        seen.add(key);
        findings.push(item);
      }
    }
  }
  return findings;
}

export function analyzeSolidity(source: string): StaticAnalysisResult {
  const findings = runLegacyRules(source);
  return { ...summarize(findings), findings, checksRun: [...LEGACY_CHECKS] };
}

function proofLockSignals(source: string): StaticFinding[] {
  const clean = stripComments(source || "");
  const findings = runLegacyRules(clean).map((item) =>
    item.id === "reentrancy" ? { ...item, id: "reentrancy-pattern" } : item,
  );
  for (const fn of extractFunctions(clean)) {
    if (isAccessControlled(fn) || /\b(admin|owner)\b/i.test(fn.body)) {
      findings.push(finding(
        "privileged-admin-signal",
        "Privileged/admin control pattern present",
        "info",
        fn,
        isAccessControlled(fn) ? "access-control guard" : "admin/owner reference",
      ));
    }
    if (/\.delegatecall\s*\(/.test(fn.body)) {
      findings.push(finding(
        "delegatecall-signal",
        "delegatecall pattern present",
        "warning",
        fn,
        "delegatecall(...)",
      ));
    }
  }
  return findings;
}

export function analyzeSolidityPatterns(source: string): SourcePatternAnalysis {
  const findings = proofLockSignals(source).slice(0, 100);
  const summary = summarize(findings);
  return {
    engine: "solidity-source-pattern-analysis-v1",
    method: "REGEX_AND_BRACE_MATCHING",
    admissionImpact: "INFORMATIONAL_ONLY",
    signalLevel: summary.risk,
    findings,
    checksRun: [...PROOFLOCK_CHECKS],
    summary: summary.summary,
  };
}
