import { id, Interface, type Provider, type TransactionRequest } from "ethers";

import { IdentityError } from "../errors";
import {
  ERC8004_IDENTITY_REGISTRY,
  type AgentIdentity,
  type Bytes32,
  type HexAddress,
  type ResolvedAgentIdentity,
} from "../types";
import {
  loadRegistrationCard,
  type CardLoaderOptions,
} from "./card";

const UINT256_MAX = (1n << 256n) - 1n;
const DEFAULT_FINALITY_CONFIRMATIONS = 5;
const NONEXISTENT_TOKEN_SELECTOR = id("ERC721NonexistentToken(uint256)").slice(0, 10);
const REGISTRY_INTERFACE = new Interface([
  "function ownerOf(uint256 agentId) view returns (address)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);

export type IdentityChainAdapter = Readonly<{
  getChainId(): Promise<bigint>;
  getLatestBlockNumber(): Promise<bigint>;
  getBlock(blockNumber: bigint): Promise<Readonly<{ number: bigint; hash: string }> | null>;
  getCode(address: string, blockTag: bigint): Promise<string>;
  ownerOf(agentId: bigint, blockTag: bigint): Promise<string>;
  tokenURI(agentId: bigint, blockTag: bigint): Promise<string>;
  getAgentWallet(agentId: bigint, blockTag: bigint): Promise<string>;
}>;

export type ResolveIdentityOptions = Readonly<{
  provider?: Provider;
  adapter?: IdentityChainAdapter;
  finalityConfirmations?: number;
  sourceBlockNumber?: bigint;
  cardLoaderOptions?: CardLoaderOptions;
}>;

export async function resolveAgentIdentity(
  input: AgentIdentity,
  options: ResolveIdentityOptions,
): Promise<ResolvedAgentIdentity> {
  const identity = validateIdentity(input);
  const adapter = resolveAdapter(options);
  await requireMainnet(adapter);
  const blockNumber = options.sourceBlockNumber === undefined
    ? await finalizedBlock(adapter, options.finalityConfirmations)
    : explicitSourceBlock(options.sourceBlockNumber);
  const block = await loadSourceBlock(adapter, blockNumber);
  await requireRegistry(adapter, blockNumber);
  const agentId = BigInt(identity.agentId);
  const owner = await readOwner(adapter, agentId, blockNumber);
  const agentURI = await readAgentUri(adapter, agentId, blockNumber);
  const agentWallet = await readAgentWallet(adapter, agentId, blockNumber);
  const registration = await loadRegistrationCard(
    agentURI,
    identity,
    options.cardLoaderOptions,
  );
  await assertSourceBlockUnchanged(adapter, block);
  return deepFreeze({
    identity,
    owner,
    agentWallet,
    agentURI,
    registrationDigest: registration.registrationDigest,
    sourceBlockNumber: blockNumber.toString(),
    sourceBlockHash: normalizeBytes32(block.hash),
    card: registration.card,
  });
}

function explicitSourceBlock(value: bigint): bigint {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) invalidIdentity();
  return value;
}

async function assertSourceBlockUnchanged(
  adapter: IdentityChainAdapter,
  source: Readonly<{ number: bigint; hash: string }>,
): Promise<void> {
  const current = await loadSourceBlock(adapter, source.number);
  if (normalizeBytes32(current.hash) !== normalizeBytes32(source.hash)) {
    throw new IdentityError("REGISTRY_UNAVAILABLE", "registry", true);
  }
}

export function createErc8004Adapter(provider: Provider): IdentityChainAdapter {
  const registry = ERC8004_IDENTITY_REGISTRY;
  return Object.freeze({
    getChainId: async () => (await provider.getNetwork()).chainId,
    getLatestBlockNumber: async () => BigInt(await provider.getBlockNumber()),
    getBlock: async (number) => {
      const block = await provider.getBlock(Number(number));
      return block?.hash ? { number: BigInt(block.number), hash: block.hash } : null;
    },
    getCode: (address, blockTag) => provider.getCode(address, Number(blockTag)),
    ownerOf: (agentId, blockTag) => callRegistry(provider, registry, "ownerOf", agentId, blockTag),
    tokenURI: (agentId, blockTag) => callRegistry(provider, registry, "tokenURI", agentId, blockTag),
    getAgentWallet: (agentId, blockTag) =>
      callRegistry(provider, registry, "getAgentWallet", agentId, blockTag),
  });
}

async function callRegistry(
  provider: Provider,
  to: string,
  method: "ownerOf" | "tokenURI" | "getAgentWallet",
  agentId: bigint,
  blockTag: bigint,
): Promise<string> {
  const data = REGISTRY_INTERFACE.encodeFunctionData(method, [agentId]);
  const result = await provider.call({ to, data, blockTag: Number(blockTag) } as TransactionRequest);
  return REGISTRY_INTERFACE.decodeFunctionResult(method, result)[0] as string;
}

function validateIdentity(input: AgentIdentity): AgentIdentity {
  if (!input || input.namespace !== "eip155" || input.chainId !== 16661) invalidIdentity();
  if (typeof input.registryAddress !== "string" || typeof input.agentId !== "string") {
    invalidIdentity();
  }
  if (input.registryAddress.toLowerCase() !== ERC8004_IDENTITY_REGISTRY) invalidIdentity();
  if (!/^(0|[1-9]\d*)$/.test(input.agentId)) invalidIdentity();
  let agentId: bigint;
  try {
    agentId = BigInt(input.agentId);
  } catch {
    invalidIdentity();
  }
  if (agentId > UINT256_MAX) invalidIdentity();
  return Object.freeze({
    namespace: "eip155",
    chainId: 16661,
    registryAddress: ERC8004_IDENTITY_REGISTRY,
    agentId: agentId.toString(),
  });
}

function resolveAdapter(options: ResolveIdentityOptions): IdentityChainAdapter {
  if (options.adapter) return options.adapter;
  if (options.provider) return createErc8004Adapter(options.provider);
  invalidIdentity();
}

async function requireMainnet(adapter: IdentityChainAdapter): Promise<void> {
  let chainId: bigint;
  try {
    chainId = await adapter.getChainId();
  } catch {
    throw new IdentityError("WRONG_CHAIN", "identity", true);
  }
  if (chainId !== 16661n) throw new IdentityError("WRONG_CHAIN", "identity", false);
}

async function finalizedBlock(
  adapter: IdentityChainAdapter,
  confirmations = DEFAULT_FINALITY_CONFIRMATIONS,
): Promise<bigint> {
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 128) {
    invalidIdentity();
  }
  try {
    const latest = await adapter.getLatestBlockNumber();
    const depth = BigInt(confirmations);
    if (latest < depth) throw new Error("insufficient finalized history");
    return latest - depth;
  } catch {
    throw new IdentityError("REGISTRY_UNAVAILABLE", "registry", true);
  }
}

