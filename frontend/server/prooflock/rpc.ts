const CHAIN_ID = 16661n;
const MAX_RPC_BYTES = 4_096;
type RpcFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function assertZeroGMainnetRpc(
  rpcUrl: string,
  signal: AbortSignal,
  rpcFetch: RpcFetch = fetch,
): Promise<void> {
  const endpoint = requireHttps(rpcUrl);
  const body = JSON.stringify({ jsonrpc: "2.0", id: "sentinel-chain-id", method: "eth_chainId", params: [] });
  const response = await rpcFetch(endpoint, {
    method: "POST", body, signal, redirect: "error", cache: "no-store",
    headers: { "content-type": "application/json", accept: "application/json" },
  });
  if (!response.ok) throw new Error("0G RPC chain check failed");
  const value = JSON.parse(await readBounded(response, signal)) as Record<string, unknown>;
  if (value.id !== "sentinel-chain-id" || typeof value.result !== "string"
    || !/^0x[0-9a-fA-F]+$/.test(value.result) || BigInt(value.result) !== CHAIN_ID) {
    throw new Error("0G RPC returned the wrong chain");
  }
}

export async function guardedZeroGMainnetRead<T>(
  rpcUrl: string,
  signal: AbortSignal,
  operation: () => Promise<T>,
  rpcFetch: RpcFetch = fetch,
): Promise<T> {
  await assertZeroGMainnetRpc(rpcUrl, signal, rpcFetch);
  signal.throwIfAborted();
  return operation();
}

async function readBounded(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error("0G RPC response is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_RPC_BYTES) { await reader.cancel(); throw new Error("0G RPC response is too large"); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function requireHttps(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("0G RPC must use HTTPS");
  return url.href;
}
