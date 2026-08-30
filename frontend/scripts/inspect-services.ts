import { config } from "dotenv";
config({ path: "../.env" });
import { JsonRpcProvider, Wallet } from "ethers";
import { createProductionStrictComputeDependencies } from "../server/prooflock/compute/strict-broker";

async function main(): Promise<void> {
  const privateKey = process.env.PROOFLOCK_COMPUTE_PRIVATE_KEY!;
  const rpcUrl = process.env.ZERO_G_RPC || process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
  const stateDirectory = process.env.PROOFLOCK_STATE_DIRECTORY!;
  const deps = createProductionStrictComputeDependencies({ privateKey, rpcUrl, stateDirectory });
  const c = new AbortController();
  const services: any[] = [];
  for (let o = 0; o < 1000; o += 50) { const p = await deps.sdk.listService(o, 50, true, c.signal); services.push(...(p as any[])); if (p.length < 50) break; }
  for (const s of services) {
    let add: any = {}; try { add = JSON.parse(s.additionalInfo ?? "{}"); } catch {}
    console.log(JSON.stringify({ provider: s.provider, model: s.model, verifiability: s.verifiability, ack: s.teeSignerAcknowledged, signer: s.teeSignerAddress, TargetSeparated: add.TargetSeparated, ProviderType: add.ProviderType, url: s.url }));
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
