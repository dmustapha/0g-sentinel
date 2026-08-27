import { expect } from "chai";
import { ethers } from "hardhat";
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

  it("seals version one and indexes the identity once", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await expect(registry.connect(scanner).seal(HASH_A, subject.address, lockInput()))
      .to.emit(registry, "ProofLocked");
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
    await expect(registry.connect(scanner).reseal(HASH_A, subject.address, lockInput()))
      .to.be.revertedWithCustomError(registry, "ProofNotFound");
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    await expect(registry.connect(scanner).seal(HASH_A, subject.address, lockInput()))
      .to.be.revertedWithCustomError(registry, "ProofAlreadyExists");
  });

  it("reseals with the next version and emits supersession", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    await expect(registry.connect(scanner).reseal(HASH_A, subject.address, lockInput({ envelopeDigest: HASH_B })))
      .to.emit(registry, "ProofSuperseded")
      .withArgs(HASH_A, 1n, 2n)
      .and.to.emit(registry, "ProofLocked");
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

  it("stores the contract runtime code hash computed by the registry", async () => {
    const { registry, scanner } = await deployRegistry();
    const contractSubject = await (await ethers.getContractFactory("MutableSubjectV1")).deploy();
    const address = await contractSubject.getAddress();
    const expected = ethers.keccak256(await ethers.provider.getCode(address));
    await registry.connect(scanner).seal(HASH_A, address, lockInput());
    expect((await registry.getProofLock(HASH_A)).runtimeCodeHash).to.equal(expected);
  });

  it("stores zero runtime code hash for an EOA", async () => {
    const { registry, scanner, subject } = await deployRegistry();
    await registry.connect(scanner).seal(HASH_A, subject.address, lockInput());
    expect((await registry.getProofLock(HASH_A)).runtimeCodeHash).to.equal(ZERO);
  });
});
