import type { HardhatEthersHelpers } from "@nomicfoundation/hardhat-ethers/types";
import type { Signer } from "ethers";
import { keccak256 } from "ethers";
import type { AgentGateV2, ProofLockConsumerDemo, SentinelRegistryV2 } from "../../typechain-types";
import type { ContractDeploymentRecord, ProofLockDeploymentConfig } from "./prooflock-v2-config";

export { readDeploymentConfig } from "./prooflock-v2-config";

async function deploymentRecord(
  contract: { getAddress(): Promise<string>; deploymentTransaction(): null | { hash: string; wait(confirmations?: number): Promise<null | { blockNumber: number }> } },
  ethersApi: HardhatEthersHelpers,
  constructorArgs: Array<string | number>,
): Promise<ContractDeploymentRecord> {
  const transaction = contract.deploymentTransaction();
  if (!transaction) throw new Error("Deployment transaction is unavailable");
  const receipt = await transaction.wait(1);
  if (!receipt) throw new Error(`Deployment transaction ${transaction.hash} was not mined`);
  const address = await contract.getAddress();
  const runtimeCode = await ethersApi.provider.getCode(address);
  if (runtimeCode === "0x") throw new Error(`No runtime code at deployed address ${address}`);
  return { address, transactionHash: transaction.hash, blockNumber: receipt.blockNumber,
    runtimeCodeHash: keccak256(runtimeCode), constructorArgs };
}

function assertEqual(actual: string | bigint, expected: string | bigint, label: string): void {
  const normalizedActual = typeof actual === "string" ? actual.toLowerCase() : actual;
  const normalizedExpected = typeof expected === "string" ? expected.toLowerCase() : expected;
  if (normalizedActual !== normalizedExpected) throw new Error(`Post-deployment ${label} mismatch`);
}

export async function deployProofLockV2(input: {
  ethers: HardhatEthersHelpers;
  config: ProofLockDeploymentConfig;
  deployer: Signer;
}) {
  const { ethers: ethersApi, config, deployer } = input;
  const registryArgs = [config.roles.admin, config.roles.scanner, config.roles.guardian];
  const registry = await (await ethersApi.getContractFactory("SentinelRegistryV2", deployer))
    .deploy(...registryArgs) as unknown as SentinelRegistryV2;
  const registryRecord = await deploymentRecord(registry, ethersApi, registryArgs);

  const policy = config.policy;
  const gateArgs: Array<string | number> = [registryRecord.address, config.identityRegistry,
    policy.maxBehavioralScore, policy.maxCodeRisk, policy.requiredCoverage,
    policy.minimumPolicyVersion, policy.maximumAgeSeconds];
  const gate = await (await ethersApi.getContractFactory("AgentGateV2", deployer))
    .deploy(...gateArgs) as unknown as AgentGateV2;
  const gateRecord = await deploymentRecord(gate, ethersApi, gateArgs);

  const consumerArgs = [gateRecord.address];
  const consumer = await (await ethersApi.getContractFactory("ProofLockConsumerDemo", deployer))
    .deploy(...consumerArgs) as unknown as ProofLockConsumerDemo;
  const consumerRecord = await deploymentRecord(consumer, ethersApi, consumerArgs);

  await verifyDeployment({ registry, gate, consumer, config });
  return { registry, gate, consumer,
    deployments: { registry: registryRecord, gate: gateRecord, consumer: consumerRecord } };
}

async function verifyDeployment(input: {
  registry: SentinelRegistryV2;
  gate: AgentGateV2;
  consumer: ProofLockConsumerDemo;
  config: ProofLockDeploymentConfig;
}): Promise<void> {
  const { registry, gate, consumer, config } = input;
  if (!await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), config.roles.admin)) {
    throw new Error("Post-deployment admin role mismatch");
  }
  if (!await registry.hasRole(await registry.SCANNER_ROLE(), config.roles.scanner)) {
    throw new Error("Post-deployment scanner role mismatch");
  }
  if (!await registry.hasRole(await registry.GUARDIAN_ROLE(), config.roles.guardian)) {
    throw new Error("Post-deployment guardian role mismatch");
  }
  assertEqual(await gate.registry(), await registry.getAddress(), "registry pointer");
  assertEqual(await gate.identityRegistry(), config.identityRegistry, "identity pointer");
  assertEqual(await gate.maxBehavioralScore(), BigInt(config.policy.maxBehavioralScore), "behavioral policy");
  assertEqual(await gate.maxCodeRisk(), BigInt(config.policy.maxCodeRisk), "code-risk policy");
  assertEqual(await gate.requiredCoverage(), BigInt(config.policy.requiredCoverage), "coverage policy");
  assertEqual(await gate.minimumPolicyVersion(), BigInt(config.policy.minimumPolicyVersion), "policy floor");
  assertEqual(await gate.maximumAge(), BigInt(config.policy.maximumAgeSeconds), "maximum age");
  assertEqual(await consumer.gate(), await gate.getAddress(), "consumer gate pointer");
}
