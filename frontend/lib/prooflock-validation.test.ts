import { describe, expect, it } from "vitest";

import { isCanonicalAgentId, isNonZeroBytes32, parseNonZeroBytes32 } from "./prooflock-validation";

const lower = `0x${"ab".repeat(32)}`;
const upper = `0x${"AB".repeat(32)}`;
const mixed = `0x${"aB".repeat(32)}`;
const zero = `0x${"00".repeat(32)}`;

describe("ProofLock identifier validation", () => {
  it.each([
    ["zero", zero],
    ["short", `0x${"ab".repeat(31)}`],
    ["long", `0x${"ab".repeat(33)}`],
    ["nonhex", `0x${"ag".repeat(32)}`],
  ])("rejects %s bytes32 values", (_case, value) => {
    expect(isNonZeroBytes32(value)).toBe(false);
    expect(parseNonZeroBytes32(value)).toBeNull();
  });

  it.each([lower, upper])("accepts exact nonzero bytes32 values (%s)", (value) => {
    expect(isNonZeroBytes32(value)).toBe(true);
  });

  it("accepts and normalizes mixed case without mutating the display input", () => {
    const displayValue = mixed;
    expect(isNonZeroBytes32(displayValue)).toBe(true);
    expect(parseNonZeroBytes32(displayValue)).toBe(lower);
    expect(displayValue).toBe(mixed);
  });
});

describe("canonical ERC-8004 agent IDs", () => {
  const maxUint256 = ((1n << 256n) - 1n).toString();
  const overflow = (1n << 256n).toString();

  it.each(["0", "1", "7", maxUint256])("accepts %s", (value) => {
    expect(isCanonicalAgentId(value)).toBe(true);
  });

  it.each(["", "00", "01", "+1", "-1", "1.0", " 1", "1 ", overflow])("rejects %j", (value) => {
    expect(isCanonicalAgentId(value)).toBe(false);
  });

  it("rejects a multi-megabyte decimal before attempting BigInt conversion", () => {
    expect(isCanonicalAgentId("9".repeat(2_000_000))).toBe(false);
  });
});
