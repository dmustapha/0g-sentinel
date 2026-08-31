import { createReadOnlyInferenceBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { Interface, JsonRpcProvider, keccak256 } from "ethers";

import type { HealthProbe, HealthProbeDependencies } from "../../lib/pulse";
import { REGISTRY_V2_INTERFACE } from "./chain";
import { resolveExpectedSigner, resolveService, validateBaseUrl } from "./compute/service";
import { computeZeroGLayout, STORAGE_VERIFICATION_CAPABILITY } from "./storage";
import { assertZeroGMainnetRpc } from "./rpc";
import { ERC8004_IDENTITY_REGISTRY } from "./types";

const CHAIN_ID = 16661n;
const TIMEOUT_MS = 5_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const IDENTITY = new Interface(["function ownerOf(uint256 agentId) view returns (address)"]);
const GATE = new Interface(["function registry() view returns (address)", "function identityRegistry() view returns (address)"]);

export function createProductionHealthProbes(env = process.env): HealthProbeDependencies {
  const rpcUrl = env.ZERO_G_RPC || env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
  const provider = new JsonRpcProvider(rpcUrl);
  return Object.freeze({
    rpc: bounded((signal) => probeRpc(rpcUrl, provider, signal)),
    identity: bounded((signal) => probeIdentity(rpcUrl, provider, env.PROOFLOCK_HEALTH_AGENT_ID, signal)),
    registry: bounded((signal) => probeRegistry(rpcUrl, provider, env.PROOFLOCK_REGISTRY_V2_ADDRESS,
      env.PROOFLOCK_HEALTH_IDENTITY_KEY, env.PROOFLOCK_STORAGE_CANARY_ROOT, signal)),
    gate: bounded((signal) => probeGate(rpcUrl, provider, env.PROOFLOCK_AGENT_GATE_V2_ADDRESS, env.PROOFLOCK_REGISTRY_V2_ADDRESS, signal)),
    compute: bounded((signal) => probeCompute(rpcUrl, env, signal)),
    storage: bounded((signal) => probeStorage(env.ZERO_G_STORAGE_INDEXER, env.PROOFLOCK_STORAGE_CANARY_ROOT, signal)),
  });
}

async function probeRpc(rpcUrl: string, provider: JsonRpcProvider, signal: AbortSignal) {
  await assertZeroGMainnetRpc(rpcUrl, signal);
  signal.throwIfAborted();
  const [network, block] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
  if (network.chainId !== CHAIN_ID) throw new Error("wrong chain");
  return { chainId: Number(network.chainId), blockNumber: block };
}

async function probeIdentity(rpcUrl: string, provider: JsonRpcProvider, agentId: string | undefined, signal: AbortSignal) {
  if (!agentId || !/^(0|[1-9]\d*)$/.test(agentId)) return null;
  await assertZeroGMainnetRpc(rpcUrl, signal);
  const code = await requireCode(provider, ERC8004_IDENTITY_REGISTRY, signal);
  const raw = await provider.call({ to: ERC8004_IDENTITY_REGISTRY, data: IDENTITY.encodeFunctionData("ownerOf", [BigInt(agentId)]) });
  const owner = String(IDENTITY.decodeFunctionResult("ownerOf", raw)[0]);
  return { bytecodeHash: keccak256(code), agentId, owner };
}

async function probeRegistry(rpcUrl: string, provider: JsonRpcProvider, address: string | undefined, key: string | undefined,
  canaryRoot: string | undefined, signal: AbortSignal) {
  if (!validAddress(address) || !validBytes32(key) || !validBytes32(canaryRoot)) return null;
  await assertZeroGMainnetRpc(rpcUrl, signal);
  const code = await requireCode(provider, address, signal);
  const raw = await provider.call({ to: address, data: REGISTRY_V2_INTERFACE.encodeFunctionData("getProofLock", [key]) });
  const record = REGISTRY_V2_INTERFACE.decodeFunctionResult("getProofLock", raw)[0];
  // Confirm a live sealed lease exists for the canary identity. We do NOT pin the exact storageRoot
  // here because the public scan/reseal flow legitimately advances it on every new seal; retrieval
  // of the canary evidence is verified independently by the storage probe.
  if (BigInt(record.version) < 1n || /^0x0{64}$/i.test(String(record.storageRoot))) {
    throw new Error("registry canary mismatch");
  }
  return { address: address.toLowerCase(), bytecodeHash: keccak256(code), identityKey: key.toLowerCase(), version: String(record.version) };
}

async function probeGate(rpcUrl: string, provider: JsonRpcProvider, gate: string | undefined, registry: string | undefined, signal: AbortSignal) {
  if (!validAddress(gate) || !validAddress(registry)) return null;
  await assertZeroGMainnetRpc(rpcUrl, signal);
  const code = await requireCode(provider, gate, signal);
  const [registryRaw, identityRaw] = await Promise.all([
    provider.call({ to: gate, data: GATE.encodeFunctionData("registry") }),
    provider.call({ to: gate, data: GATE.encodeFunctionData("identityRegistry") }),
  ]);
  const pointer = String(GATE.decodeFunctionResult("registry", registryRaw)[0]).toLowerCase();
  const identityPointer = String(GATE.decodeFunctionResult("identityRegistry", identityRaw)[0]).toLowerCase();
  if (pointer !== registry.toLowerCase() || identityPointer !== ERC8004_IDENTITY_REGISTRY) throw new Error("gate pointer mismatch");
  return { address: gate.toLowerCase(), bytecodeHash: keccak256(code), registry: pointer, identityRegistry: identityPointer };
}

async function probeCompute(rpcUrl: string, env: NodeJS.ProcessEnv, signal: AbortSignal) {
  const model = env.PROOFLOCK_COMPUTE_MODEL;
  const provider = env.PROOFLOCK_COMPUTE_PROVIDER;
  if (!model || !validAddress(provider)) return null;
  await assertZeroGMainnetRpc(rpcUrl, signal);
  const broker = await raceAbort(createReadOnlyInferenceBroker(rpcUrl, Number(CHAIN_ID)), signal);
  return probeComputeService(broker, provider, model, signal);
}

export async function probeComputeService(
  broker: Readonly<{ listService(offset: number, limit: number, includeUnacknowledged: boolean): Promise<readonly unknown[]> }>,
  provider: string,
  model: string,
  signal: AbortSignal,
) {
  const service = await resolveService(broker, provider.toLowerCase(), model, signal);
  validateBaseUrl(service.url);
  const expectedSigner = resolveExpectedSigner(service);
  return { observation: "SERVICE_DISCOVERY", proofClass: "DECENTRALIZED_MODEL_TEE", provider: provider.toLowerCase(), model,
    expectedSigner, signerAcknowledged: true, paidInference: false, inferenceExecuted: false };
}

async function probeStorage(indexerUrl: string | undefined, root: string | undefined, signal: AbortSignal) {
  if (!indexerUrl || !validBytes32(root)) return null;
  const endpoint = new URL(indexerUrl);
  if (endpoint.protocol !== "https:") throw new Error("unsafe storage endpoint");
  signal.throwIfAborted();
  const [blob, error] = await raceAbort(new Indexer(endpoint.href).downloadToBlob(root, { proof: true }), signal);
  if (error) throw error;
  if (blob.size === 0 || blob.size > 1_048_576) throw new Error("invalid canary bytes");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const layout = await computeZeroGLayout(bytes, "0x0000000000000000000000000000000000000001");
  if (layout.storageRoot.toLowerCase() !== root.toLowerCase()) throw new Error("canary root mismatch");
  return { observation: "RETRIEVAL_CANARY", root: root.toLowerCase(), retrievalVerified: true,
    networkProofVerified: STORAGE_VERIFICATION_CAPABILITY.networkProofVerified };
}

async function requireCode(provider: JsonRpcProvider, address: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error("contract unavailable");
  return code;
}

function bounded(operation: HealthProbe): HealthProbe {
  return async (parent) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, TIMEOUT_MS);
    try { return await raceAbort(operation(controller.signal), controller.signal); }
    finally { clearTimeout(timer); parent.removeEventListener("abort", abort); }
  };
}

function validAddress(value: string | undefined): value is string { return Boolean(value && ADDRESS.test(value) && !/^0x0{40}$/i.test(value)); }
function validBytes32(value: string | undefined): value is string { return Boolean(value && BYTES32.test(value) && !/^0x0{64}$/i.test(value)); }

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
