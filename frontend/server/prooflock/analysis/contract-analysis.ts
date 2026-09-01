// Pure, deterministic smart-contract danger analysis (no network). Given the seal-time evidence for a
// subject address, we detect dangerous EVM patterns from the RUNTIME BYTECODE (works even when the
// source is UNVERIFIED, the common case on 0G) and, when a verified Solidity source is present, from
// the source text as well. Output is exactly a ContractAnalysis so it composes into the risk bundle.
//
// Bytecode is scanned with a PUSH-data-aware opcode walker: PUSH1..PUSH32 (0x60..0x7f) carry inline
// immediate data whose bytes must NOT be mistaken for opcodes. Skipping that data is what lets us
// tell a real SELFDESTRUCT (0xff) apart from a 0xff byte that merely lives inside a PUSH32 constant.

import type { AddressEvidence, ContractAnalysis, RiskSignal } from "./types";

// ---------- Opcode constants ----------

export const OP_SELFDESTRUCT = 0xff;
export const OP_DELEGATECALL = 0xf4;
export const OP_CALLCODE = 0xf2;
export const OP_PUSH1 = 0x60;
export const OP_PUSH4 = 0x63;
export const OP_PUSH32 = 0x7f;

// ---------- Known-dangerous 4-byte function selectors (embedded via PUSH4) ----------

// keccak256(signature)[0:4]. These are the selectors a dispatcher pushes to match calldata, so their
// presence as PUSH4 immediates is strong evidence the contract exposes that (dangerous) entrypoint.
export const DANGEROUS_SELECTORS: Readonly<Record<string, { flag: string; signature: string }>> = {
  "40c10f19": { flag: "HAS_MINT", signature: "mint(address,uint256)" },
  "8456cb59": { flag: "HAS_PAUSE", signature: "pause()" },
  "f9f92be4": { flag: "HAS_BLACKLIST", signature: "blacklist(address)" },
  "8da5cb5b": { flag: "OWNER_CONTROLLED", signature: "owner()" },
  "f2fde38b": { flag: "OWNER_CONTROLLED", signature: "transferOwnership(address)" },
} as const;

// ---------- PUSH-data-aware opcode walker ----------

// Returns the set of opcodes actually present as executable opcodes, skipping PUSH immediate data so a
// data byte (e.g. 0xff inside a PUSH32 constant) is never misread as an opcode.
export function scanBytecodeOpcodes(code: string): Set<number> {
  const bytes = hexToBytes(code);
  const present = new Set<number>();
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];
    present.add(op);
    if (op >= OP_PUSH1 && op <= OP_PUSH32) {
      i += 1 + (op - OP_PUSH1 + 1); // opcode + its (op - 0x5f) immediate bytes
    } else {
      i += 1;
    }
  }
  return present;
}

// Collect the 4-byte PUSH4 immediates so we can match embedded function selectors. Only reads the
// immediate that directly follows a PUSH4 opcode reached by the walker, never data mid-PUSH.
function collectPush4Selectors(code: string): Set<string> {
  const bytes = hexToBytes(code);
  const selectors = new Set<string>();
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];
    if (op >= OP_PUSH1 && op <= OP_PUSH32) {
      const dataLen = op - OP_PUSH1 + 1;
      if (op === OP_PUSH4 && i + 4 < bytes.length) {
        selectors.add(bytesToHex(bytes.slice(i + 1, i + 5)));
      }
      i += 1 + dataLen;
    } else {
      i += 1;
    }
  }
  return selectors;
}

