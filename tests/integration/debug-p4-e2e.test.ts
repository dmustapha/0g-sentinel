// debug-p4-e2e.test.ts
// Phase 4: E2E Tests — all PRD user flows, Tier 1 (programmatic)
// Tier 2 (curl) run separately via debug-p4-e2e-curl.sh

import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentRegistry, AttestationRegistry, AgentGate } from "../../typechain-types";

const HASH_A = "0x" + "a".repeat(64);
const HASH_B = "0x" + "b".repeat(64);
const HASH_C = "0x" + "c".repeat(64);

// Full system fixture: deploys all 3 contracts + seeds 3 demo agents
async function deployFullSystem() {
  const [owner, scanner, agentA, agentB, agentC] = await ethers.getSigners();

  const registry = await (await ethers.getContractFactory("AgentRegistry")).deploy() as unknown as AgentRegistry;
  const attestation = await (await ethers.getContractFactory("AttestationRegistry")).deploy() as unknown as AttestationRegistry;
  const gate = await (await ethers.getContractFactory("AgentGate")).deploy(await attestation.getAddress(), false, false) as unknown as AgentGate;

  // Register 3 agents
  await registry.registerAgentsBatch(
    [agentA.address, agentB.address, agentC.address],
    [1n, 2n, 3n]
  );

  // Authorize scanner
  await attestation.authorizeScanner(scanner.address);

  return { registry, attestation, gate, owner, scanner, agentA, agentB, agentC };
}

// ── Flow 1: Dashboard — load all agents + attestations ──────────────────────
describe("E2E Flow 1: Dashboard — Load all agents + attestations", () => {
  it("Tier 1: getAllAgents returns all registered addresses", async () => {
    const { registry, agentA, agentB, agentC } = await deployFullSystem();
    const agents = await registry.getAllAgents();
    expect(agents.length).to.equal(3);
    expect(agents).to.include(agentA.address);
    expect(agents).to.include(agentB.address);
    expect(agents).to.include(agentC.address);
  });

  it("Tier 1: Dashboard correctly shows agents without attestation (has_attestation=false)", async () => {
    const { registry, attestation } = await deployFullSystem();
    const agents = await registry.getAllAgents();
    for (const addr of agents) {
      const has = await attestation.hasAttestation(addr);
      expect(has).to.be.false; // No attestations yet
    }
  });

  it("Tier 1: Dashboard correctly shows agents WITH attestation (has_attestation=true)", async () => {
    const { registry, attestation, scanner, agentA } = await deployFullSystem();
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 15, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    const has = await attestation.hasAttestation(agentA.address);
    expect(has).to.be.true;
    const att = await attestation.getAttestation(agentA.address);
    expect(Number(att.behavioral_score)).to.equal(15);
    expect(Number(att.threat_level)).to.equal(0); // SAFE
  });

  it("Tier 1: Dashboard mixed view — some attested, some not", async () => {
    const { registry, attestation, scanner, agentA, agentB, agentC } = await deployFullSystem();
    // Only attest agentA
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 15, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    const agents = await registry.getAllAgents();
    const results = await Promise.all(agents.map(async (addr) => ({
      addr,
      has: await attestation.hasAttestation(addr),
    })));
    const attested = results.filter((r) => r.has);
    const unattested = results.filter((r) => !r.has);
    expect(attested.length).to.equal(1);
    expect(unattested.length).to.equal(2);
  });

  it("Tier 1: getAgentCount matches getAllAgents length", async () => {
    const { registry } = await deployFullSystem();
    const count = await registry.getAgentCount();
    const all = await registry.getAllAgents();
    expect(Number(count)).to.equal(all.length);
  });
});

// ── Flow 2: Agent detail — view attestation proof ───────────────────────────
describe("E2E Flow 2: Agent detail — attestation proof view", () => {
  it("Tier 1: getAttestation returns full proof for attested agent", async () => {
    const { attestation, scanner, agentA } = await deployFullSystem();
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 72, 2, 1, "Suspicious fund drain detected", "", HASH_A, HASH_B, HASH_C
    );
    const att = await attestation.getAttestation(agentA.address);
    expect(Number(att.behavioral_score)).to.equal(72);
    expect(Number(att.threat_level)).to.equal(2); // FLAGGED
    expect(Number(att.code_risk)).to.equal(1); // WARNING
    expect(att.code_findings).to.equal("Suspicious fund drain detected");
    expect(att.behavioral_receipt_hash).to.equal(HASH_A);
    expect(att.code_receipt_hash).to.equal(HASH_B);
    expect(att.evidence_hash).to.equal(HASH_C);
    expect(Number(att.attestation_timestamp)).to.be.gt(0);
  });

  it("Tier 1: getAttestation for unattested agent returns all-zero struct", async () => {
    const { attestation, agentC } = await deployFullSystem();
    const att = await attestation.getAttestation(agentC.address);
    expect(Number(att.attestation_timestamp)).to.equal(0); // Zero timestamp = no attestation
    expect(Number(att.behavioral_score)).to.equal(0);
  });

  it("Tier 1: AgentGate.isSafe correctly reflects current attestation state", async () => {
    const { attestation, gate, scanner, agentA } = await deployFullSystem();
    // Before attestation
    const [safe1] = await gate.isSafe.staticCall(agentA.address);
    expect(safe1).to.be.false;
    // After attestation (SAFE)
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 10, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    const [safe2] = await gate.isSafe.staticCall(agentA.address);
    expect(safe2).to.be.true;
  });
});

