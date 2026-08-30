import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { JsonRpcProvider, Wallet } from "ethers";

const privateKey = process.env.SENTINEL_0G_PRIVATE_KEY;
const rpcUrl = process.env.SENTINEL_0G_RPC_URL;
if (!privateKey || !rpcUrl || !process.send) process.exit(78);

process.once("message", async (message) => {
  try {
    const broker = await createZGComputeNetworkBroker(new Wallet(privateKey, new JsonRpcProvider(rpcUrl)));
    const value = await execute(broker, message);
    process.send({ ok: true, value }, () => process.exit(0));
  } catch (error) {
    process.send({ ok: false, error: error instanceof Error ? error.message : String(error) }, () => process.exit(1));
  }
});

async function execute(broker, message) {
  if (message.action === "metadata") return await broker.inference.getServiceMetadata(message.provider, message.model);
  if (message.action === "headers") return await broker.inference.getRequestHeaders(message.provider, message.content);
  if (message.action === "services") {
    const values = await broker.inference.listService(message.offset, message.limit, message.includeUnacknowledged);
    return values.map(normalizeService);
  }
  if (message.action === "process") return await processResponse(broker, message);
  throw new TypeError("unknown SDK worker action");
}

async function processResponse(broker, message) {
  const original = globalThis.fetch;
  globalThis.fetch = async (resource, init) => {
    const request = new Request(resource, init);
    if (request.method !== "GET" || request.url !== message.signatureUrl) throw new TypeError(`SDK worker egress blocked: ${request.method} ${request.url} != GET ${message.signatureUrl}`);
    if (request.headers.has("authorization") || request.headers.has("proxy-authorization")) throw new TypeError("SDK worker credential forwarding blocked");
    return new Response(Buffer.from(message.signatureBodyBase64, "base64"), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    return await broker.inference.processResponse(message.provider, message.chatId, message.usage);
  } finally {
    globalThis.fetch = original;
  }
}

function normalizeService(value) {
  const keys = ["provider", "url", "model", "additionalInfo", "verifiability", "teeSignerAddress", "teeSignerAcknowledged"];
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
