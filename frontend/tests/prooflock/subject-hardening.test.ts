import { getAddress, keccak256, toUtf8Bytes } from "ethers";
import { describe, expect, it, vi } from "vitest";

import { validateEvidenceEnvelope } from "../../server/prooflock/canonical";
import {
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  classifySubject,
  type ExpectedSourceBlock,
  type SubjectChainAdapter,
} from "../../server/prooflock/subject/classify";
import {
  inspectContract,
  resolveVerifiedSource,
  type VerifiedSourceResolver,
} from "../../server/prooflock/checks/contract";
import { inspectDelegatedEoa } from "../../server/prooflock/checks/delegated-eoa";
import { inspectEoa } from "../../server/prooflock/checks/eoa";
import { runSubjectChecks, toEvidenceSubject } from "../../server/prooflock/checks";
import { ERC8004_IDENTITY_REGISTRY, type Bytes32 } from "../../server/prooflock/types";

const SUBJECT = "0x1111111111111111111111111111111111111111";
const TARGET = "0x2222222222222222222222222222222222222222";
const BEACON = "0x3333333333333333333333333333333333333333";
const BLOCK_HASH = `0x${"ab".repeat(32)}` as Bytes32;
const REORG_HASH = `0x${"cd".repeat(32)}` as Bytes32;
const SOURCE_BLOCK: ExpectedSourceBlock = { number: 1234n, hash: BLOCK_HASH };
const ZERO_WORD = `0x${"00".repeat(32)}`;

function storageAddress(address: string) {
  return `0x${"00".repeat(12)}${address.slice(2).toLowerCase()}`;
}

function minimalProxy(target = TARGET) {
  return `0x363d3d373d3d3d363d73${target.slice(2)}5af43d82803e903d91602b57fd5bf3`;
}

function chain(overrides: Partial<SubjectChainAdapter> = {}): SubjectChainAdapter {
  return {
    getBlock: vi.fn(async (number) => ({ number, hash: BLOCK_HASH })),
    getCode: vi.fn(async () => "0x"),
    getStorage: vi.fn(async () => ZERO_WORD),
    call: vi.fn(async () => "0x"),
    getTransactionCount: vi.fn(async () => 0n),
    getBalance: vi.fn(async () => 0n),
    ...overrides,
  };
}

function resolver(source = "contract Verified {}", overrides: Record<string, unknown> = {}) {
  const value: VerifiedSourceResolver = {
    resolve: vi.fn(async (request) => ({
      chainId: 16661,
      address: request.address,
      sourceBlockNumber: request.sourceBlock.number.toString(),
      sourceBlockHash: request.sourceBlock.hash,
      runtimeCodeHash: request.runtimeCodeHash,
      provider: "0G Explorer",
      uri: `https://chainscan.0g.ai/address/${request.address}`,
      rawResponseDigest: `0x${"ef".repeat(32)}`,
      source,
      verifiedRuntimeMatch: true,
      ...overrides,
    })),
  };
  return value;
}

function proxyMetadataResolver(overrides: Record<string, unknown> = {}) {
  return {
    resolve: vi.fn(async (request: any) => ({
      chainId: 16661,
      subjectAddress: request.subjectAddress,
      sourceBlockNumber: request.sourceBlock.number.toString(),
      sourceBlockHash: request.sourceBlock.hash,
      subjectRuntimeCodeHash: request.subjectRuntimeCodeHash,
      kind: request.proxyCandidate.kind,
      implementationAddress: request.proxyCandidate.implementationAddress,
      implementationCodeHash: request.proxyCandidate.implementationCodeHash,
      ...(request.proxyCandidate.kind === "EIP1967_BEACON" ? {
        beaconAddress: request.proxyCandidate.beaconAddress,
        beaconCodeHash: request.proxyCandidate.beaconCodeHash,
      } : {}),
      provider: "independent-proxy-indexer",
      uri: "https://proxy-metadata.example/record/1",
      rawResponseDigest: `0x${"88".repeat(32)}`,
      verifiedProxyMatch: true,
      ...overrides,
    })),
  };
}

