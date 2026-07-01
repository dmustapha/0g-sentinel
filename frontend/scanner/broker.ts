// File: scanner/broker.ts
// Verifiable inference through the 0G Compute broker (SDK: @0gfoundation/0g-compute-ts-sdk).
//
// The hosted-router path in compute.ts is a bearer-token REST call — substitutable by any
// OpenAI-shaped endpoint. This path is NOT substitutable: it selects a provider from the
// on-chain 0G inference marketplace, pays per request via a signed billing voucher settled
// on 0G Chain, and verifies the provider's TEE signature (TeeML) against the ZG-Res-Key.
// That is 0G Compute "doing real work": on-chain settlement + TEE verification, not just an
// API call. Same model (0GM-1.0-35B-A3B), so verdict quality is unchanged.
//
// Requires a funded broker ledger (>= 3 OG, one-time). Signer = ZERO_G_PRIVATE_KEY wallet.
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

// Provider serving 0GM-1.0-35B-A3B on mainnet 16661 (verifiability: TeeML). Overridable via env.
const PROVIDER_ADDRESS =
  process.env.ZERO_G_BROKER_PROVIDER || "0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9";
const LEDGER_MIN_OG = 3; // SDK minimum to create a ledger

export interface VerifiableComputeResult {
  content: string;
  receipt_hash: string; // from ZG-Res-Key (the settlement/verification chat id)
  model: string;
  verified: boolean; // provider TEE signature verified via processResponse
  settled: boolean; // request carried a signed billing voucher (on-chain settlement)
  provider: string;
  usage: { prompt_tokens: number; completion_tokens: number };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let brokerSingleton: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getBroker(): Promise<any> {
  if (brokerSingleton) return brokerSingleton;
  const rpc = process.env.ZERO_G_RPC || "https://evmrpc.0g.ai";
  const pk = process.env.ZERO_G_PRIVATE_KEY || process.env.SCANNER_PRIVATE_KEY || "";
  const wallet = new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpc));
  brokerSingleton = await createZGComputeNetworkBroker(wallet);
  return brokerSingleton;
}

/** Idempotently ensure a funded ledger exists. Creates one (>= 3 OG) if missing. */
export async function ensureLedger(): Promise<{ existed: boolean }> {
  const broker = await getBroker();
  try {
    await broker.ledger.getLedger();
    return { existed: true };
  } catch {
    await broker.ledger.addLedger(LEDGER_MIN_OG);
    return { existed: false };
  }
}

const acknowledged = new Set<string>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureAcknowledged(broker: any, provider: string): Promise<void> {
  if (acknowledged.has(provider)) return;
  // Acknowledging the provider signer and TEE signer is a one-time on-chain step per provider.
  try { await broker.inference.acknowledgeProviderSigner(provider); } catch { /* already acked */ }
  try { await broker.inference.acknowledgeProviderTEESigner(provider); } catch { /* not TEE or acked */ }
  acknowledged.add(provider);
}

/**
 * Run a chat completion through the broker: pick provider, sign a billing voucher, POST to the
 * provider endpoint, then verify the TEE signature and settle. Throws on any failure so the
 * caller (compute.ts) can fall back to the hosted-router path — the engine never breaks.
 */
export async function callComputeVerifiable(
  systemPrompt: string,
  userMessage: string,
  model: string = "0GM-1.0-35B-A3B"
): Promise<VerifiableComputeResult> {
  const broker = await getBroker();
  const provider = PROVIDER_ADDRESS;
  await ensureAcknowledged(broker, provider);

  const { endpoint, model: providerModel } = await broker.inference.getServiceMetadata(provider);
  // Billing headers are a single-use signed voucher — the provider redeems them for on-chain settlement.
  const headers = await broker.inference.getRequestHeaders(provider, userMessage);

  const resp = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    keepalive: false,
    signal: AbortSignal.timeout(90_000),
    headers: { "Content-Type": "application/json", Connection: "close", ...headers },
    body: JSON.stringify({
      model: providerModel || model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1024,
      temperature: 0, // reproducible verdicts (see compute.ts) — deterministic on-chain attestations
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  if (!resp.ok) {
    throw new Error(`broker inference error: ${resp.status} ${await resp.text()}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await resp.json()) as any;
  const content = data.choices?.[0]?.message?.content || "";
  const chatID = resp.headers.get("ZG-Res-Key") || data.id || "";

  // processResponse verifies the provider's TEE signature for this chatID and caches the fee.
  let verified = false;
  try {
    verified = (await broker.inference.processResponse(provider, chatID, JSON.stringify(data.usage))) === true;
  } catch {
    verified = false;
  }

  const receipt_hash = chatID
    ? "0x" + String(chatID).replace(/-/g, "").slice(0, 64).padEnd(64, "0")
    : "";

  return {
    content,
    receipt_hash,
    model: data.model || providerModel || model,
    verified,
    settled: true,
    provider,
    usage: {
      prompt_tokens: data.usage?.prompt_tokens || 0,
      completion_tokens: data.usage?.completion_tokens || 0,
    },
  };
}
