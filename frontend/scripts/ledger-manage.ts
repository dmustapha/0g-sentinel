// 0G Compute ledger management: inspect / retrieve / transfer funds.
// Usage: npx tsx scripts/ledger-manage.ts <status|retrieve|retrieve-from <provider>|transfer <provider> <amountOG>>
import { config } from "dotenv";
config({ path: "../.env" });

import { JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "status";
  const pk = must("PROOFLOCK_COMPUTE_PRIVATE_KEY");
  const rpcUrl = process.env.ZERO_G_RPC || process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
  const provider = new JsonRpcProvider(rpcUrl);
  const net = await provider.getNetwork();
  if (net.chainId !== 16661n) throw new Error(`expected chainId 16661, got ${net.chainId}`);
  const wallet = new Wallet(pk, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  const printStatus = async () => {
    const l = await broker.ledger.getLedger();
    console.log(`wallet ${wallet.address}`);
    console.log(`ledger total=${formatEther(l.totalBalance)} OG  available=${formatEther(l.availableBalance)} OG`);
    const subs = await broker.ledger.getProvidersWithBalance("inference");
    console.log(`inference sub-accounts (provider, balance OG, pendingRefund OG):`);
    for (const [p, bal, pend] of subs) console.log(`  ${p}  ${formatEther(bal)}  ${formatEther(pend)}`);
    if (subs.length === 0) console.log("  (none)");
  };

  if (cmd === "status") { await printStatus(); return; }

  if (cmd === "retrieve") {
    console.log("retrieveFund('inference') ...");
    await broker.ledger.retrieveFund("inference");
    console.log("done."); await printStatus(); return;
  }

  if (cmd === "retrieve-from") {
    const p = must2(process.argv[3], "provider");
    console.log(`retrieveFundFromProvider('inference', ${p}) ...`);
    await broker.ledger.retrieveFundFromProvider("inference", p);
    console.log("done."); await printStatus(); return;
  }

  if (cmd === "transfer") {
    const p = must2(process.argv[3], "provider");
    const amountOG = must2(process.argv[4], "amountOG");
    const neuron = parseEther(amountOG);
    console.log(`transferFund(${p}, 'inference', ${neuron} neuron = ${amountOG} OG) ...`);
    await broker.ledger.transferFund(p, "inference", neuron);
    console.log("done."); await printStatus(); return;
  }

  throw new Error(`unknown command: ${cmd}`);
}

function must(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }
function must2(v: string | undefined, name: string): string { if (!v) throw new Error(`missing arg ${name}`); return v; }

main().catch((e) => { console.error(e); process.exitCode = 1; });