function envelopeSubject(subject: ReturnType<typeof toEvidenceSubject>) {
  const chatId = "subject-hardening";
  return {
    schema: "sentinel.prooflock/evidence-v1",
    proofClass: "COMPUTE_VERIFIED",
    schemaVersion: 1,
    policyVersion: 1,
    coverage: {
      preStorageMask: 0x5f,
      requiredSealMask: 0x7f,
      identityValidated: true,
      subjectClassified: true,
      deterministicChecksRun: true,
      behavioralComputeVerified: true,
      codeCompute:
        subject.kind === "EOA"
          ? { status: "NOT_APPLICABLE", reason: "EOA has no runtime bytecode" }
          : { status: "VERIFIED" },
      evidenceStorage: "PENDING_EXTERNAL_COMMITMENT",
      policyEvaluated: true,
    },
    identity: {
      namespace: "eip155",
      chainId: 16661,
      registryAddress: ERC8004_IDENTITY_REGISTRY,
      agentId: "9",
      owner: "0x9999999999999999999999999999999999999999",
      agentWallet: subject.address,
      registrationUri: "ipfs://verified-card",
      registrationDigest: `0x${"11".repeat(32)}`,
    },
    source: {
      blockNumber: SOURCE_BLOCK.number.toString(),
      blockHash: SOURCE_BLOCK.hash,
    },
    subject,
    deterministicChecks: [
      {
        id: "subject",
        version: "2.0.0",
        status: "PASS",
        inputDigest: `0x${"22".repeat(32)}`,
        outputDigest: `0x${"33".repeat(32)}`,
        findings: [],
      },
    ],
    computeProofs: [
      {
        proofClass: "DECENTRALIZED_MODEL_TEE",
        purpose: "behavioral-risk",
        provider: "0x5555555555555555555555555555555555555555",
        model: "test",
        chatId,
        receiptDigest: keccak256(toUtf8Bytes(chatId)),
        requestDigest: `0x${"44".repeat(32)}`,
        responseDigest: `0x${"55".repeat(32)}`,
        signatureScheme: "EIP191",
        expectedSigner: "0x6666666666666666666666666666666666666666",
        signature: `0x${"ab".repeat(65)}`,
        signedTextSha256: `0x${"88".repeat(32)}`,
        requestSha256: `0x${"44".repeat(32)}`,
        rawResponseSha256: `0x${"55".repeat(32)}`,
        receiptSource: "ZG-Res-Key",
        responseHeadersSha256: `0x${"99".repeat(32)}`,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        processResponseVerified: true,
      },
      ...(subject.kind === "EOA"
        ? []
        : [
            {
              proofClass: "DECENTRALIZED_MODEL_TEE",
              purpose: "contract-risk",
              provider: "0x5555555555555555555555555555555555555555",
              model: "test",
              chatId: `${chatId}-code`,
              receiptDigest: keccak256(toUtf8Bytes(`${chatId}-code`)),
              requestDigest: `0x${"66".repeat(32)}`,
              responseDigest: `0x${"77".repeat(32)}`,
              signatureScheme: "EIP191",
              expectedSigner: "0x6666666666666666666666666666666666666666",
              signature: `0x${"cd".repeat(65)}`,
              signedTextSha256: `0x${"aa".repeat(32)}`,
              requestSha256: `0x${"66".repeat(32)}`,
              rawResponseSha256: `0x${"77".repeat(32)}`,
              receiptSource: "body-id-fallback",
              responseHeadersSha256: `0x${"bb".repeat(32)}`,
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
              processResponseVerified: true,
            },
          ]),
    ],
    verdict: { riskScore: 20, codeRisk: 0, label: "CAUTION" },
    omissions: [],
    scanner: {
      address: "0x4444444444444444444444444444444444444444",
      softwareVersion: "2.0.0",
    },
  };
}

describe("subject fixed-block hash safety", () => {
  it("rejects a same-height reorg during classification", async () => {
    let reads = 0;
    const adapter = chain({
      getBlock: vi.fn(async (number) => ({
        number,
        hash: reads++ === 0 ? BLOCK_HASH : REORG_HASH,
      })),
    });
    await expect(classifySubject(adapter, SUBJECT, SOURCE_BLOCK)).rejects.toThrow(/block hash|reorg/i);
  });

  it("rejects a same-height reorg across the full check run", async () => {
    let reads = 0;
    const adapter = chain({
      getBlock: vi.fn(async (number) => ({
        number,
        hash: reads++ < 3 ? BLOCK_HASH : REORG_HASH,
      })),
    });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    await expect(runSubjectChecks(adapter, subject, { sourceBlock: SOURCE_BLOCK })).rejects.toThrow(
      /block hash|reorg/i,
    );
  });
});

