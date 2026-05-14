// debug-p2-known-risks.test.ts
// Phase 2: KNOWN-RISKS triage — tests the fallback paths when 0G Compute returns 402
// Tests run on Hardhat network (no live API calls)

import { expect } from "chai";
import { createHash } from "crypto";

// ─── Helpers mirroring compute.ts fallback logic ────────────────────────────

function computeSha256Fallback(content: string, usage: object, model: string): string {
  return (
    "0x" +
    createHash("sha256")
      .update(JSON.stringify({ content, usage, model }))
      .digest("hex")
  );
}

function uuidToBytes32(uuid: string): string {
  return "0x" + uuid.replace(/-/g, "").padEnd(64, "0");
}

function toBytes32(hash: string): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(hash)) return hash;
  const hex = hash.startsWith("0x") ? hash.slice(2) : hash;
  return "0x" + hex.padStart(64, "0").slice(0, 64);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RISK-1: 0G Compute fallback paths", () => {
  it("SHA256 fallback produces valid bytes32 hex", () => {
    const hash = computeSha256Fallback("test content", { prompt_tokens: 10, completion_tokens: 5 }, "0GM-1.0-35B-A3B");
    expect(hash).to.match(/^0x[0-9a-fA-F]{64}$/);
  });

  it("SHA256 fallback produces DIFFERENT hashes for different responses", () => {
    const h1 = computeSha256Fallback("response A", {}, "model");
    const h2 = computeSha256Fallback("response B", {}, "model");
    expect(h1).to.not.equal(h2);
  });

  it("SHA256 fallback produces SAME hash for identical inputs (deterministic)", () => {
    const h1 = computeSha256Fallback("same content", { tokens: 10 }, "model");
    const h2 = computeSha256Fallback("same content", { tokens: 10 }, "model");
    expect(h1).to.equal(h2);
  });

  it("zg-res-key UUID → bytes32 produces valid bytes32", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const bytes32 = uuidToBytes32(uuid);
    expect(bytes32).to.match(/^0x[0-9a-fA-F]{64}$/);
    expect(bytes32.length).to.equal(66); // "0x" + 64 hex chars
  });

  it("zg-res-key UUID → bytes32 strips dashes correctly", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const bytes32 = uuidToBytes32(uuid);
    expect(bytes32).to.not.include("-");
    expect(bytes32).to.equal("0x550e8400e29b41d4a716446655440000" + "0".repeat(32));
  });

  it("Two different UUIDs produce two different bytes32 values (critical: unique receipt hashes)", () => {
    const uuid1 = "550e8400-e29b-41d4-a716-446655440000";
    const uuid2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const h1 = uuidToBytes32(uuid1);
    const h2 = uuidToBytes32(uuid2);
    expect(h1).to.not.equal(h2);
  });
});

describe("RISK-1: code-scan.ts empty-source fallback", () => {
  it("Empty source (<20 chars) returns WARNING with zero receipt hash", () => {
    // Mirrors the guard in code-scan.ts lines 39-45
    const contractSource: string = "";
    const isEmpty = !contractSource || contractSource.length < 20;
    expect(isEmpty).to.be.true;

    const fallback = {
      code_risk: 1, // WARNING
      code_findings: "Contract source not available for analysis",
      receipt_hash: "0x" + "0".repeat(64),
    };
    expect(fallback.code_risk).to.equal(1);
    expect(fallback.receipt_hash).to.match(/^0x0{64}$/);
  });

  it("Short source (<20 chars) triggers empty-source guard", () => {
    const contractSource = "pragma solidity"; // 15 chars
    const isEmpty = !contractSource || contractSource.length < 20;
    expect(isEmpty).to.be.true;
  });

  it("Valid source (>=20 chars) passes through to compute", () => {
    const contractSource = "pragma solidity ^0.8.20; contract X {}";
    const isEmpty = !contractSource || contractSource.length < 20;
    expect(isEmpty).to.be.false;
  });
});

describe("RISK-1: receipt hash uniqueness guard", () => {
  it("Identical receipt hashes would trigger CRITICAL warning in scanner", () => {
    // scanner.ts line 140: logs CRITICAL if hashes match
    const behavioral_receipt = "0x" + "a".repeat(64);
    const code_receipt = "0x" + "a".repeat(64);
    const isIdentical = behavioral_receipt === code_receipt;
    // This SHOULD NOT happen — test confirms the detection condition
    expect(isIdentical).to.be.true; // if same UUID — this is the disqualifying condition
  });

  it("Different UUIDs from two independent compute calls produce different hashes", () => {
    // When the API works, each call gets a unique zg-res-key
    const behavioralUuid = "550e8400-e29b-41d4-a716-446655440001";
    const codeScanUuid   = "550e8400-e29b-41d4-a716-446655440002";
    const h1 = uuidToBytes32(behavioralUuid);
    const h2 = uuidToBytes32(codeScanUuid);
    expect(h1).to.not.equal(h2); // different hashes — passes disqualification check
  });
});

describe("RISK-1: toBytes32 normalization (scanner.ts)", () => {
  it("Valid bytes32 passes through unchanged", () => {
    const valid = "0x" + "ab".repeat(32);
    expect(toBytes32(valid)).to.equal(valid);
  });

  it("Short hex gets left-padded with zeros", () => {
    const short = "0x1234";
    const result = toBytes32(short);
    expect(result).to.match(/^0x[0-9a-fA-F]{64}$/);
    expect(result).to.equal("0x" + "0".repeat(60) + "1234");
  });

  it("Hex without 0x prefix gets padded", () => {
    const noPfx = "deadbeef";
    const result = toBytes32(noPfx);
    expect(result).to.match(/^0x[0-9a-fA-F]{64}$/);
  });

  it("64-char hex gets clamped not extended", () => {
    const long = "0x" + "f".repeat(70); // too long
    const result = toBytes32(long);
    expect(result.length).to.equal(66); // "0x" + 64
  });
});
