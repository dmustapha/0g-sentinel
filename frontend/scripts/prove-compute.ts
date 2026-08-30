// Prove ONE real seal-grade compute proof end-to-end against the live funded 0G provider:
// strict broker succeeds -> offline re-verify passes. Records evidence to stdout + a JSON file.
import { config } from "dotenv";
config({ path: "../.env" });

import { writeFileSync } from "node:fs";
import { JsonRpcProvider, Wallet, formatEther } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

import { runStrictCompute, createProductionStrictComputeDependencies } from "../server/prooflock/compute/strict-broker";
import { resolveService } from "../server/prooflock/compute/service";
import { verifyOfflineComputeProof } from "../server/prooflock/offline-verifier";

async function main(): Promise<void> {
  const privateKey = must("PROOFLOCK_COMPUTE_PRIVATE_KEY");
  const rpcUrl = process.env.ZERO_G_RPC || process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
  const stateDirectory = must("PROOFLOCK_STATE_DIRECTORY");
  const provider = (process.env.PROVE_PROVIDER || must("PROOFLOCK_COMPUTE_PROVIDER")).toLowerCase();
  const model = process.env.PROVE_MODEL || must("PROOFLOCK_COMPUTE_MODEL");

  const rpc = new JsonRpcProvider(rpcUrl);
  const net = await rpc.getNetwork();
  if (net.chainId !== 16661n) throw new Error(`expected chainId 16661, got ${net.chainId}`);
  const wallet = new Wallet(privateKey, rpc);
  const broker = await createZGComputeNetworkBroker(wallet);
  const l = await broker.ledger.getLedger();
  console.log(`compute wallet ${wallet.address}`);
  console.log(`ledger total=${formatEther(l.totalBalance)} OG available=${formatEther(l.availableBalance)} OG`);
  console.log(`provider ${provider}  model ${model}`);

  const deps = createProductionStrictComputeDependencies({ privateKey, rpcUrl, stateDirectory });
  const c = new AbortController();
  const liveService = await resolveService(deps.sdk, provider, model, c.signal);
  console.log(`live service: url=${liveService.url} verifiability=${liveService.verifiability} signer=${liveService.teeSignerAddress} ack=${liveService.teeSignerAcknowledged}`);

  const systemPrompt = "You are a blockchain risk auditor. Respond ONLY with strict JSON of the form {\"riskScore\": <integer 0-100>, \"reason\": <short string>}.";
  const userMessage = "Wallet 0x311d2d024D8325033D2D9ABe0742412Df4d7C30A: 42 txns, no known scam interactions, holds a stable balance. Assess behavioral risk.";

  console.log("\nrunning strict compute (real paid inference) ...");
  const attempt = async () => runStrictCompute({
    chainId: 16661, purpose: "behavioral-risk", provider, model,
    systemPrompt, userMessage, spendAuthorized: true, timeoutMs: 90_000, maxResponseBytes: 131_072,
  }, deps);

  let result;
  for (let i = 1; i <= 3; i++) {
    try { result = await attempt(); break; }
    catch (e: any) {
      const code = e?.code ?? e?.name;
      console.log(`  attempt ${i} failed: ${code} :: ${e?.message}`);
      if (code !== "COMPUTE_RESPONSE_INVALID" || i === 3) throw e;
    }
  }
  if (!result) throw new Error("no result");

  const b = result.contentBinding;
  console.log("\n=== STRICT BROKER SUCCEEDED ===");
  console.log(`content: ${result.content}`);
  console.log(`chatId: ${result.proof.chatId}`);
  console.log(`enclave signer: ${b.expectedSigner}`);
  console.log(`signedText: ${b.signedText}`);
  console.log(`requestBytesExact: ${b.requestBytesExact}`);
  console.log(`requestDigest  (enclave-attested): ${result.proof.requestDigest}`);
  console.log(`requestSha256  (our raw bytes):    ${result.proof.requestSha256}`);
  console.log(`rawResponseSha256 (exact):         ${result.proof.rawResponseSha256}`);
  console.log(`responseDigest (keccak of content):${result.proof.responseDigest}`);
  console.log(`model served: ${result.proof.model}  registered: ${result.proof.serviceSnapshot?.model}`);
  console.log(`processResponseVerified: ${result.proof.processResponseVerified}`);

  console.log("\nrunning offline re-verification ...");
  const verdict = verifyOfflineComputeProof(result.proof, liveService);
  console.log("=== OFFLINE RE-VERIFY PASSED ===");
  console.log(JSON.stringify(verdict));

  const evidence = {
    at: process.env.PROVE_STAMP ?? null,
    provider, model, chainId: 16661,
    enclaveSigner: b.expectedSigner,
    chatId: result.proof.chatId,
    signedText: b.signedText,
    requestBytesExact: b.requestBytesExact,
    requestDigest: result.proof.requestDigest,
    requestSha256: result.proof.requestSha256,
    rawResponseSha256: result.proof.rawResponseSha256,
    responseDigest: result.proof.responseDigest,
    servedModel: result.proof.model,
    registeredModel: result.proof.serviceSnapshot?.model,
    content: result.content,
    offlineVerdict: verdict,
  };
  writeFileSync("../docs/context/real-compute-proof-evidence.json", JSON.stringify(evidence, null, 2));
  console.log("\nwrote docs/context/real-compute-proof-evidence.json");
}

function must(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }
main().catch((e) => { console.error(e); process.exitCode = 1; });