describe("resolver-bound verified source", () => {
  it("accepts only a resolver-produced record bound to target runtime and block", async () => {
    const target = {
      address: getAddress(SUBJECT),
      runtimeCodeHash: keccak256("0x6001") as Bytes32,
    };
    const record = await resolveVerifiedSource(resolver(), target, SOURCE_BLOCK);
    expect(record).toMatchObject({
      chainId: 16661,
      address: getAddress(SUBJECT),
      sourceBlockHash: BLOCK_HASH,
      runtimeCodeHash: target.runtimeCodeHash,
      verifiedRuntimeMatch: true,
    });
    expect(Object.isFrozen(record)).toBe(true);
  });

  it.each([
    ["chain", { chainId: 1 }],
    ["address", { address: TARGET }],
    ["block number", { sourceBlockNumber: "1233" }],
    ["block hash", { sourceBlockHash: REORG_HASH }],
    ["runtime hash", { runtimeCodeHash: `0x${"99".repeat(32)}` }],
    ["runtime match", { verifiedRuntimeMatch: false }],
    ["raw digest", { rawResponseDigest: ZERO_WORD }],
  ])("rejects a mismatched %s binding", async (_name, mismatch) => {
    await expect(resolveVerifiedSource(
      resolver("contract Verified {}", mismatch),
      { address: getAddress(SUBJECT), runtimeCodeHash: keccak256("0x6001") as Bytes32 },
      SOURCE_BLOCK,
    )).rejects.toThrow(/source|binding|runtime|chain|digest/i);
  });

  it("bounds verified source by UTF-8 bytes", async () => {
    await expect(resolveVerifiedSource(
      resolver("😀".repeat(70_000)),
      { address: getAddress(SUBJECT), runtimeCodeHash: keccak256("0x6001") as Bytes32 },
      SOURCE_BLOCK,
    )).rejects.toThrow(/source.*size|bytes/i);
  });

  it("rejects an invalid source-block selector before calling the resolver", async () => {
    const sourceResolver = resolver();
    await expect(resolveVerifiedSource(
      sourceResolver,
      { address: getAddress(SUBJECT), runtimeCodeHash: keccak256("0x6001") as Bytes32 },
      { number: -1n, hash: BLOCK_HASH },
    )).rejects.toThrow(/block/i);
    expect(sourceResolver.resolve).not.toHaveBeenCalled();
  });

  it("keeps source-pattern signals informational-only", async () => {
    const code = "0x6001";
    const adapter = chain({ getCode: vi.fn(async () => code) });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    const report = await inspectContract(adapter, subject, {
      sourceBlock: SOURCE_BLOCK,
      sourceResolver: resolver("contract X { function kill() external { selfdestruct(payable(msg.sender)); } }"),
    });
    expect(report.status).toBe("PASS");
    expect(report.sourcePatternSignals?.admissionImpact).toBe("INFORMATIONAL_ONLY");
    expect(report.deterministicFindings).toEqual([]);
  });
});

