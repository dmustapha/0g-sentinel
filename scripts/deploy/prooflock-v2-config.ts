import { getAddress, isAddress, keccak256, toUtf8Bytes, ZeroAddress } from "ethers";

export const ZERO_G_MAINNET_CHAIN_ID = 16661n;
export const CANONICAL_ERC8004_IDENTITY_REGISTRY =
  "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
export const ZERO_G_MAINNET_RPC = "https://evmrpc.0g.ai";
export const ZERO_G_MAINNET_STORAGE_INDEXER = "https://indexer-storage-turbo.0g.ai";
export const ZERO_G_MAINNET_STORAGE_FLOW = "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526";
export const DEPLOYMENT_ENV_NAMES = [
  "PROOFLOCK_ADMIN_ADDRESS", "PROOFLOCK_SCANNER_ADDRESS", "PROOFLOCK_GUARDIAN_ADDRESS",
  "PROOFLOCK_MAX_BEHAVIORAL_SCORE", "PROOFLOCK_MAX_CODE_RISK", "PROOFLOCK_REQUIRED_COVERAGE",
  "PROOFLOCK_MINIMUM_POLICY_VERSION", "PROOFLOCK_MAXIMUM_AGE_SECONDS", "PROOFLOCK_DEPLOY_CONFIRMATIONS",
] as const;
export const PRODUCTION_PROFILE_ENV_NAMES = [
  "ZERO_G_RPC", "ZERO_G_STORAGE_INDEXER", "PROOFLOCK_STORAGE_FLOW_ADDRESS",
] as const;

export interface ProofLockDeploymentConfig {
  roles: { admin: string; scanner: string; guardian: string };
  identityRegistry: string;
  confirmations: number;
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
  confirmations: number;
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
  options: { identityRegistryOverrideForTests?: string } = {},
): ProofLockDeploymentConfig {
  const roles = {
    admin: requiredAddress(env, "PROOFLOCK_ADMIN_ADDRESS"),
    scanner: requiredAddress(env, "PROOFLOCK_SCANNER_ADDRESS"),
    guardian: requiredAddress(env, "PROOFLOCK_GUARDIAN_ADDRESS"),
  };
  if (new Set(Object.values(roles).map((address) => address.toLowerCase())).size !== 3) {
    throw new Error("PROOFLOCK role addresses must be distinct");
  }
  const identityRegistry = getAddress(
    options.identityRegistryOverrideForTests ?? CANONICAL_ERC8004_IDENTITY_REGISTRY,
  );
  const requiredCoverage = requiredInteger(env, "PROOFLOCK_REQUIRED_COVERAGE", 0, 255);
  if (requiredCoverage !== 0x7f) throw new Error("PROOFLOCK_REQUIRED_COVERAGE must be 127");
  return {
    roles,
    identityRegistry,
    confirmations: requiredInteger(env, "PROOFLOCK_DEPLOY_CONFIRMATIONS", 3, 64),
    policy: {
      maxBehavioralScore: requiredInteger(env, "PROOFLOCK_MAX_BEHAVIORAL_SCORE", 0, 100),
      maxCodeRisk: requiredInteger(env, "PROOFLOCK_MAX_CODE_RISK", 0, 2),
      requiredCoverage,
      minimumPolicyVersion: requiredInteger(env, "PROOFLOCK_MINIMUM_POLICY_VERSION", 1, 4_294_967_295),
      maximumAgeSeconds: requiredInteger(env, "PROOFLOCK_MAXIMUM_AGE_SECONDS", 1, 30 * 24 * 60 * 60),
    },
  };
}

export function assertProductionProfile(env: Environment): void {
  const expected: Record<(typeof PRODUCTION_PROFILE_ENV_NAMES)[number], string> = {
    ZERO_G_RPC: ZERO_G_MAINNET_RPC,
    ZERO_G_STORAGE_INDEXER: ZERO_G_MAINNET_STORAGE_INDEXER,
    PROOFLOCK_STORAGE_FLOW_ADDRESS: ZERO_G_MAINNET_STORAGE_FLOW,
  };
  for (const name of PRODUCTION_PROFILE_ENV_NAMES) {
    const actual = env[name]?.replace(/\/$/, "");
    const canonical = expected[name].replace(/\/$/, "");
    const equal = name === "ZERO_G_RPC"
      ? isProductionRpc(actual)
      : name.endsWith("ADDRESS")
      ? Boolean(actual && isAddress(actual) && getAddress(actual) === getAddress(canonical))
      : actual === canonical;
    if (!equal) throw new Error(`${name} must use the canonical 0G mainnet value ${expected[name]}`);
  }
}

function isProductionRpc(value: string | undefined): boolean {
  if (!value || /testnet/i.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function deploymentConfigFingerprint(config: ProofLockDeploymentConfig): string {
  return keccak256(toUtf8Bytes(JSON.stringify(config)));
}

export function assertDeployerDistinctFromRoles(
  deployer: string,
  roles: ProofLockDeploymentConfig["roles"],
): void {
  if (!isAddress(deployer) || getAddress(deployer) === ZeroAddress) {
    throw new Error("deployer address must be an explicit nonzero EVM address");
  }
  const deployerKey = getAddress(deployer).toLowerCase();
  if (Object.values(roles).some((role) => getAddress(role).toLowerCase() === deployerKey)) {
    throw new Error(
      "deployer key must remain distinct from admin, scanner, and guardian custody; discard it after deployment",
    );
  }
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
    custodyConstraint: "admin, scanner, and guardian must remain distinct custodians",
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
        NEXT_PUBLIC_PROOFLOCK_ADMIN_ADDRESS: config.roles.admin,
        NEXT_PUBLIC_PROOFLOCK_SCANNER_ADDRESS: config.roles.scanner,
        NEXT_PUBLIC_PROOFLOCK_GUARDIAN_ADDRESS: config.roles.guardian,
        NEXT_PUBLIC_PROOFLOCK_CUSTODY_CONSTRAINT: "admin-scanner-guardian-must-remain-distinct",
      },
    },
  };
}
