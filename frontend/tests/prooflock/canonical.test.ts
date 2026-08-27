import { describe, expect, it } from "vitest";

import {
  canonicalizeEvidence,
  canonicalizeStorageCommitment,
  hashCanonical,
  receiptDigest,
  validateEvidenceEnvelope,
  validateStorageCommitment,
} from "../../server/prooflock/canonical";

const CHAT_RECEIPT =
  "0xf6329dc5840c2ec545a5c8227b54976fb67dcc850ad41902bcbe78e8a8d7c4f2";

function validEnvelope() {
  return {
    schema: "sentinel.prooflock/evidence-v1",
    proofClass: "COMPUTE_VERIFIED",
    schemaVersion: 1,
    policyVersion: 3,
    identity: {
      namespace: "eip155",
      chainId: 16661,
      registryAddress: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
      agentId: "7",
      owner: "0x1111111111111111111111111111111111111111",
      agentWallet: "0x2222222222222222222222222222222222222222",
      registrationUri: "ipfs://agent-card",
      registrationDigest:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    source: {
      blockNumber: "12345",
      blockHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    subject: {
      address: "0x3333333333333333333333333333333333333333",
      kind: "CONTRACT",
      runtimeCodeHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    deterministicChecks: [
      {
        id: "permissions",
        version: "1.0.0",
        status: "PASS",
        inputDigest:
          "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        outputDigest:
          "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        findings: ["owner disclosed"],
      },
    ],
    computeProofs: [
      {
        purpose: "contract-risk",
        provider: "0g",
        model: "llama-3.3",
        chatId: "chat-123",
        receiptDigest: CHAT_RECEIPT,
        requestDigest:
          "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        responseDigest:
          "0x0101010101010101010101010101010101010101010101010101010101010101",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        processResponseVerified: true,
      },
    ],
    verdict: { riskScore: 12, label: "SAFE" },
    omissions: [],
    scanner: {
      address: "0x4444444444444444444444444444444444444444",
      softwareVersion: "2.0.0",
    },
  };
}

const EXPECTED_CANONICAL =
  '{"computeProofs":[{"chatId":"chat-123","model":"llama-3.3","processResponseVerified":true,"provider":"0g","purpose":"contract-risk","receiptDigest":"0xf6329dc5840c2ec545a5c8227b54976fb67dcc850ad41902bcbe78e8a8d7c4f2","requestDigest":"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","responseDigest":"0x0101010101010101010101010101010101010101010101010101010101010101","usage":{"completionTokens":5,"promptTokens":10,"totalTokens":15}}],"deterministicChecks":[{"findings":["owner disclosed"],"id":"permissions","inputDigest":"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","outputDigest":"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","status":"PASS","version":"1.0.0"}],"identity":{"agentId":"7","agentWallet":"0x2222222222222222222222222222222222222222","chainId":16661,"namespace":"eip155","owner":"0x1111111111111111111111111111111111111111","registrationDigest":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","registrationUri":"ipfs://agent-card","registryAddress":"0x8004a169fb4a3325136eb29fa0ceb6d2e539a432"},"omissions":[],"policyVersion":3,"proofClass":"COMPUTE_VERIFIED","scanner":{"address":"0x4444444444444444444444444444444444444444","softwareVersion":"2.0.0"},"schema":"sentinel.prooflock/evidence-v1","schemaVersion":1,"source":{"blockHash":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","blockNumber":"12345"},"subject":{"address":"0x3333333333333333333333333333333333333333","kind":"CONTRACT","runtimeCodeHash":"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"verdict":{"label":"SAFE","riskScore":12}}';

describe("canonical ProofLock evidence", () => {
  it("matches the fixed JCS bytes and Keccak-256 fixture", () => {
    expect(canonicalizeEvidence(validEnvelope())).toBe(EXPECTED_CANONICAL);
    expect(hashCanonical(validEnvelope())).toBe(
      "0xd33afe2337248613a568a8f24a78430f7a999faadadf16b8c905cefbe2d140ec",
    );
  });

  it("is invariant to input key order and address casing", () => {
    const value = validEnvelope();
    const reordered = {
      ...value,
      identity: {
        ...value.identity,
        registryAddress: "0x8004A169FB4A3325136EB29FA0CEB6D2E539A432",
      },
      scanner: {
        softwareVersion: value.scanner.softwareVersion,
        address: value.scanner.address.toUpperCase().replace("0X", "0x"),
      },
    };

    expect(hashCanonical(reordered)).toBe(hashCanonical(value));
  });

  it("changes the hash when semantic content changes", () => {
    const changed = validEnvelope();
    changed.verdict.riskScore = 13;
    expect(hashCanonical(changed)).not.toBe(hashCanonical(validEnvelope()));
  });

  it("hashes chat IDs as UTF-8 rather than padding them", () => {
    expect(receiptDigest("chat-123")).toBe(CHAT_RECEIPT);
    expect(receiptDigest("chat-123")).not.toContain("636861742d313233");
  });
});

describe("strict envelope validation", () => {
  it("normalizes all addresses to lowercase", () => {
    const value = validEnvelope();
    value.identity.registryAddress =
      "0x8004A169FB4A3325136EB29FA0CEB6D2E539A432";
    expect(validateEvidenceEnvelope(value).identity.registryAddress).toBe(
      "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
    );
  });

  it.each([
    ["top-level unknown field", (v: any) => (v.extra = true)],
    ["nested unknown field", (v: any) => (v.identity.extra = true)],
    ["wrong namespace", (v: any) => (v.identity.namespace = "solana")],
    ["wrong chain", (v: any) => (v.identity.chainId = 1)],
    ["wrong schema", (v: any) => (v.schema = "evidence-v2")],
    ["wrong proof class", (v: any) => (v.proofClass = "SEALED")],
    ["malformed address", (v: any) => (v.subject.address = "0x123")],
    ["malformed bytes32", (v: any) => (v.source.blockHash = "0x12")],
    ["empty agent ID", (v: any) => (v.identity.agentId = "")],
    ["leading-zero agent ID", (v: any) => (v.identity.agentId = "07")],
    ["leading-zero block", (v: any) => (v.source.blockNumber = "012345")],
    ["empty model", (v: any) => (v.computeProofs[0].model = "")],
    ["empty URI", (v: any) => (v.identity.registrationUri = "")],
    ["empty version", (v: any) => (v.scanner.softwareVersion = "")],
    ["no compute proofs", (v: any) => (v.computeProofs = [])],
    [
      "unverified compute",
      (v: any) => (v.computeProofs[0].processResponseVerified = false),
    ],
    ["no deterministic checks", (v: any) => (v.deterministicChecks = [])],
    ["empty check ID", (v: any) => (v.deterministicChecks[0].id = "")],
    ["NaN", (v: any) => (v.verdict.riskScore = Number.NaN)],
    ["Infinity", (v: any) => (v.verdict.riskScore = Number.POSITIVE_INFINITY)],
    ["float", (v: any) => (v.verdict.riskScore = 12.5)],
    ["negative usage", (v: any) => (v.computeProofs[0].usage.promptTokens = -1)],
    ["float usage", (v: any) => (v.computeProofs[0].usage.promptTokens = 1.5)],
    [
      "unsafe usage",
      (v: any) =>
        (v.computeProofs[0].usage.promptTokens = Number.MAX_SAFE_INTEGER + 1),
    ],
    ["explicit undefined", (v: any) => (v.previousProofId = undefined)],
    ["nested undefined", (v: any) => (v.computeProofs[0].provider = undefined)],
    ["bigint", (v: any) => (v.verdict.riskScore = 12n)],
  ])("rejects %s", (_name, mutate) => {
    const value = validEnvelope();
    mutate(value);
    expect(() => validateEvidenceEnvelope(value)).toThrow();
  });

  it("rejects duplicate deterministic check IDs", () => {
    const value = validEnvelope();
    value.deterministicChecks.push({ ...value.deterministicChecks[0] });
    expect(() => validateEvidenceEnvelope(value)).toThrow(/duplicate/i);
  });

  it("rejects duplicate compute receipt digests", () => {
    const value = validEnvelope();
    value.computeProofs.push({ ...value.computeProofs[0] });
    expect(() => validateEvidenceEnvelope(value)).toThrow(/duplicate/i);
  });

  it("rejects a receipt digest that does not bind its chat ID", () => {
    const value = validEnvelope();
    value.computeProofs[0].receiptDigest = value.computeProofs[0].requestDigest;
    expect(() => validateEvidenceEnvelope(value)).toThrow(/receipt/i);
  });
});

describe("Storage commitment separation", () => {
  const commitment = {
    envelopeDigest:
      "0xd33afe2337248613a568a8f24a78430f7a999faadadf16b8c905cefbe2d140ec",
    rootHash:
      "0x1212121212121212121212121212121212121212121212121212121212121212",
    uploadTxHash:
      "0x1313131313131313131313131313131313131313131313131313131313131313",
    retrievedDigest:
      "0xd33afe2337248613a568a8f24a78430f7a999faadadf16b8c905cefbe2d140ec",
    finalizedAtBlock: "12350",
    retrievalVerified: true,
  };

  it("validates and canonicalizes storage independently", () => {
    expect(validateStorageCommitment(commitment)).toEqual(commitment);
    expect(canonicalizeStorageCommitment(commitment)).toContain(
      '"retrievalVerified":true',
    );
  });

  it("does not allow a post-upload commitment inside the envelope", () => {
    const value = { ...validEnvelope(), storageCommitment: commitment };
    expect(() => validateEvidenceEnvelope(value)).toThrow();
  });

  it("requires a real verified retrieval and canonical block number", () => {
    expect(() =>
      validateStorageCommitment({ ...commitment, retrievalVerified: false }),
    ).toThrow();
    expect(() =>
      validateStorageCommitment({ ...commitment, finalizedAtBlock: "012350" }),
    ).toThrow();
  });
});
