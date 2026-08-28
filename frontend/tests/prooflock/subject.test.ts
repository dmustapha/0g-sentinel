import { getAddress, keccak256, toUtf8Bytes } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  classifySubject,
  type SubjectChainAdapter,
} from "../../server/prooflock/subject/classify";
import { inspectContract } from "../../server/prooflock/checks/contract";
import { inspectDelegatedEoa } from "../../server/prooflock/checks/delegated-eoa";
import { inspectEoa } from "../../server/prooflock/checks/eoa";
import { runSubjectChecks } from "../../server/prooflock/checks";
import { analyzeSolidityPatterns } from "../../server/prooflock/checks/static-analysis";
import type { Bytes32, HexAddress } from "../../server/prooflock/types";

const SUBJECT = "0x1111111111111111111111111111111111111111";
const TARGET = "0x2222222222222222222222222222222222222222";
const BEACON = "0x3333333333333333333333333333333333333333";
const BLOCK = 1234n;
const EMPTY_HASH = keccak256("0x");

type AdapterOverrides = Partial<SubjectChainAdapter>;

function adapter(overrides: AdapterOverrides = {}) {
  const value: SubjectChainAdapter = {
    getCode: vi.fn(async () => "0x"),
    getStorage: vi.fn(async () => `0x${"00".repeat(32)}`),
    call: vi.fn(async () => "0x"),
    getTransactionCount: vi.fn(async () => 0n),
    getBalance: vi.fn(async () => 0n),
    ...overrides,
  };
  return value;
}

function storageAddress(address: string) {
  return `0x${"00".repeat(12)}${address.slice(2).toLowerCase()}`;
}

function minimalProxy(target = TARGET) {
  return `0x363d3d373d3d3d363d73${target.slice(2)}5af43d82803e903d91602b57fd5bf3`;
}

describe("ProofLock subject classification", () => {
  it("classifies empty runtime code as an EOA at the requested block", async () => {
    const getCode = vi.fn(async () => "0x");
    const result = await classifySubject(adapter({ getCode }), SUBJECT, BLOCK);

    expect(getCode).toHaveBeenCalledWith(getAddress(SUBJECT), BLOCK);
    expect(result).toEqual({
      address: getAddress(SUBJECT) as HexAddress,
      kind: "EOA",
      sourceBlockNumber: BLOCK.toString(),
      runtimeCode: "0x",
      runtimeCodeHash: EMPTY_HASH as Bytes32,
    });
  });

  it("classifies only the exact EIP-7702 designator shape as delegated", async () => {
    const designator = `0xef0100${TARGET.slice(2)}`;
    const getCode = vi.fn(async (address: string) =>
      address.toLowerCase() === SUBJECT.toLowerCase() ? designator : "0x6001",
    );
    const result = await classifySubject(adapter({ getCode }), SUBJECT, BLOCK);

    expect(result).toMatchObject({
      kind: "EIP7702_DELEGATED_EOA",
      delegationTarget: getAddress(TARGET),
      delegationCodeHash: keccak256("0x6001"),
      runtimeCodeHash: keccak256(designator),
    });
    expect(getCode).toHaveBeenNthCalledWith(2, getAddress(TARGET), BLOCK);
  });

  it.each([
    "0xef0100",
    `0xef0100${TARGET.slice(2)}00`,
    `0xef0101${TARGET.slice(2)}`,
    "0x00",
    "0x60016000",
  ])("treats non-designator runtime %s as contract code", async (runtimeCode) => {
    const result = await classifySubject(
      adapter({ getCode: vi.fn(async () => runtimeCode) }),
      SUBJECT,
      BLOCK,
    );
    expect(result.kind).toBe("CONTRACT");
    expect(result.runtimeCodeHash).toBe(keccak256(runtimeCode));
  });

  it("rejects malformed addresses, bytecode, and block tags", async () => {
    await expect(classifySubject(adapter(), "not-an-address", BLOCK)).rejects.toThrow(
      "Invalid subject address",
    );
    await expect(classifySubject(adapter(), SUBJECT, -1n)).rejects.toThrow(
      "Invalid source block",
    );
    await expect(
      classifySubject(adapter({ getCode: vi.fn(async () => "0x123") }), SUBJECT, BLOCK),
    ).rejects.toThrow("Malformed runtime bytecode");
  });
});

