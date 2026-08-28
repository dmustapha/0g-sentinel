import { getAddress, keccak256 } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  classifySubject,
  type ExpectedSourceBlock,
  type SubjectChainAdapter,
} from "../../server/prooflock/subject/classify";
import { inspectContract } from "../../server/prooflock/checks/contract";
import { inspectEoa } from "../../server/prooflock/checks/eoa";
import { runSubjectChecks } from "../../server/prooflock/checks";
import { analyzeSolidityPatterns } from "../../server/prooflock/checks/static-analysis";
import type { Bytes32 } from "../../server/prooflock/types";

const SUBJECT = "0x1111111111111111111111111111111111111111";
const TARGET = "0x2222222222222222222222222222222222222222";
const BEACON = "0x3333333333333333333333333333333333333333";
const BLOCK = 1234n;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as Bytes32;
const SOURCE_BLOCK: ExpectedSourceBlock = { number: BLOCK, hash: BLOCK_HASH };
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;

function adapter(overrides: Partial<SubjectChainAdapter> = {}): SubjectChainAdapter {
  return {
    getBlock: vi.fn(async (number) => ({ number, hash: BLOCK_HASH })),
    getCode: vi.fn(async () => "0x"),
    getStorage: vi.fn(async () => ZERO_BYTES32),
    call: vi.fn(async () => "0x"),
    getTransactionCount: vi.fn(async () => 0n),
    getBalance: vi.fn(async () => 0n),
    ...overrides,
  };
}

function storageAddress(address: string) {
  return `0x${"00".repeat(12)}${address.slice(2).toLowerCase()}`;
}

function minimalProxy(target = TARGET) {
  return `0x363d3d373d3d3d363d73${target.slice(2)}5af43d82803e903d91602b57fd5bf3`;
}

