import { describe, expect, it } from "vitest";

import {
  canonicalizeEvidence,
  canonicalizeStorageCommitment,
  hashCanonical,
  receiptDigest,
  validateEvidenceEnvelope,
  validateStorageCommitment,
} from "../../server/prooflock/canonical";
import {
  COVERAGE,
  REQUIRED_COVERAGE,
  type ProofLifecycle,
} from "../../server/prooflock/types";

const CHAT_RECEIPT =
  "0xf6329dc5840c2ec545a5c8227b54976fb67dcc850ad41902bcbe78e8a8d7c4f2";
const BEHAVIORAL_RECEIPT =
  "0x45d8b8bcf01461883d935bd4805523685842ab5246cf14d328a03f343c02ff6a";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function validEnvelope() {
  return {
    schema: "sentinel.prooflock/evidence-v1",
    proofClass: "COMPUTE_VERIFIED",
    schemaVersion: 1,
    policyVersion: 3,
    coverage: {
      preStorageMask: 0x5f,
      requiredSealMask: 0x7f,
      identityValidated: true,
      subjectClassified: true,
      deterministicChecksRun: true,
      behavioralComputeVerified: true,
      codeCompute: { status: "VERIFIED" },
      evidenceStorage: "PENDING_EXTERNAL_COMMITMENT",
      policyEvaluated: true,
    },
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
        purpose: "behavioral-risk",
        provider: "0x5555555555555555555555555555555555555555",
        model: "llama-3.3",
        chatId: "chat-456",
        receiptDigest: BEHAVIORAL_RECEIPT,
        requestDigest:
          "0x0202020202020202020202020202020202020202020202020202020202020202",
        responseDigest:
          "0x0303030303030303030303030303030303030303030303030303030303030303",
        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
        processResponseVerified: true,
      },
      {
        purpose: "contract-risk",
        provider: "0x5555555555555555555555555555555555555555",
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
  '{"computeProofs":[{"chatId":"chat-456","model":"llama-3.3","processResponseVerified":true,"provider":"0x5555555555555555555555555555555555555555","purpose":"behavioral-risk","receiptDigest":"0x45d8b8bcf01461883d935bd4805523685842ab5246cf14d328a03f343c02ff6a","requestDigest":"0x0202020202020202020202020202020202020202020202020202020202020202","responseDigest":"0x0303030303030303030303030303030303030303030303030303030303030303","usage":{"completionTokens":4,"promptTokens":8,"totalTokens":12}},{"chatId":"chat-123","model":"llama-3.3","processResponseVerified":true,"provider":"0x5555555555555555555555555555555555555555","purpose":"contract-risk","receiptDigest":"0xf6329dc5840c2ec545a5c8227b54976fb67dcc850ad41902bcbe78e8a8d7c4f2","requestDigest":"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","responseDigest":"0x0101010101010101010101010101010101010101010101010101010101010101","usage":{"completionTokens":5,"promptTokens":10,"totalTokens":15}}],"coverage":{"behavioralComputeVerified":true,"codeCompute":{"status":"VERIFIED"},"deterministicChecksRun":true,"evidenceStorage":"PENDING_EXTERNAL_COMMITMENT","identityValidated":true,"policyEvaluated":true,"preStorageMask":95,"requiredSealMask":127,"subjectClassified":true},"deterministicChecks":[{"findings":["owner disclosed"],"id":"permissions","inputDigest":"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","outputDigest":"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","status":"PASS","version":"1.0.0"}],"identity":{"agentId":"7","agentWallet":"0x2222222222222222222222222222222222222222","chainId":16661,"namespace":"eip155","owner":"0x1111111111111111111111111111111111111111","registrationDigest":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","registrationUri":"ipfs://agent-card","registryAddress":"0x8004a169fb4a3325136eb29fa0ceb6d2e539a432"},"omissions":[],"policyVersion":3,"proofClass":"COMPUTE_VERIFIED","scanner":{"address":"0x4444444444444444444444444444444444444444","softwareVersion":"2.0.0"},"schema":"sentinel.prooflock/evidence-v1","schemaVersion":1,"source":{"blockHash":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","blockNumber":"12345"},"subject":{"address":"0x3333333333333333333333333333333333333333","kind":"CONTRACT","runtimeCodeHash":"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"verdict":{"label":"SAFE","riskScore":12}}';

describe("canonical ProofLock evidence", () => {
  it("matches the fixed JCS bytes and Keccak-256 fixture", () => {
    expect(canonicalizeEvidence(validEnvelope())).toBe(EXPECTED_CANONICAL);
    expect(hashCanonical(validEnvelope())).toBe(
      "0x078a4bf1725ac6af58b9516cf57efbadeaf5bc5e3b7ecc3345aea985885a590e",
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
      computeProofs: value.computeProofs.map((proof) => ({
        ...proof,
        provider: proof.provider.toUpperCase().replace("0X", "0x"),
      })),
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

  it("preserves ordered findings and deterministic checks", () => {
    const value: any = validEnvelope();
    value.deterministicChecks[0].findings = ["first", "second"];
    value.deterministicChecks.push({
      ...value.deterministicChecks[0],
      id: "upgradeability",
      findings: ["third"],
    });
    const validated = validateEvidenceEnvelope(value);

    expect(validated.deterministicChecks.map((check) => check.id)).toEqual([
      "permissions",
      "upgradeability",
    ]);
    expect(validated.deterministicChecks[0].findings).toEqual(["first", "second"]);
  });

  it("changes canonical bytes when meaningful array order is reversed", () => {
    const findingsOriginal: any = validEnvelope();
    findingsOriginal.deterministicChecks[0].findings = ["first", "second"];
    const findingsReversed = structuredClone(findingsOriginal);
    findingsReversed.deterministicChecks[0].findings.reverse();
    const checkOrderReversed: any = validEnvelope();
    checkOrderReversed.deterministicChecks.push({
      ...checkOrderReversed.deterministicChecks[0],
      id: "upgradeability",
    });
    const originalOrder = structuredClone(checkOrderReversed);
    checkOrderReversed.deterministicChecks.reverse();

    expect(hashCanonical(findingsReversed)).not.toBe(hashCanonical(findingsOriginal));
    expect(canonicalizeEvidence(checkOrderReversed)).not.toBe(
      canonicalizeEvidence(originalOrder),
    );
  });
});

describe("frozen coverage and lifecycle constants", () => {
  it("matches the contract bit layout exactly", () => {
    expect(COVERAGE).toEqual({
      IDENTITY_VALIDATED: 0x01,
      SUBJECT_CLASSIFIED: 0x02,
      DETERMINISTIC_CHECKS_RUN: 0x04,
      BEHAVIORAL_COMPUTE_VERIFIED: 0x08,
      CODE_COMPUTE_VERIFIED_OR_NOT_APPLICABLE: 0x10,
      EVIDENCE_STORAGE_VERIFIED: 0x20,
      POLICY_EVALUATED: 0x40,
    });
    expect(REQUIRED_COVERAGE).toBe(0x7f);
  });

  it("includes the pre-proof NONE lifecycle", () => {
    const lifecycle: ProofLifecycle = "NONE";
    expect(lifecycle).toBe("NONE");
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
    ["missing coverage", (v: any) => delete v.coverage],
    ["unknown coverage field", (v: any) => (v.coverage.extra = true)],
    ["wrong pre-storage mask", (v: any) => (v.coverage.preStorageMask = 0x7f)],
    ["wrong seal mask", (v: any) => (v.coverage.requiredSealMask = 0x5f)],
    [
      "embedded storage success",
      (v: any) => (v.coverage.evidenceStorage = "VERIFIED"),
    ],
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
    ["negative-zero risk", (v: any) => (v.verdict.riskScore = -0)],
    ["negative usage", (v: any) => (v.computeProofs[0].usage.promptTokens = -1)],
    ["negative-zero usage", (v: any) => (v.computeProofs[0].usage.promptTokens = -0)],
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

  it("requires exactly one behavioral-risk Compute proof", () => {
    const missing: any = validEnvelope();
    missing.computeProofs = missing.computeProofs.filter(
      (proof: any) => proof.purpose !== "behavioral-risk",
    );
    expect(() => validateEvidenceEnvelope(missing)).toThrow(/behavioral/i);

    const duplicate: any = validEnvelope();
    duplicate.computeProofs.push({
      ...duplicate.computeProofs[0],
      chatId: "chat-789",
      receiptDigest:
        "0x88b1fc0d4d6c1ae9498122d8ff1b65975c4f059864f522d902241896d688bac5",
    });
    expect(() => validateEvidenceEnvelope(duplicate)).toThrow(/purpose|behavioral/i);
  });

  it("requires exactly one contract-risk proof when code Compute is verified", () => {
    const missing: any = validEnvelope();
    missing.computeProofs = missing.computeProofs.filter(
      (proof: any) => proof.purpose !== "contract-risk",
    );
    expect(() => validateEvidenceEnvelope(missing)).toThrow(/contract/i);

    const duplicate: any = validEnvelope();
    duplicate.computeProofs.push({
      ...duplicate.computeProofs[1],
      chatId: "chat-789",
      receiptDigest:
        "0x88b1fc0d4d6c1ae9498122d8ff1b65975c4f059864f522d902241896d688bac5",
    });
    expect(() => validateEvidenceEnvelope(duplicate)).toThrow(/purpose|contract/i);
  });

  it("allows code Compute to be not applicable only for an EOA", () => {
    const eoa: any = validEnvelope();
    eoa.subject.kind = "EOA";
    eoa.coverage.codeCompute = {
      status: "NOT_APPLICABLE",
      reason: "EOA has no runtime bytecode",
    };
    eoa.computeProofs = eoa.computeProofs.filter(
      (proof: any) => proof.purpose !== "contract-risk",
    );
    expect(validateEvidenceEnvelope(eoa).coverage.codeCompute).toEqual(
      eoa.coverage.codeCompute,
    );

    eoa.coverage.codeCompute.reason = "";
    expect(() => validateEvidenceEnvelope(eoa)).toThrow();
  });

  it("rejects dishonest code Compute not-applicable combinations", () => {
    const contract: any = validEnvelope();
    contract.coverage.codeCompute = {
      status: "NOT_APPLICABLE",
      reason: "incorrect",
    };
    contract.computeProofs = contract.computeProofs.filter(
      (proof: any) => proof.purpose !== "contract-risk",
    );
    expect(() => validateEvidenceEnvelope(contract)).toThrow(/EOA/i);

    const eoaWithProof: any = validEnvelope();
    eoaWithProof.subject.kind = "EOA";
    eoaWithProof.coverage.codeCompute = {
      status: "NOT_APPLICABLE",
      reason: "EOA has no runtime bytecode",
    };
    expect(() => validateEvidenceEnvelope(eoaWithProof)).toThrow(/contract/i);
  });

  it.each([
    ["registry", (v: any) => (v.identity.registryAddress = ZERO_ADDRESS)],
    ["owner", (v: any) => (v.identity.owner = ZERO_ADDRESS)],
    ["wallet", (v: any) => (v.identity.agentWallet = ZERO_ADDRESS)],
    ["subject", (v: any) => (v.subject.address = ZERO_ADDRESS)],
    ["scanner", (v: any) => (v.scanner.address = ZERO_ADDRESS)],
    ["provider", (v: any) => (v.computeProofs[0].provider = ZERO_ADDRESS)],
  ])("rejects the zero %s address", (_name, mutate) => {
    const value: any = validEnvelope();
    mutate(value);
    expect(() => validateEvidenceEnvelope(value)).toThrow(/address|zero/i);
  });

  it("rejects a receipt digest that does not bind its chat ID", () => {
    const value = validEnvelope();
    value.computeProofs[0].receiptDigest = value.computeProofs[0].requestDigest;
    expect(() => validateEvidenceEnvelope(value)).toThrow(/receipt/i);
  });
});

describe("subject provenance invariants", () => {
  it("rejects provenance target fields on a plain EOA", () => {
    for (const field of [
      "delegationTarget",
      "delegationCodeHash",
      "proxyImplementation",
      "proxyImplementationCodeHash",
    ]) {
      const value: any = validEnvelope();
      value.subject.kind = "EOA";
      value.coverage.codeCompute = {
        status: "NOT_APPLICABLE",
        reason: "EOA has no runtime bytecode",
      };
      value.computeProofs = value.computeProofs.filter(
        (proof: any) => proof.purpose !== "contract-risk",
      );
      value.subject[field] = field.endsWith("Hash")
        ? "0x1212121212121212121212121212121212121212121212121212121212121212"
        : "0x6666666666666666666666666666666666666666";
      expect(() => validateEvidenceEnvelope(value)).toThrow(/EOA|subject/i);
    }
  });

  it("requires a nonzero delegation target and code hash for EIP-7702", () => {
    const missing: any = validEnvelope();
    missing.subject.kind = "EIP7702_DELEGATED_EOA";
    expect(() => validateEvidenceEnvelope(missing)).toThrow(/delegation/i);

    const valid: any = validEnvelope();
    valid.subject.kind = "EIP7702_DELEGATED_EOA";
    valid.subject.delegationTarget =
      "0x6666666666666666666666666666666666666666";
    valid.subject.delegationCodeHash =
      "0x1212121212121212121212121212121212121212121212121212121212121212";
    expect(validateEvidenceEnvelope(valid).subject.delegationTarget).toBe(
      valid.subject.delegationTarget,
    );

    valid.subject.delegationTarget = ZERO_ADDRESS;
    expect(() => validateEvidenceEnvelope(valid)).toThrow(/address|zero/i);
  });

  it("disallows proxy provenance on EIP-7702 subjects", () => {
    const value: any = validEnvelope();
    value.subject.kind = "EIP7702_DELEGATED_EOA";
    value.subject.delegationTarget =
      "0x6666666666666666666666666666666666666666";
    value.subject.delegationCodeHash =
      "0x1212121212121212121212121212121212121212121212121212121212121212";
    value.subject.proxyImplementation =
      "0x7777777777777777777777777777777777777777";
    value.subject.proxyImplementationCodeHash =
      "0x1313131313131313131313131313131313131313131313131313131313131313";
    expect(() => validateEvidenceEnvelope(value)).toThrow(/proxy/i);
  });

  it("requires contract proxy address and hash to occur together", () => {
    for (const field of ["proxyImplementation", "proxyImplementationCodeHash"]) {
      const value: any = validEnvelope();
      value.subject[field] = field.endsWith("Hash")
        ? "0x1313131313131313131313131313131313131313131313131313131313131313"
        : "0x7777777777777777777777777777777777777777";
      expect(() => validateEvidenceEnvelope(value)).toThrow(/proxy/i);
    }

    const value: any = validEnvelope();
    value.subject.proxyImplementation =
      "0x7777777777777777777777777777777777777777";
    value.subject.proxyImplementationCodeHash =
      "0x1313131313131313131313131313131313131313131313131313131313131313";
    expect(validateEvidenceEnvelope(value).subject.proxyImplementation).toBe(
      value.subject.proxyImplementation,
    );

    value.subject.proxyImplementation = ZERO_ADDRESS;
    expect(() => validateEvidenceEnvelope(value)).toThrow(/address|zero/i);
  });

  it("disallows delegation provenance on contracts", () => {
    const value: any = validEnvelope();
    value.subject.delegationTarget =
      "0x6666666666666666666666666666666666666666";
    value.subject.delegationCodeHash =
      "0x1212121212121212121212121212121212121212121212121212121212121212";
    expect(() => validateEvidenceEnvelope(value)).toThrow(/delegation/i);
  });
});

describe("Storage commitment separation", () => {
  const commitment = {
    envelopeDigest:
      "0x078a4bf1725ac6af58b9516cf57efbadeaf5bc5e3b7ecc3345aea985885a590e",
    rootHash:
      "0x1212121212121212121212121212121212121212121212121212121212121212",
    uploadTxHash:
      "0x1313131313131313131313131313131313131313131313131313131313131313",
    retrievedDigest:
      "0x078a4bf1725ac6af58b9516cf57efbadeaf5bc5e3b7ecc3345aea985885a590e",
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
