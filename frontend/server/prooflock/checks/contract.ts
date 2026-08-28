import { getAddress, isHexString, keccak256, toUtf8Bytes } from "ethers";

import type { Bytes32, HexAddress } from "../types";
import {
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  normalizeRuntimeCode,
  type ClassifiedSubject,
  type SubjectChainAdapter,
} from "../subject/classify";
import { analyzeSolidityPatterns, type SourcePatternAnalysis } from "./static-analysis";

const ZERO_WORD = `0x${"00".repeat(32)}`;
const BEACON_IMPLEMENTATION_SELECTOR = "0x5c60da1b";

export type VerifiedSource = Readonly<{
  source: string;
  provenance: "block-explorer-verified" | "compiler-metadata-verified";
}>;

type ImplementationProxy = Readonly<{
  kind: "EIP1967_IMPLEMENTATION" | "EIP1167_MINIMAL";
  implementationAddress: HexAddress;
  implementationCodeHash: Bytes32;
}>;

type BeaconProxy = Readonly<{
  kind: "EIP1967_BEACON";
  beaconAddress: HexAddress;
  beaconCodeHash: Bytes32;
  implementationAddress: HexAddress;
  implementationCodeHash: Bytes32;
}>;

export type ContractCheckReport = Readonly<{
  kind: "CONTRACT_ANALYSIS";
  sourceBlockNumber: string;
  runtimeCodeHash: Bytes32;
  proxy?: ImplementationProxy | BeaconProxy;
  verifiedSource?: Readonly<{
    digest: Bytes32;
    provenance: VerifiedSource["provenance"];
    analysisEngine: "solidity-source-pattern-analysis-v1";
  }>;
  sourcePatternAnalysis?: SourcePatternAnalysis;
  findings: readonly string[];
}>;

export type ContractCheckOptions = Readonly<{
  blockTag: bigint;
  verifiedSource?: VerifiedSource;
}>;

function addressFromWord(value: string, label: string): HexAddress | undefined {
  if (!isHexString(value, 32)) throw new Error(`Invalid ${label}`);
  if (value.toLowerCase() === ZERO_WORD) return undefined;
  if (!/^0x0{24}/i.test(value)) throw new Error(`Invalid ${label}`);
  const rawAddress = `0x${value.slice(-40)}`;
  try {
    return getAddress(rawAddress) as HexAddress;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

async function codeHash(
  adapter: SubjectChainAdapter,
  address: HexAddress,
  blockTag: bigint,
): Promise<Bytes32> {
  const code = normalizeRuntimeCode(await adapter.getCode(address, blockTag));
  return keccak256(code) as Bytes32;
}

async function implementationProxy(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  blockTag: bigint,
): Promise<ImplementationProxy | undefined> {
  const word = await adapter.getStorage(subject.address, EIP1967_IMPLEMENTATION_SLOT, blockTag);
  const implementationAddress = addressFromWord(word, "EIP-1967 storage word");
  if (!implementationAddress) return undefined;
  return {
    kind: "EIP1967_IMPLEMENTATION",
    implementationAddress,
    implementationCodeHash: await codeHash(adapter, implementationAddress, blockTag),
  };
}

async function beaconProxy(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  blockTag: bigint,
): Promise<BeaconProxy | undefined> {
  const word = await adapter.getStorage(subject.address, EIP1967_BEACON_SLOT, blockTag);
  const beaconAddress = addressFromWord(word, "EIP-1967 storage word");
  if (!beaconAddress) return undefined;
  const result = await adapter.call(
    { to: beaconAddress, data: BEACON_IMPLEMENTATION_SELECTOR },
    blockTag,
  );
  const implementationAddress = addressFromWord(result, "beacon implementation response");
  if (!implementationAddress) throw new Error("Beacon returned an invalid implementation");
  const [beaconCodeHash, implementationCodeHash] = await Promise.all([
    codeHash(adapter, beaconAddress, blockTag),
    codeHash(adapter, implementationAddress, blockTag),
  ]);
  return {
    kind: "EIP1967_BEACON",
    beaconAddress,
    beaconCodeHash,
    implementationAddress,
    implementationCodeHash,
  };
}

function minimalProxyTarget(runtimeCode: string): HexAddress | undefined {
  const match = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/.exec(
    runtimeCode,
  );
  if (!match) return undefined;
  return getAddress(`0x${match[1]}`) as HexAddress;
}

async function detectProxy(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  blockTag: bigint,
): Promise<ImplementationProxy | BeaconProxy | undefined> {
  const implementation = await implementationProxy(adapter, subject, blockTag);
  if (implementation) return implementation;
  const beacon = await beaconProxy(adapter, subject, blockTag);
  if (beacon) return beacon;
  const implementationAddress = minimalProxyTarget(subject.runtimeCode);
  if (!implementationAddress) return undefined;
  return {
    kind: "EIP1167_MINIMAL",
    implementationAddress,
    implementationCodeHash: await codeHash(adapter, implementationAddress, blockTag),
  };
}

function sourceEvidence(verifiedSource: VerifiedSource | undefined) {
  if (!verifiedSource) return {};
  if (!verifiedSource.source.trim()) throw new Error("Verified source must not be empty");
  if (
    verifiedSource.provenance !== "block-explorer-verified"
    && verifiedSource.provenance !== "compiler-metadata-verified"
  ) {
    throw new Error("Invalid verified-source provenance");
  }
  return {
    verifiedSource: {
      digest: keccak256(toUtf8Bytes(verifiedSource.source)) as Bytes32,
      provenance: verifiedSource.provenance,
      analysisEngine: "solidity-source-pattern-analysis-v1" as const,
    },
    sourcePatternAnalysis: analyzeSolidityPatterns(verifiedSource.source),
  };
}

export async function inspectContract(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  options: ContractCheckOptions,
): Promise<ContractCheckReport> {
  if (subject.kind !== "CONTRACT") throw new Error("Contract checks require a contract subject");
  if (subject.sourceBlockNumber !== options.blockTag.toString()) {
    throw new Error("Contract check block does not match classification block");
  }
  const proxy = await detectProxy(adapter, subject, options.blockTag);
  const source = sourceEvidence(options.verifiedSource);
  const patterns = source.sourcePatternAnalysis;
  return Object.freeze({
    kind: "CONTRACT_ANALYSIS",
    sourceBlockNumber: options.blockTag.toString(),
    runtimeCodeHash: subject.runtimeCodeHash,
    ...(proxy ? { proxy } : {}),
    ...source,
    findings: patterns?.findings.map((item) => `${item.id}:${item.functionName}`) ?? [],
  });
}
