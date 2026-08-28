import type { HardhatEthersHelpers } from "@nomicfoundation/hardhat-ethers/types";
import type { BaseContract, ContractFactory, Signer } from "ethers";
import { keccak256 } from "ethers";
import type { AgentGateV2, ProofLockConsumerDemo, SentinelRegistryV2 } from "../../typechain-types";
import type { ContractDeploymentRecord, ProofLockDeploymentConfig } from "./prooflock-v2-config";

export { readDeploymentConfig } from "./prooflock-v2-config";

const GRAPH_GAS_ESTIMATE = { registry: 3_000_000n, gate: 2_000_000n, consumer: 1_000_000n };
const GAS_MARGIN_BASIS_POINTS = 12_500n;
type DeploymentName = keyof typeof GRAPH_GAS_ESTIMATE;
type DeploymentRecords = Partial<Record<DeploymentName, ContractDeploymentRecord>>;

export interface DeploymentBudget {
  estimatedGraphGas: bigint;
  gasWithMargin: bigint;
  marginBasisPoints: number;
  maxFeePerGas: bigint;
  requiredBalance: bigint;
}

export async function estimateDeploymentBudget(provider: {
  getFeeData(): Promise<{ maxFeePerGas?: null | bigint; gasPrice?: null | bigint }>;
}): Promise<DeploymentBudget> {
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!maxFeePerGas || maxFeePerGas <= 0n) throw new Error("Unable to estimate 0G deployment fees");
  const estimatedGraphGas = Object.values(GRAPH_GAS_ESTIMATE).reduce((sum, value) => sum + value, 0n);
  const gasWithMargin = estimatedGraphGas * GAS_MARGIN_BASIS_POINTS / 10_000n;
  return { estimatedGraphGas, gasWithMargin, marginBasisPoints: Number(GAS_MARGIN_BASIS_POINTS),
    maxFeePerGas, requiredBalance: gasWithMargin * maxFeePerGas };
}

export function assertDeploymentBalance(balance: bigint, budget: DeploymentBudget): void {
  if (balance < budget.requiredBalance) {
    throw new Error(`Insufficient deployer balance: need ${budget.requiredBalance}, have ${balance}`);
  }
}

async function deploymentRecord(
  contract: { getAddress(): Promise<string>; deploymentTransaction(): null | { hash: string; wait(confirmations?: number): Promise<null | { blockNumber: number }> } },
  ethersApi: HardhatEthersHelpers,
  constructorArgs: Array<string | number>,
  confirmations: number,
): Promise<ContractDeploymentRecord> {
  const transaction = contract.deploymentTransaction();
  if (!transaction) throw new Error("Deployment transaction is unavailable");
  const receipt = await transaction.wait(confirmations);
  if (!receipt) throw new Error(`Deployment transaction ${transaction.hash} was not mined`);
  if (("status" in receipt) && receipt.status !== 1) throw new Error(`Deployment transaction ${transaction.hash} failed`);
  const address = await contract.getAddress();
  const runtimeCode = await ethersApi.provider.getCode(address);
  if (runtimeCode === "0x") throw new Error(`No runtime code at deployed address ${address}`);
  return { address, transactionHash: transaction.hash, blockNumber: receipt.blockNumber,
    runtimeCodeHash: keccak256(runtimeCode), confirmations, constructorArgs };
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
  confirmations: number;
  recovered?: DeploymentRecords;
  onDeployment?: (name: DeploymentName, record: ContractDeploymentRecord) => Promise<void>;
}) {
  const { ethers: ethersApi, config, deployer, confirmations } = input;
  if (!Number.isInteger(confirmations) || confirmations < 1) throw new Error("Invalid confirmation count");
  const registryArgs = [config.roles.admin, config.roles.scanner, config.roles.guardian];
  const registryResult = await resolveDeployment("registry", "SentinelRegistryV2", registryArgs, input);
  const registry = registryResult.contract as unknown as SentinelRegistryV2;
  const registryRecord = registryResult.record;

  const policy = config.policy;
  const gateArgs: Array<string | number> = [registryRecord.address, config.identityRegistry,
    policy.maxBehavioralScore, policy.maxCodeRisk, policy.requiredCoverage,
    policy.minimumPolicyVersion, policy.maximumAgeSeconds];
  const gateResult = await resolveDeployment("gate", "AgentGateV2", gateArgs, input);
  const gate = gateResult.contract as unknown as AgentGateV2;
  const gateRecord = gateResult.record;

  const consumerArgs = [gateRecord.address];
  const consumerResult = await resolveDeployment("consumer", "ProofLockConsumerDemo", consumerArgs, input);
  const consumer = consumerResult.contract as unknown as ProofLockConsumerDemo;
  const consumerRecord = consumerResult.record;

  await verifyDeployment({ registry, gate, consumer, config });
  return { registry, gate, consumer,
    deployments: { registry: registryRecord, gate: gateRecord, consumer: consumerRecord } };
}

async function resolveDeployment(
  name: DeploymentName,
  contractName: string,
  constructorArgs: Array<string | number>,
  input: Parameters<typeof deployProofLockV2>[0],
): Promise<{ contract: BaseContract; record: ContractDeploymentRecord }> {
  const recovered = input.recovered?.[name];
  if (recovered) {
    await verifyRecoveredRecord(recovered, input.ethers, input.confirmations);
    const contract = await input.ethers.getContractAt(contractName, recovered.address, input.deployer);
    return { contract, record: recovered };
  }
  const factory: ContractFactory = await input.ethers.getContractFactory(contractName, input.deployer);
  const contract = await factory.deploy(...constructorArgs);
  const record = await deploymentRecord(contract, input.ethers, constructorArgs, input.confirmations);
  await input.onDeployment?.(name, record);
  return { contract, record };
}

async function verifyRecoveredRecord(
  record: ContractDeploymentRecord,
  ethersApi: HardhatEthersHelpers,
  confirmations: number,
): Promise<void> {
  const receipt = await ethersApi.provider.getTransactionReceipt(record.transactionHash);
  if (!receipt || receipt.status !== 1 || receipt.blockNumber !== record.blockNumber) {
    throw new Error(`Recovered deployment receipt is invalid for ${record.address}`);
  }
  if (receipt.contractAddress?.toLowerCase() !== record.address.toLowerCase()) {
    throw new Error(`Recovered deployment address mismatch for ${record.transactionHash}`);
  }
  const observedConfirmations = await ethersApi.provider.getBlockNumber() - receipt.blockNumber + 1;
  if (observedConfirmations < confirmations) throw new Error(`Recovered deployment lacks ${confirmations} confirmations`);
  const runtimeCode = await ethersApi.provider.getCode(record.address);
  if (runtimeCode === "0x" || keccak256(runtimeCode) !== record.runtimeCodeHash) {
    throw new Error(`Recovered runtime code mismatch for ${record.address}`);
  }
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