describe("fail-closed proxy and delegation provenance", () => {
  it("does not let a live EIP-1967 slot redirect source or canonical evidence", async () => {
    const sourceResolver = resolver("contract OrdinaryWithBenignSlot {}");
    const adapter = chain({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === TARGET.toLowerCase() ? "0x6002" : "0x6001",
      ),
      getStorage: vi.fn(async (_address, slot) =>
        slot === EIP1967_IMPLEMENTATION_SLOT ? storageAddress(TARGET) : ZERO_WORD,
      ),
    });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    const report = await inspectContract(adapter, subject, {
      sourceBlock: SOURCE_BLOCK,
      sourceResolver,
    } as never);
    const evidenceSubject = toEvidenceSubject(subject, report);

    expect(report.proxy).toBeUndefined();
    expect(report.proxyCandidate).toMatchObject({ kind: "EIP1967_IMPLEMENTATION" });
    expect(sourceResolver.resolve).toHaveBeenCalledWith(expect.objectContaining({
      address: getAddress(SUBJECT),
      runtimeCodeHash: subject.runtimeCodeHash,
    }));
    expect(evidenceSubject).not.toHaveProperty("proxyImplementation");
  });

  it("promotes a slot candidate only with independently bound proxy metadata", async () => {
    const metadataResolver = proxyMetadataResolver();
    const adapter = chain({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === TARGET.toLowerCase() ? "0x6002" : "0x6001",
      ),
      getStorage: vi.fn(async (_address, slot) =>
        slot === EIP1967_IMPLEMENTATION_SLOT ? storageAddress(TARGET) : ZERO_WORD,
      ),
    });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    const report = await inspectContract(adapter, subject, {
      sourceBlock: SOURCE_BLOCK,
      proxyMetadataResolver: metadataResolver,
    } as never);
    const evidenceSubject = toEvidenceSubject(subject, report);

    expect(report.boundProxyMetadata).toMatchObject({ verifiedProxyMatch: true });
    expect(report.proxy).toMatchObject({
      kind: "EIP1967_IMPLEMENTATION",
      implementationAddress: getAddress(TARGET),
    });
    expect(evidenceSubject).toMatchObject({
      proxyImplementation: getAddress(TARGET),
      proxyImplementationCodeHash: keccak256("0x6002"),
    });
  });

  it.each([
    ["self implementation", SUBJECT, "0x6001"],
    ["dead implementation", TARGET, "0x"],
  ])("rejects %s in an EIP-1967 implementation slot", async (_name, implementation, code) => {
    const adapter = chain({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === SUBJECT.toLowerCase() ? "0x6001" : code,
      ),
      getStorage: vi.fn(async (_address, slot) =>
        slot === EIP1967_IMPLEMENTATION_SLOT ? storageAddress(implementation) : ZERO_WORD,
      ),
    });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    await expect(inspectContract(adapter, subject, { sourceBlock: SOURCE_BLOCK })).rejects.toThrow(
      /proxy candidate|implementation|self|zero|code/i,
    );
  });

  it.each([
    ["self beacon", SUBJECT, "0x6001", storageAddress(TARGET), "0x6002"],
    ["dead beacon", BEACON, "0x", storageAddress(TARGET), "0x6002"],
    ["dead beacon implementation", BEACON, "0x6001", storageAddress(TARGET), "0x"],
    ["zero beacon implementation", BEACON, "0x6001", ZERO_WORD, "0x"],
  ])("rejects %s", async (_name, beacon, beaconCode, response, implementationCode) => {
    const adapter = chain({
      getCode: vi.fn(async (address) => {
        if (address.toLowerCase() === SUBJECT.toLowerCase()) return "0x6001";
        if (address.toLowerCase() === beacon.toLowerCase()) return beaconCode;
        return implementationCode;
      }),
      getStorage: vi.fn(async (_address, slot) =>
        slot === EIP1967_BEACON_SLOT ? storageAddress(beacon) : ZERO_WORD,
      ),
      call: vi.fn(async () => response),
    });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    await expect(inspectContract(adapter, subject, { sourceBlock: SOURCE_BLOCK })).rejects.toThrow(
      /beacon|proxy candidate|implementation|self|zero|code/i,
    );
  });

  it.each([
    ["zero", "0x0000000000000000000000000000000000000000", "0x"],
    ["self", SUBJECT, "0x6001"],
    ["dead", TARGET, "0x"],
  ])("rejects a %s EIP-1167 target", async (_name, target, targetCode) => {
    const adapter = chain({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === SUBJECT.toLowerCase() ? minimalProxy(target) : targetCode,
      ),
    });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    await expect(inspectContract(adapter, subject, { sourceBlock: SOURCE_BLOCK })).rejects.toThrow(
      /minimal|implementation|self|zero|code/i,
    );
  });

  it.each([
    ["zero", "0x0000000000000000000000000000000000000000", "0x"],
    ["self", SUBJECT, "0x6001"],
    ["dead", TARGET, "0x"],
  ])("rejects a %s EIP-7702 delegation", async (_name, target, targetCode) => {
    const adapter = chain({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === SUBJECT.toLowerCase()
          ? `0xef0100${target.slice(2)}`
          : targetCode,
      ),
    });
    await expect(classifySubject(adapter, SUBJECT, SOURCE_BLOCK)).rejects.toThrow(
      /delegation|target|self|zero|code/i,
    );
  });

  it("marks live delegation as a mandatory drift input", async () => {
    const adapter = chain({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === SUBJECT.toLowerCase()
          ? `0xef0100${TARGET.slice(2)}`
          : "0x6002",
      ),
      getHistory: vi.fn(async () => ({ complete: true, observedTransactions: 2 })),
    });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    const report = await inspectDelegatedEoa(adapter, subject, { sourceBlock: SOURCE_BLOCK });
    expect(report).toMatchObject({ status: "PASS", requiresDriftMonitoring: true });
  });

  it("fails when delegation code disappears after classification", async () => {
    const designator = `0xef0100${TARGET.slice(2)}`;
    let targetReads = 0;
    const adapter = chain({
      getCode: vi.fn(async (address) => {
        if (address.toLowerCase() === SUBJECT.toLowerCase()) return designator;
        return targetReads++ === 0 ? "0x6002" : "0x";
      }),
      getHistory: vi.fn(async () => ({ complete: true, observedTransactions: 2 })),
    });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    await expect(inspectDelegatedEoa(adapter, subject, { sourceBlock: SOURCE_BLOCK })).rejects.toThrow(
      /delegation.*code|drift/i,
    );
  });
});