describe("contract deterministic checks", () => {
  it("records runtime hash and EIP-1967 implementation provenance at one block", async () => {
    const runtime = "0x6001600055";
    const implementationCode = "0x6002600055";
    const chain = adapter({
      getStorage: vi.fn(async (_address, slot) =>
        slot === EIP1967_IMPLEMENTATION_SLOT ? storageAddress(TARGET) : `0x${"00".repeat(32)}`,
      ),
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === TARGET.toLowerCase() ? implementationCode : runtime,
      ),
    });
    const subject = await classifySubject(chain, SUBJECT, BLOCK);
    const result = await inspectContract(chain, subject, { blockTag: BLOCK });

    expect(result.runtimeCodeHash).toBe(keccak256(runtime));
    expect(result.proxy).toEqual({
      kind: "EIP1967_IMPLEMENTATION",
      implementationAddress: getAddress(TARGET),
      implementationCodeHash: keccak256(implementationCode),
    });
    expect(chain.getStorage).toHaveBeenCalledWith(
      getAddress(SUBJECT),
      EIP1967_IMPLEMENTATION_SLOT,
      BLOCK,
    );
  });

  it("resolves an EIP-1967 beacon and its implementation at the fixed block", async () => {
    const implementationCode = "0x6003";
    const beaconCode = "0x6004";
    const chain = adapter({
      getStorage: vi.fn(async (_address, slot) =>
        slot === EIP1967_BEACON_SLOT ? storageAddress(BEACON) : `0x${"00".repeat(32)}`,
      ),
      call: vi.fn(async () => storageAddress(TARGET)),
      getCode: vi.fn(async (address) => {
        if (address.toLowerCase() === BEACON.toLowerCase()) return beaconCode;
        if (address.toLowerCase() === TARGET.toLowerCase()) return implementationCode;
        return "0x6001";
      }),
    });
    const subject = await classifySubject(chain, SUBJECT, BLOCK);
    const result = await inspectContract(chain, subject, { blockTag: BLOCK });

    expect(result.proxy).toEqual({
      kind: "EIP1967_BEACON",
      beaconAddress: getAddress(BEACON),
      beaconCodeHash: keccak256(beaconCode),
      implementationAddress: getAddress(TARGET),
      implementationCodeHash: keccak256(implementationCode),
    });
    expect(chain.call).toHaveBeenCalledWith(
      { to: getAddress(BEACON), data: "0x5c60da1b" },
      BLOCK,
    );
  });

  it("detects an exact EIP-1167 minimal proxy", async () => {
    const chain = adapter({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === TARGET.toLowerCase() ? "0x6005" : minimalProxy(),
      ),
    });
    const subject = await classifySubject(chain, SUBJECT, BLOCK);
    const result = await inspectContract(chain, subject, { blockTag: BLOCK });

    expect(result.proxy).toEqual({
      kind: "EIP1167_MINIMAL",
      implementationAddress: getAddress(TARGET),
      implementationCodeHash: keccak256("0x6005"),
    });
  });

  it("rejects malformed or non-canonical EIP-1967 storage words", async () => {
    for (const word of ["0x1234", `0x01${"00".repeat(11)}${TARGET.slice(2)}`]) {
      const chain = adapter({
        getCode: vi.fn(async () => "0x6001"),
        getStorage: vi.fn(async (_address, slot) =>
          slot === EIP1967_IMPLEMENTATION_SLOT ? word : `0x${"00".repeat(32)}`,
        ),
      });
      const subject = await classifySubject(chain, SUBJECT, BLOCK);
      await expect(inspectContract(chain, subject, { blockTag: BLOCK })).rejects.toThrow(
        "Invalid EIP-1967 storage word",
      );
    }
  });

  it("emits a verified-source digest only for explicit verified source input", async () => {
    const chain = adapter({ getCode: vi.fn(async () => "0x6001") });
    const subject = await classifySubject(chain, SUBJECT, BLOCK);
    const absent = await inspectContract(chain, subject, { blockTag: BLOCK });
    const source = "contract A { function ping() external {} }";
    const present = await inspectContract(chain, subject, {
      blockTag: BLOCK,
      verifiedSource: { source, provenance: "block-explorer-verified" },
    });

    expect(absent).not.toHaveProperty("verifiedSource");
    expect(present.verifiedSource).toEqual({
      digest: keccak256(toUtf8Bytes(source)),
      provenance: "block-explorer-verified",
      analysisEngine: "solidity-source-pattern-analysis-v1",
    });
  });

  it("rejects an unrecognized verified-source provenance at runtime", async () => {
    const chain = adapter({ getCode: vi.fn(async () => "0x6001") });
    const subject = await classifySubject(chain, SUBJECT, BLOCK);
    await expect(inspectContract(chain, subject, {
      blockTag: BLOCK,
      verifiedSource: { source: "contract A {}", provenance: "user-supplied" } as never,
    })).rejects.toThrow("Invalid verified-source provenance");
  });
});

describe("accurately labelled Solidity source-pattern analysis", () => {
  it("reports every required signal without claiming to be an AST", () => {
    const result = analyzeSolidityPatterns(`
      contract Risky {
        address public admin;
        mapping(address => uint256) balances;
        function setAdmin(address next) external onlyOwner { admin = next; }
        function drain(address target, bytes calldata data) external {
          target.delegatecall(data);
          target.call(data);
          payable(msg.sender).call{value: 1 ether}("");
          balances[msg.sender] = 0;
          selfdestruct(payable(msg.sender));
        }
      }
    `);

    expect(result.engine).toBe("solidity-source-pattern-analysis-v1");
    expect(result.method).toBe("REGEX_AND_BRACE_MATCHING");
    expect(result.checksRun).toEqual(expect.arrayContaining([
      "privileged-admin-signal",
      "delegatecall-signal",
      "unprotected-selfdestruct",
      "unchecked-low-level-call",
      "arbitrary-external-call",
      "reentrancy-pattern",
    ]));
    expect(result.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining([
      "privileged-admin-signal",
      "delegatecall-signal",
      "unprotected-selfdestruct",
      "unchecked-low-level-call",
      "arbitrary-external-call",
      "reentrancy-pattern",
    ]));
  });

  it("does not match vulnerability words that occur only in comments", () => {
    const result = analyzeSolidityPatterns(`
      contract Clean {
        // selfdestruct(target); target.delegatecall(data);
        function ping() external pure returns (bool) { return true; }
      }
    `);
    expect(result.findings).toEqual([]);
  });
});

