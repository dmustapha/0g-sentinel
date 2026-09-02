import { describe, expect, it } from "vitest";
import { parseComputeAnalysis, safeComputeAnalysis, contentFromResponseBytes, safeRiskEvidence } from "../../server/prooflock/compute-analysis";

// Builds a sealed compute REQUEST body (base64) the way strict-broker does: a chat request whose user
// message is the canonicalized context string carrying riskEvidence (the bundleForLlm shape).
function requestBodyWith(riskEvidence: unknown): string {
  const context = JSON.stringify({ identity: { agentId: "7" }, subject: { kind: "EOA" },
    deterministicChecks: [], riskEvidence });
  const request = { model: "z-ai/glm-5", messages: [
    { role: "system", content: "you are an auditor" }, { role: "user", content: context }] };
  return Buffer.from(JSON.stringify(request), "utf8").toString("base64");
}

describe("safeRiskEvidence (recovers structured evidence from the sealed request)", () => {
  const bundle = {
    address: "0xabc", isContract: false, nonce: 7, heuristicScore: 40,
    riskSignals: [
      { id: "sanctions", label: "Address on a sanctions list", strength: 1, hard: true, detail: "OFAC SDN" },
      { id: "approvals", label: "Granted 3 unlimited approvals", strength: 0.6, hard: false, detail: "count=3" },
    ],
    threat: { sanctioned: false, scamFlagged: true, sources: [
      { name: "OFAC", status: "CLEAR" }, { name: "ScamSniffer", status: "HIT", detail: "drainer blocklist" }] },
    contract: { bytecodeFlags: ["SELFDESTRUCT", "DELEGATECALL"], sourceFindings: ["honeypot: hidden fee"], codeRisk: 2 },
    evidenceCoverage: { explorer: "OK", rpc: "OK" },
  };

  it("recovers threat sources, bytecode flags, source findings, and signals", () => {
    const evidence = safeRiskEvidence(requestBodyWith(bundle));
    expect(evidence).not.toBeNull();
    expect(evidence!.scamFlagged).toBe(true);
    expect(evidence!.sources).toEqual([
      { name: "OFAC", status: "CLEAR" }, { name: "ScamSniffer", status: "HIT", detail: "drainer blocklist" }]);
    expect(evidence!.bytecodeFlags).toEqual(["SELFDESTRUCT", "DELEGATECALL"]);
    expect(evidence!.sourceFindings).toEqual(["honeypot: hidden fee"]);
    expect(evidence!.signals[0]).toEqual({ label: "Address on a sanctions list", strength: 1, hard: true, detail: "OFAC SDN" });
    expect(evidence!.signals).toHaveLength(2);
  });

  it("degrades to null on a legacy seal with no riskEvidence, or malformed input", () => {
    expect(safeRiskEvidence(requestBodyWith(undefined))).toBeNull();
    expect(safeRiskEvidence(Buffer.from('{"messages":[]}', "utf8").toString("base64"))).toBeNull();
    expect(safeRiskEvidence("not-base64-json!!!")).toBeNull();
    expect(safeRiskEvidence(undefined)).toBeNull();
    expect(safeRiskEvidence(null)).toBeNull();
  });

  it("fills safe defaults when threat/contract subtrees are absent", () => {
    const evidence = safeRiskEvidence(requestBodyWith({ riskSignals: [] }));
    expect(evidence).not.toBeNull();
    expect(evidence!.sanctioned).toBe(false);
    expect(evidence!.scamFlagged).toBe(false);
    expect(evidence!.sources).toEqual([]);
    expect(evidence!.bytecodeFlags).toEqual([]);
    expect(evidence!.signals).toEqual([]);
  });
});

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
