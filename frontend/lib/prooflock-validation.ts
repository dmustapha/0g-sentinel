import type { Bytes32 } from "@/server/prooflock/types";

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const CANONICAL_DECIMAL = /^(0|[1-9]\d*)$/;
const UINT256_LIMIT = 1n << 256n;
const UINT64_LIMIT = 1n << 64n;
const UINT48_LIMIT = 1n << 48n;

export function isNonZeroBytes32(value: string): value is Bytes32 {
  return BYTES32.test(value) && !/^0x0{64}$/i.test(value);
}

export function parseNonZeroBytes32(value: string): Bytes32 | null {
  return isNonZeroBytes32(value) ? value.toLowerCase() as Bytes32 : null;
}

export function isCanonicalAgentId(value: string): boolean {
  return boundedDecimal(value, 78, UINT256_LIMIT);
}

export function isCanonicalUint64(value: string): boolean {
  return boundedDecimal(value, 20, UINT64_LIMIT);
}

export function isCanonicalUint48(value: string): boolean {
  return boundedDecimal(value, 15, UINT48_LIMIT);
}

export function isPositiveUint64(value: string): boolean {
  return value !== "0" && isCanonicalUint64(value);
}

export function isPositiveUint48(value: string): boolean {
  return value !== "0" && isCanonicalUint48(value);
}

function boundedDecimal(value: string, maximumDigits: number, exclusiveLimit: bigint): boolean {
  return value.length <= maximumDigits && CANONICAL_DECIMAL.test(value)
    && BigInt(value) < exclusiveLimit;
}
