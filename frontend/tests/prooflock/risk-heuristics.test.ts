import { describe, expect, it } from "vitest";

import {
  computeHeuristics,
  decodeApprovalAmount,
  SIGNAL_DRAIN_PATTERN,
  SIGNAL_FAILED_TX_RATE,
  SIGNAL_FRESH_ACCOUNT,
  SIGNAL_NO_HISTORY,
  SIGNAL_UNLIMITED_APPROVALS,
} from "../../server/prooflock/analysis/risk-heuristics";
import type {
  AddressEvidence,
  ChainTx,
  EvmAddress,
  TokenTransfer,
} from "../../server/prooflock/analysis/types";

const SUBJECT = "0x00000000000000000000000000000000000000aa" as EvmAddress;
const PEER_A = "0x00000000000000000000000000000000000000b1";
const PEER_B = "0x00000000000000000000000000000000000000c2";
const PEER_C = "0x00000000000000000000000000000000000000d3";
const SPENDER = "0x00000000000000000000000000000000000000e4";

const MAX_UINT = `0x${"ff".repeat(32)}`;
const ADDR_WORD = "000000000000000000000000" + SPENDER.slice(2);

function approveCalldata(amountHex: string): string {
  // approve(spender, amount): methodId + 32-byte spender word + 32-byte amount word.
  const amount = amountHex.replace(/^0x/, "").padStart(64, "0");
  return `0x095ea7b3${ADDR_WORD}${amount}`;
}

function tx(overrides: Partial<ChainTx>): ChainTx {
  return {
    hash: "0x" + "1".repeat(64),
    blockNumber: 100,
    timestamp: 1_700_000_000,
    from: SUBJECT,
    to: PEER_A,
    value: "0",
    methodId: "0x",
    input: "0x",
    isError: false,
    gasUsed: "21000",
    ...overrides,
  };
}

function transfer(overrides: Partial<TokenTransfer>): TokenTransfer {
  return {
    hash: "0x" + "2".repeat(64),
    blockNumber: 100,
    from: SUBJECT,
    to: PEER_A,
    contractAddress: "0x" + "9".repeat(40),
    value: "0",
    tokenSymbol: "TKN",
    tokenDecimal: "18",
    ...overrides,
  };
}

function evidence(overrides: Partial<AddressEvidence>): AddressEvidence {
  return {
    address: SUBJECT,
    observedAtBlock: 1000,
    nonce: 50,
    balanceWei: "1000",
    isContract: false,
    code: "0x",
    transactions: [],
    tokenTransfers: [],
    internalTxns: [],
    sourceVerified: false,
    source: null,
    coverage: { explorer: "OK", rpc: "OK" },
    ...overrides,
  };
}

function scoreOf(ev: AddressEvidence): number {
  return computeHeuristics(ev).behavioralScore;
}

function signalValue(ev: AddressEvidence, id: string): number {
  const s = computeHeuristics(ev).signals.find((x) => x.id === id);
  if (!s) throw new Error(`missing signal ${id}`);
  return s.value;
}

describe("decodeApprovalAmount", () => {
  it("decodes an unlimited (max uint256) approval", () => {
    const amount = decodeApprovalAmount(approveCalldata(MAX_UINT));
    expect(amount).toBe((1n << 256n) - 1n);
  });

  it("decodes a bounded approval amount", () => {
    const amount = decodeApprovalAmount(approveCalldata("0x2710")); // 10000
    expect(amount).toBe(10000n);
  });

  it("treats setApprovalForAll(true) as unlimited and (false) as zero", () => {
    const approveAll =
      `0xa22cb465${ADDR_WORD}${"0".repeat(63)}1`;
    const revokeAll = `0xa22cb465${ADDR_WORD}${"0".repeat(64)}`;
    expect(decodeApprovalAmount(approveAll)).toBe((1n << 256n) - 1n);
    expect(decodeApprovalAmount(revokeAll)).toBe(0n);
  });

  it("returns null for non-approval or malformed input", () => {
    expect(decodeApprovalAmount("0x")).toBeNull();
    expect(decodeApprovalAmount("0xdeadbeef")).toBeNull();
    expect(decodeApprovalAmount("not-hex")).toBeNull();
  });
});

