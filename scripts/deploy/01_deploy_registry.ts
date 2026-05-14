// File: scripts/deploy/01_deploy_registry.ts
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying AgentRegistry with:", deployer.address);

  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("AgentRegistry deployed to:", address);

  // Persist to .env for downstream scripts
  const envPath = path.join(__dirname, "../../.env");
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  env = env.replace(/^AGENT_REGISTRY_ADDRESS=.*/m, "");
  fs.writeFileSync(envPath, env.trimEnd() + `\nAGENT_REGISTRY_ADDRESS=${address}\n`);
  console.log("AGENT_REGISTRY_ADDRESS written to .env");
}

main().catch((err) => { console.error(err); process.exit(1); });
