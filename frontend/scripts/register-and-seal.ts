// Register a batch of our own real 0G ERC-8004 agents (conformant cards) and seal each, to populate
// the leaderboard with genuine on-chain examples. Subjects use keys with varied nonces (activity),
// so the real behavioral feed produces varied, credible scores. Idempotent-ish; logs + continues.
import { config } from "dotenv";
config({ path: "../.env" });

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Contract, Interface, JsonRpcProvider, Wallet, parseEther } from "ethers";

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const ABI = [
  "function register() returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];
const STATE = "../.config-batch-agents.json";

function card(agentId: string): string {
  const doc = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `Sentinel Demo Agent ${agentId}`, description: "Example agent scanned by 0G Sentinel ProofLock.",
    active: true, registrations: [{ agentId: Number(agentId), agentRegistry: `eip155:16661:${REGISTRY.toLowerCase()}` }],
  };
  return "data:application/json;base64," + Buffer.from(JSON.stringify(doc)).toString("base64");
}

async function main(): Promise<void> {
  const rpcUrl = process.env.ZERO_G_RPC || "https://evmrpc.0g.ai";
  const provider = new JsonRpcProvider(rpcUrl);
  const funder = new Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
  const iface = new Interface(ABI);
  const state: Record<string, string> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};

  // Subject keys with varied activity: the funded deployer (high nonce) + the compute payer, plus
  // fresh keys (zero activity). Deterministic fresh keys so reruns reuse the same agents.
  const subjects: Array<{ label: string; key: string }> = [
    { label: "deployer(active)", key: process.env.DEPLOYER_PRIVATE_KEY! },
    { label: "compute(some)", key: process.env.PROOFLOCK_COMPUTE_PRIVATE_KEY! },
  ];
  for (let i = 1; i <= 8; i++) {
    const key = `0x${i.toString(16).padStart(2, "0").repeat(32)}`;
    subjects.push({ label: `fresh-${i}`, key });
  }

  const { loadProofLockRunner } = await import("../server/prooflock/operator.js");
  const runner = await loadProofLockRunner();
  const results: any[] = [];

  for (const { label, key } of subjects) {
    const subject = new Wallet(key, provider);
    process.stderr.write(`\n=== ${label} ${subject.address} ===\n`);
    try {
      // Fund the subject key enough for register + setAgentURI if it is nearly empty.
      const bal = await provider.getBalance(subject.address);
      if (bal < parseEther("0.02")) {
        const tx = await funder.sendTransaction({ to: subject.address, value: parseEther("0.05") });
        await tx.wait(2);
        process.stderr.write(`  funded ${label}\n`);
      }
      const registry = new Contract(REGISTRY, ABI, subject);
      let agentId = state[subject.address.toLowerCase()];
      if (agentId) {
        const w = await registry.getAgentWallet(agentId).catch(() => null);
        if (!w || w.toLowerCase() !== subject.address.toLowerCase()) agentId = "";
      }
      if (!agentId) {
        const tx = await registry.register();
        const rc = await tx.wait(2);
        const ev = rc.logs.map((l: any) => { try { return iface.parseLog(l); } catch { return null; } })
          .find((e: any) => e && e.name === "Registered");
        agentId = ev.args.agentId.toString();
        const uriTx = await registry.setAgentURI(agentId, card(agentId));
        await uriTx.wait(2);
        state[subject.address.toLowerCase()] = agentId;
        writeFileSync(STATE, JSON.stringify(state, null, 1));
        process.stderr.write(`  registered agentId ${agentId}\n`);
      }
      const identity = { namespace: "eip155" as const, chainId: 16661 as const, registryAddress: REGISTRY as `0x${string}`, agentId };
      const result: any = await runner.run({ identity, mode: "SEAL" }, (s: string) => process.stderr.write(`  ${agentId}: ${s}\n`));
      if (result.kind === "SEALED") {
        const v = result.writeOutcome?.version ?? result.chain?.expectedVersion;
        const score = result.compute?.behavioralScore;
        console.log(`OK ${label} agent ${agentId} SEALED v${v} behavioralScore=${score}`);
        results.push({ label, agentId, ok: true, score });
      } else {
        console.log(`SKIP ${label} agent ${agentId} -> ${result.kind}`);
        results.push({ label, agentId, ok: false, detail: result.kind });
      }
    } catch (error: any) {
      console.log(`FAIL ${label} -> ${(error?.code ?? error?.name ?? "ERROR")}: ${(error?.message ?? String(error)).slice(0, 90)}`);
      results.push({ label, ok: false, detail: error?.code ?? "ERROR" });
    }
  }
  const sealed = results.filter((r) => r.ok);
  console.log(`\n=== BATCH DONE: ${sealed.length}/${subjects.length} sealed ===`);
  console.log(JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
