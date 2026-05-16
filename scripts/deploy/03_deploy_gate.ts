// File: scripts/deploy/03_deploy_gate.ts
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const attestationAddr = process.env.ATTESTATION_REGISTRY_ADDRESS;
  if (!attestationAddr) throw new Error("ATTESTATION_REGISTRY_ADDRESS not set in .env");

  console.log("Deploying AgentGate with attestation:", attestationAddr);

  const AgentGate = await ethers.getContractFactory("AgentGate");
  // whitelistEnabled=false, requireCallerIsAgent=false — both guards off by default.
  // Enable via approveTarget()/setWhitelistEnabled(true) after deploy if needed.
  const gate = await AgentGate.deploy(attestationAddr, false, false);
  await gate.waitForDeployment();

  const address = await gate.getAddress();
  console.log("AgentGate deployed to:", address);

  const envPath = path.join(__dirname, "../../.env");
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  env = env.replace(/^AGENT_GATE_ADDRESS=.*/m, "");
  fs.writeFileSync(envPath, env.trimEnd() + `\nAGENT_GATE_ADDRESS=${address}\n`);
  console.log("AGENT_GATE_ADDRESS written to .env");
}

main().catch((err) => { console.error(err); process.exit(1); });