function hexToBytes(code: string): number[] {
  let hex = code.startsWith("0x") || code.startsWith("0X") ? code.slice(2) : code;
  if (hex.length % 2 !== 0) hex = "0" + hex; // tolerate odd nibble counts defensively
  const out: number[] = [];
  for (let j = 0; j < hex.length; j += 2) {
    const byte = parseInt(hex.slice(j, j + 2), 16);
    if (Number.isNaN(byte)) continue; // skip any non-hex noise rather than corrupting the walk
    out.push(byte);
  }
  return out;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Verified-source scanning ----------

// Scans verified Solidity source for dangerous patterns. Returns plain-English findings.
function scanSource(source: string): { findings: string[]; honeypot: boolean } {
  const findings: string[] = [];
  let honeypot = false;
  const lower = source.toLowerCase();

  if (/\bselfdestruct\s*\(/.test(lower) || /\bsuicide\s*\(/.test(lower)) {
    findings.push("Source calls selfdestruct - the contract can be permanently destroyed");
  }
  if (/\bdelegatecall\s*\(/.test(lower)) {
    findings.push("Source uses delegatecall - execution can be redirected to another contract");
  }
  const hasOnlyOwner = /\bonlyowner\b/.test(lower);
  if (hasOnlyOwner && /\bfunction\s+mint\b|\b_mint\s*\(/.test(lower)) {
    findings.push("Owner-restricted mint - the owner can create new tokens at will");
  }
  if (isTransferBlocking(lower)) {
    findings.push("Transfer-blocking logic detected - transfers can be rejected (honeypot risk)");
    honeypot = true;
  }
  if (/\bblacklist\b|\bblocklist\b|\bisblacklisted\b|\b_blacklist\b/.test(lower)) {
    findings.push("Blacklist mapping - specific holders can be blocked from transferring");
  }
  if (isHiddenFeeSetter(lower)) {
    findings.push("Adjustable fee/tax setter - the owner can raise transfer taxes after launch");
  }
  return { findings, honeypot };
}

// A require(false) or an unconditional revert reachable from a transfer function is the classic
// honeypot: buys succeed, sells revert. We approximate by looking for a hard block near transfer.
function isTransferBlocking(lower: string): boolean {
  const hasTransfer = /\bfunction\s+(transfer|transferfrom)\b/.test(lower);
  const hardBlock = /\brequire\s*\(\s*false\b/.test(lower) || /\brevert\s+tradingnotallowed\b/.test(lower);
  return hasTransfer && hardBlock;
}

function isHiddenFeeSetter(lower: string): boolean {
  return /\bfunction\s+set(fee|fees|tax|taxes|feepercent)\b/.test(lower);
}

// ---------- codeRisk mapping ----------

// Maps detected flags/findings to the ProofLock gate's codeRisk scale (0 clean, 1 warning, 2 vulnerable).
function computeCodeRisk(
  bytecodeFlags: readonly string[],
  ownerControlled: boolean,
  honeypot: boolean,
): 0 | 1 | 2 {
  const has = (f: string) => bytecodeFlags.includes(f);
  const fundMoving = has("HAS_MINT") || has("HAS_PAUSE") || has("HAS_BLACKLIST");

  // VULNERABLE: self-destruct, delegatecall + owner-controlled fund-moving, or a source honeypot.
  if (has("SELFDESTRUCT")) return 2;
  if ((has("DELEGATECALL") || has("CALLCODE")) && ownerControlled && fundMoving) return 2;
  if (honeypot) return 2;

  // WARNING: owner-controlled mint/pause/blacklist, or an upgradeable delegatecall path.
  if (ownerControlled && fundMoving) return 1;
  if (has("DELEGATECALL") || has("CALLCODE")) return 1;

  return 0;
}

// ---------- Public entrypoint ----------

export function analyzeContract(
  evidence: Pick<AddressEvidence, "isContract" | "code" | "source" | "sourceVerified">,
): ContractAnalysis {
  if (!evidence.isContract) {
    return {
      isContract: false,
      bytecodeFlags: [],
      sourceFindings: [],
      codeRisk: 0,
      signals: [],
      factors: ["Standard wallet with no deployed contract code"],
    };
  }

  const opcodes = scanBytecodeOpcodes(evidence.code);
  const selectors = collectPush4Selectors(evidence.code);
  const bytecodeFlags = buildBytecodeFlags(opcodes, selectors);

  const sourceScan =
    evidence.sourceVerified && evidence.source && evidence.source.trim().length > 0
      ? scanSource(evidence.source)
      : { findings: [], honeypot: false };

  const ownerControlled = bytecodeFlags.includes("OWNER_CONTROLLED");
  const codeRisk = computeCodeRisk(bytecodeFlags, ownerControlled, sourceScan.honeypot);
  const signals = buildSignals(bytecodeFlags, sourceScan.honeypot);
  const factors = buildFactors(bytecodeFlags, sourceScan.findings, sourceScan.honeypot);

  return {
    isContract: true,
    bytecodeFlags,
    sourceFindings: sourceScan.findings,
    codeRisk,
    signals,
    factors,
  };
}

function buildBytecodeFlags(opcodes: Set<number>, selectors: Set<string>): string[] {
  const flags: string[] = [];
  if (opcodes.has(OP_SELFDESTRUCT)) flags.push("SELFDESTRUCT");
  if (opcodes.has(OP_DELEGATECALL)) flags.push("DELEGATECALL");
  if (opcodes.has(OP_CALLCODE)) flags.push("CALLCODE");
  for (const sel of selectors) {
    const known = DANGEROUS_SELECTORS[sel];
    if (known && !flags.includes(known.flag)) flags.push(known.flag);
  }
  return flags;
}

function buildSignals(bytecodeFlags: readonly string[], honeypot: boolean): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const has = (f: string) => bytecodeFlags.includes(f);

  if (has("SELFDESTRUCT")) {
    signals.push({ id: "selfdestruct", label: "Contract can self-destruct", value: 1, weight: 0.6, hard: false });
  }
  if (has("DELEGATECALL")) {
    signals.push({ id: "delegatecall", label: "Contract is upgradeable via delegatecall", value: 1, weight: 0.4, hard: false });
  }
  if (has("CALLCODE")) {
    signals.push({ id: "callcode", label: "Contract uses legacy callcode delegation", value: 1, weight: 0.4, hard: false });
  }
  if (has("HAS_MINT")) {
    signals.push({ id: "has_mint", label: "Owner can mint unlimited tokens", value: 1, weight: 0.35, hard: false });
  }
  if (has("HAS_PAUSE")) {
    signals.push({ id: "has_pause", label: "Owner can pause all transfers", value: 1, weight: 0.3, hard: false });
  }
  if (has("HAS_BLACKLIST")) {
    signals.push({ id: "has_blacklist", label: "Owner can block specific holders", value: 1, weight: 0.35, hard: false });
  }
  if (honeypot) {
    signals.push({ id: "honeypot", label: "Transfers can be blocked (honeypot pattern)", value: 1, weight: 1, hard: true });
  }
  return signals;
}

function buildFactors(
  bytecodeFlags: readonly string[],
  sourceFindings: readonly string[],
  honeypot: boolean,
): string[] {
  const factors: string[] = [];
  const has = (f: string) => bytecodeFlags.includes(f);

  if (honeypot) {
    factors.push("Source code contains a transfer-blocking honeypot pattern - selling may be impossible");
  }
  if (has("SELFDESTRUCT")) {
    factors.push("Contract can self-destruct, wiping its code and potentially trapping funds");
  }
  if (has("DELEGATECALL") || has("CALLCODE")) {
    factors.push("Contract can delegate execution to another contract, a common upgrade or backdoor path");
  }
  const ownerCaps = describeOwnerCaps(bytecodeFlags);
  if (ownerCaps) factors.push(ownerCaps);

  if (factors.length === 0) {
    factors.push("Contract code shows no dangerous patterns (self-destruct, hidden mint, or backdoor)");
  }
  if (sourceFindings.length > 0 && factors.length < 4) {
    factors.push("Verified source review surfaced additional owner-privileged logic");
  }
  return factors.slice(0, 4);
}

function describeOwnerCaps(bytecodeFlags: readonly string[]): string | null {
  const caps: string[] = [];
  if (bytecodeFlags.includes("HAS_MINT")) caps.push("mint new tokens");
  if (bytecodeFlags.includes("HAS_PAUSE")) caps.push("pause transfers");
  if (bytecodeFlags.includes("HAS_BLACKLIST")) caps.push("blacklist holders");
  if (caps.length === 0) return null;
  return `Owner-controlled contract: the owner can ${caps.join(", ")}`;
}
