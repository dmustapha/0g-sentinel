import { ethers, network } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDeploymentArtifact, assertMainnetChain, readDeploymentConfig } from "./prooflock-v2-config";
import { deployProofLockV2 } from "./prooflock-v2-deployer";

async function requireLiveCode(address: string, label: string): Promise<void> {
  if (await ethers.provider.getCode(address) === "0x") throw new Error(`${label} has no runtime code at ${address}`);
}

async function main(): Promise<void> {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  assertMainnetChain(chainId);
  const config = readDeploymentConfig(process.env);
  await requireLiveCode(config.identityRegistry, "Canonical ERC-8004 Identity Registry");
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("DEPLOYER_PRIVATE_KEY is not configured for zerogMainnet");
  const balance = await ethers.provider.getBalance(await deployer.getAddress());
  if (balance === 0n) throw new Error("Deployer has zero 0G balance; fund it before deployment");

  const result = await deployProofLockV2({ ethers, config, deployer });
  const artifact = buildDeploymentArtifact({ config, deployer: await deployer.getAddress(),
    deployedAt: new Date().toISOString(), contracts: result.deployments });
  const directory = join(process.cwd(), "deployments", chainId.toString());
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `prooflock-v2-${result.deployments.registry.address.toLowerCase()}.json`);
  writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });

  console.log(JSON.stringify({ network: network.name, artifact: file, envHandoff: artifact.envHandoff }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
