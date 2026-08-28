import { expect } from "chai";
import { ethers } from "hardhat";
import { readFileSync } from "node:fs";
import { assertMainnetChain, buildDeploymentArtifact, readDeploymentConfig } from
  "../../scripts/deploy/prooflock-v2-config";
import { deployProofLockV2 } from "../../scripts/deploy/prooflock-v2-deployer";

const ADMIN = "0x1000000000000000000000000000000000000001";
const SCANNER = "0x2000000000000000000000000000000000000002";
const GUARDIAN = "0x3000000000000000000000000000000000000003";
const IDENTITY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

function validEnv() {
  return {
    PROOFLOCK_ADMIN_ADDRESS: ADMIN,
    PROOFLOCK_SCANNER_ADDRESS: SCANNER,
    PROOFLOCK_GUARDIAN_ADDRESS: GUARDIAN,
    PROOFLOCK_ERC8004_IDENTITY_REGISTRY_ADDRESS: IDENTITY,
    PROOFLOCK_MAX_BEHAVIORAL_SCORE: "50",
    PROOFLOCK_MAX_CODE_RISK: "1",
    PROOFLOCK_REQUIRED_COVERAGE: "127",
    PROOFLOCK_MINIMUM_POLICY_VERSION: "1",
    PROOFLOCK_MAXIMUM_AGE_SECONDS: "604800",
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

  it("requires explicit separated roles and the canonical identity dependency", () => {
    expect(() => readDeploymentConfig({ ...validEnv(), PROOFLOCK_ADMIN_ADDRESS: undefined }))
      .to.throw("PROOFLOCK_ADMIN_ADDRESS");
    expect(() => readDeploymentConfig({ ...validEnv(), PROOFLOCK_GUARDIAN_ADDRESS: SCANNER }))
      .to.throw("distinct");
    expect(() => readDeploymentConfig({
      ...validEnv(),
      PROOFLOCK_ERC8004_IDENTITY_REGISTRY_ADDRESS: ADMIN,
    })).to.throw("canonical ERC-8004");
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
    for (const [name, value] of [
      ["PROOFLOCK_MAX_BEHAVIORAL_SCORE", "101"],
      ["PROOFLOCK_MAX_CODE_RISK", "3"],
      ["PROOFLOCK_REQUIRED_COVERAGE", "126"],
      ["PROOFLOCK_MINIMUM_POLICY_VERSION", "0"],
      ["PROOFLOCK_MAXIMUM_AGE_SECONDS", "2592001"],
    ]) {
      expect(() => readDeploymentConfig({ ...validEnv(), [name]: value }), name).to.throw(name);
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
    });
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
      PROOFLOCK_ERC8004_IDENTITY_REGISTRY_ADDRESS: await identity.getAddress(),
    }, { canonicalIdentityRegistry: await identity.getAddress() });
    const result = await deployProofLockV2({ ethers, config, deployer });
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
});
