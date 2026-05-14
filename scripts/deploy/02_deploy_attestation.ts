// File: scripts/deploy/02_deploy_attestation.ts
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying AttestationRegistry with account:", deployer.address);

  const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
  const registry = await AttestationRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("AttestationRegistry deployed to:", address);

  // Authorize the scanner signer
  const scannerAddress = process.env.SCANNER_ADDRESS || deployer.address;
  const tx = await registry.authorizeScanner(scannerAddress);
  await tx.wait();
  console.log("Scanner authorized:", scannerAddress);

  // Save address to env file
  const envPath = path.join(__dirname, "../../.env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
  const updated = existing.includes("ATTESTATION_REGISTRY_ADDRESS=")
    ? existing.replace(/ATTESTATION_REGISTRY_ADDRESS=.*/g, `ATTESTATION_REGISTRY_ADDRESS=${address}`)
    : existing + `\nATTESTATION_REGISTRY_ADDRESS=${address}`;
  fs.writeFileSync(envPath, updated);
  console.log("Address saved to .env");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