describe("runtime RPC numeric validation", () => {
  it.each([
    ["non-bigint nonce", 1 as never, 0n],
    ["negative nonce", -1n, 0n],
    ["overflow nonce", 1n << 64n, 0n],
    ["non-bigint balance", 0n, "1" as never],
    ["negative balance", 0n, -1n],
    ["overflow balance", 0n, 1n << 256n],
  ])("rejects %s", async (_name, nonce, balance) => {
    const adapter = chain({
      getTransactionCount: vi.fn(async () => nonce),
      getBalance: vi.fn(async () => balance),
    });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    await expect(inspectEoa(adapter, subject, SOURCE_BLOCK)).rejects.toThrow(/nonce|balance|bigint|range/i);
  });

  it.each([
    { complete: 1 as never, observedTransactions: 1 },
    { complete: true, observedTransactions: -1 },
    { complete: true, observedTransactions: Number.MAX_SAFE_INTEGER + 1 },
  ])("treats malformed history as unknown: %o", async (history) => {
    const adapter = chain({ getHistory: vi.fn(async () => history) });
    const subject = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    const report = await inspectEoa(adapter, subject, SOURCE_BLOCK);
    expect(report).toMatchObject({ status: "WARN", history: { status: "UNKNOWN" } });
  });
});

describe("strict evidence subject adapter", () => {
  it("rejects a report bound to a different block hash", async () => {
    const adapter = chain();
    const classified = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    const report = await inspectEoa(adapter, classified, SOURCE_BLOCK);
    expect(() => toEvidenceSubject(classified, {
      ...report,
      sourceBlockHash: REORG_HASH,
    })).toThrow(/block|hash/i);
  });

  it.each([
    ["EOA", "0x", undefined],
    ["CONTRACT", "0x6001", undefined],
    ["EIP7702_DELEGATED_EOA", `0xef0100${TARGET.slice(2)}`, undefined],
    ["EIP1967_IMPLEMENTATION", "0x6001", "implementation"],
    ["EIP1967_BEACON", "0x6001", "beacon"],
    ["EIP1167_MINIMAL", minimalProxy(), "minimal"],
  ])("maps %s through canonical evidence", async (variant, subjectCode, proxyKind) => {
    const adapter = chain({
      getCode: vi.fn(async (address) => {
        if (address.toLowerCase() === SUBJECT.toLowerCase()) return subjectCode;
        if (address.toLowerCase() === BEACON.toLowerCase()) return "0x6003";
        return "0x6002";
      }),
      getStorage: vi.fn(async (_address, slot) => {
        if (proxyKind === "implementation" && slot === EIP1967_IMPLEMENTATION_SLOT) {
          return storageAddress(TARGET);
        }
        if (proxyKind === "beacon" && slot === EIP1967_BEACON_SLOT) return storageAddress(BEACON);
        return ZERO_WORD;
      }),
      call: vi.fn(async () => storageAddress(TARGET)),
      getHistory: vi.fn(async () => ({ complete: true, observedTransactions: 1 })),
    });
    const classified = await classifySubject(adapter, SUBJECT, SOURCE_BLOCK);
    const report = await runSubjectChecks(adapter, classified, { sourceBlock: SOURCE_BLOCK });
    const evidenceSubject = toEvidenceSubject(classified, report);
    const validated = validateEvidenceEnvelope(envelopeSubject(evidenceSubject));

    expect(validated.subject).toEqual(evidenceSubject);
    expect(Object.keys(evidenceSubject).sort()).toEqual(
      expect.arrayContaining(["address", "kind", "runtimeCodeHash"]),
    );
    if (proxyKind === "minimal") {
      expect(validated.subject.proxyImplementation).toBe(getAddress(TARGET).toLowerCase());
      expect(validated.subject.proxyImplementationCodeHash).toBe(keccak256("0x6002"));
    } else if (proxyKind) {
      expect(validated.subject).not.toHaveProperty("proxyImplementation");
    }
    if (variant === "EIP7702_DELEGATED_EOA") {
      expect(validated.subject.delegationTarget).toBe(getAddress(TARGET).toLowerCase());
    }
  });
});
