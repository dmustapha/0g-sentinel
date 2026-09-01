import { getAddress, id, Interface, JsonRpcProvider, type Filter, type Log } from "ethers";

import { ERC8004_IDENTITY_REGISTRY } from "../types";

// Foolproof address -> agentId resolution for the canonical 0G mainnet ERC-8004 registry.
//
// There is no on-chain reverse getter (address -> agentId), so we find candidates from the indexed
// `owner` topic of the `Registered` event and then VERIFY each candidate on-chain: an address is
// only ever treated as an agent if `getAgentWallet(agentId) === address` currently holds. The event
// is a hint; the live on-chain wallet is the truth. If nothing verifies, the address is NOT a
// registered agent and must never be sealed as one.

const REGISTERED_TOPIC = id("Registered(uint256,string,address)");
const REGISTRY = new Interface(["function getAgentWallet(uint256 agentId) view returns (address)"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DEFAULT_WINDOW = 200_000;

export type AddressResolverDeps = Readonly<{
  latestBlock(): Promise<number>;
  getLogs(filter: Filter): Promise<readonly Log[]>;
  getAgentWallet(agentId: bigint): Promise<string>;
}>;

export type ResolveByAddressResult =
  | Readonly<{ status: "AGENT"; agentId: string }>
  | Readonly<{ status: "NOT_AN_AGENT" }>;

export function isEvmAddress(value: string): boolean {
  return ADDRESS.test(value);
}

export async function resolveAgentIdByAddress(
  address: string,
  deps: AddressResolverDeps,
  window = DEFAULT_WINDOW,
): Promise<ResolveByAddressResult> {
  if (!isEvmAddress(address)) return { status: "NOT_AN_AGENT" };
  const target = getAddress(address);
  const latest = await deps.latestBlock();
  const fromBlock = Math.max(0, latest - window);
  const paddedOwner = `0x${"0".repeat(24)}${target.slice(2).toLowerCase()}`;
  const logs = await deps.getLogs({ address: ERC8004_IDENTITY_REGISTRY,
    topics: [REGISTERED_TOPIC, null, paddedOwner], fromBlock, toBlock: latest });
  // Newest first: prefer the most recent registration whose wallet still resolves to the address.
  const candidates = dedupeAgentIds(logs);
  for (const agentId of candidates) {
    let wallet: string;
    try { wallet = await deps.getAgentWallet(agentId); }
    catch { continue; }
    if (ADDRESS.test(wallet) && getAddress(wallet) === target) {
      return { status: "AGENT", agentId: agentId.toString() };
    }
  }
  return { status: "NOT_AN_AGENT" };
}

function dedupeAgentIds(logs: readonly Log[]): bigint[] {
  const seen = new Set<string>();
  const ordered: bigint[] = [];
  for (const log of [...logs].sort((a, b) => b.blockNumber - a.blockNumber)) {
    const topic = log.topics[1];
    if (!topic) continue;
    const agentId = BigInt(topic);
    const key = agentId.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(agentId);
  }
  return ordered;
}

export function createProductionAddressResolver(env: NodeJS.ProcessEnv = process.env): AddressResolverDeps {
  const rpcUrl = env.ZERO_G_RPC || env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
  const provider = new JsonRpcProvider(rpcUrl);
  return Object.freeze({
    latestBlock: () => provider.getBlockNumber(),
    getLogs: (filter) => provider.getLogs(filter),
    getAgentWallet: async (agentId) => {
      const raw = await provider.call({ to: ERC8004_IDENTITY_REGISTRY,
        data: REGISTRY.encodeFunctionData("getAgentWallet", [agentId]) });
      return REGISTRY.decodeFunctionResult("getAgentWallet", raw)[0] as string;
    },
  });
}
