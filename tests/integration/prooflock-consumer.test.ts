import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type {
  MockERC8004IdentityRegistry,
  ProofLockConsumerDemo,
  SentinelRegistryV2,
} from "../../typechain-types";

const DAY = 24 * 60 * 60;
const COVERAGE = 0x7f;
const HASHES = ["a", "b", "c", "d"].map((value) => `0x${value.repeat(64)}`);

function input(validForSeconds = 7 * DAY) {
  return { envelopeDigest: HASHES[0], storageRoot: HASHES[1], computeRoot: HASHES[2], artifactHash: HASHES[3],
    expectedRuntimeCodeHash: ethers.ZeroHash, validForSeconds,
    policyVersion: 1, behavioralScore: 10, codeRisk: 0, coverage: COVERAGE };
}

async function deployFixture(validForSeconds = 7 * DAY) {
  const [admin, scanner, guardian, owner, agent, outsider] = await ethers.getSigners();
  const identity = (await (await ethers.getContractFactory("MockERC8004IdentityRegistry")).deploy()) as unknown as MockERC8004IdentityRegistry;
  const registry = (await (await ethers.getContractFactory("SentinelRegistryV2")).deploy(admin.address, scanner.address, guardian.address)) as unknown as SentinelRegistryV2;
  await identity.setAgent(7, owner.address, agent.address);
  const identityKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"], [16661, await identity.getAddress(), 7],
  ));
  await registry.connect(scanner).seal(identityKey, agent.address, input(validForSeconds));
  const gate = await (await ethers.getContractFactory("AgentGateV2")).deploy(
    await registry.getAddress(), await identity.getAddress(), 50, 1, COVERAGE, 1, 7 * DAY,
  );
  const consumer = (await (await ethers.getContractFactory("ProofLockConsumerDemo")).deploy(await gate.getAddress())) as unknown as ProofLockConsumerDemo;
  return { registry, consumer, scanner, guardian, agent, outsider, identityKey };
}

describe("ProofLockConsumerDemo", () => {
  it("changes visible state only for an allowed agent", async () => {
    const { consumer, agent } = await deployFixture();
    await consumer.connect(agent).acceptAgent(7);
    expect(await consumer.acceptedCount()).to.equal(1n);
    expect(await consumer.lastAcceptedAgent()).to.equal(agent.address);
    expect(await consumer.lastAcceptedVersion()).to.equal(1n);
  });

  it("rejects an outsider spoofing an admitted agent ID", async () => {
    const { consumer, agent, outsider } = await deployFixture();
    await expect(consumer.connect(outsider).acceptAgent(7))
      .to.be.revertedWithCustomError(consumer, "CallerNotAgent")
      .withArgs(outsider.address, agent.address);
    expect(await consumer.acceptedCount()).to.equal(0n);
  });

  it("blocks the action after drift is marked", async () => {
    const { registry, consumer, guardian, agent, identityKey } = await deployFixture();
    await registry.connect(guardian).markDrift(identityKey, 3, 1);
    await expect(consumer.connect(agent).acceptAgent(7)).to.be.reverted;
    expect(await consumer.acceptedCount()).to.equal(0n);
  });

  it("blocks the action after the lease expires", async () => {
    const { consumer, agent } = await deployFixture(2);
    await time.increase(3);
    await expect(consumer.connect(agent).acceptAgent(7)).to.be.reverted;
    expect(await consumer.acceptedCount()).to.equal(0n);
  });

  it("allows the action again after resealing a drifted proof", async () => {
    const { registry, consumer, scanner, guardian, agent, identityKey } = await deployFixture();
    await registry.connect(guardian).markDrift(identityKey, 3, 1);
    await expect(consumer.connect(agent).acceptAgent(7)).to.be.reverted;
    await registry.connect(scanner).reseal(identityKey, agent.address, 1, input());
    await consumer.connect(agent).acceptAgent(7);
    expect(await consumer.acceptedCount()).to.equal(1n);
    expect(await consumer.lastAcceptedVersion()).to.equal(2n);
  });
});
