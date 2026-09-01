import { JsonRpcProvider, VoidSigner } from "ethers";

import { apiErrorResponse, methodNotAllowedResponse } from "@/server/prooflock/api";
import { createEthersRegistryChainAdapter } from "@/server/prooflock/chain";
import { createDiscoveryHandler, type DiscoveryDependencies } from "@/server/prooflock/discovery";
import { createProductionDiscoveryDetailReader } from "@/server/prooflock/read-api";
import { assertZeroGMainnetRpc } from "@/server/prooflock/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Discovery reads + verifies each candidate's evidence (a 0G Storage download per agent), so a
// populated leaderboard needs headroom beyond the default function budget.
export const maxDuration = 60;

// 0G RPC serves wide getLogs ranges for this low-volume event, so we scan a generous recent window
// (well beyond a single lease's lifecycle) rather than the last ~40 minutes. Still "recent finalized
// activity", not a complete index, but wide enough to surface active leases on the leaderboard.
const WINDOW = 100_000;
const CAP = 100;
const CONCURRENCY = 6;
const READ_ONLY_SIGNER = "0x0000000000000000000000000000000000000001";

export async function GET(request: Request): Promise<Response> {
  try {
    const rpc = requiredRpc(process.env.ZERO_G_RPC || process.env.NEXT_PUBLIC_RPC_URL);
    const registryAddress = requiredAddress(process.env.PROOFLOCK_REGISTRY_V2_ADDRESS);
    const confirmations = positiveInteger(process.env.PROOFLOCK_REGISTRY_V2_CONFIRMATIONS ?? "5", 128);
    return createDiscoveryHandler(productionDependencies(rpc, registryAddress), {
      registryAddress, confirmations, window: WINDOW, cap: CAP, concurrency: CONCURRENCY,
    })(request);
  } catch (error) {
    return apiErrorResponse(error, { code: "DEPENDENCY_UNAVAILABLE", message: "ProofLock discovery is unavailable",
      stage: "READING_PROOF", retryable: true, status: 503 });
  }
}

export const POST = () => methodNotAllowedResponse("READING_PROOF");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;

function productionDependencies(rpc: string, registryAddress: string): DiscoveryDependencies {
  const provider = new JsonRpcProvider(rpc);
  const adapter = createEthersRegistryChainAdapter(provider,
    new VoidSigner(READ_ONLY_SIGNER, provider), registryAddress);
  const readDetail = createProductionDiscoveryDetailReader();
  return Object.freeze({
    assertChain: (signal) => assertZeroGMainnetRpc(rpc, signal),
    getLatestBlock: (signal) => abortable(provider.getBlockNumber(), signal),
    getBlock: (blockNumber, signal) => abortable(provider.getBlock(blockNumber), signal),
    getLogs: (filter, signal) => abortable(provider.getLogs({ ...filter, topics: [...filter.topics] }), signal),
    readProofLock: (identityKey, blockNumber, signal) => adapter.getProofLock(
      identityKey as `0x${string}`, signal, blockNumber),
    readProofLockDetail: readDetail,
    now: () => new Date(),
  });
}

function requiredRpc(value: string | undefined): string {
  if (!value) throw new Error("RPC is not configured");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("RPC must use HTTPS");
  return url.href;
}

function requiredAddress(value: string | undefined): string {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new Error("Registry is invalid");
  return value;
}

function positiveInteger(value: string, maximum: number): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Discovery finality is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error("Discovery finality is invalid");
  return parsed;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