describe("ProofLock subject classification", () => {
  it("classifies an EOA with the canonical zero runtime hash", async () => {
    const getCode = vi.fn(async () => "0x");
    const subject = await classifySubject(adapter({ getCode }), SUBJECT, SOURCE_BLOCK);
    expect(subject).toMatchObject({
      address: getAddress(SUBJECT),
      kind: "EOA",
      sourceBlockNumber: BLOCK.toString(),
      sourceBlockHash: BLOCK_HASH,
      runtimeCode: "0x",
      runtimeCodeHash: ZERO_BYTES32,
    });
    expect(getCode).toHaveBeenCalledWith(getAddress(SUBJECT), BLOCK);
    expect(Object.isFrozen(subject)).toBe(true);
  });

  it("classifies only an exact, live EIP-7702 designator", async () => {
    const designator = `0xef0100${TARGET.slice(2)}`;
    const getCode = vi.fn(async (address: string) =>
      address.toLowerCase() === SUBJECT.toLowerCase() ? designator : "0x6001",
    );
    const subject = await classifySubject(adapter({ getCode }), SUBJECT, SOURCE_BLOCK);
    expect(subject).toMatchObject({
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
    const subject = await classifySubject(
      adapter({ getCode: vi.fn(async () => runtimeCode) }),
      SUBJECT,
      SOURCE_BLOCK,
    );
    expect(subject.kind).toBe("CONTRACT");
    expect(subject.runtimeCodeHash).toBe(keccak256(runtimeCode));
  });

  it("rejects malformed identity, block, and bytecode inputs", async () => {
    await expect(classifySubject(adapter(), "bad", SOURCE_BLOCK)).rejects.toThrow(/address/i);
    await expect(classifySubject(adapter(), SUBJECT, {
      number: -1n,
      hash: BLOCK_HASH,
    })).rejects.toThrow(/block/i);
    await expect(classifySubject(
      adapter({ getCode: vi.fn(async () => "0x123") }),
      SUBJECT,
      SOURCE_BLOCK,
    )).rejects.toThrow(/bytecode/i);
  });
});

describe("corroborated proxy checks", () => {
  it("rejects malformed and non-canonical EIP-1967 storage words", async () => {
    for (const word of ["0x1234", `0x01${"00".repeat(11)}${TARGET.slice(2)}`]) {
      const adapterValue = adapter({
        getCode: vi.fn(async () => "0x6001"),
        getStorage: vi.fn(async (_address, slot) =>
          slot === EIP1967_IMPLEMENTATION_SLOT ? word : ZERO_BYTES32,
        ),
      });
      const subject = await classifySubject(adapterValue, SUBJECT, SOURCE_BLOCK);
      await expect(inspectContract(
        adapterValue,
        subject,
        { sourceBlock: SOURCE_BLOCK },
      )).rejects.toThrow(/storage word/i);
    }
  });

  it("records an EIP-1967 implementation with live code", async () => {
    const adapterValue = adapter({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === TARGET.toLowerCase() ? "0x6002" : "0x6001",
      ),
      getStorage: vi.fn(async (_address, slot) =>
        slot === EIP1967_IMPLEMENTATION_SLOT ? storageAddress(TARGET) : ZERO_BYTES32,
      ),
    });
    const subject = await classifySubject(adapterValue, SUBJECT, SOURCE_BLOCK);
    const report = await inspectContract(adapterValue, subject, { sourceBlock: SOURCE_BLOCK });
    expect(report.proxy).toEqual({
      kind: "EIP1967_IMPLEMENTATION",
      implementationAddress: getAddress(TARGET),
      implementationCodeHash: keccak256("0x6002"),
    });
  });

  it("records a live beacon and resolved live implementation", async () => {
    const adapterValue = adapter({
      getCode: vi.fn(async (address) => {
        if (address.toLowerCase() === BEACON.toLowerCase()) return "0x6003";
        if (address.toLowerCase() === TARGET.toLowerCase()) return "0x6002";
        return "0x6001";
      }),
      getStorage: vi.fn(async (_address, slot) =>
        slot === EIP1967_BEACON_SLOT ? storageAddress(BEACON) : ZERO_BYTES32,
      ),
      call: vi.fn(async () => storageAddress(TARGET)),
    });
    const subject = await classifySubject(adapterValue, SUBJECT, SOURCE_BLOCK);
    const report = await inspectContract(adapterValue, subject, { sourceBlock: SOURCE_BLOCK });
    expect(report.proxy).toEqual({
      kind: "EIP1967_BEACON",
      beaconAddress: getAddress(BEACON),
      beaconCodeHash: keccak256("0x6003"),
      implementationAddress: getAddress(TARGET),
      implementationCodeHash: keccak256("0x6002"),
    });
  });

  it("records an exact minimal proxy with live implementation", async () => {
    const adapterValue = adapter({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === TARGET.toLowerCase() ? "0x6002" : minimalProxy(),
      ),
    });
    const subject = await classifySubject(adapterValue, SUBJECT, SOURCE_BLOCK);
    const report = await inspectContract(adapterValue, subject, { sourceBlock: SOURCE_BLOCK });
    expect(report.proxy).toMatchObject({
      kind: "EIP1167_MINIMAL",
      implementationAddress: getAddress(TARGET),
      implementationCodeHash: keccak256("0x6002"),
    });
  });
});

describe("informational source-pattern signals", () => {
  it("runs every required legacy signal as informational pattern analysis", () => {
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
    expect(result.checksRun).toEqual(expect.arrayContaining([
      "privileged-admin-signal",
      "delegatecall-signal",
      "unprotected-selfdestruct",
      "unchecked-low-level-call",
      "arbitrary-external-call",
      "reentrancy-pattern",
    ]));
    expect(result.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      "privileged-admin-signal",
      "delegatecall-signal",
      "unprotected-selfdestruct",
      "unchecked-low-level-call",
      "arbitrary-external-call",
      "reentrancy-pattern",
    ]));
    expect(result.admissionImpact).toBe("INFORMATIONAL_ONLY");
  });

  it("labels its regex method and configured signals without claiming AST proof", () => {
    const result = analyzeSolidityPatterns(`
      contract Risky {
        function drain(address target, bytes calldata data) external {
          target.delegatecall(data);
          target.call(data);
          selfdestruct(payable(msg.sender));
        }
      }
    `);
    expect(result).toMatchObject({
      engine: "solidity-source-pattern-analysis-v1",
      method: "REGEX_AND_BRACE_MATCHING",
      admissionImpact: "INFORMATIONAL_ONLY",
    });
    expect(result.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      "delegatecall-signal",
      "unprotected-selfdestruct",
      "unchecked-low-level-call",
      "arbitrary-external-call",
    ]));
  });

  it("ignores vulnerability words in comments", () => {
    expect(analyzeSolidityPatterns(`
      contract Clean {
        // selfdestruct(target); target.delegatecall(data);
        function ping() external pure returns (bool) { return true; }
      }
    `).findings).toEqual([]);
  });
});

