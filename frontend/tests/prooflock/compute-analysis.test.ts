import { describe, expect, it } from "vitest";
import { parseComputeAnalysis, safeComputeAnalysis, contentFromResponseBytes } from "../../server/prooflock/compute-analysis";

const rich = JSON.stringify({ riskScore: 12, summary: "Low behavioral risk: steady history, no scam ties.",
  factors: ["42 transactions, no flagged counterparties", "Stable balance", "No contract code"] });

describe("parseComputeAnalysis", () => {
  it("extracts score, summary, and factors from the signed content", () => {
    const a = parseComputeAnalysis(rich);
    expect(a.riskScore).toBe(12);
    expect(a.summary).toContain("Low behavioral risk");
    expect(a.factors).toHaveLength(3);
  });
  it("tolerates a terse score-only response (no summary/factors)", () => {
    const a = parseComputeAnalysis(JSON.stringify({ riskScore: 40 }));
    expect(a.riskScore).toBe(40);
    expect(a.summary).toBeNull();
    expect(a.factors).toEqual([]);
  });
  it("rejects a non-JSON or out-of-range score", () => {
    expect(() => parseComputeAnalysis("not json")).toThrow();
    expect(() => parseComputeAnalysis(JSON.stringify({ riskScore: 500 }))).toThrow();
  });
  it("caps factors at 6", () => {
    const many = JSON.stringify({ riskScore: 1, factors: Array.from({ length: 10 }, (_, i) => `f${i}`) });
    expect(parseComputeAnalysis(many).factors).toHaveLength(6);
  });
});

describe("safeComputeAnalysis", () => {
  it("returns null instead of throwing on bad input", () => {
    expect(safeComputeAnalysis("garbage")).toBeNull();
    expect(safeComputeAnalysis(null)).toBeNull();
    expect(safeComputeAnalysis(rich)?.riskScore).toBe(12);
  });
});

describe("contentFromResponseBytes", () => {
  it("pulls the model content string out of a base64 chat-completions body", () => {
    const body = Buffer.from(JSON.stringify({ choices: [{ message: { content: rich } }] })).toString("base64");
    expect(contentFromResponseBytes(body)).toBe(rich);
  });
  it("returns null for malformed bodies", () => {
    expect(contentFromResponseBytes("not-base64-json")).toBeNull();
    expect(contentFromResponseBytes(null)).toBeNull();
  });
});
