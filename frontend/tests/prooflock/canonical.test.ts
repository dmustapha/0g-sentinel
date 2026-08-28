import { describe, expect, it } from "vitest";
import { canonicalize as canonicalizeJcs } from "json-canonicalize";

import {
  canonicalizeEvidence,
  canonicalizeStorageCommitment,
  hashCanonical,
  receiptDigest,
  validateEvidenceEnvelope,
  validateStorageCommitment,
} from "../../server/prooflock/canonical";
import { EvidenceValidationError } from "../../server/prooflock/errors";
import {
  COVERAGE,
  ERC8004_IDENTITY_REGISTRY,
  REQUIRED_COVERAGE,
  type ProofLifecycle,
} from "../../server/prooflock/types";

const CHAT_RECEIPT = "0xf6329dc5840c2ec545a5c8227b54976fb67dcc850ad41902bcbe78e8a8d7c4f2";
const BEHAVIORAL_RECEIPT = "0x45d8b8bcf01461883d935bd4805523685842ab5246cf14d328a03f343c02ff6a";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const IDENTITY_REGISTRY = ERC8004_IDENTITY_REGISTRY;
const EIP191_SIGNATURE = `0x${"ab".repeat(65)}`;

function transcriptArtifact(requestByte: string, responseByte: string, headerByte: string) {
  return {
    proofClass: "DECENTRALIZED_MODEL_TEE",
    signatureScheme: "EIP191",
    expectedSigner: "0x6666666666666666666666666666666666666666",
    signature: EIP191_SIGNATURE,
    signedTextSha256: `0x${"09".repeat(32)}`,
    requestSha256: `0x${requestByte.repeat(32)}`,
    rawResponseSha256: `0x${responseByte.repeat(32)}`,
    receiptSource: "ZG-Res-Key",
    responseHeadersSha256: `0x${headerByte.repeat(32)}`,
  };
}

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
      registryAddress: IDENTITY_REGISTRY,
      agentId: "7",
      owner: "0x1111111111111111111111111111111111111111",
      agentWallet: "0x2222222222222222222222222222222222222222",
      registrationUri: "ipfs://agent-card",
      registrationDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    source: {
      blockNumber: "12345",
      blockHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    subject: {
      address: "0x2222222222222222222222222222222222222222",
      kind: "CONTRACT",
      runtimeCodeHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    deterministicChecks: [
      {
        id: "permissions",
        version: "1.0.0",
        status: "PASS",
        inputDigest: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        outputDigest: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        findings: ["owner disclosed"],
      },
    ],
    computeProofs: [
      {
        ...transcriptArtifact("02", "03", "04"),
        purpose: "behavioral-risk",
        provider: "0x5555555555555555555555555555555555555555",
        model: "llama-3.3",
        chatId: "chat-456",
        receiptDigest: BEHAVIORAL_RECEIPT,
        requestDigest: "0x0202020202020202020202020202020202020202020202020202020202020202",
        responseDigest: "0x0303030303030303030303030303030303030303030303030303030303030303",
        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
        processResponseVerified: true,
      },
      {
        ...transcriptArtifact("ff", "01", "05"),
        purpose: "contract-risk",
        provider: "0x5555555555555555555555555555555555555555",
        model: "llama-3.3",
        chatId: "chat-123",
        receiptDigest: CHAT_RECEIPT,
        requestDigest: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        responseDigest: "0x0101010101010101010101010101010101010101010101010101010101010101",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        processResponseVerified: true,
      },
    ],
    verdict: { riskScore: 12, codeRisk: 0, label: "SAFE" },
    omissions: [],
    scanner: {
      address: "0x4444444444444444444444444444444444444444",
      softwareVersion: "2.0.0",
    },
  };
}