describe("EOA and delegated-EOA checks", () => {
  it("captures nonce, balance, and complete history at the fixed block", async () => {
    const getTransactionCount = vi.fn(async () => 4n);
    const getBalance = vi.fn(async () => 99n);
    const getHistory = vi.fn(async () => ({ complete: true as const, observedTransactions: 4 }));
    const chain = adapter({ getTransactionCount, getBalance, getHistory });
    const subject = await classifySubject(chain, SUBJECT, BLOCK);
    const result = await inspectEoa(chain, subject, BLOCK);

    expect(result).toMatchObject({
      status: "PASS",
      assessment: "OBSERVED",
      nonce: "4",
      balanceWei: "99",
      history: { status: "AVAILABLE", observedTransactions: 4 },
    });
    expect(getTransactionCount).toHaveBeenCalledWith(getAddress(SUBJECT), BLOCK);
    expect(getBalance).toHaveBeenCalledWith(getAddress(SUBJECT), BLOCK);
    expect(getHistory).toHaveBeenCalledWith(getAddress(SUBJECT), BLOCK);
  });

  it("marks missing or empty history unknown/caution and never safe", async () => {
    const noSource = await inspectEoa(adapter(), {
      address: getAddress(SUBJECT) as HexAddress,
      kind: "EOA",
      sourceBlockNumber: BLOCK.toString(),
      runtimeCode: "0x",
      runtimeCodeHash: EMPTY_HASH as Bytes32,
    }, BLOCK);
    const empty = await inspectEoa(adapter({
      getHistory: vi.fn(async () => ({ complete: true as const, observedTransactions: 0 })),
    }), {
      address: getAddress(SUBJECT) as HexAddress,
      kind: "EOA",
      sourceBlockNumber: BLOCK.toString(),
      runtimeCode: "0x",
      runtimeCodeHash: EMPTY_HASH as Bytes32,
    }, BLOCK);

    expect(noSource).toMatchObject({ status: "WARN", assessment: "CAUTION", history: { status: "UNKNOWN" } });
    expect(empty).toMatchObject({ status: "WARN", assessment: "CAUTION" });
  });

  it("checks delegated target provenance and target contract signals", async () => {
    const designator = `0xef0100${TARGET.slice(2)}`;
    const targetCode = minimalProxy(BEACON);
    const chain = adapter({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === SUBJECT.toLowerCase() ? designator : targetCode,
      ),
      getHistory: vi.fn(async () => ({ complete: true as const, observedTransactions: 2 })),
    });
    const subject = await classifySubject(chain, SUBJECT, BLOCK);
    const result = await inspectDelegatedEoa(chain, subject, { blockTag: BLOCK });

    expect(result.delegation).toMatchObject({
      target: getAddress(TARGET),
      codeHash: keccak256(targetCode),
    });
    expect(result.targetAnalysis.proxy).toMatchObject({
      kind: "EIP1167_MINIMAL",
      implementationAddress: getAddress(BEACON),
    });
  });

  it("warns when a delegation target has no runtime code at the source block", async () => {
    const designator = `0xef0100${TARGET.slice(2)}`;
    const chain = adapter({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === SUBJECT.toLowerCase() ? designator : "0x",
      ),
    });
    const subject = await classifySubject(chain, SUBJECT, BLOCK);
    const result = await inspectDelegatedEoa(chain, subject, { blockTag: BLOCK });
    expect(result.status).toBe("WARN");
    expect(result.findings).toContain("DELEGATION_TARGET_CODE_EMPTY");
  });
});

describe("subject check router", () => {
  it.each([
    ["EOA", "EOA_SNAPSHOT"],
    ["CONTRACT", "CONTRACT_ANALYSIS"],
    ["EIP7702_DELEGATED_EOA", "DELEGATED_EOA_ANALYSIS"],
  ] as const)("routes %s subjects to %s", async (kind, reportKind) => {
    const code = kind === "EOA"
      ? "0x"
      : kind === "CONTRACT"
        ? "0x6001"
        : `0xef0100${TARGET.slice(2)}`;
    const chain = adapter({ getCode: vi.fn(async (address) =>
      address.toLowerCase() === SUBJECT.toLowerCase() ? code : "0x6002",
    ) });
    const subject = await classifySubject(chain, SUBJECT, BLOCK);
    const report = await runSubjectChecks(chain, subject, { blockTag: BLOCK });
    expect(report.kind).toBe(reportKind);
  });
});
