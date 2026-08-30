// §4 probe: does ANY non-proxied TeeML provider bind the REQUEST bytes exactly?
// runStrictCompute succeeds ONLY when the enclave-signed request hash == sha256(our bytes).
// It throws COMPUTE_REQUEST_BINDING_FAILED when the provider proxies/re-serializes.
// So the production path itself is the honest probe — no code change required.
import { config } from "dotenv";
config({ path: "../.env" });

import { JsonRpcProvider, Wallet } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

import {
  runStrictCompute,
  createProductionStrictComputeDependencies,
  StrictComputeError,
} from "../server/prooflock/compute/strict-broker";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;

function isSeparatedTeeMlSigner(s: any): boolean {
  let additional: any = {};
  try { additional = JSON.parse(s.additionalInfo ?? "{}"); } catch { return false; }
  const signer = String(s.teeSignerAddress ?? "");
  return (
    s.verifiability === "TeeML" &&
    s.teeSignerAcknowledged === true &&
    additional.TargetSeparated === true &&
    addressPattern.test(signer) &&
    !/^0x0{40}$/i.test(signer) &&
    signer.toLowerCase() !== String(s.provider ?? "").toLowerCase()
  );
}

function causeChain(error: unknown): string {
  const parts: string[] = [];
  let cur: any = error;
  for (let i = 0; i < 6 && cur; i++) {
    parts.push(`${cur?.name ?? typeof cur}: ${cur?.message ?? String(cur)}`);
    cur = cur?.cause;
  }
  return parts.join("  <=  ");
}

function providerIdentity(signedText: string | undefined): string {
  if (!signedText) return "?";
  const parts = signedText.split(":");
  return parts.length >= 4 ? parts[3] : "?";
}

async function main(): Promise<void> {
  const privateKey = must("PROOFLOCK_COMPUTE_PRIVATE_KEY");
  const rpcUrl = process.env.ZERO_G_RPC || process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
  const stateDirectory = must("PROOFLOCK_STATE_DIRECTORY");

  const provider = new JsonRpcProvider(rpcUrl);
  const net = await provider.getNetwork();
  console.log(`RPC ${rpcUrl} chainId=${net.chainId}`);
  if (net.chainId !== 16661n) throw new Error(`expected chainId 16661, got ${net.chainId}`);

  const wallet = new Wallet(privateKey, provider);
  console.log(`compute wallet ${wallet.address}`);
  const broker = await createZGComputeNetworkBroker(wallet);
  const ledger = await broker.ledger.getLedger();
  console.log(`ledger totalBalance=${ledger.totalBalance} availableBalance=${ledger.availableBalance} (neuron; 1e18=1 OG)`);

  const deps = createProductionStrictComputeDependencies({ privateKey, rpcUrl, stateDirectory });

  const controller = new AbortController();
  const services: any[] = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const page = await deps.sdk.listService(offset, 50, true, controller.signal);
    services.push(...(page as any[]));
    if (page.length < 50) break;
  }
  console.log(`listed ${services.length} services`);

  const only = process.env.PROBE_ONLY?.toLowerCase();
  const candidates = services.filter(isSeparatedTeeMlSigner).filter((c) => !only || String(c.provider).toLowerCase() === only);
  const byProvider = new Map<string, any>();
  for (const c of candidates) if (!byProvider.has(String(c.provider).toLowerCase())) byProvider.set(String(c.provider).toLowerCase(), c);
  console.log(`separated-TeeML acknowledged candidates: ${byProvider.size}`);
  for (const c of byProvider.values()) console.log(`  ${c.provider}  model=${c.model}  url=${c.url}`);

  const results: any[] = [];
  for (const c of byProvider.values()) {
    const label = `${c.provider} (${c.model})`;
    process.stdout.write(`\nPROBE ${label} ... `);
    try {
      const r = await runStrictCompute({
        chainId: 16661,
        purpose: "behavioral-risk",
        provider: String(c.provider),
        model: String(c.model),
        systemPrompt: 'You are a JSON API. Reply with exactly {"ok":true} and nothing else.',
        userMessage: "ping",
        spendAuthorized: true,
        timeoutMs: 60_000,
        maxResponseBytes: 65_536,
      }, deps);
      const ident = providerIdentity(r.contentBinding.signedText);
      console.log(`REQUEST EXACT ✅  identity=${ident}  signer=${r.contentBinding.expectedSigner}`);
      results.push({ provider: c.provider, model: c.model, requestExact: true, identity: ident });
    } catch (error) {
      const code = error instanceof StrictComputeError ? (error as any).code : "?";
      const msg = error instanceof Error ? error.message : String(error);
      const verdict = code === "COMPUTE_REQUEST_BINDING_FAILED" ? "REQUEST PROXIED (mismatch)" : `ERROR ${code}`;
      console.log(`${verdict} :: ${msg}`);
      console.log(`    cause: ${causeChain(error)}`);
      results.push({ provider: c.provider, model: c.model, requestExact: false, code, msg });
    }
  }

  console.log("\n=== SUMMARY ===");
  const exact = results.filter((r) => r.requestExact);
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nProviders binding REQUEST exactly: ${exact.length}`);
  if (exact.length > 0) console.log("→ A direct provider exists; PREFER it, no relaxation needed.");
  else console.log("→ No direct provider binds request exactly; §4 request relaxation is justified.");
}

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
