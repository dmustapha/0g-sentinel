import { JsonRpcProvider } from "ethers";

import { apiErrorResponse, methodNotAllowedResponse } from "@/server/prooflock/api";
import { REGISTRY_V2_INTERFACE } from "@/server/prooflock/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAIN_ID = 16661;
const WINDOW = 2_000;

export async function GET(request: Request): Promise<Response> {
  try {
    const rpc = process.env.ZERO_G_RPC || process.env.NEXT_PUBLIC_RPC_URL;
    const registry = process.env.PROOFLOCK_REGISTRY_V2_ADDRESS;
    if (!rpc || !registry || !/^0x[0-9a-fA-F]{40}$/.test(registry)) throw new Error();
    const provider = new JsonRpcProvider(rpc, CHAIN_ID, { staticNetwork: true });
    request.signal.throwIfAborted();
    const latestBlock = await provider.getBlockNumber();
    const logs = await provider.getLogs({
      address: registry, topics: [REGISTRY_V2_INTERFACE.getEvent("ProofLocked")!.topicHash],
      fromBlock: Math.max(0, latestBlock - WINDOW), toBlock: latestBlock,
    });
    const identities = uniqueProofLocks(logs);
    return response({ identities, latestBlock, fromBlock: Math.max(0, latestBlock - WINDOW) });
  } catch (error) {
    return apiErrorResponse(error, { code: "DEPENDENCY_UNAVAILABLE", message: "ProofLock discovery is unavailable",
      stage: "READING_PROOF", retryable: true, status: 503 });
  }
}
export const POST = () => methodNotAllowedResponse("READING_PROOF");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;

function uniqueProofLocks(logs: readonly Readonly<{ topics: readonly string[]; transactionHash: string; blockNumber: number }>[]) {
  const records = new Map<string, { identityKey: string; transactionHash: string; blockNumber: number }>();
  for (const log of logs) {
    const identityKey = log.topics[1]?.toLowerCase();
    if (identityKey) records.set(identityKey, { identityKey, transactionHash: log.transactionHash, blockNumber: log.blockNumber });
  }
  return [...records.values()].sort((left, right) => right.blockNumber - left.blockNumber).slice(0, 100);
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=15, stale-while-revalidate=45",
    "x-content-type-options": "nosniff",
  } });
}
