// File: scripts/seed-demo.ts
/**
 * Deploy seed agents and run full scans against them.
 * Run BEFORE demo: npx ts-node scripts/seed-demo.ts
 * Pre-seeds: Agent A (FLAGGED/CLEAN), Agent B (SAFE/VULNERABLE), Agent C (SAFE/CLEAN)
 */
import { runFullScan } from "../scanner/scanner";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

// Agent A: High-risk behavioral pattern (fund drain simulation)
const AGENT_A_SOURCE = `
pragma solidity ^0.8.0;
contract AgentA {
  address owner;
  constructor() { owner = msg.sender; }
  // Normal agent contract — behavioral scan detects synthetic fund drain
  function execute(address target, bytes calldata data) external { (bool ok,) = target.call(data); require(ok); }
}`;

// Agent B: Known reentrancy vulnerability
const AGENT_B_SOURCE = `
pragma solidity ^0.7.0;
contract AgentB {
  mapping(address => uint256) public balances;
  function deposit() external payable { balances[msg.sender] += msg.value; }
  function withdraw() external {
    uint256 amount = balances[msg.sender];
    (bool ok,) = msg.sender.call{value: amount}("");  // reentrancy: external call before state update
    require(ok);
    balances[msg.sender] = 0;  // state update AFTER call = reentrancy vulnerability
  }
}`;

// Agent C: Clean contract
const AGENT_C_SOURCE = `
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/access/Ownable.sol";
contract AgentC is Ownable {
  constructor() Ownable(msg.sender) {}
  function execute(address target, bytes calldata data) external onlyOwner returns (bytes memory) {
    (bool ok, bytes memory result) = target.call(data);
    require(ok, "execution failed");
    return result;
  }
}`;

// Use env-configured addresses or fixed demo addresses
const DEMO_AGENTS: Array<{ address: string; name: string; source: string }> = [
  {
    address: process.env.AGENT_A_ADDRESS || "0xAAAA000000000000000000000000000000000001",
    name: "Agent Alpha",
    source: AGENT_A_SOURCE,
  },
  {
    address: process.env.AGENT_B_ADDRESS || "0xBBBB000000000000000000000000000000000002",
    name: "Agent Beta (VULNERABLE)",
    source: AGENT_B_SOURCE,
  },
  {
    address: process.env.AGENT_C_ADDRESS || "0xCCCC000000000000000000000000000000000003",
    name: "Agent Gamma",
    source: AGENT_C_SOURCE,
  },
  {
    address: "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526",
    name: "0G Flow Protocol",
    source: `// 0G Flow Protocol — live mainnet contract
pragma solidity ^0.8.0;
// On-chain data availability payment contract
// Handles storage node payments and rewards on 0G Aristotle mainnet`,
  },
];

function setKnownSources() {
  const sources: Record<string, string> = {};
  for (const agent of DEMO_AGENTS) {
    sources[agent.address.toLowerCase()] = agent.source;
  }
  process.env.KNOWN_CONTRACT_SOURCES = JSON.stringify(sources);
}

// Register agents in AgentRegistry
async function registerAgents() {
  const provider = new ethers.JsonRpcProvider(process.env.ZERO_G_RPC || "https://evmrpc.0g.ai");
  const signer = new ethers.Wallet(process.env.SCANNER_PRIVATE_KEY || "", provider);
  const registryAddress = process.env.AGENT_REGISTRY_ADDRESS || "";

  if (!registryAddress) {
    console.log("[Seed] AGENT_REGISTRY_ADDRESS not set — skipping on-chain registration");
    return;
  }

  const abi = [
    "function registerAgentsBatch(address[] calldata addresses, uint256[] calldata tokenIds) external",
    "function getAllAgents() view returns (address[])",
  ];
  const registry = new ethers.Contract(registryAddress, abi, signer);

  const existing: string[] = await registry.getAllAgents();
  const existingLower = existing.map((a) => a.toLowerCase());
  const toRegisterAgents = DEMO_AGENTS.filter(
    (a) => !existingLower.includes(a.address.toLowerCase())
  );

  if (toRegisterAgents.length === 0) {
    console.log("[Seed] All agents already registered");
    return;
  }

  const addresses = toRegisterAgents.map((a) => a.address);
  const tokenIds = toRegisterAgents.map((_, i) => i + 1); // token IDs 1, 2, 3 ...

  console.log(`[Seed] Registering ${addresses.length} agents...`);
  const tx = await registry.registerAgentsBatch(addresses, tokenIds);
  const receipt = await tx.wait();
  console.log(`[Seed] Registered: ${receipt.hash}`);
}

async function main() {
  console.log("=== 0G Sentinel Demo Seeding ===");
  setKnownSources();

  await registerAgents();

  const results: Array<{ name: string; address: string; status: string }> = [];

  for (const agent of DEMO_AGENTS) {
    console.log(`\n[Seed] Scanning ${agent.name} (${agent.address.slice(0, 10)}...)...`);
    try {
      const result = await runFullScan(agent.address);
      console.log(`  Behavioral: ${["SAFE", "CAUTION", "FLAGGED"][result.threat_level]} (score: ${result.behavioral_score})`);
      console.log(`  Code: ${["CLEAN", "WARNING", "VULNERABLE"][result.code_risk]}`);
      if (result.code_findings) console.log(`  Findings: ${result.code_findings}`);
      console.log(`  Attestation TX: ${result.attestation_tx_hash}`);
      results.push({ name: agent.name, address: agent.address, status: "OK" });
    } catch (err) {
      console.error(`  FAILED: ${err}`);
      results.push({ name: agent.name, address: agent.address, status: `FAILED: ${err}` });
    }
  }

  console.log("\n=== Seeding Summary ===");
  for (const r of results) {
    console.log(`  ${r.name} (${r.address.slice(0, 10)}...): ${r.status}`);
  }
}

main().catch(console.error);