const EXPECTED_CANONICAL =
  '{"computeProofs":[{"chatId":"chat-456","expectedSigner":"0x6666666666666666666666666666666666666666","model":"llama-3.3","processResponseVerified":true,"proofClass":"DECENTRALIZED_MODEL_TEE","provider":"0x5555555555555555555555555555555555555555","purpose":"behavioral-risk","rawResponseSha256":"0x0303030303030303030303030303030303030303030303030303030303030303","receiptDigest":"0x45d8b8bcf01461883d935bd4805523685842ab5246cf14d328a03f343c02ff6a","receiptSource":"ZG-Res-Key","requestDigest":"0x0202020202020202020202020202020202020202020202020202020202020202","requestSha256":"0x0202020202020202020202020202020202020202020202020202020202020202","responseDigest":"0x0303030303030303030303030303030303030303030303030303030303030303","responseHeadersSha256":"0x0404040404040404040404040404040404040404040404040404040404040404","signature":"0xababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababab","signatureScheme":"EIP191","signedTextSha256":"0x0909090909090909090909090909090909090909090909090909090909090909","usage":{"completionTokens":4,"promptTokens":8,"totalTokens":12}},{"chatId":"chat-123","expectedSigner":"0x6666666666666666666666666666666666666666","model":"llama-3.3","processResponseVerified":true,"proofClass":"DECENTRALIZED_MODEL_TEE","provider":"0x5555555555555555555555555555555555555555","purpose":"contract-risk","rawResponseSha256":"0x0101010101010101010101010101010101010101010101010101010101010101","receiptDigest":"0xf6329dc5840c2ec545a5c8227b54976fb67dcc850ad41902bcbe78e8a8d7c4f2","receiptSource":"ZG-Res-Key","requestDigest":"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","requestSha256":"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","responseDigest":"0x0101010101010101010101010101010101010101010101010101010101010101","responseHeadersSha256":"0x0505050505050505050505050505050505050505050505050505050505050505","signature":"0xababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababab","signatureScheme":"EIP191","signedTextSha256":"0x0909090909090909090909090909090909090909090909090909090909090909","usage":{"completionTokens":5,"promptTokens":10,"totalTokens":15}}],"coverage":{"behavioralComputeVerified":true,"codeCompute":{"status":"VERIFIED"},"deterministicChecksRun":true,"evidenceStorage":"PENDING_EXTERNAL_COMMITMENT","identityValidated":true,"policyEvaluated":true,"preStorageMask":95,"requiredSealMask":127,"subjectClassified":true},"deterministicChecks":[{"findings":["owner disclosed"],"id":"permissions","inputDigest":"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","outputDigest":"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","status":"PASS","version":"1.0.0"}],"identity":{"agentId":"7","agentWallet":"0x2222222222222222222222222222222222222222","chainId":16661,"namespace":"eip155","owner":"0x1111111111111111111111111111111111111111","registrationDigest":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","registrationUri":"ipfs://agent-card","registryAddress":"0x8004a169fb4a3325136eb29fa0ceb6d2e539a432"},"omissions":[],"policyVersion":3,"proofClass":"COMPUTE_VERIFIED","scanner":{"address":"0x4444444444444444444444444444444444444444","softwareVersion":"2.0.0"},"schema":"sentinel.prooflock/evidence-v1","schemaVersion":1,"source":{"blockHash":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","blockNumber":"12345"},"subject":{"address":"0x2222222222222222222222222222222222222222","kind":"CONTRACT","runtimeCodeHash":"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"verdict":{"label":"SAFE","riskScore":12}}';

