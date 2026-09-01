import { describe, expect, it } from "vitest";
import {
  analyzeContract,
  scanBytecodeOpcodes,
  OP_SELFDESTRUCT,
  OP_DELEGATECALL,
} from "../../server/prooflock/analysis/contract-analysis";
import type { AddressEvidence } from "../../server/prooflock/analysis/types";

type ContractInput = Pick<AddressEvidence, "isContract" | "code" | "source" | "sourceVerified">;

const contract = (code: string, over: Partial<ContractInput> = {}): ContractInput => ({
  isContract: true,
  code,
  source: null,
  sourceVerified: false,
  ...over,
});

// A tiny stop-prefixed body so the danger byte is a real opcode, not PUSH data.
// STOP(0x00) DUP1(0x80) <op>
const runtimeWith = (op: number) => `0x0080${op.toString(16).padStart(2, "0")}`;

// PUSH32 (0x7f) + 32 immediate bytes, one of which is 0xff, then STOP.
const push32Data = (() => {
  const data = new Array<string>(32).fill("11");
  data[10] = "ff"; // 0xff buried inside the PUSH32 immediate
  return `0x7f${data.join("")}00`;
})();

// PUSH4 (0x63) + mint selector (40c10f19), then STOP.
const push4Mint = "0x6340c10f1900";

describe("scanBytecodeOpcodes (PUSH-data-aware walker)", () => {
  it("finds SELFDESTRUCT when it is a real opcode", () => {
    expect(scanBytecodeOpcodes(runtimeWith(OP_SELFDESTRUCT)).has(OP_SELFDESTRUCT)).toBe(true);
  });

  it("does NOT flag a 0xff byte that lives inside PUSH32 immediate data", () => {
    const ops = scanBytecodeOpcodes(push32Data);
    expect(ops.has(0x7f)).toBe(true); // the PUSH32 opcode itself is present
    expect(ops.has(OP_SELFDESTRUCT)).toBe(false); // the buried 0xff is data, not an opcode
    expect(ops.has(0x00)).toBe(true); // the trailing STOP is reached after skipping the data
  });

  it("skips PUSH1 immediate so an embedded opcode-looking byte is not counted", () => {
    // PUSH1(0x60) 0xf4(data) STOP -> DELEGATECALL byte is data, must not appear
    const ops = scanBytecodeOpcodes("0x60f400");
    expect(ops.has(OP_DELEGATECALL)).toBe(false);
    expect(ops.has(0x00)).toBe(true);
  });
});

describe("analyzeContract - EOA", () => {
  it("returns a clean non-contract shape for an EOA", () => {
    const a = analyzeContract({ isContract: false, code: "0x", source: null, sourceVerified: false });
    expect(a.isContract).toBe(false);
    expect(a.codeRisk).toBe(0);
    expect(a.bytecodeFlags).toEqual([]);
    expect(a.sourceFindings).toEqual([]);
    expect(a.signals).toEqual([]);
    expect(a.factors[0]).toContain("Standard wallet");
  });
});

describe("analyzeContract - bytecode flags", () => {
  it("(a) flags SELFDESTRUCT and rates codeRisk 2", () => {
    const a = analyzeContract(contract(runtimeWith(OP_SELFDESTRUCT)));
    expect(a.bytecodeFlags).toContain("SELFDESTRUCT");
    expect(a.codeRisk).toBe(2);
    expect(a.signals.some((s) => s.id === "selfdestruct")).toBe(true);
  });

  it("(b) does NOT flag SELFDESTRUCT when 0xff is inside PUSH32 data", () => {
    const a = analyzeContract(contract(push32Data));
    expect(a.bytecodeFlags).not.toContain("SELFDESTRUCT");
    expect(a.codeRisk).toBe(0);
    expect(a.factors[0]).toContain("no dangerous patterns");
  });

  it("(c) flags DELEGATECALL and rates codeRisk >= 1", () => {
    const a = analyzeContract(contract(runtimeWith(OP_DELEGATECALL)));
    expect(a.bytecodeFlags).toContain("DELEGATECALL");
    expect(a.codeRisk).toBeGreaterThanOrEqual(1);
    expect(a.signals.some((s) => s.id === "delegatecall")).toBe(true);
  });

  it("(d) detects the mint selector pushed via PUSH4 as HAS_MINT", () => {
    const a = analyzeContract(contract(push4Mint));
    expect(a.bytecodeFlags).toContain("HAS_MINT");
    expect(a.signals.some((s) => s.id === "has_mint")).toBe(true);
  });

  it("escalates delegatecall + owner-controlled fund-moving to codeRisk 2", () => {
    // PUSH4 mint + PUSH4 owner() + DELEGATECALL opcode + STOP
    const code = "0x6340c10f19638da5cb5bf400";
    const a = analyzeContract(contract(code));
    expect(a.bytecodeFlags).toEqual(expect.arrayContaining(["HAS_MINT", "OWNER_CONTROLLED", "DELEGATECALL"]));
    expect(a.codeRisk).toBe(2);
  });

  it("rates owner-controlled mint (no delegatecall) as codeRisk 1", () => {
    const code = "0x6340c10f19638da5cb5b00"; // PUSH4 mint, PUSH4 owner(), STOP
    const a = analyzeContract(contract(code));
    expect(a.codeRisk).toBe(1);
  });
});

describe("analyzeContract - verified source", () => {
  it("(f) surfaces a selfdestruct source finding", () => {
    const src = "contract Kill { function boom() public { selfdestruct(payable(msg.sender)); } }";
    const a = analyzeContract(contract("0x00", { source: src, sourceVerified: true }));
    expect(a.sourceFindings.some((f) => f.toLowerCase().includes("selfdestruct"))).toBe(true);
  });

  it("flags a transfer-blocking honeypot as codeRisk 2 with a hard signal", () => {
    const src = "contract Trap { function transfer(address to, uint256 v) public { require(false); } }";
    const a = analyzeContract(contract("0x00", { source: src, sourceVerified: true }));
    expect(a.codeRisk).toBe(2);
    expect(a.signals.some((s) => s.id === "honeypot" && s.hard)).toBe(true);
    expect(a.factors[0].toLowerCase()).toContain("honeypot");
  });

  it("ignores source when it is not verified", () => {
    const src = "contract Kill { function boom() public { selfdestruct(payable(msg.sender)); } }";
    const a = analyzeContract(contract("0x00", { source: src, sourceVerified: false }));
    expect(a.sourceFindings).toEqual([]);
  });
});
