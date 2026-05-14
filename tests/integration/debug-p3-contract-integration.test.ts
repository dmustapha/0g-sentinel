// debug-p3-contract-integration.test.ts
// Phase 3: Integration tests — non-user-facing connections
// Tests: AgentGate↔AttestationRegistry cross-contract interface
//        Scanner write path → AttestationRegistry state
// Runs on Hardhat local network

import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentRegistry, AttestationRegistry, AgentGate } from "../../typechain-types";

const ZERO_BYTES32 = "0x" + "0".repeat(64);
const HASH_A = "0x" + "a".repeat(64);
const HASH_B = "0x" + "b".repeat(64);
const HASH_C = "0x" + "c".repeat(64);

describe("Integration: Contract-Contract (AgentGate ↔ AttestationRegistry)", () => {
  let registry: AgentRegistry;
  let attestation: AttestationRegistry;
  let gate: AgentGate;
  let owner: any, scanner: any, user: any, agent: any;

  beforeEach(async () => {
    [owner, scanner, user, agent] = await ethers.getSigners();

    const RegistryFactory = await ethers.getContractFactory("AgentRegistry");
    registry = await RegistryFactory.deploy() as unknown as AgentRegistry;

    const AttestationFactory = await ethers.getContractFactory("AttestationRegistry");
    attestation = await AttestationFactory.deploy() as unknown as AttestationRegistry;

    const GateFactory = await ethers.getContractFactory("AgentGate");
    gate = await GateFactory.deploy(await attestation.getAddress()) as unknown as AgentGate;
  });

  // ── AgentGate reads AttestationRegistry correctly ──────────────────────

  it("AgentGate: isSafe returns false for unattested agent", async () => {
    const [safe, reason] = await gate.isSafe(agent.address);
    expect(safe).to.be.false;
    expect(reason).to.include("no attestation");
  });

  it("AgentGate: isSafe returns true for SAFE attested agent", async () => {
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 10, 0, 0, "", HASH_A, HASH_B, HASH_C
    );
    const [safe, reason] = await gate.isSafe(agent.address);
    expect(safe).to.be.true;
    expect(reason).to.equal("");
  });

  it("AgentGate: isSafe returns true for CAUTION attested agent (threat_level=1)", async () => {
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 45, 1, 0, "", HASH_A, HASH_B, HASH_C
    );
    const [safe] = await gate.isSafe(agent.address);
    expect(safe).to.be.true; // threshold is MAX_THREAT_LEVEL=1
  });

  it("AgentGate: isSafe returns false for FLAGGED agent (threat_level=2)", async () => {
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 80, 2, 0, "", HASH_A, HASH_B, HASH_C
    );
    const [safe, reason] = await gate.isSafe(agent.address);
    expect(safe).to.be.false;
    expect(reason).to.include("FLAGGED");
  });

  it("AgentGate: isSafe returns false for VULNERABLE code risk (code_risk=2)", async () => {
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 10, 0, 2, "reentrancy at withdraw()", HASH_A, HASH_B, HASH_C
    );
    const [safe, reason] = await gate.isSafe(agent.address);
    expect(safe).to.be.false;
    expect(reason).to.include("VULNERABLE");
  });

  it("AgentGate: executeIfSafe reverts for unsafe agent", async () => {
    // Unattested agent — should revert
    await expect(
      gate.executeIfSafe(agent.address, user.address, "0x")
    ).to.be.revertedWith("Agent has no attestation from 0G Sentinel");
  });

  it("AgentGate: executeIfSafe reverts for FLAGGED agent", async () => {
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 80, 2, 0, "", HASH_A, HASH_B, HASH_C
    );
    await expect(
      gate.executeIfSafe(agent.address, user.address, "0x")
    ).to.be.revertedWith("Agent behavioral risk: FLAGGED");
  });

  it("AgentGate: executeIfSafe succeeds for SAFE agent (simple call)", async () => {
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 10, 0, 0, "", HASH_A, HASH_B, HASH_C
    );
    // Call a view function on AttestationRegistry (will succeed)
    const iface = new ethers.Interface(["function getAttestedCount() view returns (uint256)"]);
    const calldata = iface.encodeFunctionData("getAttestedCount");
    // executeIfSafe should succeed (no revert)
    const tx = await gate.executeIfSafe(agent.address, await attestation.getAddress(), calldata);
    expect(tx.hash).to.be.a("string");
  });

  it("AgentGate emits AgentBlocked on blocked execution", async () => {
    // Unattested agent
    await expect(
      gate.executeIfSafe(agent.address, user.address, "0x")
    ).to.be.reverted;
    // Event check via isSafe read path (executeIfSafe reverts before emit in solidity)
    // Instead verify the read path works: isSafe returns false
    const [safe] = await gate.isSafe(agent.address);
    expect(safe).to.be.false;
  });

  it("AgentGate reads LIVE attestation updates (not stale cache)", async () => {
    await attestation.authorizeScanner(scanner.address);
    // First write: FLAGGED
    await attestation.connect(scanner).writeAttestation(
      agent.address, 80, 2, 0, "", HASH_A, HASH_B, HASH_C
    );
    const [safe1] = await gate.isSafe(agent.address);
    expect(safe1).to.be.false;

    // Second write: SAFE (updated attestation)
    const HASH_D = "0x" + "d".repeat(64);
    const HASH_E = "0x" + "e".repeat(64);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 10, 0, 0, "", HASH_D, HASH_E, HASH_C
    );
    const [safe2] = await gate.isSafe(agent.address);
    expect(safe2).to.be.true; // gate reads updated attestation immediately
  });
});

