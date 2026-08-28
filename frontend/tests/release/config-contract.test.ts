import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PUBLIC_V2 = [
  "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_RPC_URL", "NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS",
  "NEXT_PUBLIC_AGENT_GATE_V2_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_CONSUMER_ADDRESS",
  "NEXT_PUBLIC_PROOFLOCK_VALIDATOR_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_VALIDATOR_VERSION",
  "NEXT_PUBLIC_PROOFLOCK_POLICY_VERSION", "NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID",
];
const SERVER_V2 = ["PROOFLOCK_REGISTRY_V2_FROM_BLOCK", "PROOFLOCK_CONSUMER_ADDRESS"];

describe("release configuration and legacy boundary", () => {
  it.each([".env.example", "../.env.example"])("documents every active public V2 variable in %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    for (const name of PUBLIC_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
    for (const name of SERVER_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("never falls back from AgentGateV2 to a legacy gate", () => {
    const text = readFileSync(resolve(process.cwd(), "lib/contracts.ts"), "utf8");
    expect(text).not.toContain("?? process.env.NEXT_PUBLIC_AGENT_GATE_ADDRESS");
    expect(text).not.toContain("readGateDecision");
    expect(text).not.toContain("simulateConsumerAction");
  });

  it.each(["app/api/v1/attestation/[address]/route.ts", "app/api/verify-evidence/route.ts"])("retires %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(text).toContain("goneResponse");
    expect(text).not.toContain("verified: true");
  });

  it("publishes the current fail-closed claim boundary", () => {
    const text = readFileSync(resolve(process.cwd(), "../README.md"), "utf8");
    expect(text).toContain("networkProofVerified: false");
    expect(text).toContain("inferenceExecuted: false");
    expect(text).toContain("Legacy V1");
    for (const claim of ["hosted 0G router fallback", "two independent AI inference pipelines", "immutable 9-field attestations"])
      expect(text).not.toContain(claim);
  });
});
