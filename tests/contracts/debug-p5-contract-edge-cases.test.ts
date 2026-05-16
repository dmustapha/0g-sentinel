// debug-p5-contract-edge-cases.test.ts
// Phase 5.1: Contract edge cases — every public/external function

import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentRegistry, AttestationRegistry, AgentGate } from "../../typechain-types";

const HASH_A = "0x" + "a".repeat(64);
const HASH_B = "0x" + "b".repeat(64);
const HASH_C = "0x" + "c".repeat(64);
const ZERO_BYTES32 = "0x" + "0".repeat(64);

async function deployAll() {
  const [owner, scanner, agentA, agentB, notOwner] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("AgentRegistry")).deploy() as unknown as AgentRegistry;
  const attestation = await (await ethers.getContractFactory("AttestationRegistry")).deploy() as unknown as AttestationRegistry;
  const gate = await (await ethers.getContractFactory("AgentGate")).deploy(await attestation.getAddress(), false, false) as unknown as AgentGate;
  return { registry, attestation, gate, owner, scanner, agentA, agentB, notOwner };
}

// ── AgentRegistry edge cases ─────────────────────────────────────────────────

describe("Edge: AgentRegistry — registerAgent()", () => {
  it("Zero address → revert 'Invalid address'", async () => {
    const { registry } = await deployAll();
    await expect(registry.registerAgent(ethers.ZeroAddress, 1n))
      .to.be.revertedWith("Invalid address");
  });

  it("Max tokenId (type(uint256).max) → succeeds", async () => {
    const { registry, agentA } = await deployAll();
    const maxUint = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    await registry.registerAgent(agentA.address, maxUint);
    expect(await registry.isRegistered(agentA.address)).to.be.true;
  });

  it("TokenId = 0 → succeeds (no minimum constraint)", async () => {
    const { registry, agentA } = await deployAll();
    await registry.registerAgent(agentA.address, 0n);
    expect(await registry.isRegistered(agentA.address)).to.be.true;
  });

  it("Non-owner → reverts with OwnableUnauthorizedAccount", async () => {
    const { registry, agentA, notOwner } = await deployAll();
    await expect(registry.connect(notOwner).registerAgent(agentA.address, 1n))
      .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  it("Double-register same address → idempotent (count stays 1)", async () => {
    const { registry, agentA } = await deployAll();
    await registry.registerAgent(agentA.address, 1n);
    await registry.registerAgent(agentA.address, 99n); // different tokenId, ignored
    expect(await registry.getAgentCount()).to.equal(1n);
  });
});

describe("Edge: AgentRegistry — registerAgentsBatch()", () => {
  it("Mismatched array lengths → revert 'Length mismatch'", async () => {
    const { registry, agentA, agentB } = await deployAll();
    await expect(
      registry.registerAgentsBatch([agentA.address, agentB.address], [1n])
    ).to.be.revertedWith("Length mismatch");
  });

  it("Empty arrays → succeeds, count unchanged", async () => {
    const { registry } = await deployAll();
    await registry.registerAgentsBatch([], []);
    expect(await registry.getAgentCount()).to.equal(0n);
  });

  it("Batch with zero address → zero address silently skipped", async () => {
    const { registry, agentA } = await deployAll();
    await registry.registerAgentsBatch(
      [ethers.ZeroAddress, agentA.address],
      [1n, 2n]
    );
    // Zero address skipped, agentA registered
    expect(await registry.getAgentCount()).to.equal(1n);
    expect(await registry.isRegistered(agentA.address)).to.be.true;
  });

  it("Batch with duplicate addresses → deduplicates", async () => {
    const { registry, agentA } = await deployAll();
    await registry.registerAgentsBatch(
      [agentA.address, agentA.address],
      [1n, 2n]
    );
    expect(await registry.getAgentCount()).to.equal(1n);
  });

  it("Non-owner batch register → reverts", async () => {
    const { registry, agentA, notOwner } = await deployAll();
    await expect(
      registry.connect(notOwner).registerAgentsBatch([agentA.address], [1n])
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });
});

// ── AttestationRegistry edge cases ──────────────────────────────────────────

describe("Edge: AttestationRegistry — writeAttestation()", () => {
  it("Zero agent address → revert 'Invalid agent address'", async () => {
    const { attestation, scanner } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await expect(
      attestation.connect(scanner).writeAttestation(
        ethers.ZeroAddress, 50, 1, 1, "", "", HASH_A, HASH_B, HASH_C
      )
    ).to.be.revertedWith("Invalid agent address");
  });

  it("behavioral_score > 100 → revert 'Score must be 0-100'", async () => {
    const { attestation, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await expect(
      attestation.connect(scanner).writeAttestation(
        agentA.address, 101, 0, 0, "", "", HASH_A, HASH_B, HASH_C
      )
    ).to.be.revertedWith("Score must be 0-100");
  });

  it("behavioral_score = 100 → succeeds (boundary)", async () => {
    const { attestation, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 100, 2, 2, "", "", HASH_A, HASH_B, HASH_C
    );
    const att = await attestation.getAttestation(agentA.address);
    expect(Number(att.behavioral_score)).to.equal(100);
  });

  it("behavioral_score = 0 → succeeds (minimum)", async () => {
    const { attestation, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 0, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    const att = await attestation.getAttestation(agentA.address);
    expect(Number(att.behavioral_score)).to.equal(0);
  });

  it("threat_level > 2 → revert 'Invalid threat_level'", async () => {
    const { attestation, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await expect(
      attestation.connect(scanner).writeAttestation(
        agentA.address, 50, 3, 0, "", "", HASH_A, HASH_B, HASH_C
      )
    ).to.be.revertedWith("Invalid threat_level");
  });

  it("code_risk > 2 → revert 'Invalid code_risk'", async () => {
    const { attestation, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await expect(
      attestation.connect(scanner).writeAttestation(
        agentA.address, 50, 0, 3, "", "", HASH_A, HASH_B, HASH_C
      )
    ).to.be.revertedWith("Invalid code_risk");
  });

  it("Zero bytes32 hashes → accepted (valid attestation)", async () => {
    const { attestation, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 50, 1, 1, "", "", ZERO_BYTES32, ZERO_BYTES32, ZERO_BYTES32
    );
    const att = await attestation.getAttestation(agentA.address);
    expect(att.behavioral_receipt_hash).to.equal(ZERO_BYTES32);
  });

  it("Empty code_findings string → accepted", async () => {
    const { attestation, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 10, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    const att = await attestation.getAttestation(agentA.address);
    expect(att.code_findings).to.equal("");
  });

  it("Unauthorized caller → revert 'Not authorized scanner'", async () => {
    const { attestation, agentA, notOwner } = await deployAll();
    await expect(
      attestation.connect(notOwner).writeAttestation(
        agentA.address, 10, 0, 0, "", "", HASH_A, HASH_B, HASH_C
      )
    ).to.be.revertedWith("Not authorized scanner");
  });
});

describe("Edge: AttestationRegistry — authorizeScanner/revokeScanner()", () => {
  it("Authorize then revoke — scanner can no longer write", async () => {
    const { attestation, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.revokeScanner(scanner.address);
    await expect(
      attestation.connect(scanner).writeAttestation(
        agentA.address, 10, 0, 0, "", "", HASH_A, HASH_B, HASH_C
      )
    ).to.be.revertedWith("Not authorized scanner");
  });

  it("Non-owner cannot authorize scanner", async () => {
    const { attestation, notOwner, scanner } = await deployAll();
    await expect(
      attestation.connect(notOwner).authorizeScanner(scanner.address)
    ).to.be.revertedWithCustomError(attestation, "OwnableUnauthorizedAccount");
  });

  it("Owner can write attestation directly without being a registered scanner", async () => {
    const { attestation, owner, agentA } = await deployAll();
    // onlyAuthorized allows owner OR authorized scanner
    await attestation.connect(owner).writeAttestation(
      agentA.address, 10, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    expect(await attestation.hasAttestation(agentA.address)).to.be.true;
  });
});

// ── AgentGate edge cases ────────────────────────────────────────────────────

describe("Edge: AgentGate — isSafe()", () => {
  it("Zero agent address → returns false (no attestation)", async () => {
    const { gate } = await deployAll();
    const [safe] = await gate.isSafe.staticCall(ethers.ZeroAddress);
    expect(safe).to.be.false;
  });

  it("Boundary: threat_level=1 (MAX) → safe", async () => {
    const { attestation, gate, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 59, 1, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    const [safe] = await gate.isSafe.staticCall(agentA.address);
    expect(safe).to.be.true;
  });

  it("Boundary: threat_level=2 (>MAX) → not safe", async () => {
    const { attestation, gate, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 60, 2, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    const [safe] = await gate.isSafe.staticCall(agentA.address);
    expect(safe).to.be.false;
  });

  it("Boundary: code_risk=1 (MAX) → safe", async () => {
    const { attestation, gate, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 10, 0, 1, "warning only", "", HASH_A, HASH_B, HASH_C
    );
    const [safe] = await gate.isSafe.staticCall(agentA.address);
    expect(safe).to.be.true;
  });

  it("Boundary: code_risk=2 (>MAX) → not safe", async () => {
    const { attestation, gate, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 10, 0, 2, "reentrancy", "", HASH_A, HASH_B, HASH_C
    );
    const [safe] = await gate.isSafe.staticCall(agentA.address);
    expect(safe).to.be.false;
  });
});

describe("Edge: AgentGate — executeIfSafe()", () => {
  it("Reverts with 'Agent execution failed' when target call fails", async () => {
    const { attestation, gate, scanner, agentA } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 10, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    // Call with invalid calldata to a contract that will revert
    const invalidCalldata = "0xdeadbeef";
    await expect(
      gate.executeIfSafe(agentA.address, await attestation.getAddress(), invalidCalldata)
    ).to.be.revertedWith("Agent execution failed");
  });

  it("executeIfSafe to EOA with empty calldata succeeds", async () => {
    const { attestation, gate, scanner, agentA, notOwner } = await deployAll();
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 10, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    // Calling an EOA with empty calldata always succeeds
    const tx = await gate.executeIfSafe(agentA.address, notOwner.address, "0x");
    expect(tx.hash).to.be.a("string");
  });
});
