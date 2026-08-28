import { getAddress, isHexString, keccak256 } from "ethers";

import type { Bytes32, HexAddress } from "../types";
import {
  assertExpectedSourceBlock,
  deepFreeze,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  normalizeRuntimeCode,
  validateExpectedSourceBlock,
  type ClassifiedSubject,
  type ExpectedSourceBlock,
  type SubjectChainAdapter,
} from "../subject/classify";
import { analyzeSolidityPatterns, type SourcePatternAnalysis } from "./static-analysis";

const ZERO_WORD = `0x${"00".repeat(32)}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BEACON_IMPLEMENTATION_SELECTOR = "0x5c60da1b";
const MAX_SOURCE_BYTES = 262_144;
const MAX_METADATA_LENGTH = 4_096;

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

export type CorroboratedProxy = ImplementationProxy | BeaconProxy;

export type SourceResolutionRequest = Readonly<{
  chainId: 16661;
  address: HexAddress;
  runtimeCodeHash: Bytes32;
  sourceBlock: ExpectedSourceBlock;
}>;

export interface VerifiedSourceResolver {
  resolve(request: SourceResolutionRequest): Promise<unknown>;
}

export type ResolvedVerifiedSource = Readonly<{
  chainId: 16661;
  address: HexAddress;
  sourceBlockNumber: string;
  sourceBlockHash: Bytes32;
  runtimeCodeHash: Bytes32;
  provider: string;
  uri: string;
  rawResponseDigest: Bytes32;
  source: string;
  verifiedRuntimeMatch: true;
  verificationMethod: "PROVIDER_ASSERTED_RUNTIME_MATCH";
}>;

export type ContractCheckReport = Readonly<{
  kind: "CONTRACT_ANALYSIS";
  status: "PASS" | "FAIL";
  sourceBlockNumber: string;
  sourceBlockHash: Bytes32;
  runtimeCodeHash: Bytes32;
  proxy?: CorroboratedProxy;
  resolvedSource?: ResolvedVerifiedSource;
  sourcePatternSignals?: SourcePatternAnalysis;
  deterministicFindings: readonly string[];
  informationalFindings: readonly string[];
}>;

export type ContractCheckOptions = Readonly<{
  sourceBlock: ExpectedSourceBlock;
  sourceResolver?: VerifiedSourceResolver;
}>;

function normalizeAddress(value: unknown, label: string): HexAddress {
  if (typeof value !== "string") throw new Error(`Invalid source ${label} binding`);
  try {
    return getAddress(value) as HexAddress;
  } catch {
    throw new Error(`Invalid source ${label} binding`);
  }
}

function normalizeNonZeroBytes32(value: unknown, label: string): Bytes32 {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-fA-F]{64}$/.test(value)
    || value.toLowerCase() === ZERO_WORD
  ) {
    throw new Error(`Invalid source ${label}`);
  }
  return value.toLowerCase() as Bytes32;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_METADATA_LENGTH) {
    throw new Error(`Invalid source ${label}`);
  }
  return value;
}

function sourceResponse(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid verified source response");
  }
  return value as Record<string, unknown>;
}

export async function resolveVerifiedSource(
  resolver: VerifiedSourceResolver,
  target: Readonly<{ address: string; runtimeCodeHash: Bytes32 }>,
  sourceBlock: ExpectedSourceBlock,
): Promise<ResolvedVerifiedSource> {
  sourceBlock = validateExpectedSourceBlock(sourceBlock);
  const address = normalizeAddress(target.address, "address");
  const request = { chainId: 16661 as const, address, runtimeCodeHash: target.runtimeCodeHash, sourceBlock };
  const raw = sourceResponse(await resolver.resolve(request));
  if (typeof raw.source !== "string" || !raw.source.trim()) throw new Error("Invalid source source");
  if (new TextEncoder().encode(raw.source).byteLength > MAX_SOURCE_BYTES) {
    throw new Error("Verified source size exceeds byte limit");
  }
  if (
    raw.chainId !== 16661
    || normalizeAddress(raw.address, "address") !== address
    || raw.sourceBlockNumber !== sourceBlock.number.toString()
    || normalizeNonZeroBytes32(raw.sourceBlockHash, "block hash") !== sourceBlock.hash
    || normalizeNonZeroBytes32(raw.runtimeCodeHash, "runtime hash") !== target.runtimeCodeHash
    || raw.verifiedRuntimeMatch !== true
  ) {
    throw new Error("Verified source binding mismatch");
  }
  return deepFreeze({
    chainId: 16661,
    address,
    sourceBlockNumber: sourceBlock.number.toString(),
    sourceBlockHash: sourceBlock.hash,
    runtimeCodeHash: target.runtimeCodeHash,
    provider: boundedText(raw.provider, "provider"),
    uri: boundedText(raw.uri, "URI"),
    rawResponseDigest: normalizeNonZeroBytes32(raw.rawResponseDigest, "raw response digest"),
    source: raw.source,
    verifiedRuntimeMatch: true,
    verificationMethod: "PROVIDER_ASSERTED_RUNTIME_MATCH",
  });
}

function addressFromWord(value: string, label: string): HexAddress | undefined {
  if (!isHexString(value, 32)) throw new Error(`Invalid ${label}`);
  if (value.toLowerCase() === ZERO_WORD) return undefined;
  if (!/^0x0{24}/i.test(value)) throw new Error(`Invalid ${label}`);
  return normalizeAddress(`0x${value.slice(-40)}`, label);
}

function assertTargetAddress(target: HexAddress, subject: HexAddress, label: string): void {
  if (target.toLowerCase() === ZERO_ADDRESS) throw new Error(`${label} target is zero`);
  if (target === subject) throw new Error(`${label} target points to self`);
}

async function liveCodeHash(
  adapter: SubjectChainAdapter,
  target: HexAddress,
  subject: HexAddress,
  blockTag: bigint,
  label: string,
): Promise<Bytes32> {
  assertTargetAddress(target, subject, label);
  const code = normalizeRuntimeCode(await adapter.getCode(target, blockTag));
  if (code === "0x") throw new Error(`${label} proxy candidate has no live code`);
  return keccak256(code) as Bytes32;
}

async function implementationProxy(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  blockTag: bigint,
): Promise<ImplementationProxy | undefined> {
  const word = await adapter.getStorage(subject.address, EIP1967_IMPLEMENTATION_SLOT, blockTag);
  const implementationAddress = addressFromWord(word, "EIP-1967 implementation storage word");
  if (!implementationAddress) return undefined;
  return {
    kind: "EIP1967_IMPLEMENTATION",
    implementationAddress,
    implementationCodeHash: await liveCodeHash(
      adapter, implementationAddress, subject.address, blockTag, "EIP-1967 implementation",
    ),
  };
}

async function beaconProxy(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  blockTag: bigint,
): Promise<BeaconProxy | undefined> {
  const word = await adapter.getStorage(subject.address, EIP1967_BEACON_SLOT, blockTag);
  const beaconAddress = addressFromWord(word, "EIP-1967 beacon storage word");
  if (!beaconAddress) return undefined;
  const beaconCodeHash = await liveCodeHash(
    adapter, beaconAddress, subject.address, blockTag, "EIP-1967 beacon",
  );
  const result = await adapter.call(
    { to: beaconAddress, data: BEACON_IMPLEMENTATION_SELECTOR },
    blockTag,
  );
  const implementationAddress = addressFromWord(result, "beacon implementation response");
  if (!implementationAddress) throw new Error("Beacon proxy candidate returned zero implementation");
  if (implementationAddress === beaconAddress) throw new Error("Beacon implementation points to beacon self");
  const implementationCodeHash = await liveCodeHash(
    adapter, implementationAddress, subject.address, blockTag, "Beacon implementation",
  );
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
  return match ? normalizeAddress(`0x${match[1]}`, "minimal proxy target") : undefined;
}

async function detectProxy(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  blockTag: bigint,
): Promise<CorroboratedProxy | undefined> {
  const implementation = await implementationProxy(adapter, subject, blockTag);
  if (implementation) return implementation;
  const beacon = await beaconProxy(adapter, subject, blockTag);
  if (beacon) return beacon;
  const implementationAddress = minimalProxyTarget(subject.runtimeCode);
  if (!implementationAddress) return undefined;
  return {
    kind: "EIP1167_MINIMAL",
    implementationAddress,
    implementationCodeHash: await liveCodeHash(
      adapter, implementationAddress, subject.address, blockTag, "EIP-1167 implementation",
    ),
  };
}

function sourceTarget(subject: ClassifiedSubject, proxy?: CorroboratedProxy) {
  return proxy
    ? { address: proxy.implementationAddress, runtimeCodeHash: proxy.implementationCodeHash }
    : { address: subject.address, runtimeCodeHash: subject.runtimeCodeHash };
}

export async function inspectContract(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  options: ContractCheckOptions,
): Promise<ContractCheckReport> {
  if (subject.kind !== "CONTRACT") throw new Error("Contract checks require a contract subject");
  const sourceBlock = await assertExpectedSourceBlock(adapter, options.sourceBlock);
  if (
    subject.sourceBlockNumber !== sourceBlock.number.toString()
    || subject.sourceBlockHash !== sourceBlock.hash
  ) {
    throw new Error("Contract check block does not match classification block");
  }
  const proxy = await detectProxy(adapter, subject, sourceBlock.number);
  const resolvedSource = options.sourceResolver
    ? await resolveVerifiedSource(options.sourceResolver, sourceTarget(subject, proxy), sourceBlock)
    : undefined;
  const sourcePatternSignals = resolvedSource
    ? analyzeSolidityPatterns(resolvedSource.source)
    : undefined;
  await assertExpectedSourceBlock(adapter, sourceBlock);
  return deepFreeze({
    kind: "CONTRACT_ANALYSIS",
    status: "PASS",
    sourceBlockNumber: sourceBlock.number.toString(),
    sourceBlockHash: sourceBlock.hash,
    runtimeCodeHash: subject.runtimeCodeHash,
    ...(proxy ? { proxy } : {}),
    ...(resolvedSource ? { resolvedSource, sourcePatternSignals } : {}),
    deterministicFindings: [],
    informationalFindings: sourcePatternSignals?.findings
      .slice(0, 100)
      .map((item) => `${item.id}:${item.functionName}`) ?? [],
  });
}
