import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type {
  AgentGateV2,
  MockERC8004IdentityRegistry,
  SentinelRegistryV2,
} from "../../typechain-types";

const CHAIN_ID = 16661n;
const DAY = 24 * 60 * 60;
const COVERAGE = 0x7f;
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const HASH_C = `0x${"c".repeat(64)}`;
const HASH_D = `0x${"d".repeat(64)}`;
const ZERO = ethers.ZeroHash;

function input(overrides: Record<string, unknown> = {}) {
  return { envelopeDigest: HASH_A, storageRoot: HASH_B, computeRoot: HASH_C, artifactHash: HASH_D,
    expectedRuntimeCodeHash: ZERO, validForSeconds: 7 * DAY, policyVersion: 2,
    behavioralScore: 10, codeRisk: 0, coverage: COVERAGE, ...overrides };
}

async function deployGateFixture(subjectKind: "eoa" | "contract" = "eoa") {
  const [admin, scanner, guardian, owner, eoa, other] = await ethers.getSigners();
  const identity = (await (await ethers.getContractFactory("MockERC8004IdentityRegistry")).deploy()) as unknown as MockERC8004IdentityRegistry;
  const registry = (await (await ethers.getContractFactory("SentinelRegistryV2")).deploy(admin.address, scanner.address, guardian.address)) as unknown as SentinelRegistryV2;
  const subject = subjectKind === "contract"
    ? await (await ethers.getContractFactory("MutableSubjectV1")).deploy()
    : eoa;
  const subjectAddress = await subject.getAddress();
  const agentId = 41n;
  await identity.setAgent(agentId, owner.address, subjectAddress);
  const identityKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"], [CHAIN_ID, await identity.getAddress(), agentId],
  ));
  const gate = await (await ethers.getContractFactory("AgentGateV2")).deploy(
    await registry.getAddress(), await identity.getAddress(), 50, 1, COVERAGE, 2, 7 * DAY,
  ) as unknown as AgentGateV2;
  return { gate, registry, identity, scanner, guardian, subject, subjectAddress, other, agentId, identityKey };
}

async function sealValid(fixture: Awaited<ReturnType<typeof deployGateFixture>>, overrides = {}) {
  const code = await ethers.provider.getCode(fixture.subjectAddress);
  const expectedRuntimeCodeHash = code === "0x" ? ZERO : ethers.keccak256(code);
  await fixture.registry.connect(fixture.scanner).seal(
    fixture.identityKey, fixture.subjectAddress, input({ expectedRuntimeCodeHash, ...overrides }),
  );
}

