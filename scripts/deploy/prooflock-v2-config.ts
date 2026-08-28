import { getAddress, isAddress, ZeroAddress } from "ethers";

export const ZERO_G_MAINNET_CHAIN_ID = 16661n;
export const CANONICAL_ERC8004_IDENTITY_REGISTRY =
  "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

export interface ProofLockDeploymentConfig {
  roles: { admin: string; scanner: string; guardian: string };
  identityRegistry: string;
  policy: {
    maxBehavioralScore: number;
    maxCodeRisk: number;
    requiredCoverage: number;
    minimumPolicyVersion: number;
    maximumAgeSeconds: number;
  };
}

export interface ContractDeploymentRecord {
  address: string;
  transactionHash: string;
  blockNumber: number;
  runtimeCodeHash: string;
  constructorArgs: Array<string | number>;
}

type Environment = Record<string, string | undefined>;
type DeploymentRecords = {
  registry: ContractDeploymentRecord;
  gate: ContractDeploymentRecord;
  consumer: ContractDeploymentRecord;
};

function requiredAddress(env: Environment, name: string): string {
  const value = env[name];
  if (!value || !isAddress(value) || getAddress(value) === ZeroAddress) {
    throw new Error(`${name} must be an explicit nonzero EVM address`);
  }
  return getAddress(value);
}

function requiredInteger(env: Environment, name: string, minimum: number, maximum: number): number {
  const value = env[name];
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be an explicit base-10 integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function readDeploymentConfig(
  env: Environment,
  options: { canonicalIdentityRegistry?: string } = {},
): ProofLockDeploymentConfig {
  const roles = {
    admin: requiredAddress(env, "PROOFLOCK_ADMIN_ADDRESS"),
    scanner: requiredAddress(env, "PROOFLOCK_SCANNER_ADDRESS"),
    guardian: requiredAddress(env, "PROOFLOCK_GUARDIAN_ADDRESS"),
  };
  if (new Set(Object.values(roles).map((address) => address.toLowerCase())).size !== 3) {
    throw new Error("PROOFLOCK role addresses must be distinct");
  }
  const identityRegistry = requiredAddress(env, "PROOFLOCK_ERC8004_IDENTITY_REGISTRY_ADDRESS");
  const canonical = getAddress(options.canonicalIdentityRegistry ?? CANONICAL_ERC8004_IDENTITY_REGISTRY);
  if (identityRegistry !== canonical) throw new Error("Identity dependency is not the canonical ERC-8004 registry");
  const requiredCoverage = requiredInteger(env, "PROOFLOCK_REQUIRED_COVERAGE", 0, 255);
  if (requiredCoverage !== 0x7f) throw new Error("PROOFLOCK_REQUIRED_COVERAGE must be 127");
  return {
    roles,
    identityRegistry,
    policy: {
      maxBehavioralScore: requiredInteger(env, "PROOFLOCK_MAX_BEHAVIORAL_SCORE", 0, 100),
      maxCodeRisk: requiredInteger(env, "PROOFLOCK_MAX_CODE_RISK", 0, 2),
      requiredCoverage,
      minimumPolicyVersion: requiredInteger(env, "PROOFLOCK_MINIMUM_POLICY_VERSION", 1, 4_294_967_295),
      maximumAgeSeconds: requiredInteger(env, "PROOFLOCK_MAXIMUM_AGE_SECONDS", 1, 30 * 24 * 60 * 60),
    },
  };
}

export function assertMainnetChain(chainId: bigint): void {
  if (chainId !== ZERO_G_MAINNET_CHAIN_ID) {
    throw new Error(`ProofLock V2 must deploy on 0G Aristotle mainnet chain 16661; received ${chainId}`);
  }
}

export function buildDeploymentArtifact(input: {
  config: ProofLockDeploymentConfig;
  deployer: string;
  deployedAt: string;
  contracts: DeploymentRecords;
}) {
  const { config, contracts } = input;
  return {
    schemaVersion: "prooflock-deployment-v2" as const,
    network: "0g-aristotle-mainnet" as const,
    chainId: Number(ZERO_G_MAINNET_CHAIN_ID),
    deployedAt: input.deployedAt,
    deployer: getAddress(input.deployer),
    roles: config.roles,
    policy: config.policy,
    dependencies: { erc8004IdentityRegistry: config.identityRegistry },
    contracts,
    envHandoff: {
      server: {
        PROOFLOCK_REGISTRY_V2_ADDRESS: contracts.registry.address,
        PROOFLOCK_REGISTRY_V2_FROM_BLOCK: String(contracts.registry.blockNumber),
        PROOFLOCK_AGENT_GATE_V2_ADDRESS: contracts.gate.address,
        PROOFLOCK_CONSUMER_ADDRESS: contracts.consumer.address,
      },
      browser: {
        NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS: contracts.registry.address,
        NEXT_PUBLIC_AGENT_GATE_V2_ADDRESS: contracts.gate.address,
        NEXT_PUBLIC_PROOFLOCK_CONSUMER_ADDRESS: contracts.consumer.address,
        NEXT_PUBLIC_PROOFLOCK_VALIDATOR_ADDRESS: config.roles.scanner,
        NEXT_PUBLIC_PROOFLOCK_VALIDATOR_VERSION: "sentinel-prooflock-v2",
        NEXT_PUBLIC_PROOFLOCK_POLICY_VERSION: String(config.policy.minimumPolicyVersion),
      },
    },
  };
}
