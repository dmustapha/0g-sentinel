// Phase 1 of the deep agent-risk pipeline: compute chain-agnostic behavioral risk signals from a
// seal-time evidence bundle. PURE and deterministic: no network, no I/O. Given the same
// AddressEvidence it always returns the same HeuristicSignals, so the result can be hashed straight
// into the sealed evidence and reasoned over later by the 0G Compute model.

import type {
  AddressEvidence,
  ChainTx,
  HeuristicSignals,
  RiskSignal,
} from "./types";

// Stable signal ids so downstream code (threat intel, contract analysis, the risk LLM) can match on
// them without depending on label wording.
export const SIGNAL_UNLIMITED_APPROVALS = "unlimited_approvals";
export const SIGNAL_FAILED_TX_RATE = "failed_tx_rate";
export const SIGNAL_DRAIN_PATTERN = "drain_pattern";
export const SIGNAL_TX_VELOCITY_BURST = "tx_velocity_burst";
export const SIGNAL_COUNTERPARTY_CONCENTRATION = "counterparty_concentration";
export const SIGNAL_FRESH_ACCOUNT = "fresh_account";
export const SIGNAL_NO_HISTORY = "no_history";

// Method ids we decode for approval detection.
const METHOD_APPROVE = "0x095ea7b3"; // approve(address,uint256)
const METHOD_SET_APPROVAL_FOR_ALL = "0xa22cb465"; // setApprovalForAll(address,bool)

// Anything at or above 2^255 is treated as an "unlimited" allowance (covers the common uint256 max
// and the "half of max" pattern some tokens use).
const UNLIMITED_THRESHOLD = 1n << 255n;
const UINT256_MAX = (1n << 256n) - 1n;

// A drain looks like: value arrives, then >=90% of it leaves to a different counterparty within a
// short block window.
const DRAIN_OUTBOUND_RATIO = 0.9;
const DRAIN_BLOCK_WINDOW = 25;

// Fresh-account signal decays linearly to zero once the address has ~20 outgoing txns.
const FRESH_ACCOUNT_NONCE_HORIZON = 20;

// Weights are seal-time constants; tuned so no single soft signal alone maxes the score.
const WEIGHTS = {
  [SIGNAL_UNLIMITED_APPROVALS]: 0.55,
  [SIGNAL_FAILED_TX_RATE]: 0.3,
  [SIGNAL_DRAIN_PATTERN]: 0.7,
  [SIGNAL_TX_VELOCITY_BURST]: 0.2,
  [SIGNAL_COUNTERPARTY_CONCENTRATION]: 0.25,
  [SIGNAL_FRESH_ACCOUNT]: 0.15,
  [SIGNAL_NO_HISTORY]: 0.1,
} as const;

/**
 * Decode the allowance amount from an approval calldata string.
 *
 * For approve(address,uint256) the amount is the final 32-byte word. For
 * setApprovalForAll(address,bool) the "amount" is the boolean flag, returned as UINT256_MAX when
 * approved (so callers can treat it as unlimited) or 0n when revoked. Returns null when the input is
 * not a recognised approval or is malformed.
 */
export function decodeApprovalAmount(input: string): bigint | null {
  if (typeof input !== "string" || !input.startsWith("0x")) return null;
  const methodId = input.slice(0, 10).toLowerCase();
  const body = input.slice(10);
  // Each ABI word is 32 bytes / 64 hex chars.
  if (body.length < 64) return null;
  const lastWord = body.slice(body.length - 64);
  if (!/^[0-9a-fA-F]{64}$/.test(lastWord)) return null;
  const raw = BigInt(`0x${lastWord}`);
  if (methodId === METHOD_SET_APPROVAL_FOR_ALL) {
    return raw === 0n ? 0n : UINT256_MAX;
  }
  if (methodId === METHOD_APPROVE) {
    return raw;
  }
  return null;
}