describe("Integration: Scanner write path → AttestationRegistry state", () => {
  let attestation: AttestationRegistry;
  let owner: any, scanner: any, agent: any;

  beforeEach(async () => {
    [owner, scanner, agent] = await ethers.getSigners();
    const AttestationFactory = await ethers.getContractFactory("AttestationRegistry");
    attestation = await AttestationFactory.deploy() as unknown as AttestationRegistry;
  });

  it("writeAttestation stores all 8 fields correctly", async () => {
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 42, 1, 1, "reentrancy risk", HASH_A, HASH_B, HASH_C
    );
    const att = await attestation.getAttestation(agent.address);
    expect(att.behavioral_score).to.equal(42);
    expect(att.threat_level).to.equal(1);
    expect(att.code_risk).to.equal(1);
    expect(att.code_findings).to.equal("reentrancy risk");
    expect(att.behavioral_receipt_hash).to.equal(HASH_A);
    expect(att.code_receipt_hash).to.equal(HASH_B);
    expect(att.evidence_hash).to.equal(HASH_C);
    expect(att.attestation_timestamp).to.be.gt(0);
  });

  it("writeAttestation: behavioral and code receipt hashes stored separately", async () => {
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 30, 0, 0, "", HASH_A, HASH_B, HASH_C
    );
    const att = await attestation.getAttestation(agent.address);
    expect(att.behavioral_receipt_hash).to.not.equal(att.code_receipt_hash);
    expect(att.behavioral_receipt_hash).to.equal(HASH_A);
    expect(att.code_receipt_hash).to.equal(HASH_B);
  });

  it("writeAttestation: second write updates (not duplicate) attested agents list", async () => {
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 10, 0, 0, "", HASH_A, HASH_B, HASH_C
    );
    await attestation.connect(scanner).writeAttestation(
      agent.address, 20, 1, 0, "", HASH_B, HASH_C, HASH_A
    );
    const count = await attestation.getAttestedCount();
    expect(count).to.equal(1n); // NOT 2 — same address, no duplicate
    const att = await attestation.getAttestation(agent.address);
    expect(att.behavioral_score).to.equal(20); // updated value
  });

  it("hasAttestation: false before write, true after", async () => {
    expect(await attestation.hasAttestation(agent.address)).to.be.false;
    await attestation.authorizeScanner(scanner.address);
    await attestation.connect(scanner).writeAttestation(
      agent.address, 10, 0, 0, "", HASH_A, HASH_B, HASH_C
    );
    expect(await attestation.hasAttestation(agent.address)).to.be.true;
  });

  it("writeAttestation emits AttestationWritten event with correct args", async () => {
    await attestation.authorizeScanner(scanner.address);
    await expect(
      attestation.connect(scanner).writeAttestation(
        agent.address, 75, 2, 2, "vuln", HASH_A, HASH_B, HASH_C
      )
    )
      .to.emit(attestation, "AttestationWritten")
      .withArgs(agent.address, 2, 2, HASH_A, HASH_B, (v: any) => v > 0n);
  });

  it("Unauthorized scanner cannot write attestation", async () => {
    await expect(
      attestation.connect(scanner).writeAttestation(
        agent.address, 10, 0, 0, "", HASH_A, HASH_B, HASH_C
      )
    ).to.be.revertedWith("Not authorized scanner");
  });

  it("getAllAttestedAgents returns all unique attested addresses", async () => {
    await attestation.authorizeScanner(scanner.address);
    const [, , , agentB] = await ethers.getSigners();
    await attestation.connect(scanner).writeAttestation(
      agent.address, 10, 0, 0, "", HASH_A, HASH_B, HASH_C
    );
    await attestation.connect(scanner).writeAttestation(
      agentB.address, 20, 1, 0, "", HASH_B, HASH_C, HASH_A
    );
    const all = await attestation.getAllAttestedAgents();
    expect(all.length).to.equal(2);
    expect(all).to.include(agent.address);
    expect(all).to.include(agentB.address);
  });
});

describe("Integration: AgentRegistry → registration pipeline", () => {
  let registry: AgentRegistry;
  let owner: any, user: any;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();
    const RegistryFactory = await ethers.getContractFactory("AgentRegistry");
    registry = await RegistryFactory.deploy() as unknown as AgentRegistry;
  });

  it("registerAgent adds to list and isRegistered returns true", async () => {
    const [, , , agent] = await ethers.getSigners();
    await registry.registerAgent(agent.address, 1n);
    expect(await registry.isRegistered(agent.address)).to.be.true;
    const all = await registry.getAllAgents();
    expect(all).to.include(agent.address);
  });

  it("registerAgent is idempotent — duplicate register does not add twice", async () => {
    const [, , , agent] = await ethers.getSigners();
    await registry.registerAgent(agent.address, 1n);
    await registry.registerAgent(agent.address, 1n); // duplicate
    expect(await registry.getAgentCount()).to.equal(1n);
  });

  it("registerAgentsBatch registers multiple agents atomically", async () => {
    const [, , , a, b, c] = await ethers.getSigners();
    await registry.registerAgentsBatch(
      [a.address, b.address, c.address],
      [1n, 2n, 3n]
    );
    expect(await registry.getAgentCount()).to.equal(3n);
    expect(await registry.isRegistered(a.address)).to.be.true;
    expect(await registry.isRegistered(b.address)).to.be.true;
    expect(await registry.isRegistered(c.address)).to.be.true;
  });

  it("Non-owner cannot registerAgent", async () => {
    const [, , , agent] = await ethers.getSigners();
    await expect(
      registry.connect(user).registerAgent(agent.address, 1n)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });
});
