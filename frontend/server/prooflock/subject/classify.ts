import { getAddress, isHexString, keccak256 } from "ethers";

import type { Bytes32, HexAddress, SubjectKind } from "../types";

export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
export const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;

export type AccountHistory = Readonly<{
  complete: boolean;
  observedTransactions: number;
}>;

export interface SubjectChainAdapter {
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

function delegationTarget(runtimeCode: string): HexAddress | undefined {
  const match = /^0xef0100([0-9a-f]{40})$/.exec(runtimeCode);
  return match ? normalizeAddress(`0x${match[1]}`, "delegation target") : undefined;
}

export async function classifySubject(
  adapter: SubjectChainAdapter,
  address: string,
  blockTag: bigint,
): Promise<ClassifiedSubject> {
  if (blockTag < 0n) throw new Error("Invalid source block");
  const normalizedAddress = normalizeAddress(address, "subject");
  const runtimeCode = normalizeRuntimeCode(await adapter.getCode(normalizedAddress, blockTag));
  const target = delegationTarget(runtimeCode);
  const base = {
    address: normalizedAddress,
    sourceBlockNumber: blockTag.toString(),
    runtimeCode,
    runtimeCodeHash: keccak256(runtimeCode) as Bytes32,
  };

  if (runtimeCode === "0x") return Object.freeze({ ...base, kind: "EOA" as const });
  if (!target) return Object.freeze({ ...base, kind: "CONTRACT" as const });

  const delegationCode = normalizeRuntimeCode(await adapter.getCode(target, blockTag));
  return Object.freeze({
    ...base,
    kind: "EIP7702_DELEGATED_EOA" as const,
    delegationTarget: target,
    delegationCode,
    delegationCodeHash: keccak256(delegationCode) as Bytes32,
  });
}
