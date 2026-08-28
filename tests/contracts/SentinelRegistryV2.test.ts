import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { SentinelRegistryV2 } from "../../typechain-types";

const DAY = 24 * 60 * 60;
const REQUIRED_COVERAGE = 0x7f;
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const HASH_C = `0x${"c".repeat(64)}`;
const HASH_D = `0x${"d".repeat(64)}`;
const ZERO = ethers.ZeroHash;

function lockInput(overrides: Record<string, unknown> = {}) {
  return {
    envelopeDigest: HASH_A,
    storageRoot: HASH_B,
    computeRoot: HASH_C,
    artifactHash: HASH_D,
    expectedRuntimeCodeHash: ZERO,
    validForSeconds: 7 * DAY,
    policyVersion: 1,
    behavioralScore: 10,
    codeRisk: 0,
    coverage: REQUIRED_COVERAGE,
    ...overrides,
  };
}

async function deployRegistry() {
  const [admin, scanner, guardian, outsider, subject] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("SentinelRegistryV2")).deploy(
    admin.address,
    scanner.address,
    guardian.address,
  ) as unknown as SentinelRegistryV2;
  return { registry, admin, scanner, guardian, outsider, subject };
}

describe("SentinelRegistryV2", () => {
  it("grants separate scanner and guardian roles and lets admin revoke them", async () => {
    const { registry, admin, scanner, guardian, subject } = await deployRegistry();
    const scannerRole = await registry.SCANNER_ROLE();
    const guardianRole = await registry.GUARDIAN_ROLE();
    expect(await registry.hasRole(scannerRole, scanner.address)).to.equal(true);
    expect(await registry.hasRole(guardianRole, guardian.address)).to.equal(true);

    await registry.connect(admin).revokeRole(scannerRole, scanner.address);
    await expect(registry.connect(scanner).seal(HASH_A, subject.address, lockInput()))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await registry.connect(admin).revokeRole(guardianRole, guardian.address);
    await expect(registry.connect(guardian).revoke(HASH_A, 2, 1))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });

  it("does not allow the admin role alone to seal", async () => {
    const { registry, admin, subject } = await deployRegistry();
    await expect(registry.connect(admin).seal(HASH_A, subject.address, lockInput()))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });

  for (const [name, identityKey, subject, overrides] of [
    ["identity", ZERO, "subject", {}],
    ["subject", HASH_A, "zero", {}],
    ["envelope", HASH_A, "subject", { envelopeDigest: ZERO }],
    ["storage", HASH_A, "subject", { storageRoot: ZERO }],
    ["compute", HASH_A, "subject", { computeRoot: ZERO }],
    ["artifact", HASH_A, "subject", { artifactHash: ZERO }],
  ] as const) {
    it(`rejects a zero ${name} commitment`, async () => {
      const fixture = await deployRegistry();
      const subjectAddress = subject === "zero" ? ethers.ZeroAddress : fixture.subject.address;
      await expect(
        fixture.registry.connect(fixture.scanner).seal(identityKey, subjectAddress, lockInput(overrides)),
      ).to.be.revertedWithCustomError(fixture.registry, "ZeroCommitment");
    });
  }

  it("enforces positive TTL and the 30 day maximum", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await expect(registry.connect(scanner).seal(HASH_A, subject.address, lockInput({ validForSeconds: 0 })))
      .to.be.revertedWithCustomError(registry, "InvalidTTL");
    await expect(registry.connect(scanner).seal(HASH_A, subject.address, lockInput({ validForSeconds: 30 * DAY + 1 })))
      .to.be.revertedWithCustomError(registry, "InvalidTTL");
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput({ validForSeconds: 30 * DAY }));
    expect((await registry.getProofLock(HASH_A)).version).to.equal(1n);
  });

  it("requires the complete ProofLock coverage mask", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await expect(registry.connect(scanner).seal(HASH_A, subject.address, lockInput({ coverage: 0x7e })))
      .to.be.revertedWithCustomError(registry, "IncompleteCoverage");
  });

  it("accepts behavioral score 100 and rejects 101", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput({ behavioralScore: 100 }));
    expect((await registry.getProofLock(HASH_A)).behavioralScore).to.equal(100);
    await expect(registry.connect(scanner).seal(HASH_B, subject.address, lockInput({ behavioralScore: 101 })))
      .to.be.revertedWithCustomError(registry, "InvalidBehavioralScore");
  });

  it("accepts code risk 2 and rejects 3", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput({ codeRisk: 2 }));
    expect((await registry.getProofLock(HASH_A)).codeRisk).to.equal(2);
    await expect(registry.connect(scanner).seal(HASH_B, subject.address, lockInput({ codeRisk: 3 })))
      .to.be.revertedWithCustomError(registry, "InvalidCodeRisk");
  });

  it("seals version one and indexes the identity once", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    const tx = await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    await expect(tx).to.emit(registry, "ProofLocked").withArgs(
      HASH_A, subject.address, 1n, block!.timestamp, block!.timestamp + 7 * DAY,
      HASH_A, HASH_B, HASH_C, HASH_D, ZERO, 1, 10, 0, REQUIRED_COVERAGE,
    );
    const proof = await registry.getProofLock(HASH_A);
    expect(proof.identityKey).to.equal(HASH_A);
    expect(proof.subject).to.equal(subject.address);
    expect(proof.version).to.equal(1n);
    expect(proof.state).to.equal(1);
    expect(proof.stateReason).to.equal(0);
    expect(proof.validUntil - proof.issuedAt).to.equal(BigInt(7 * DAY));
    expect(await registry.getIdentityCount()).to.equal(1n);
    expect(await registry.getIdentityKeysPaged(0, 1)).to.deep.equal([HASH_A]);
    expect(await registry.getIdentityKeysPaged(1, 1)).to.deep.equal([]);
  });

  it("allows seal only for absent identities and reseal only for existing identities", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await expect(registry.connect(scanner).reseal(HASH_A, subject.address, 1, lockInput()))
      .to.be.revertedWithCustomError(registry, "ProofNotFound");
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    await expect(registry.connect(scanner).seal(HASH_A, subject.address, lockInput()))
      .to.be.revertedWithCustomError(registry, "ProofAlreadyExists");
  });

  it("reseals with the next version and emits supersession", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    const tx = await registry.connect(scanner).reseal(HASH_A, subject.address, 1, lockInput({ envelopeDigest: HASH_B }));
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    await expect(tx)
      .to.emit(registry, "ProofSuperseded")
      .withArgs(HASH_A, 1n, 2n)
      .and.to.emit(registry, "ProofLocked")
      .withArgs(
        HASH_A, subject.address, 2n, block!.timestamp, block!.timestamp + 7 * DAY,
        HASH_B, HASH_B, HASH_C, HASH_D, ZERO, 1, 10, 0, REQUIRED_COVERAGE,
      );
    expect((await registry.getProofLock(HASH_A)).version).to.equal(2n);
    expect(await registry.getIdentityCount()).to.equal(1n);
  });

  it("rejects stale revoke and drift writes", async () => {
    const { registry, scanner, guardian, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    await expect(registry.connect(guardian).revoke(HASH_A, 2, 2))
      .to.be.revertedWithCustomError(registry, "StaleVersion");
    await registry.connect(guardian).markDrift(HASH_A, 3, 1);
    expect((await registry.getProofLock(HASH_A)).state).to.equal(3);
    await expect(registry.connect(guardian).revoke(HASH_A, 2, 2))
      .to.be.revertedWithCustomError(registry, "StaleVersion");
  });

  it("revokes and marks drift with explicit reason codes", async () => {
    const { registry, scanner, guardian, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    await expect(registry.connect(guardian).revoke(HASH_A, 2, 1))
      .to.emit(registry, "ProofRevoked").withArgs(HASH_A, 1n, 2);
    expect((await registry.getProofLock(HASH_A)).stateReason).to.equal(2);

    await registry.connect(scanner).seal(HASH_B, subject.address, lockInput());
    await expect(registry.connect(guardian).markDrift(HASH_B, 6, 1))
      .to.emit(registry, "DriftMarked").withArgs(HASH_B, 1n, 6);
    expect((await registry.getProofLock(HASH_B)).stateReason).to.equal(6);
  });

  it("enforces one-way competing lifecycle transitions", async () => {
    const { registry, scanner, guardian, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    await registry.connect(guardian).markDrift(HASH_A, 3, 1);
    await expect(registry.connect(guardian).markDrift(HASH_A, 3, 1))
      .to.be.revertedWithCustomError(registry, "InvalidState");
    await registry.connect(guardian).revoke(HASH_A, 2, 1);
    await expect(registry.connect(guardian).revoke(HASH_A, 2, 1))
      .to.be.revertedWithCustomError(registry, "InvalidState");
    await expect(registry.connect(guardian).markDrift(HASH_A, 3, 1))
      .to.be.revertedWithCustomError(registry, "InvalidState");
    await expect(registry.connect(scanner).reseal(HASH_A, subject.address, 1, lockInput()))
      .to.be.revertedWithCustomError(registry, "InvalidState");
  });

  it("allows resealing ACTIVE or DRIFTED records", async () => {
    const { registry, scanner, guardian, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput({ validForSeconds: 1 }));
    await time.increase(2);
    await registry.connect(scanner).reseal(HASH_A, subject.address, 1, lockInput());
    expect((await registry.getProofLock(HASH_A)).version).to.equal(2n);
    await registry.connect(scanner).seal(HASH_B, subject.address, lockInput());
    await registry.connect(guardian).markDrift(HASH_B, 3, 1);
    await registry.connect(scanner).reseal(HASH_B, subject.address, 1, lockInput());
    expect((await registry.getProofLock(HASH_B)).state).to.equal(1);
  });

  it("requires lifecycle reason codes from 1 through 16", async () => {
    const { registry, scanner, guardian, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    await expect(registry.connect(guardian).markDrift(HASH_A, 0, 1))
      .to.be.revertedWithCustomError(registry, "InvalidReason");
    await expect(registry.connect(guardian).markDrift(HASH_A, 17, 1))
      .to.be.revertedWithCustomError(registry, "InvalidReason");
    await registry.connect(guardian).markDrift(HASH_A, 16, 1);

    await registry.connect(scanner).seal(HASH_B, subject.address, lockInput());
    await expect(registry.connect(guardian).revoke(HASH_B, 0, 1))
      .to.be.revertedWithCustomError(registry, "InvalidReason");
    await expect(registry.connect(guardian).revoke(HASH_B, 17, 1))
      .to.be.revertedWithCustomError(registry, "InvalidReason");
    await registry.connect(guardian).revoke(HASH_B, 1, 1);
  });

  it("caps identity pagination at 100", async () => {
    const { registry } = await deployRegistry();
    expect(await registry.getIdentityKeysPaged(0, 100)).to.deep.equal([]);
    await expect(registry.getIdentityKeysPaged(0, 101))
      .to.be.revertedWithCustomError(registry, "PageLimitExceeded");
  });

  it("stores and emits the expected live contract runtime code hash", async () => {
    const { registry, scanner } = await deployRegistry();
    const contractSubject = await (await ethers.getContractFactory("MutableSubjectV1")).deploy();
    const address = await contractSubject.getAddress();
    const expected = ethers.keccak256(await ethers.provider.getCode(address));
    const tx = await registry.connect(scanner).seal(HASH_A, address, lockInput({ expectedRuntimeCodeHash: expected }));
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    expect((await registry.getProofLock(HASH_A)).runtimeCodeHash).to.equal(expected);
    await expect(tx).to.emit(registry, "ProofLocked").withArgs(
      HASH_A, address, 1, block!.timestamp, block!.timestamp + 7 * DAY,
      HASH_A, HASH_B, HASH_C, HASH_D, expected, 1, 10, 0, REQUIRED_COVERAGE,
    );
  });

  it("stores zero runtime code hash for an EOA", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    expect((await registry.getProofLock(HASH_A)).runtimeCodeHash).to.equal(ZERO);
  });

  it("rejects a nonzero expected runtime for an EOA without indexing or events", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    const filter = registry.filters.ProofLocked(HASH_A);
    await expect(registry.connect(scanner).seal(
      HASH_A, subject.address, lockInput({ expectedRuntimeCodeHash: HASH_B }),
    )).to.be.revertedWithCustomError(registry, "RuntimeCodeHashMismatch").withArgs(HASH_B, ZERO);
    expect((await registry.getProofLock(HASH_A)).version).to.equal(0n);
    expect(await registry.getIdentityCount()).to.equal(0n);
    expect(await registry.queryFilter(filter)).to.deep.equal([]);
  });

  it("rejects zero and wrong expected hashes for a contract without state", async () => {
    const { registry, scanner } = await deployRegistry();
    const contractSubject = await (await ethers.getContractFactory("MutableSubjectV1")).deploy();
    const address = await contractSubject.getAddress();
    const actual = ethers.keccak256(await ethers.provider.getCode(address));
    for (const expected of [ZERO, HASH_B]) {
      await expect(registry.connect(scanner).seal(
        HASH_A, address, lockInput({ expectedRuntimeCodeHash: expected }),
      )).to.be.revertedWithCustomError(registry, "RuntimeCodeHashMismatch").withArgs(expected, actual);
      expect((await registry.getProofLock(HASH_A)).version).to.equal(0n);
      expect(await registry.getIdentityCount()).to.equal(0n);
    }
  });

  it("rejects when analyzed V1 runtime mutates to V2 before seal", async () => {
    const { registry, scanner } = await deployRegistry();
    const v1 = await (await ethers.getContractFactory("MutableSubjectV1")).deploy();
    const v2 = await (await ethers.getContractFactory("MutableSubjectV2")).deploy();
    const address = await v1.getAddress();
    const analyzed = ethers.keccak256(await ethers.provider.getCode(address));
    await network.provider.send("hardhat_setCode", [address, await ethers.provider.getCode(await v2.getAddress())]);
    const live = ethers.keccak256(await ethers.provider.getCode(address));
    await expect(registry.connect(scanner).seal(
      HASH_A, address, lockInput({ expectedRuntimeCodeHash: analyzed }),
    )).to.be.revertedWithCustomError(registry, "RuntimeCodeHashMismatch").withArgs(analyzed, live);
    expect((await registry.getProofLock(HASH_A)).state).to.equal(0);
  });

  it("preserves a prior proof on stale-runtime reseal and accepts the fresh runtime once", async () => {
    const { registry, scanner } = await deployRegistry();
    const v1 = await (await ethers.getContractFactory("MutableSubjectV1")).deploy();
    const v2 = await (await ethers.getContractFactory("MutableSubjectV2")).deploy();
    const address = await v1.getAddress();
    const v1Hash = ethers.keccak256(await ethers.provider.getCode(address));
    await registry.connect(scanner).seal(HASH_A, address, lockInput({ expectedRuntimeCodeHash: v1Hash }));
    await network.provider.send("hardhat_setCode", [address, await ethers.provider.getCode(await v2.getAddress())]);
    const v2Hash = ethers.keccak256(await ethers.provider.getCode(address));
    await expect(registry.connect(scanner).reseal(
      HASH_A, address, 1, lockInput({ expectedRuntimeCodeHash: v1Hash }),
    )).to.be.revertedWithCustomError(registry, "RuntimeCodeHashMismatch").withArgs(v1Hash, v2Hash);
    expect((await registry.getProofLock(HASH_A)).version).to.equal(1n);
    expect((await registry.getProofLock(HASH_A)).runtimeCodeHash).to.equal(v1Hash);
    expect((await registry.getProofLock(HASH_A)).state).to.equal(1);
    await registry.connect(scanner).reseal(HASH_A, address, 1, lockInput({ expectedRuntimeCodeHash: v2Hash }));
    expect((await registry.getProofLock(HASH_A)).version).to.equal(2n);
    expect((await registry.getProofLock(HASH_A)).runtimeCodeHash).to.equal(v2Hash);
  });

  it("binds an EOA-to-EIP-7702 designator transition to the exact designator hash", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    const designator = `0xef0100${scanner.address.slice(2)}`;
    try {
      await network.provider.send("hardhat_setCode", [subject.address, designator]);
      const expected = ethers.keccak256(designator);
      await expect(registry.connect(scanner).seal(HASH_A, subject.address, lockInput()))
        .to.be.revertedWithCustomError(registry, "RuntimeCodeHashMismatch").withArgs(ZERO, expected);
      await registry.connect(scanner).seal(HASH_A, subject.address, lockInput({ expectedRuntimeCodeHash: expected }));
      expect((await registry.getProofLock(HASH_A)).runtimeCodeHash).to.equal(expected);
    } finally {
      await network.provider.send("hardhat_setCode", [subject.address, "0x"]);
    }
  });

  it("rejects a stale reseal version without a successor and accepts the current version once", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    await expect(registry.connect(scanner).reseal(HASH_A, subject.address, 2, lockInput()))
      .to.be.revertedWithCustomError(registry, "StaleVersion").withArgs(2, 1);
    expect((await registry.getProofLock(HASH_A)).version).to.equal(1n);
    expect(await registry.queryFilter(registry.filters.ProofSuperseded(HASH_A))).to.deep.equal([]);
    await registry.connect(scanner).reseal(HASH_A, subject.address, 1, lockInput());
    await expect(registry.connect(scanner).reseal(HASH_A, subject.address, 1, lockInput()))
      .to.be.revertedWithCustomError(registry, "StaleVersion").withArgs(1, 2);
    expect((await registry.getProofLock(HASH_A)).version).to.equal(2n);
    expect(await registry.queryFilter(registry.filters.ProofSuperseded(HASH_A))).to.have.length(1);
  });
});
