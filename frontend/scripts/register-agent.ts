// Register an ERC-8004 agent on the canonical 0G mainnet registry (0x8004a169…a432).
// The seal binds subject == agentWallet, and register() sets agentWallet = msg.sender, so we
// register FROM a dedicated controlled subject key. Idempotent; appends keys to ../.env.
import { config } from "dotenv";
config({ path: "../.env" });

import { readFileSync, writeFileSync } from "node:fs";
import { Contract, Interface, JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";
import { resolveAgentIdentity } from "../server/prooflock/identity/erc8004";

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const ENV_PATH = "../.env";
const ABI = [
  "function register() returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];

function setEnv(key: string, value: string): void {
  let env = readFileSync(ENV_PATH, "utf8");
  const re = new RegExp("^" + key + "=.*$", "m");
  if (re.test(env)) env = env.replace(re, key + "=" + value);
  else env += (env.endsWith("\n") ? "" : "\n") + key + "=" + value + "\n";
  writeFileSync(ENV_PATH, env);
}

function card(agentId: string): string {
  const doc = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Sentinel ProofLock Demo Agent",
    description: "Autonomous agent under Sentinel ProofLock behavioral + code risk attestation on 0G.",
    active: true,
    registrations: [{ agentId: Number(agentId), agentRegistry: `eip155:16661:${REGISTRY.toLowerCase()}` }],
  };
  return "data:application/json;base64," + Buffer.from(JSON.stringify(doc)).toString("base64");
}

async function main(): Promise<void> {
  const rpcUrl = process.env.ZERO_G_RPC || "https://evmrpc.0g.ai";
  const provider = new JsonRpcProvider(rpcUrl);
  if ((await provider.getNetwork()).chainId !== 16661n) throw new Error("wrong chainId");
  const deployer = new Wallet(must("DEPLOYER_PRIVATE_KEY"), provider);

  // Dedicated subject key (generate + persist once).
  let subjectPk = process.env.PROOFLOCK_SUBJECT_PRIVATE_KEY;
  if (!subjectPk) {
    const w = Wallet.createRandom();
    subjectPk = w.privateKey;
    setEnv("PROOFLOCK_SUBJECT_PRIVATE_KEY", subjectPk);
    setEnv("PROOFLOCK_SUBJECT_ADDRESS", w.address);
    console.log(`generated subject key ${w.address}`);
  }
  const subject = new Wallet(subjectPk, provider);
  console.log(`subject (agentWallet) ${subject.address}`);

  // Fund subject for register + setAgentURI if needed.
  const bal = await provider.getBalance(subject.address);
  console.log(`subject balance ${formatEther(bal)} OG`);
  if (bal < parseEther("0.03")) {
    console.log("funding subject 0.1 OG from deployer ...");
    const tx = await deployer.sendTransaction({ to: subject.address, value: parseEther("0.1") });
    console.log(`  fund tx ${tx.hash}`);
    await tx.wait(2);
  }

  const registry = new Contract(REGISTRY, ABI, subject);
  const iface = new Interface(ABI);

  let agentId = process.env.PROOFLOCK_AGENT_ID;
  if (agentId) {
    const wallet = await registry.getAgentWallet(agentId);
    if (wallet.toLowerCase() === subject.address.toLowerCase()) {
      console.log(`agent ${agentId} already registered to subject; skipping register`);
    } else {
      console.log(`env agentId ${agentId} wallet ${wallet} != subject; re-registering`);
      agentId = undefined;
    }
  }

  if (!agentId) {
    console.log("register() from subject ...");
    const tx = await registry.register();
    console.log(`  register tx ${tx.hash}`);
    const receipt = await tx.wait(2);
    const ev = receipt.logs.map((l: any) => { try { return iface.parseLog(l); } catch { return null; } })
      .find((e: any) => e && e.name === "Registered");
    if (!ev) throw new Error("no Registered event");
    const newId: string = String(ev.args.agentId);
    agentId = newId;
    console.log(`  agentId = ${newId}`);
    setEnv("PROOFLOCK_AGENT_ID", newId);
  }

  if (!agentId) throw new Error("agentId unresolved");
  // Set the registration card (backlink must carry this agentId).
  const uri = card(agentId);
  const current = await registry.tokenURI(agentId).catch(() => "");
  if (current !== uri) {
    console.log("setAgentURI(agentId, card) ...");
    const tx = await registry.setAgentURI(agentId, uri);
    console.log(`  setAgentURI tx ${tx.hash}`);
    await tx.wait(2);
  } else {
    console.log("tokenURI already matches card; skipping setAgentURI");
  }

  // On-chain verification.
  console.log("\n=== on-chain verification ===");
  console.log(`ownerOf(${agentId})       = ${await registry.ownerOf(agentId)}`);
  console.log(`getAgentWallet(${agentId})= ${await registry.getAgentWallet(agentId)}`);
  console.log(`tokenURI len              = ${(await registry.tokenURI(agentId)).length}`);

  // Off-chain: exercise the REAL runner identity resolution (fetches + validates the card).
  console.log("\n=== resolveAgentIdentity (real runner path) — waiting for finality ===");
  const identity = { namespace: "eip155" as const, chainId: 16661 as const, registryAddress: REGISTRY as `0x${string}`, agentId: agentId! };
  let resolved: any;
  for (let i = 0; i < 20; i++) {
    try { resolved = await resolveAgentIdentity(identity, { provider }); break; }
    catch (e: any) { console.log(`  attempt ${i + 1}: ${e?.message ?? e}`); await new Promise((r) => setTimeout(r, 3000)); }
  }
  if (!resolved) throw new Error("resolveAgentIdentity never succeeded");
  console.log(`resolved owner=${resolved.owner} agentWallet=${resolved.agentWallet} sourceBlock=${resolved.sourceBlockNumber}`);
  console.log(`registrationDigest=${resolved.registrationDigest}`);
  if (resolved.agentWallet.toLowerCase() !== subject.address.toLowerCase()) throw new Error("agentWallet mismatch");
  console.log("\nAGENT REGISTERED + RESOLVED OK.  agentId=" + agentId + "  subject=" + subject.address);
}

function must(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }
main().catch((e) => { console.error(e); process.exitCode = 1; });