describe("account snapshots and check routing", () => {
  it("uses fixed-block nonce, balance, and complete history", async () => {
    const adapterValue = adapter({
      getTransactionCount: vi.fn(async () => 4n),
      getBalance: vi.fn(async () => 99n),
      getHistory: vi.fn(async () => ({ complete: true, observedTransactions: 4 })),
    });
    const subject = await classifySubject(adapterValue, SUBJECT, SOURCE_BLOCK);
    const report = await inspectEoa(adapterValue, subject, SOURCE_BLOCK);
    expect(report).toMatchObject({
      status: "PASS",
      assessment: "OBSERVED",
      nonce: "4",
      balanceWei: "99",
      history: { status: "AVAILABLE", observedTransactions: 4 },
    });
  });

  it("makes unavailable history cautionary", async () => {
    const adapterValue = adapter();
    const subject = await classifySubject(adapterValue, SUBJECT, SOURCE_BLOCK);
    const report = await inspectEoa(adapterValue, subject, SOURCE_BLOCK);
    expect(report).toMatchObject({
      status: "WARN",
      assessment: "CAUTION",
      history: { status: "UNKNOWN" },
    });
  });

  it("makes a complete but empty history cautionary", async () => {
    const adapterValue = adapter({
      getHistory: vi.fn(async () => ({ complete: true, observedTransactions: 0 })),
    });
    const subject = await classifySubject(adapterValue, SUBJECT, SOURCE_BLOCK);
    const report = await inspectEoa(adapterValue, subject, SOURCE_BLOCK);
    expect(report).toMatchObject({ status: "WARN", assessment: "CAUTION" });
  });

  it("checks nested proxy provenance for a delegated EOA target", async () => {
    const designator = `0xef0100${TARGET.slice(2)}`;
    const targetCode = minimalProxy(BEACON);
    const adapterValue = adapter({
      getCode: vi.fn(async (address) => {
        if (address.toLowerCase() === SUBJECT.toLowerCase()) return designator;
        if (address.toLowerCase() === TARGET.toLowerCase()) return targetCode;
        return "0x6003";
      }),
      getHistory: vi.fn(async () => ({ complete: true, observedTransactions: 2 })),
    });
    const subject = await classifySubject(adapterValue, SUBJECT, SOURCE_BLOCK);
    const report = await runSubjectChecks(adapterValue, subject, { sourceBlock: SOURCE_BLOCK });
    expect(report).toMatchObject({
      kind: "DELEGATED_EOA_ANALYSIS",
      delegation: { target: getAddress(TARGET), codeHash: keccak256(targetCode) },
      targetAnalysis: {
        proxy: { kind: "EIP1167_MINIMAL", implementationAddress: getAddress(BEACON) },
      },
    });
  });

  it.each([
    ["EOA", "0x", "EOA_SNAPSHOT"],
    ["CONTRACT", "0x6001", "CONTRACT_ANALYSIS"],
    ["EIP7702", `0xef0100${TARGET.slice(2)}`, "DELEGATED_EOA_ANALYSIS"],
  ])("routes %s to %s", async (_name, code, reportKind) => {
    const adapterValue = adapter({
      getCode: vi.fn(async (address) =>
        address.toLowerCase() === SUBJECT.toLowerCase() ? code : "0x6002",
      ),
    });
    const subject = await classifySubject(adapterValue, SUBJECT, SOURCE_BLOCK);
    const report = await runSubjectChecks(adapterValue, subject, { sourceBlock: SOURCE_BLOCK });
    expect(report.kind).toBe(reportKind);
  });
});