describe("AgentGateV2", () => {
  it("rejects zero or non-contract dependency addresses", async () => {
    const fixture = await deployGateFixture();
    const factory = await ethers.getContractFactory("AgentGateV2");
    const registryAddress = await fixture.registry.getAddress();
    const identityAddress = await fixture.identity.getAddress();
    await expect(factory.deploy(ethers.ZeroAddress, identityAddress, 50, 1, COVERAGE, 1, DAY))
      .to.be.revertedWithCustomError(factory, "InvalidConfiguration");
    await expect(factory.deploy(registryAddress, ethers.ZeroAddress, 50, 1, COVERAGE, 1, DAY))
      .to.be.revertedWithCustomError(factory, "InvalidConfiguration");
    await expect(factory.deploy(fixture.other.address, identityAddress, 50, 1, COVERAGE, 1, DAY))
      .to.be.revertedWithCustomError(factory, "InvalidConfiguration");
    await expect(factory.deploy(registryAddress, fixture.other.address, 50, 1, COVERAGE, 1, DAY))
      .to.be.revertedWithCustomError(factory, "InvalidConfiguration");
  });

  it("rejects out-of-policy immutable limits", async () => {
    const fixture = await deployGateFixture();
    const factory = await ethers.getContractFactory("AgentGateV2");
    const args = [await fixture.registry.getAddress(), await fixture.identity.getAddress()] as const;
    await expect(factory.deploy(...args, 101, 1, COVERAGE, 1, DAY)).to.be.reverted;
    await expect(factory.deploy(...args, 50, 3, COVERAGE, 1, DAY)).to.be.reverted;
    await expect(factory.deploy(...args, 50, 1, 0x7e, 1, DAY)).to.be.reverted;
    await expect(factory.deploy(...args, 50, 1, 0xff, 1, DAY)).to.be.reverted;
    await expect(factory.deploy(...args, 50, 1, COVERAGE, 0, DAY)).to.be.reverted;
    await expect(factory.deploy(...args, 50, 1, COVERAGE, 1, 0)).to.be.reverted;
    await expect(factory.deploy(...args, 50, 1, COVERAGE, 1, 30 * DAY + 1)).to.be.reverted;
  });

  it("accepts the minimum and maximum valid gate limits", async () => {
    const fixture = await deployGateFixture();
    const factory = await ethers.getContractFactory("AgentGateV2");
    const minimum = await factory.deploy(
      await fixture.registry.getAddress(), await fixture.identity.getAddress(),
      0, 0, COVERAGE, 1, 1,
    );
    const maximum = await factory.deploy(
      await fixture.registry.getAddress(), await fixture.identity.getAddress(),
      100, 2, COVERAGE, 1, 30 * DAY,
    );
    expect(await minimum.maximumAge()).to.equal(1);
    expect(await maximum.maxBehavioralScore()).to.equal(100);
    expect(await maximum.maxCodeRisk()).to.equal(2);
    expect(await maximum.maximumAge()).to.equal(30 * DAY);
  });

  it("allows a current identity-bound ProofLock", async () => {
    const fixture = await deployGateFixture();
    await sealValid(fixture);
    expect(await fixture.gate.checkAgent(fixture.agentId)).to.deep.equal([true, 0n, fixture.subjectAddress, 1n]);
  });

  it("returns IDENTITY_UNAVAILABLE when the configured registry cannot answer", async () => {
    const fixture = await deployGateFixture();
    const wrongAbi = await (await ethers.getContractFactory("MutableSubjectV1")).deploy();
    const broken = await (await ethers.getContractFactory("AgentGateV2")).deploy(
      await fixture.registry.getAddress(), await wrongAbi.getAddress(), 50, 1, COVERAGE, 2, 7 * DAY,
    );
    expect((await broken.checkAgent(1))[1]).to.equal(13);
  });

  it("returns AGENT_NOT_FOUND when ownerOf rejects a missing token", async () => {
    const fixture = await deployGateFixture();
    expect((await fixture.gate.checkAgent(999))[1]).to.equal(14);
  });

  it("returns AGENT_WALLET_UNSET for a token without a wallet", async () => {
    const fixture = await deployGateFixture();
    await fixture.identity.setAgent(42, fixture.other.address, ethers.ZeroAddress);
    expect((await fixture.gate.checkAgent(42))[1]).to.equal(15);
  });

  it("returns IDENTITY_UNAVAILABLE for a malformed owner address word", async () => {
    const fixture = await deployGateFixture();
    await fixture.identity.setMalformedResponses(true, false);
    expect((await fixture.gate.checkAgent(fixture.agentId))[1]).to.equal(13);
  });

  it("returns IDENTITY_UNAVAILABLE for a malformed wallet address word", async () => {
    const fixture = await deployGateFixture();
    await fixture.identity.setMalformedResponses(false, true);
    expect((await fixture.gate.checkAgent(fixture.agentId))[1]).to.equal(13);
  });

  it("returns NO_PROOF after identity resolution succeeds", async () => {
    const fixture = await deployGateFixture();
    expect((await fixture.gate.checkAgent(fixture.agentId))[1]).to.equal(1);
  });

  it("blocks a changed ERC-8004 agent wallet", async () => {
    const fixture = await deployGateFixture();
    await sealValid(fixture);
    await fixture.identity.setAgentWallet(fixture.agentId, fixture.other.address);
    expect((await fixture.gate.checkAgent(fixture.agentId))[1]).to.equal(5);
  });

  it("blocks revoked and drifted locks", async () => {
    const revoked = await deployGateFixture();
    await sealValid(revoked);
    await revoked.registry.connect(revoked.guardian).revoke(revoked.identityKey, 2, 1);
    expect((await revoked.gate.checkAgent(revoked.agentId))[1]).to.equal(2);

    const drifted = await deployGateFixture();
    await sealValid(drifted);
    await drifted.registry.connect(drifted.guardian).markDrift(drifted.identityKey, 3, 1);
    expect((await drifted.gate.checkAgent(drifted.agentId))[1]).to.equal(3);
  });

  it("blocks expired and over-age locks", async () => {
    const expired = await deployGateFixture();
    await sealValid(expired, { validForSeconds: 2 });
    await time.increase(3);
    expect((await expired.gate.checkAgent(expired.agentId))[1]).to.equal(4);

    const aged = await deployGateFixture();
    await sealValid(aged, { validForSeconds: 10 * DAY });
    await time.increase(7 * DAY + 1);
    expect((await aged.gate.checkAgent(aged.agentId))[1]).to.equal(4);
  });

  it("expires a lock exactly at validUntil", async () => {
    const fixture = await deployGateFixture();
    await sealValid(fixture, { validForSeconds: 60 });
    const proof = await fixture.registry.getProofLock(fixture.identityKey);
    await time.increaseTo(proof.validUntil);
    expect((await fixture.gate.checkAgent(fixture.agentId))[1]).to.equal(4);
  });

  it("blocks an old policy and risk above either threshold", async () => {
    const policy = await deployGateFixture();
    await sealValid(policy, { policyVersion: 1 });
    expect((await policy.gate.checkAgent(policy.agentId))[1]).to.equal(7);

    const behavior = await deployGateFixture();
    await sealValid(behavior, { behavioralScore: 51 });
    expect((await behavior.gate.checkAgent(behavior.agentId))[1]).to.equal(11);

    const code = await deployGateFixture();
    await sealValid(code, { codeRisk: 2 });
    expect((await code.gate.checkAgent(code.agentId))[1]).to.equal(12);
  });

  it("blocks runtime bytecode drift", async () => {
    const fixture = await deployGateFixture("contract");
    await sealValid(fixture);
    const v2 = await (await ethers.getContractFactory("MutableSubjectV2")).deploy();
    await network.provider.send("hardhat_setCode", [fixture.subjectAddress, await ethers.provider.getCode(await v2.getAddress())]);
    expect((await fixture.gate.checkAgent(fixture.agentId))[1]).to.equal(6);
  });

  it("requireAgent returns identity data or reverts with the stable reason", async () => {
    const fixture = await deployGateFixture();
    await sealValid(fixture);
    expect(await fixture.gate.requireAgent(fixture.agentId)).to.deep.equal([fixture.subjectAddress, 1n]);
    await fixture.identity.setAgentWallet(fixture.agentId, fixture.other.address);
    await expect(fixture.gate.requireAgent(fixture.agentId))
      .to.be.revertedWithCustomError(fixture.gate, "AgentRejected").withArgs(5);
  });
});