describe("computeHeuristics fixtures", () => {
  // A clean, active EOA: varied counterparties, no failures, no unlimited approvals, aged nonce.
  const cleanPeers = [
    "0x00000000000000000000000000000000000000b1",
    "0x00000000000000000000000000000000000000c2",
    "0x00000000000000000000000000000000000000d3",
    "0x00000000000000000000000000000000000000e4",
    "0x00000000000000000000000000000000000000f5",
    "0x0000000000000000000000000000000000000106",
    "0x0000000000000000000000000000000000000117",
    "0x0000000000000000000000000000000000000128",
  ];
  // Irregular block/timestamp spacing so the timing-burst signal stays low (human-like variance).
  const cleanTimestamps = [1000, 90000, 130000, 900000, 1_000_000, 3_500_000, 3_600_000, 9_000_000];
  const clean = evidence({
    nonce: 60,
    transactions: cleanPeers.map((peer, i) =>
      tx({ to: peer, blockNumber: 10 + i * 37, timestamp: cleanTimestamps[i] }),
    ),
  });

  // Three unlimited approvals to the same spender.
  const approvals = evidence({
    nonce: 60,
    transactions: [
      tx({ methodId: "0x095ea7b3", input: approveCalldata(MAX_UINT), blockNumber: 10, timestamp: 100 }),
      tx({ methodId: "0x095ea7b3", input: approveCalldata(MAX_UINT), blockNumber: 20, timestamp: 900 }),
      tx({ methodId: "0x095ea7b3", input: approveCalldata(MAX_UINT), blockNumber: 30, timestamp: 5000 }),
    ],
  });

  // Half the transactions revert.
  const failing = evidence({
    nonce: 60,
    transactions: [
      tx({ to: PEER_A, isError: true, blockNumber: 10, timestamp: 100 }),
      tx({ to: PEER_B, isError: true, blockNumber: 20, timestamp: 2000 }),
      tx({ to: PEER_C, isError: false, blockNumber: 30, timestamp: 8000 }),
      tx({ to: SPENDER, isError: false, blockNumber: 40, timestamp: 15000 }),
    ],
  });

  // Inbound then 95% outbound to a different peer within 5 blocks.
  const drain = evidence({
    nonce: 60,
    transactions: [
      tx({ from: PEER_A, to: SUBJECT, value: "1000000", blockNumber: 100, timestamp: 100 }),
      tx({ from: SUBJECT, to: PEER_B, value: "950000", blockNumber: 105, timestamp: 200 }),
    ],
  });

  // Brand-new address, nonce 0, no history at all.
  const fresh = evidence({ nonce: 0, transactions: [] });

  it("clean active EOA scores low with a benign factor", () => {
    const result = computeHeuristics(clean);
    expect(result.behavioralScore).toBeLessThan(30);
    expect(result.factors).toContain("No risky patterns detected in recent activity");
  });

  it("three unlimited approvals raise the score and value maxes at 1", () => {
    expect(signalValue(approvals, SIGNAL_UNLIMITED_APPROVALS)).toBe(1);
    expect(scoreOf(approvals)).toBeGreaterThan(scoreOf(clean));
  });

  it("high failed-tx rate is reported as a fraction", () => {
    expect(signalValue(failing, SIGNAL_FAILED_TX_RATE)).toBeCloseTo(0.5, 5);
    const label = computeHeuristics(failing).signals.find(
      (s) => s.id === SIGNAL_FAILED_TX_RATE,
    )?.label;
    expect(label).toContain("50%");
  });

  it("detects a drain pattern", () => {
    expect(signalValue(drain, SIGNAL_DRAIN_PATTERN)).toBe(1);
    expect(scoreOf(drain)).toBeGreaterThan(scoreOf(clean));
  });

  it("fresh nonce-0 address flags fresh + no-history", () => {
    expect(signalValue(fresh, SIGNAL_FRESH_ACCOUNT)).toBe(1);
    expect(signalValue(fresh, SIGNAL_NO_HISTORY)).toBe(1);
  });

  it("orders risky addresses above the clean one", () => {
    const cleanScore = scoreOf(clean);
    expect(scoreOf(drain)).toBeGreaterThan(cleanScore);
    expect(scoreOf(approvals)).toBeGreaterThan(cleanScore);
  });

  it("also detects a drain via token transfers", () => {
    const tokenDrain = evidence({
      nonce: 60,
      tokenTransfers: [
        transfer({ from: PEER_A, to: SUBJECT, value: "1000000", blockNumber: 200 }),
        transfer({ from: SUBJECT, to: PEER_C, value: "1000000", blockNumber: 203 }),
      ],
    });
    expect(signalValue(tokenDrain, SIGNAL_DRAIN_PATTERN)).toBe(1);
  });

  it("factors are plain English strings", () => {
    for (const factor of computeHeuristics(drain).factors) {
      expect(typeof factor).toBe("string");
      expect(factor).not.toMatch(/0x[0-9a-fA-F]{6,}/); // no raw hashes/addresses in user copy
      expect(factor.length).toBeGreaterThan(4);
    }
  });

  it("bounded approvals do not count as unlimited", () => {
    const bounded = evidence({
      nonce: 60,
      transactions: [
        tx({ methodId: "0x095ea7b3", input: approveCalldata("0x2710"), blockNumber: 10 }),
      ],
    });
    expect(signalValue(bounded, SIGNAL_UNLIMITED_APPROVALS)).toBe(0);
  });

  it("keeps every signal value and weight inside [0,1]", () => {
    for (const s of computeHeuristics(drain).signals) {
      expect(s.value).toBeGreaterThanOrEqual(0);
      expect(s.value).toBeLessThanOrEqual(1);
      expect(s.weight).toBeGreaterThanOrEqual(0);
      expect(s.weight).toBeLessThanOrEqual(1);
      expect(s.hard).toBe(false);
    }
  });

  it("is deterministic for identical input", () => {
    expect(computeHeuristics(drain)).toEqual(computeHeuristics(drain));
  });
});