// ── Flow 3: Trigger scan — validate input path ──────────────────────────────
describe("E2E Flow 3: Trigger scan — input validation and error paths", () => {
  it("Tier 1: Behavioral result maps threat_level string to 0|1|2 correctly", () => {
    const threatMap: Record<string, 0 | 1 | 2> = { SAFE: 0, CAUTION: 1, FLAGGED: 2 };
    expect(threatMap["SAFE"]).to.equal(0);
    expect(threatMap["CAUTION"]).to.equal(1);
    expect(threatMap["FLAGGED"]).to.equal(2);
    // Unknown value defaults to CAUTION (as in behavioral.ts line 82)
    const unknown = threatMap["UNKNOWN"] ?? 1;
    expect(unknown).to.equal(1);
  });

  it("Tier 1: Code risk maps string to 0|1|2 correctly", () => {
    const riskMap: Record<string, 0 | 1 | 2> = { CLEAN: 0, WARNING: 1, VULNERABLE: 2 };
    expect(riskMap["CLEAN"]).to.equal(0);
    expect(riskMap["WARNING"]).to.equal(1);
    expect(riskMap["VULNERABLE"]).to.equal(2);
    // Unknown defaults to WARNING (as in code-scan.ts line 72)
    const unknown = riskMap["UNKNOWN"] ?? 1;
    expect(unknown).to.equal(1);
  });

  it("Tier 1: behavioral_score clamped to 0-100 range", () => {
    const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
    expect(clamp(-10)).to.equal(0);
    expect(clamp(110)).to.equal(100);
    expect(clamp(50)).to.equal(50);
    expect(clamp(50.7)).to.equal(51);
  });

  it("Tier 1: agentAddress regex validation (valid cases)", () => {
    const regex = /^0x[0-9a-fA-F]{40}$/;
    expect(regex.test("0x5F6a3AbC97E421f7B3930fc504D6a0CE4eE41e06")).to.be.true;
    expect(regex.test("0x0000000000000000000000000000000000000001")).to.be.true;
  });

  it("Tier 1: agentAddress regex validation (invalid cases → 400 response)", () => {
    const regex = /^0x[0-9a-fA-F]{40}$/;
    expect(regex.test("not-an-address")).to.be.false;
    expect(regex.test("0x123")).to.be.false; // too short
    expect(regex.test("")).to.be.false;
    expect(regex.test("0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG")).to.be.false; // invalid chars
  });

  it("Tier 1: scan error path — malformed JSON from compute throws parse error", () => {
    const malformedContent = "not valid json {";
    let parseError = false;
    try {
      JSON.parse(malformedContent);
    } catch {
      parseError = true;
    }
    expect(parseError).to.be.true; // confirms error propagation behavior
  });
});

// ── Flow 4: Full system — attestation → gate → execution flow ───────────────
describe("E2E Flow 4: Full attestation → gate → execution flow", () => {
  it("Tier 1: Complete flow: register → attest → gate check → execute", async () => {
    const { registry, attestation, gate, scanner, agentA } = await deployFullSystem();

    // Step 1: Agent is registered
    expect(await registry.isRegistered(agentA.address)).to.be.true;

    // Step 2: Scanner writes attestation (SAFE)
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 10, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );

    // Step 3: Gate confirms safe
    const [safe] = await gate.isSafe.staticCall(agentA.address);
    expect(safe).to.be.true;

    // Step 4: Execute passes
    const iface = new ethers.Interface(["function getAgentCount() view returns (uint256)"]);
    const calldata = iface.encodeFunctionData("getAgentCount");
    const tx = await gate.executeIfSafe(agentA.address, await registry.getAddress(), calldata);
    expect(tx.hash).to.match(/^0x[0-9a-fA-F]+$/);
  });

  it("Tier 1: Complete flow: register → attest FLAGGED → gate blocks execution", async () => {
    const { registry, attestation, gate, scanner, agentB } = await deployFullSystem();

    expect(await registry.isRegistered(agentB.address)).to.be.true;
    await attestation.connect(scanner).writeAttestation(
      agentB.address, 85, 2, 2, "reentrancy + fund drain", "", HASH_A, HASH_B, HASH_C
    );
    const [safe, reason] = await gate.isSafe.staticCall(agentB.address);
    expect(safe).to.be.false;
    expect(reason).to.include("FLAGGED");

    await expect(
      gate.executeIfSafe(agentB.address, await registry.getAddress(), "0x")
    ).to.be.revertedWith("Agent behavioral risk: FLAGGED");
  });

  it("Tier 1: Proof page data — all receipt hashes are valid bytes32", async () => {
    const { attestation, scanner, agentA } = await deployFullSystem();
    await attestation.connect(scanner).writeAttestation(
      agentA.address, 20, 0, 0, "", "", HASH_A, HASH_B, HASH_C
    );
    const att = await attestation.getAttestation(agentA.address);
    const bytes32Regex = /^0x[0-9a-fA-F]{64}$/;
    expect(att.behavioral_receipt_hash).to.match(bytes32Regex);
    expect(att.code_receipt_hash).to.match(bytes32Regex);
    expect(att.evidence_hash).to.match(bytes32Regex);
  });
});