async function loadSourceBlock(adapter: IdentityChainAdapter, number: bigint) {
  try {
    const block = await adapter.getBlock(number);
    if (!block || block.number !== number) throw new Error("block unavailable");
    normalizeBytes32(block.hash);
    return block;
  } catch {
    throw new IdentityError("REGISTRY_UNAVAILABLE", "registry", true);
  }
}

async function requireRegistry(adapter: IdentityChainAdapter, blockTag: bigint): Promise<void> {
  try {
    const code = await adapter.getCode(ERC8004_IDENTITY_REGISTRY, blockTag);
    if (!/^0x[0-9a-fA-F]+$/.test(code) || /^0x0*$/i.test(code)) {
      throw new Error("registry absent");
    }
  } catch {
    throw new IdentityError("REGISTRY_UNAVAILABLE", "registry", true);
  }
}

async function readOwner(adapter: IdentityChainAdapter, agentId: bigint, blockTag: bigint) {
  try {
    return normalizeAddress(
      await adapter.ownerOf(agentId, blockTag),
      "REGISTRY_UNAVAILABLE",
      true,
    );
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    if (hasRevertSelector(error, NONEXISTENT_TOKEN_SELECTOR)) {
      throw new IdentityError("AGENT_NOT_FOUND", "registry", false);
    }
    throw new IdentityError("REGISTRY_UNAVAILABLE", "registry", true);
  }
}

function hasRevertSelector(error: unknown, selector: string): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length && seen.size < 32) {
    const value = pending.pop();
    if (typeof value === "string" && value.toLowerCase().startsWith(selector)) return true;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["data", "error", "info", "revert"]) {
      if (key in record) pending.push(record[key]);
    }
  }
  return false;
}

async function readAgentUri(adapter: IdentityChainAdapter, agentId: bigint, blockTag: bigint) {
  try {
    const uri = await adapter.tokenURI(agentId, blockTag);
    if (typeof uri !== "string" || uri.length === 0 || uri.length > 4096) throw new Error("bad URI");
    return uri;
  } catch {
    throw new IdentityError("AGENT_URI_UNAVAILABLE", "registry", true);
  }
}

async function readAgentWallet(adapter: IdentityChainAdapter, agentId: bigint, blockTag: bigint) {
  try {
    return normalizeAddress(await adapter.getAgentWallet(agentId, blockTag), "AGENT_WALLET_UNSET");
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError("REGISTRY_UNAVAILABLE", "registry", true);
  }
}

function normalizeAddress(
  value: string,
  zeroCode: "REGISTRY_UNAVAILABLE" | "AGENT_WALLET_UNSET",
  retryable = false,
) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new IdentityError(zeroCode, "registry", retryable);
  }
  const normalized = value.toLowerCase() as HexAddress;
  if (normalized === "0x0000000000000000000000000000000000000000") {
    throw new IdentityError(zeroCode, "registry", retryable);
  }
  return normalized;
}

function normalizeBytes32(value: string): Bytes32 {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new IdentityError("REGISTRY_UNAVAILABLE", "registry", true);
  }
  return value.toLowerCase() as Bytes32;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function invalidIdentity(): never {
  throw new IdentityError("INVALID_IDENTITY", "identity", false);
}