describe("canonical ProofLock evidence", () => {
  it("matches the fixed JCS bytes and Keccak-256 fixture", () => {
    const expectedV2 = EXPECTED_CANONICAL.replace(
      '"verdict":{"label":"SAFE"',
      '"verdict":{"codeRisk":0,"label":"SAFE"',
    );
    expect(canonicalizeEvidence(validEnvelope())).toBe(expectedV2);
    expect(hashCanonical(validEnvelope())).toBe("0xb6271493a013df25bfe82fd7c7ff2a1afc3e6ec74a0ad774db8a0bc998b5a841");
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

  it("bounds and Unicode-validates direct receipt digests", () => {
    expect(() => receiptDigest("x".repeat(513))).toThrow(/512|length|long/i);
    expect(() => receiptDigest("\uD800")).toThrow(/unicode|surrogate/i);
    expect(() => receiptDigest("\uDC00")).toThrow(/unicode|surrogate/i);
    expect(() => receiptDigest("chat-😀")).not.toThrow();
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

    expect(validated.deterministicChecks.map((check) => check.id)).toEqual(["permissions", "upgradeability"]);
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
    expect(canonicalizeEvidence(checkOrderReversed)).not.toBe(canonicalizeEvidence(originalOrder));
  });
});

describe("frozen coverage and lifecycle constants", () => {
  it("exports the canonical ERC-8004 registry once", () => {
    expect(ERC8004_IDENTITY_REGISTRY).toBe(IDENTITY_REGISTRY);
  });

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
    const value: any = validEnvelope();
    value.identity.registryAddress = "0x8004A169FB4A3325136EB29FA0CEB6D2E539A432";
    expect(validateEvidenceEnvelope(value).identity.registryAddress).toBe("0x8004a169fb4a3325136eb29fa0ceb6d2e539a432");
  });

  it.each([
    ["top-level unknown field", (v: any) => (v.extra = true)],
    ["nested unknown field", (v: any) => (v.identity.extra = true)],
    ["wrong namespace", (v: any) => (v.identity.namespace = "solana")],
    ["wrong chain", (v: any) => (v.identity.chainId = 1)],
    ["schema version 2", (v: any) => (v.schemaVersion = 2)],
    ["wrong schema", (v: any) => (v.schema = "evidence-v2")],
    ["wrong proof class", (v: any) => (v.proofClass = "SEALED")],
    ["missing coverage", (v: any) => delete v.coverage],
    ["unknown coverage field", (v: any) => (v.coverage.extra = true)],
    ["wrong pre-storage mask", (v: any) => (v.coverage.preStorageMask = 0x7f)],
    ["wrong seal mask", (v: any) => (v.coverage.requiredSealMask = 0x5f)],
    ["embedded storage success", (v: any) => (v.coverage.evidenceStorage = "VERIFIED")],
    ["malformed address", (v: any) => (v.subject.address = "0x123")],
    ["malformed bytes32", (v: any) => (v.source.blockHash = "0x12")],
    ["empty agent ID", (v: any) => (v.identity.agentId = "")],
    ["leading-zero agent ID", (v: any) => (v.identity.agentId = "07")],
    ["leading-zero block", (v: any) => (v.source.blockNumber = "012345")],
    ["empty model", (v: any) => (v.computeProofs[0].model = "")],
    ["wrong compute proof class", (v: any) => (v.computeProofs[0].proofClass = "CENTRALIZED_TEE_ROUTING")],
    ["wrong signature scheme", (v: any) => (v.computeProofs[0].signatureScheme = "ECDSA")],
    ["malformed signature", (v: any) => (v.computeProofs[0].signature = "0x12")],
    ["missing raw-response digest", (v: any) => delete v.computeProofs[0].rawResponseSha256],
    ["wrong receipt source", (v: any) => (v.computeProofs[0].receiptSource = "router")],
    ["empty URI", (v: any) => (v.identity.registrationUri = "")],
    ["empty version", (v: any) => (v.scanner.softwareVersion = "")],
    ["no compute proofs", (v: any) => (v.computeProofs = [])],
    ["unverified compute", (v: any) => (v.computeProofs[0].processResponseVerified = false)],
    ["no deterministic checks", (v: any) => (v.deterministicChecks = [])],
    ["empty check ID", (v: any) => (v.deterministicChecks[0].id = "")],
    ["NaN", (v: any) => (v.verdict.riskScore = Number.NaN)],
    ["Infinity", (v: any) => (v.verdict.riskScore = Number.POSITIVE_INFINITY)],
    ["float", (v: any) => (v.verdict.riskScore = 12.5)],
    ["negative-zero risk", (v: any) => (v.verdict.riskScore = -0)],
    ["negative usage", (v: any) => (v.computeProofs[0].usage.promptTokens = -1)],
    ["negative-zero usage", (v: any) => (v.computeProofs[0].usage.promptTokens = -0)],
    ["float usage", (v: any) => (v.computeProofs[0].usage.promptTokens = 1.5)],
    ["unsafe usage", (v: any) => (v.computeProofs[0].usage.promptTokens = Number.MAX_SAFE_INTEGER + 1)],
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

  it("binds the ERC-8004 wallet to the analyzed subject", () => {
    const value: any = validEnvelope();
    value.subject.address = "0x3333333333333333333333333333333333333333";
    expect(() => validateEvidenceEnvelope(value)).toThrow(/wallet|subject/i);
  });

  it("accepts policyVersion through uint32 max and rejects overflow", () => {
    const maximum: any = validEnvelope();
    maximum.policyVersion = 4_294_967_295;
    expect(validateEvidenceEnvelope(maximum).policyVersion).toBe(4_294_967_295);

    const overflow: any = validEnvelope();
    overflow.policyVersion = 4_294_967_296;
    expect(() => validateEvidenceEnvelope(overflow)).toThrow(/policy|uint32/i);
  });

  it("requires the canonical chain-16661 identity registry", () => {
    const value: any = validEnvelope();
    value.identity.registryAddress = "0x9999999999999999999999999999999999999999";
    expect(() => validateEvidenceEnvelope(value)).toThrow(/registry/i);
  });

  it("rejects duplicate compute receipt digests", () => {
    const value = validEnvelope();
    value.computeProofs.push({ ...value.computeProofs[0] });
    expect(() => validateEvidenceEnvelope(value)).toThrow(/duplicate/i);
  });

  it("requires exactly one behavioral-risk Compute proof", () => {
    const missing: any = validEnvelope();
    missing.computeProofs = missing.computeProofs.filter((proof: any) => proof.purpose !== "behavioral-risk");
    expect(() => validateEvidenceEnvelope(missing)).toThrow(/behavioral/i);

    const duplicate: any = validEnvelope();
    duplicate.computeProofs.push({
      ...duplicate.computeProofs[0],
      chatId: "chat-789",
      receiptDigest: "0x88b1fc0d4d6c1ae9498122d8ff1b65975c4f059864f522d902241896d688bac5",
    });
    expect(() => validateEvidenceEnvelope(duplicate)).toThrow(/purpose|behavioral/i);
  });

  it("requires exactly one contract-risk proof when code Compute is verified", () => {
    const missing: any = validEnvelope();
    missing.computeProofs = missing.computeProofs.filter((proof: any) => proof.purpose !== "contract-risk");
    expect(() => validateEvidenceEnvelope(missing)).toThrow(/contract/i);

    const duplicate: any = validEnvelope();
    duplicate.computeProofs.push({
      ...duplicate.computeProofs[1],
      chatId: "chat-789",
      receiptDigest: "0x88b1fc0d4d6c1ae9498122d8ff1b65975c4f059864f522d902241896d688bac5",
    });
    expect(() => validateEvidenceEnvelope(duplicate)).toThrow(/purpose|contract/i);
  });

  it("allows code Compute to be not applicable only for an EOA", () => {
    const eoa: any = validEnvelope();
    eoa.subject.kind = "EOA";
    eoa.subject.runtimeCodeHash = ZERO_BYTES32;
    eoa.coverage.codeCompute = {
      status: "NOT_APPLICABLE",
      reason: "EOA has no runtime bytecode",
    };
    eoa.computeProofs = eoa.computeProofs.filter((proof: any) => proof.purpose !== "contract-risk");
    expect(validateEvidenceEnvelope(eoa).coverage.codeCompute).toEqual(eoa.coverage.codeCompute);

    eoa.coverage.codeCompute.reason = "";
    expect(() => validateEvidenceEnvelope(eoa)).toThrow();
  });

  it("rejects dishonest code Compute not-applicable combinations", () => {
    const contract: any = validEnvelope();
    contract.coverage.codeCompute = {
      status: "NOT_APPLICABLE",
      reason: "incorrect",
    };
    contract.computeProofs = contract.computeProofs.filter((proof: any) => proof.purpose !== "contract-risk");
    expect(() => validateEvidenceEnvelope(contract)).toThrow(/EOA/i);

    const eoaWithProof: any = validEnvelope();
    eoaWithProof.subject.kind = "EOA";
    eoaWithProof.subject.runtimeCodeHash = ZERO_BYTES32;
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
    ["expected signer", (v: any) => (v.computeProofs[0].expectedSigner = ZERO_ADDRESS)],
  ])("rejects the zero %s address", (_name, mutate) => {
    const value: any = validEnvelope();
    mutate(value);
    expect(() => validateEvidenceEnvelope(value)).toThrow(/address|zero/i);
  });

  it.each([
    ["registration digest", (v: any) => (v.identity.registrationDigest = ZERO_BYTES32)],
    ["source block hash", (v: any) => (v.source.blockHash = ZERO_BYTES32)],
    ["check input digest", (v: any) => (v.deterministicChecks[0].inputDigest = ZERO_BYTES32)],
    ["check output digest", (v: any) => (v.deterministicChecks[0].outputDigest = ZERO_BYTES32)],
    ["Compute receipt digest", (v: any) => (v.computeProofs[0].receiptDigest = ZERO_BYTES32)],
    ["Compute request digest", (v: any) => (v.computeProofs[0].requestDigest = ZERO_BYTES32)],
    ["Compute response digest", (v: any) => (v.computeProofs[0].responseDigest = ZERO_BYTES32)],
    ["signed text SHA-256", (v: any) => (v.computeProofs[0].signedTextSha256 = ZERO_BYTES32)],
    ["request SHA-256", (v: any) => (v.computeProofs[0].requestSha256 = ZERO_BYTES32)],
    ["raw response SHA-256", (v: any) => (v.computeProofs[0].rawResponseSha256 = ZERO_BYTES32)],
    ["response headers SHA-256", (v: any) => (v.computeProofs[0].responseHeadersSha256 = ZERO_BYTES32)],
    ["previous proof ID", (v: any) => (v.previousProofId = ZERO_BYTES32)],
  ])("rejects zero %s", (_name, mutate) => {
    const value: any = validEnvelope();
    mutate(value);
    expect(() => validateEvidenceEnvelope(value)).toThrow(/zero/i);
  });

  it("rejects a receipt digest that does not bind its chat ID", () => {
    const value = validEnvelope();
    value.computeProofs[0].receiptDigest = value.computeProofs[0].requestDigest;
    expect(() => validateEvidenceEnvelope(value)).toThrow(/receipt/i);
  });
});

describe("subject provenance invariants", () => {
  it("uses zero runtime hash only as the plain-EOA marker", () => {
    const eoa: any = validEnvelope();
    eoa.subject.kind = "EOA";
    eoa.subject.runtimeCodeHash = ZERO_BYTES32;
    eoa.coverage.codeCompute = {
      status: "NOT_APPLICABLE",
      reason: "EOA has no runtime bytecode",
    };
    eoa.computeProofs = eoa.computeProofs.filter((proof: any) => proof.purpose !== "contract-risk");
    expect(validateEvidenceEnvelope(eoa).subject.runtimeCodeHash).toBe(ZERO_BYTES32);

    eoa.subject.runtimeCodeHash = "0x1212121212121212121212121212121212121212121212121212121212121212";
    expect(() => validateEvidenceEnvelope(eoa)).toThrow(/runtime/i);

    for (const kind of ["CONTRACT", "EIP7702_DELEGATED_EOA"]) {
      const value: any = validEnvelope();
      value.subject.kind = kind;
      value.subject.runtimeCodeHash = ZERO_BYTES32;
      if (kind === "EIP7702_DELEGATED_EOA") {
        value.subject.delegationTarget = "0x6666666666666666666666666666666666666666";
        value.subject.delegationCodeHash = "0x1212121212121212121212121212121212121212121212121212121212121212";
      }
      expect(() => validateEvidenceEnvelope(value)).toThrow(/runtime/i);
    }
  });

  it("rejects provenance target fields on a plain EOA", () => {
    for (const field of [
      "delegationTarget",
      "delegationCodeHash",
      "proxyImplementation",
      "proxyImplementationCodeHash",
    ]) {
      const value: any = validEnvelope();
      value.subject.kind = "EOA";
      value.subject.runtimeCodeHash = ZERO_BYTES32;
      value.coverage.codeCompute = {
        status: "NOT_APPLICABLE",
        reason: "EOA has no runtime bytecode",
      };
      value.computeProofs = value.computeProofs.filter((proof: any) => proof.purpose !== "contract-risk");
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
    valid.subject.delegationTarget = "0x6666666666666666666666666666666666666666";
    valid.subject.delegationCodeHash = "0x1212121212121212121212121212121212121212121212121212121212121212";
    expect(validateEvidenceEnvelope(valid).subject.delegationTarget).toBe(valid.subject.delegationTarget);

    valid.subject.delegationTarget = ZERO_ADDRESS;
    expect(() => validateEvidenceEnvelope(valid)).toThrow(/address|zero/i);

    valid.subject.delegationTarget = "0x6666666666666666666666666666666666666666";
    valid.subject.delegationCodeHash = ZERO_BYTES32;
    expect(() => validateEvidenceEnvelope(valid)).toThrow(/hash|zero/i);
  });

  it("disallows proxy provenance on EIP-7702 subjects", () => {
    const value: any = validEnvelope();
    value.subject.kind = "EIP7702_DELEGATED_EOA";
    value.subject.delegationTarget = "0x6666666666666666666666666666666666666666";
    value.subject.delegationCodeHash = "0x1212121212121212121212121212121212121212121212121212121212121212";
    value.subject.proxyImplementation = "0x7777777777777777777777777777777777777777";
    value.subject.proxyImplementationCodeHash = "0x1313131313131313131313131313131313131313131313131313131313131313";
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
    value.subject.proxyImplementation = "0x7777777777777777777777777777777777777777";
    value.subject.proxyImplementationCodeHash = "0x1313131313131313131313131313131313131313131313131313131313131313";
    expect(validateEvidenceEnvelope(value).subject.proxyImplementation).toBe(value.subject.proxyImplementation);

    value.subject.proxyImplementation = ZERO_ADDRESS;
    expect(() => validateEvidenceEnvelope(value)).toThrow(/address|zero/i);

    value.subject.proxyImplementation = "0x7777777777777777777777777777777777777777";
    value.subject.proxyImplementationCodeHash = ZERO_BYTES32;
    expect(() => validateEvidenceEnvelope(value)).toThrow(/hash|zero/i);
  });

  it("disallows delegation provenance on contracts", () => {
    const value: any = validEnvelope();
    value.subject.delegationTarget = "0x6666666666666666666666666666666666666666";
    value.subject.delegationCodeHash = "0x1212121212121212121212121212121212121212121212121212121212121212";
    expect(() => validateEvidenceEnvelope(value)).toThrow(/delegation/i);
  });
});

describe("hostile input bounds and Unicode safety", () => {
  it("rejects a huge sparse array before enumerating its entries", () => {
    const value: any = validEnvelope();
    value.extra = new Array(1_000_000);
    expect(() => validateEvidenceEnvelope(value)).toThrowError(
      expect.objectContaining({
        name: EvidenceValidationError.name,
        message: expect.stringMatching(/array|node|length/i),
      }),
    );
  });

  it("rejects holes in bounded schema arrays normally", () => {
    const value: any = validEnvelope();
    value.deterministicChecks[0].findings = new Array(2);
    expect(() => validateEvidenceEnvelope(value)).toThrow(EvidenceValidationError);
  });

  it("rejects input deeper than 16 object levels", () => {
    const value: any = validEnvelope();
    let cursor: any = value;
    for (let index = 0; index < 17; index += 1) {
      cursor.extra = {};
      cursor = cursor.extra;
    }
    expect(() => validateEvidenceEnvelope(value)).toThrow(/depth/i);
  });

  it("rejects more than 10,000 visited nodes", () => {
    const value: any = validEnvelope();
    value.extra = Array.from({ length: 10_001 }, () => 0);
    expect(() => validateEvidenceEnvelope(value)).toThrow(/node/i);
  });

  it("rejects an aggregate string payload above 262,144 code units", () => {
    const value: any = validEnvelope();
    value.extra = "x".repeat(262_145);
    expect(() => validateEvidenceEnvelope(value)).toThrow(/string|payload/i);
  });

  it.each([
    ["URI", (v: any) => (v.identity.registrationUri = "x".repeat(4097))],
    ["finding", (v: any) => (v.deterministicChecks[0].findings = ["x".repeat(2049)])],
    ["omission", (v: any) => (v.omissions = ["x".repeat(2049)])],
    ["chat ID", (v: any) => (v.computeProofs[0].chatId = "x".repeat(513))],
    ["model", (v: any) => (v.computeProofs[0].model = "x".repeat(257))],
    ["check ID", (v: any) => (v.deterministicChecks[0].id = "x".repeat(129))],
    ["check version", (v: any) => (v.deterministicChecks[0].version = "x".repeat(129))],
    ["scanner version", (v: any) => (v.scanner.softwareVersion = "x".repeat(129))],
  ])("rejects an oversized %s", (_name, mutate) => {
    const value: any = validEnvelope();
    mutate(value);
    expect(() => validateEvidenceEnvelope(value)).toThrow();
  });

  it("caps every variable-length evidence array", () => {
    const checks: any = validEnvelope();
    checks.deterministicChecks = Array.from({ length: 65 }, (_, index) => ({
      ...checks.deterministicChecks[0],
      id: `check-${index}`,
    }));
    expect(() => validateEvidenceEnvelope(checks)).toThrow();

    const findings: any = validEnvelope();
    findings.deterministicChecks[0].findings = Array.from({ length: 101 }, (_, index) => `finding-${index}`);
    expect(() => validateEvidenceEnvelope(findings)).toThrow();

    const proofs: any = validEnvelope();
    proofs.computeProofs.push({ ...proofs.computeProofs[0] });
    expect(() => validateEvidenceEnvelope(proofs)).toThrow();

    const omissions: any = validEnvelope();
    omissions.omissions = Array.from({ length: 101 }, (_, index) => `omission-${index}`);
    expect(() => validateEvidenceEnvelope(omissions)).toThrow();
  });

  it("enforces uint256 agent IDs and uint64 block numbers", () => {
    const agent: any = validEnvelope();
    agent.identity.agentId = (1n << 256n).toString();
    expect(() => validateEvidenceEnvelope(agent)).toThrow(/uint256|agent/i);

    const source: any = validEnvelope();
    source.source.blockNumber = (1n << 64n).toString();
    expect(() => validateEvidenceEnvelope(source)).toThrow(/uint64|block/i);
  });

  it("rejects cycles but accepts shared noncyclic references", () => {
    const cyclic: any = validEnvelope();
    cyclic.extra = cyclic;
    expect(() => validateEvidenceEnvelope(cyclic)).toThrow(/cyclic/i);

    const shared: any = validEnvelope();
    const sharedArray = ["shared evidence"];
    shared.deterministicChecks[0].findings = sharedArray;
    shared.omissions = sharedArray;
    expect(validateEvidenceEnvelope(shared).omissions).toEqual(sharedArray);
  });

  it.each(["\uD800", "\uDC00"])("rejects lone Unicode surrogate %s", (text) => {
    const value: any = validEnvelope();
    value.deterministicChecks[0].findings = [text];
    expect(() => hashCanonical(value)).toThrow(/unicode|surrogate/i);
  });

  it("preserves well-formed Unicode values", () => {
    const value: any = validEnvelope();
    value.deterministicChecks[0].findings = ["€", "😀", "line\nfeed"];
    const canonical = canonicalizeEvidence(value);
    expect(canonical).toContain('{"findings":["€","😀","line\\nfeed"],"id":"permissions"');
    expect(() => hashCanonical(value)).not.toThrow();
  });

  it("orders non-ASCII object keys by UTF-16 code units", () => {
    const unordered = { "😀": 1, "€": 4, é: 2, a: 3 };
    expect(canonicalizeJcs(unordered)).toBe('{"a":3,"é":2,"€":4,"😀":1}');
  });

  it("requires exact, overflow-safe token accounting", () => {
    const mismatch: any = validEnvelope();
    mismatch.computeProofs[0].usage.totalTokens = 11;
    expect(() => validateEvidenceEnvelope(mismatch)).toThrow(/total|token/i);

    const overflow: any = validEnvelope();
    overflow.computeProofs[0].usage.promptTokens = Number.MAX_SAFE_INTEGER;
    overflow.computeProofs[0].usage.completionTokens = 1;
    overflow.computeProofs[0].usage.totalTokens = Number.MAX_SAFE_INTEGER;
    expect(() => validateEvidenceEnvelope(overflow)).toThrow(/overflow/i);
  });
});

describe("Storage commitment separation", () => {
  const commitment = {
    envelopeDigest: "0xe545f1558f7c3179e601d7eefdec874698b31ab2bfac88dccc980b069083a91b",
    storageRoot: "0x1212121212121212121212121212121212121212121212121212121212121212",
    uploadTxHash: "0x1313131313131313131313131313131313131313131313131313131313131313",
    retrievedDigest: "0xe545f1558f7c3179e601d7eefdec874698b31ab2bfac88dccc980b069083a91b",
    finalizedAtBlock: "12350",
    retrievalVerified: true,
    networkProofVerified: false,
  };

  it("validates and canonicalizes storage independently", () => {
    expect(validateStorageCommitment(commitment)).toEqual(commitment);
    const canonical = canonicalizeStorageCommitment(commitment);
    expect(canonical).toContain('"retrievalVerified":true');
    expect(canonical).toContain('"storageRoot":');
    expect(canonical).not.toContain('"rootHash":');
  });

  it("rejects the retired rootHash field name", () => {
    const legacy: any = { ...commitment, rootHash: commitment.storageRoot };
    delete legacy.storageRoot;
    expect(() => validateStorageCommitment(legacy)).toThrow();
  });

  it("does not allow a post-upload commitment inside the envelope", () => {
    const value = { ...validEnvelope(), storageCommitment: commitment };
    expect(() => validateEvidenceEnvelope(value)).toThrow();
  });

  it("requires a real verified retrieval and canonical block number", () => {
    expect(() => validateStorageCommitment({ ...commitment, retrievalVerified: false })).toThrow();
    expect(() => validateStorageCommitment({ ...commitment, finalizedAtBlock: "012350" })).toThrow();
    expect(() =>
      validateStorageCommitment({
        ...commitment,
        finalizedAtBlock: (1n << 64n).toString(),
      }),
    ).toThrow(/uint64|block/i);
  });

  it("requires retrieval to reproduce the envelope digest", () => {
    expect(() =>
      validateStorageCommitment({
        ...commitment,
        retrievedDigest: "0x1414141414141414141414141414141414141414141414141414141414141414",
      }),
    ).toThrow(/digest/i);
  });

  it.each(["envelopeDigest", "storageRoot", "uploadTxHash", "retrievedDigest"])("rejects zero %s", (field) => {
    expect(() => validateStorageCommitment({ ...commitment, [field]: ZERO_BYTES32 })).toThrow(/zero/i);
  });
});
