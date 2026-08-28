import { describe, expect, it } from "vitest";

import { assertRiskRecordBinding } from "../../server/prooflock/read-api";

describe("public ProofLock risk provenance", () => {
  const envelope = { verdict: { riskScore: 12, codeRisk: 1, label: "SAFE" as const } };

  it("binds both Gate-driving risk fields to stored evidence", () => {
    expect(() => assertRiskRecordBinding(envelope, { behavioralScore: 12, codeRisk: 1 })).not.toThrow();
    expect(() => assertRiskRecordBinding(envelope, { behavioralScore: 13, codeRisk: 1 })).toThrow(/risk verdict/);
    expect(() => assertRiskRecordBinding(envelope, { behavioralScore: 12, codeRisk: 0 })).toThrow(/risk verdict/);
  });
});