function isUnlimited(amount: bigint): boolean {
  return amount >= UNLIMITED_THRESHOLD || amount === UINT256_MAX;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function signal(
  id: keyof typeof WEIGHTS,
  label: string,
  value: number,
  detail?: string,
): RiskSignal {
  return {
    id,
    label,
    value: clamp01(value),
    weight: WEIGHTS[id],
    hard: false,
    ...(detail ? { detail } : {}),
  };
}

function computeUnlimitedApprovals(txns: readonly ChainTx[]): RiskSignal {
  let count = 0;
  for (const tx of txns) {
    const methodId = tx.methodId.toLowerCase();
    if (methodId !== METHOD_APPROVE && methodId !== METHOD_SET_APPROVAL_FOR_ALL) continue;
    const amount = decodeApprovalAmount(tx.input);
    if (amount !== null && isUnlimited(amount)) count += 1;
  }
  const value = Math.min(1, count / 3);
  const label =
    count === 0
      ? "No unlimited token approvals granted"
      : `Granted ${count} unlimited token approval${count === 1 ? "" : "s"}`;
  return signal(SIGNAL_UNLIMITED_APPROVALS, label, value, count > 0 ? `count=${count}` : undefined);
}

function computeFailedTxRate(txns: readonly ChainTx[]): RiskSignal {
  const total = txns.length;
  const failed = txns.reduce((n, tx) => (tx.isError ? n + 1 : n), 0);
  const value = total === 0 ? 0 : failed / total;
  const pct = Math.round(value * 100);
  return signal(
    SIGNAL_FAILED_TX_RATE,
    `${pct}% of recent transactions failed`,
    value,
    total > 0 ? `${failed}/${total} failed` : undefined,
  );
}

// A movement is a normalised value transfer we can scan for the drain pattern. Inbound = value into
// the subject; outbound = value out of the subject.
type Movement = Readonly<{
  block: number;
  amount: bigint;
  counterparty: string;
  inbound: boolean;
}>;

function toWei(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function collectMovements(evidence: AddressEvidence): Movement[] {
  const subject = evidence.address.toLowerCase();
  const movements: Movement[] = [];
  for (const tx of evidence.transactions) {
    const amount = toWei(tx.value);
    if (amount <= 0n) continue;
    const from = tx.from.toLowerCase();
    const to = (tx.to ?? "").toLowerCase();
    if (to === subject && from !== subject) {
      movements.push({ block: tx.blockNumber, amount, counterparty: from, inbound: true });
    } else if (from === subject && to !== subject && to !== "") {
      movements.push({ block: tx.blockNumber, amount, counterparty: to, inbound: false });
    }
  }
  for (const transfer of evidence.tokenTransfers) {
    const amount = toWei(transfer.value);
    if (amount <= 0n) continue;
    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    if (to === subject && from !== subject) {
      movements.push({ block: transfer.blockNumber, amount, counterparty: from, inbound: true });
    } else if (from === subject && to !== subject) {
      movements.push({ block: transfer.blockNumber, amount, counterparty: to, inbound: false });
    }
  }
  return movements;
}

function computeDrainPattern(evidence: AddressEvidence): RiskSignal {
  const movements = collectMovements(evidence);
  for (const inflow of movements) {
    if (!inflow.inbound) continue;
    const cutoff = (inflow.amount * BigInt(Math.round(DRAIN_OUTBOUND_RATIO * 100))) / 100n;
    for (const outflow of movements) {
      if (outflow.inbound) continue;
      if (outflow.block < inflow.block) continue;
      if (outflow.block - inflow.block > DRAIN_BLOCK_WINDOW) continue;
      if (outflow.counterparty === inflow.counterparty) continue;
      if (outflow.amount >= cutoff) {
        return signal(
          SIGNAL_DRAIN_PATTERN,
          "Funds received then rapidly moved out",
          1,
          `in@${inflow.block} out@${outflow.block}`,
        );
      }
    }
  }
  return signal(SIGNAL_DRAIN_PATTERN, "No rapid drain of received funds", 0);
}

function stdDev(gaps: readonly number[]): number {
  if (gaps.length === 0) return 0;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance);
}

// Burst-ness from timing: tight, low-variance inter-tx gaps look automated.
function timingBurst(txns: readonly ChainTx[]): number {
  if (txns.length < 4) return 0;
  const times = txns.map((t) => t.timestamp).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const spread = mean === 0 ? 0 : stdDev(gaps) / mean; // coefficient of variation
  // Low spread relative to mean => metronomic => bot-like. Map spread<=0.1 to 1, spread>=1 to 0.
  return clamp01(1 - spread / 1);
}

// Burst-ness from repetition: many identical (methodId,to) pairs looks scripted.
function repetitionBurst(txns: readonly ChainTx[]): number {
  if (txns.length === 0) return 0;
  const counts = new Map<string, number>();
  let max = 0;
  for (const tx of txns) {
    const key = `${tx.methodId.toLowerCase()}|${(tx.to ?? "").toLowerCase()}`;
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (next > max) max = next;
  }
  return clamp01(max / txns.length);
}

function computeVelocityBurst(txns: readonly ChainTx[]): RiskSignal {
  const value = Math.max(timingBurst(txns), repetitionBurst(txns));
  return signal(SIGNAL_TX_VELOCITY_BURST, "Repetitive or burst transaction pattern", value);
}

function computeCounterpartyConcentration(txns: readonly ChainTx[]): RiskSignal {
  if (txns.length === 0) {
    return signal(SIGNAL_COUNTERPARTY_CONCENTRATION, "Most activity flows to a single address", 0);
  }
  const counts = new Map<string, number>();
  let considered = 0;
  for (const tx of txns) {
    const to = (tx.to ?? "").toLowerCase();
    if (to === "") continue; // contract creation has no counterparty
    considered += 1;
    counts.set(to, (counts.get(to) ?? 0) + 1);
  }
  if (considered === 0) {
    return signal(SIGNAL_COUNTERPARTY_CONCENTRATION, "Most activity flows to a single address", 0);
  }
  const max = Math.max(...counts.values());
  const value = max / considered;
  return signal(
    SIGNAL_COUNTERPARTY_CONCENTRATION,
    "Most activity flows to a single address",
    value,
  );
}

function computeFreshAccount(nonce: number): RiskSignal {
  const value = clamp01(1 - nonce / FRESH_ACCOUNT_NONCE_HORIZON);
  return signal(SIGNAL_FRESH_ACCOUNT, "New address with little on-chain history", value);
}

function computeNoHistory(evidence: AddressEvidence): RiskSignal {
  const empty = evidence.transactions.length === 0 && evidence.nonce === 0;
  return signal(SIGNAL_NO_HISTORY, "No observable transaction history", empty ? 1 : 0);
}

function scoreFrom(signals: readonly RiskSignal[]): number {
  if (signals.some((s) => s.hard)) return 100;
  const survival = signals.reduce((product, s) => product * (1 - s.weight * s.value), 1);
  return Math.round(100 * (1 - survival));
}

// A signal has to clear this contribution (weight*value) before it is worth surfacing as a
// user-facing factor. This keeps small-sample floors (e.g. a benign EOA whose few transactions
// happen to share a counterparty) from producing alarming copy.
const FACTOR_MIN_CONTRIBUTION = 0.05;

// Plain-English summary lines for a non-technical user, drawn from the signals contributing the most
// (weight*value). Always returns at least one line.
function buildFactors(signals: readonly RiskSignal[]): string[] {
  const ranked = signals
    .map((s) => ({ label: s.label, contribution: s.weight * s.value }))
    .filter((s) => s.contribution >= FACTOR_MIN_CONTRIBUTION)
    .sort((a, b) => b.contribution - a.contribution);
  if (ranked.length === 0) {
    return ["No risky patterns detected in recent activity"];
  }
  return ranked.slice(0, 5).map((r) => r.label);
}

/**
 * Compute the behavioral heuristic signals for one subject address. Pure and deterministic: no
 * network, no clock, no randomness. Threat-intel signals (which may be `hard`) are folded in later
 * by threat-intel.ts; this function only produces soft behavioral signals but honours the `hard`
 * clamp in scoring so the composed vector scores correctly.
 */
export function computeHeuristics(evidence: AddressEvidence): HeuristicSignals {
  const txns = evidence.transactions;
  const signals: RiskSignal[] = [
    computeUnlimitedApprovals(txns),
    computeFailedTxRate(txns),
    computeDrainPattern(evidence),
    computeVelocityBurst(txns),
    computeCounterpartyConcentration(txns),
    computeFreshAccount(evidence.nonce),
    computeNoHistory(evidence),
  ];
  return {
    signals,
    behavioralScore: scoreFrom(signals),
    factors: buildFactors(signals),
  };
}
