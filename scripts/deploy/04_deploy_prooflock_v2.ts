import { ethers, network } from "hardhat";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertProductionProfile, buildDeploymentArtifact, assertMainnetChain,
  deploymentConfigFingerprint, readDeploymentConfig } from "./prooflock-v2-config";
import { assertDeploymentBalance, deployProofLockV2, estimateDeploymentBudget } from "./prooflock-v2-deployer";
import { DeploymentJournalStore } from "./prooflock-v2-journal";

async function requireLiveCode(address: string, label: string): Promise<void> {
  if (await ethers.provider.getCode(address) === "0x") throw new Error(`${label} has no runtime code at ${address}`);
}

async function main(): Promise<void> {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  assertMainnetChain(chainId);
  assertProductionProfile(process.env);
  const config = readDeploymentConfig(process.env);
  await requireLiveCode(config.identityRegistry, "Canonical ERC-8004 Identity Registry");
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("DEPLOYER_PRIVATE_KEY is not configured for zerogMainnet");
  const balance = await ethers.provider.getBalance(await deployer.getAddress());
  const budget = await estimateDeploymentBudget(ethers.provider);
  assertDeploymentBalance(balance, budget);

  const directory = join(process.cwd(), "deployments", chainId.toString());
  const store = new DeploymentJournalStore(directory, await deployer.getAddress());
  let journal = store.open({ configFingerprint: deploymentConfigFingerprint(config),
    confirmations: config.confirmations, deployer: await deployer.getAddress(),
    estimatedGraphGas: String(budget.estimatedGraphGas), requiredBalance: String(budget.requiredBalance) });
  const result = await deployProofLockV2({ ethers, config, deployer, confirmations: config.confirmations,
    recovered: journal.deployments,
    onDeployment: async (name, record) => {
      journal = { ...journal, deployments: { ...journal.deployments, [name]: record } };
      store.save(journal);
    } });
  const artifact = buildDeploymentArtifact({ config, deployer: await deployer.getAddress(),
    deployedAt: new Date().toISOString(), contracts: result.deployments });
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `prooflock-v2-${result.deployments.registry.address.toLowerCase()}.json`);
  persistArtifact(file, artifact);
  journal = { ...journal, status: "COMPLETE", deployments: result.deployments };
  store.save(journal);

  console.log(JSON.stringify({ network: network.name, artifact: file, envHandoff: artifact.envHandoff }, null, 2));
}

function persistArtifact(file: string, artifact: ReturnType<typeof buildDeploymentArtifact>): void {
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (!existsSync(file)) {
    writeFileSync(file, serialized, { flag: "wx", mode: 0o600 });
    return;
  }
  const existing = JSON.parse(readFileSync(file, "utf8")) as ReturnType<typeof buildDeploymentArtifact>;
  if (JSON.stringify(existing.contracts) !== JSON.stringify(artifact.contracts)
    || JSON.stringify(existing.roles) !== JSON.stringify(artifact.roles)) {
    throw new Error(`Existing deployment artifact conflicts with recovered deployment: ${file}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
