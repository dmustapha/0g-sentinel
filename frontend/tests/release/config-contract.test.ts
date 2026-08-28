import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PUBLIC_V2 = [
  "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_RPC_URL", "NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS",
  "NEXT_PUBLIC_AGENT_GATE_V2_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_CONSUMER_ADDRESS",
  "NEXT_PUBLIC_PROOFLOCK_ADMIN_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_SCANNER_ADDRESS",
  "NEXT_PUBLIC_PROOFLOCK_GUARDIAN_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_CUSTODY_CONSTRAINT",
  "NEXT_PUBLIC_PROOFLOCK_VALIDATOR_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_VALIDATOR_VERSION",
  "NEXT_PUBLIC_PROOFLOCK_POLICY_VERSION", "NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID",
];
const SERVER_V2 = ["PROOFLOCK_REGISTRY_V2_FROM_BLOCK", "PROOFLOCK_CONSUMER_ADDRESS"];
const OPERATOR_V2 = [
  "SENTINEL_0G_PRIVATE_KEY", "PROOFLOCK_GUARDIAN_PRIVATE_KEY", "PROOFLOCK_COMPUTE_PRIVATE_KEY",
  "PROOFLOCK_SCANNER_SOFTWARE_VERSION", "PROOFLOCK_POLICY_VERSION",
  "PROOFLOCK_COMPUTE_PROVIDER", "PROOFLOCK_COMPUTE_MODEL",
  "PROOFLOCK_STATE_DIRECTORY", "PROOFLOCK_SPEND_AUTHORIZED",
  "PROOFLOCK_CHAIN_CONFIRMATIONS", "PROOFLOCK_TRANSACTION_TIMEOUT_MS",
];
const DEPLOY_V2 = [
  "PROOFLOCK_ADMIN_ADDRESS", "PROOFLOCK_SCANNER_ADDRESS", "PROOFLOCK_GUARDIAN_ADDRESS",
  "PROOFLOCK_MAX_BEHAVIORAL_SCORE", "PROOFLOCK_MAX_CODE_RISK", "PROOFLOCK_REQUIRED_COVERAGE",
  "PROOFLOCK_MINIMUM_POLICY_VERSION", "PROOFLOCK_MAXIMUM_AGE_SECONDS", "PROOFLOCK_DEPLOY_CONFIRMATIONS",
];

describe("release configuration and legacy boundary", () => {
  it.each([".env.example", "../.env.example"])("documents every active public V2 variable in %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    for (const name of PUBLIC_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
    for (const name of SERVER_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
    for (const name of OPERATOR_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
    expect(text).not.toMatch(/^PROOFLOCK_OPERATOR_MODULE=/m);
  });

  it.each([".env.example", "../.env.example"])("documents all nine V2 deployment inputs in %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(DEPLOY_V2).toHaveLength(9);
    for (const name of DEPLOY_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
    expect(text).not.toMatch(/^PROOFLOCK_ERC8004_IDENTITY_REGISTRY_ADDRESS=/m);
  });

  it("never falls back from AgentGateV2 to a legacy gate", () => {
    const text = readFileSync(resolve(process.cwd(), "lib/contracts.ts"), "utf8");
    expect(text).not.toContain("?? process.env.NEXT_PUBLIC_AGENT_GATE_ADDRESS");
    expect(text).not.toContain("readGateDecision");
    expect(text).not.toContain("simulateConsumerAction");
  });

  it("guards verifier admission through the bound consumer predicate", () => {
    const text = readFileSync(resolve(process.cwd(), "components/VerifyEvidenceButton.tsx"), "utf8");
    expect(text).toContain("admittedConsumerState");
    expect(text).not.toMatch(/gate\.status === "VERIFIED" && gate\.allowed/);
  });

  it.each(["components/ScanInput.tsx", "components/RescanButton.tsx"])("keeps provenance policy out of browser mutation payloads in %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    for (const field of ["registryAddress:", "scanner:", "scannerSoftwareVersion:", "policyVersion:", "validForSeconds:"]) expect(text).not.toContain(field);
  });

  it("removes the unused legacy share-card claim surface", () => {
    expect(() => readFileSync(resolve(process.cwd(), "components/ShareCard.tsx"), "utf8")).toThrow();
  });

  it.each(["../scripts/prooflock/run.ts", "../scripts/prooflock/check-drift.ts"])(
    "loads the built-in production operator in %s",
    (path) => {
      const text = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(text).toContain("loadProofLock");
      expect(text).not.toContain("PROOFLOCK_OPERATOR_MODULE");
      expect(text).not.toContain("pathToFileURL");
    },
  );

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
