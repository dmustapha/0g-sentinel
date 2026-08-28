import { getAddress, isHexString, keccak256 } from "ethers";

import type { Bytes32, HexAddress, SubjectKind } from "../types";

export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
export const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Bytes32;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT64_MAX = (1n << 64n) - 1n;

export type ExpectedSourceBlock = Readonly<{
  number: bigint;
  hash: Bytes32;
}>;

export type AccountHistory = Readonly<{
  complete: boolean;
  observedTransactions: number;
}>;

export interface SubjectChainAdapter {
  getBlock(blockNumber: bigint): Promise<Readonly<{ number: bigint; hash: string }> | null>;
  getCode(address: string, blockTag: bigint): Promise<string>;
  getStorage(address: string, slot: string, blockTag: bigint): Promise<string>;
  call(transaction: Readonly<{ to: string; data: string }>, blockTag: bigint): Promise<string>;
  getTransactionCount(address: string, blockTag: bigint): Promise<bigint>;
  getBalance(address: string, blockTag: bigint): Promise<bigint>;
  getHistory?(address: string, blockTag: bigint): Promise<AccountHistory>;
}

export type ClassifiedSubject = Readonly<{
  address: HexAddress;
  kind: SubjectKind;
  sourceBlockNumber: string;
  sourceBlockHash: Bytes32;
  runtimeCode: string;
  runtimeCodeHash: Bytes32;
  delegationTarget?: HexAddress;
  delegationCode?: string;
  delegationCodeHash?: Bytes32;
}>;

function normalizeAddress(value: string, label: string): HexAddress {
  try {
    return getAddress(value) as HexAddress;
  } catch {
    throw new Error(`Invalid ${label} address`);
  }
}

export function normalizeRuntimeCode(value: string): string {
  if (!isHexString(value) || value.length % 2 !== 0) {
    throw new Error("Malformed runtime bytecode");
  }
  return value.toLowerCase();
}

function normalizeBlockHash(value: string): Bytes32 {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new Error("Invalid source block hash");
  }
  return value.toLowerCase() as Bytes32;
}

export function validateExpectedSourceBlock(value: ExpectedSourceBlock): ExpectedSourceBlock {
  if (typeof value?.number !== "bigint" || value.number < 0n || value.number > UINT64_MAX) {
    throw new Error("Invalid source block number");
  }
  return Object.freeze({ number: value.number, hash: normalizeBlockHash(value.hash) });
}

export async function assertExpectedSourceBlock(
  adapter: SubjectChainAdapter,
  expectedInput: ExpectedSourceBlock,
): Promise<ExpectedSourceBlock> {
  const expected = validateExpectedSourceBlock(expectedInput);
  const actual = await adapter.getBlock(expected.number);
  if (!actual || typeof actual.number !== "bigint" || actual.number !== expected.number) {
    throw new Error("Source block number unavailable or replaced");
  }
  if (normalizeBlockHash(actual.hash) !== expected.hash) {
    throw new Error("Source block hash changed during scan (reorg detected)");
  }
  return expected;
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function delegationTarget(runtimeCode: string): HexAddress | undefined {
  const match = /^0xef0100([0-9a-f]{40})$/.exec(runtimeCode);
  return match ? normalizeAddress(`0x${match[1]}`, "delegation target") : undefined;
}

export async function classifySubject(
  adapter: SubjectChainAdapter,
  address: string,
  sourceBlockInput: ExpectedSourceBlock,
): Promise<ClassifiedSubject> {
  const sourceBlock = await assertExpectedSourceBlock(adapter, sourceBlockInput);
  const normalizedAddress = normalizeAddress(address, "subject");
  const runtimeCode = normalizeRuntimeCode(
    await adapter.getCode(normalizedAddress, sourceBlock.number),
  );
  const target = delegationTarget(runtimeCode);
  const base = {
    address: normalizedAddress,
    sourceBlockNumber: sourceBlock.number.toString(),
    sourceBlockHash: sourceBlock.hash,
    runtimeCode,
    runtimeCodeHash: keccak256(runtimeCode) as Bytes32,
  };

  if (runtimeCode === "0x") {
    await assertExpectedSourceBlock(adapter, sourceBlock);
    return deepFreeze({
      ...base,
      kind: "EOA" as const,
      runtimeCodeHash: ZERO_BYTES32,
    });
  }
  if (!target) {
    await assertExpectedSourceBlock(adapter, sourceBlock);
    return deepFreeze({ ...base, kind: "CONTRACT" as const });
  }
  if (target.toLowerCase() === ZERO_ADDRESS || target === normalizedAddress) {
    throw new Error("Invalid EIP-7702 delegation target: zero or self");
  }

  const delegationCode = normalizeRuntimeCode(await adapter.getCode(target, sourceBlock.number));
  if (delegationCode === "0x") throw new Error("EIP-7702 delegation target has no live code");
  await assertExpectedSourceBlock(adapter, sourceBlock);
  return deepFreeze({
    ...base,
    kind: "EIP7702_DELEGATED_EOA" as const,
    delegationTarget: target,
    delegationCode,
    delegationCodeHash: keccak256(delegationCode) as Bytes32,
  });
}
