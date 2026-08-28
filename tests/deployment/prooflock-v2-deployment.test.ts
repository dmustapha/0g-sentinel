import { expect } from "chai";
import { ethers } from "hardhat";
import { readFileSync } from "node:fs";
import { assertMainnetChain, buildDeploymentArtifact, readDeploymentConfig } from
  "../../scripts/deploy/prooflock-v2-config";
import { assertProductionProfile, DEPLOYMENT_ENV_NAMES, PRODUCTION_PROFILE_ENV_NAMES } from
  "../../scripts/deploy/prooflock-v2-config";
import { assertDeploymentBalance, deployProofLockV2, estimateDeploymentBudget } from
  "../../scripts/deploy/prooflock-v2-deployer";
import { DeploymentJournalStore } from "../../scripts/deploy/prooflock-v2-journal";
import { mkdtempSync, readFileSync as readText, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN = "0x1000000000000000000000000000000000000001";
const SCANNER = "0x2000000000000000000000000000000000000002";
const GUARDIAN = "0x3000000000000000000000000000000000000003";
const IDENTITY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

function validEnv() {
  return {
    PROOFLOCK_ADMIN_ADDRESS: ADMIN,
    PROOFLOCK_SCANNER_ADDRESS: SCANNER,
    PROOFLOCK_GUARDIAN_ADDRESS: GUARDIAN,
    PROOFLOCK_MAX_BEHAVIORAL_SCORE: "50",
    PROOFLOCK_MAX_CODE_RISK: "1",
    PROOFLOCK_REQUIRED_COVERAGE: "127",
    PROOFLOCK_MINIMUM_POLICY_VERSION: "1",
    PROOFLOCK_MAXIMUM_AGE_SECONDS: "604800",
    PROOFLOCK_DEPLOY_CONFIRMATIONS: "3",
  };
}

describe("ProofLock V2 deployment tooling", () => {
  it("routes the generic mainnet command to V2 and labels legacy deploys", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["deploy:mainnet"]).to.equal("npm run deploy:prooflock-v2:mainnet");
    expect(pkg.scripts["deploy:legacy:mainnet"]).to.contain("01_deploy_registry.ts");
    expect(pkg.scripts["deploy:legacy:testnet"]).to.contain("01_deploy_registry.ts");
    expect(pkg.scripts["deploy:testnet"]).to.equal(undefined);
  });

  it("requires explicit separated roles and fixes the canonical identity dependency", () => {
    expect(() => readDeploymentConfig({ ...validEnv(), PROOFLOCK_ADMIN_ADDRESS: undefined }))
      .to.throw("PROOFLOCK_ADMIN_ADDRESS");
    expect(() => readDeploymentConfig({ ...validEnv(), PROOFLOCK_GUARDIAN_ADDRESS: SCANNER }))
      .to.throw("distinct");
    expect(readDeploymentConfig(validEnv()).identityRegistry.toLowerCase()).to.equal(IDENTITY);
    expect(DEPLOYMENT_ENV_NAMES).to.have.length(9);
    expect(DEPLOYMENT_ENV_NAMES).not.to.include("PROOFLOCK_ERC8004_IDENTITY_REGISTRY_ADDRESS");
  });

  it("enumerates every deployment and production-profile environment read", () => {
    const deploymentReads = new Set<string>();
    readDeploymentConfig(new Proxy(validEnv(), { get(target, property: string) {
      deploymentReads.add(property);
      return target[property as keyof ReturnType<typeof validEnv>];
    } }));
    expect([...deploymentReads].sort()).to.deep.equal([...DEPLOYMENT_ENV_NAMES].sort());

    const profile = { ZERO_G_RPC: "https://evmrpc.0g.ai",
      ZERO_G_STORAGE_INDEXER: "https://indexer-storage-turbo.0g.ai",
      PROOFLOCK_STORAGE_FLOW_ADDRESS: "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526" };
    const profileReads = new Set<string>();
    assertProductionProfile(new Proxy(profile, { get(target, property: keyof typeof profile) {
      profileReads.add(property);
      return target[property];
    } }));
    expect([...profileReads].sort()).to.deep.equal([...PRODUCTION_PROFILE_ENV_NAMES].sort());
  });

  it("parses bounded policy inputs without hidden defaults", () => {
    const config = readDeploymentConfig(validEnv());
    expect(config.policy).to.deep.equal({
      maxBehavioralScore: 50,
      maxCodeRisk: 1,
      requiredCoverage: 127,
      minimumPolicyVersion: 1,
      maximumAgeSeconds: 604800,
    });
    expect(config.confirmations).to.equal(3);
    for (const [name, value] of [
      ["PROOFLOCK_MAX_BEHAVIORAL_SCORE", "101"],
      ["PROOFLOCK_MAX_CODE_RISK", "3"],
      ["PROOFLOCK_REQUIRED_COVERAGE", "126"],
      ["PROOFLOCK_MINIMUM_POLICY_VERSION", "0"],
      ["PROOFLOCK_MAXIMUM_AGE_SECONDS", "2592001"],
      ["PROOFLOCK_DEPLOY_CONFIRMATIONS", "2"],
    ]) {
      expect(() => readDeploymentConfig({ ...validEnv(), [name]: value }), name).to.throw(name);
    }
  });

  it("rejects testnet and noncanonical production Storage profiles", () => {
    const production = {
      ZERO_G_RPC: "https://evmrpc.0g.ai",
      ZERO_G_STORAGE_INDEXER: "https://indexer-storage-turbo.0g.ai",
      PROOFLOCK_STORAGE_FLOW_ADDRESS: "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526",
    };
    expect(PRODUCTION_PROFILE_ENV_NAMES).to.have.members(Object.keys(production));
    expect(() => assertProductionProfile(production)).not.to.throw();
    expect(() => assertProductionProfile({ ...production,
      ZERO_G_RPC: "https://example-mainnet-rpc.invalid" })).not.to.throw();
    expect(() => assertProductionProfile({ ...production,
      ZERO_G_RPC: "https://evmrpc-testnet.0g.ai" })).to.throw("ZERO_G_RPC");
    expect(() => assertProductionProfile({ ...production,
      ZERO_G_STORAGE_INDEXER: "https://indexer-storage-testnet-turbo.0g.ai" })).to.throw("ZERO_G_STORAGE_INDEXER");
    expect(() => assertProductionProfile({ ...production,
      PROOFLOCK_STORAGE_FLOW_ADDRESS: ADMIN })).to.throw("PROOFLOCK_STORAGE_FLOW_ADDRESS");
  });

  it("budgets the entire graph with margin before deployment", async () => {
    const budget = await estimateDeploymentBudget({ getFeeData: async () => ({ maxFeePerGas: 2n }) });
    expect(budget.marginBasisPoints).to.be.at.least(12_500);
    expect(budget.gasWithMargin).to.be.greaterThan(budget.estimatedGraphGas);
    expect(budget.requiredBalance).to.equal(budget.gasWithMargin * 2n);
    expect(() => assertDeploymentBalance(budget.requiredBalance - 1n, budget)).to.throw("Insufficient");
    expect(() => assertDeploymentBalance(budget.requiredBalance, budget)).not.to.throw();
  });

  it("atomically recovers a partial deployment journal without secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "prooflock-deploy-"));
    try {
      const store = new DeploymentJournalStore(directory, ADMIN);
      const initial = store.open({ configFingerprint: `0x${"c".repeat(64)}`, confirmations: 3,
        deployer: ADMIN, estimatedGraphGas: "6000000", requiredBalance: "15000000" });
      const partial = { ...initial, deployments: { registry: {
        address: ADMIN, transactionHash: `0x${"a".repeat(64)}`, blockNumber: 42,
        runtimeCodeHash: `0x${"b".repeat(64)}`, confirmations: 3, constructorArgs: [SCANNER],
      } } };
      store.save(partial);
      expect(store.open({ ...initial, deployments: {} }).deployments.registry?.address).to.equal(ADMIN);
      expect(readText(store.path, "utf8")).not.to.contain("PRIVATE_KEY");
      expect(() => store.open({ ...initial, configFingerprint: `0x${"d".repeat(64)}` }))
        .to.throw("fingerprint");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects every chain except 0G Aristotle mainnet", () => {
    expect(() => assertMainnetChain(16661n)).not.to.throw();
    expect(() => assertMainnetChain(16602n)).to.throw("16661");
    expect(() => assertMainnetChain(31337n)).to.throw("16661");
  });

  it("builds a machine-readable artifact and exact env handoff", () => {
    const config = readDeploymentConfig(validEnv());
    const contract = {
      address: ADMIN,
      transactionHash: `0x${"a".repeat(64)}`,
      blockNumber: 42,
      runtimeCodeHash: `0x${"b".repeat(64)}`,
      confirmations: 3,
      constructorArgs: [SCANNER],
    };
    const artifact = buildDeploymentArtifact({
      config,
      deployer: GUARDIAN,
      deployedAt: "2026-08-28T12:00:00.000Z",
      contracts: { registry: contract, gate: { ...contract, address: SCANNER },
        consumer: { ...contract, address: GUARDIAN } },
    });
    expect(artifact.schemaVersion).to.equal("prooflock-deployment-v2");
    expect(artifact.chainId).to.equal(16661);
    expect(artifact.contracts.registry.blockNumber).to.equal(42);
    expect(artifact.envHandoff.server).to.deep.equal({
      PROOFLOCK_REGISTRY_V2_ADDRESS: ADMIN,
      PROOFLOCK_REGISTRY_V2_FROM_BLOCK: "42",
      PROOFLOCK_AGENT_GATE_V2_ADDRESS: SCANNER,
      PROOFLOCK_CONSUMER_ADDRESS: GUARDIAN,
    });
    expect(artifact.envHandoff.browser).to.deep.equal({
      NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS: ADMIN,
      NEXT_PUBLIC_AGENT_GATE_V2_ADDRESS: SCANNER,
      NEXT_PUBLIC_PROOFLOCK_CONSUMER_ADDRESS: GUARDIAN,
      NEXT_PUBLIC_PROOFLOCK_VALIDATOR_ADDRESS: SCANNER,
      NEXT_PUBLIC_PROOFLOCK_VALIDATOR_VERSION: "sentinel-prooflock-v2",
      NEXT_PUBLIC_PROOFLOCK_POLICY_VERSION: "1",
      NEXT_PUBLIC_PROOFLOCK_ADMIN_ADDRESS: ADMIN,
      NEXT_PUBLIC_PROOFLOCK_SCANNER_ADDRESS: SCANNER,
      NEXT_PUBLIC_PROOFLOCK_GUARDIAN_ADDRESS: GUARDIAN,
      NEXT_PUBLIC_PROOFLOCK_CUSTODY_CONSTRAINT: "admin-scanner-guardian-must-remain-distinct",
    });
    expect(artifact.custodyConstraint).to.contain("distinct");
    expect(() => JSON.stringify(artifact)).not.to.throw();
  });

  it("deploys the V2 graph with exact roles, pointers, policy, receipts, and runtime code", async function () {
    this.timeout(120_000);
    const [deployer, admin, scanner, guardian] = await ethers.getSigners();
    const identity = await (await ethers.getContractFactory("MockERC8004IdentityRegistry")).deploy();
    const config = readDeploymentConfig({
      ...validEnv(),
      PROOFLOCK_ADMIN_ADDRESS: admin.address,
      PROOFLOCK_SCANNER_ADDRESS: scanner.address,
      PROOFLOCK_GUARDIAN_ADDRESS: guardian.address,
    }, { identityRegistryOverrideForTests: await identity.getAddress() });
    const result = await deployProofLockV2({ ethers, config, deployer, confirmations: 1 });
    expect(await result.registry.hasRole(await result.registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await result.registry.hasRole(await result.registry.SCANNER_ROLE(), scanner.address)).to.equal(true);
    expect(await result.registry.hasRole(await result.registry.GUARDIAN_ROLE(), guardian.address)).to.equal(true);
    expect(await result.gate.registry()).to.equal(await result.registry.getAddress());
    expect(await result.gate.identityRegistry()).to.equal(await identity.getAddress());
    expect(await result.gate.maxBehavioralScore()).to.equal(50);
    expect(await result.gate.maximumAge()).to.equal(604800);
    expect(await result.consumer.gate()).to.equal(await result.gate.getAddress());
    for (const deployment of Object.values(result.deployments)) {
      expect(deployment.blockNumber).to.be.greaterThan(0);
      expect(deployment.runtimeCodeHash).to.match(/^0x[0-9a-f]{64}$/);
      expect(deployment.runtimeCodeHash).not.to.equal(ethers.ZeroHash);
    }
  });

  it("resumes after a persisted registry receipt without redeploying it", async function () {
    this.timeout(120_000);
    const [deployer, admin, scanner, guardian] = await ethers.getSigners();
    const identity = await (await ethers.getContractFactory("MockERC8004IdentityRegistry")).deploy();
    const config = readDeploymentConfig({ ...validEnv(), PROOFLOCK_ADMIN_ADDRESS: admin.address,
      PROOFLOCK_SCANNER_ADDRESS: scanner.address, PROOFLOCK_GUARDIAN_ADDRESS: guardian.address },
    { identityRegistryOverrideForTests: await identity.getAddress() });
    let registryRecord: Awaited<ReturnType<typeof deployProofLockV2>>["deployments"]["registry"] | undefined;
    await expect(deployProofLockV2({ ethers, config, deployer, confirmations: 1,
      onDeployment: async (name, record) => {
        if (name === "registry") {
          registryRecord = record;
          throw new Error("simulated process stop");
        }
      } })).to.be.rejectedWith("simulated process stop");
    expect(registryRecord).not.to.equal(undefined);
    const resumed = await deployProofLockV2({ ethers, config, deployer, confirmations: 1,
      recovered: { registry: registryRecord! } });
    expect(resumed.deployments.registry.transactionHash).to.equal(registryRecord!.transactionHash);
    expect(await resumed.gate.registry()).to.equal(registryRecord!.address);
    expect(await resumed.consumer.gate()).to.equal(await resumed.gate.getAddress());
  });
});
