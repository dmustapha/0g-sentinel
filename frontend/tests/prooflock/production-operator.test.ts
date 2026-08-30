import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProofLockDependencies,
  createProofLockDriftOperator,
  assertProductionSealableSubject,
  parseContractCodeRisk,
  readProductionOperatorConfig,
} from "../../server/prooflock/production-operator";
import { bindOperatorRunner } from "../../server/prooflock/operator";
import type { RunnerInput } from "../../server/prooflock/runner";

const SCANNER_KEY = `0x${"11".repeat(32)}`;
const GUARDIAN_KEY = `0x${"22".repeat(32)}`;
const COMPUTE_KEY = `0x${"33".repeat(32)}`;
const COMPUTE = "0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB";
const SCANNER = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const GUARDIAN = "0x1563915e194D8CfBA1943570603F7606A3115508";
const REGISTRY = "0x1000000000000000000000000000000000000001";
const PROVIDER = "0x2000000000000000000000000000000000000002";
const ADMIN = "0x3000000000000000000000000000000000000003";
const FLOW = "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526";
const directories: string[] = [];

async function validEnv() {
  const state = await mkdtemp(join(tmpdir(), "prooflock-production-"));
  directories.push(state);
  return {
    ZERO_G_RPC: "https://evmrpc.0g.ai",
    ZERO_G_STORAGE_INDEXER: "https://indexer-storage-turbo.0g.ai",
    PROOFLOCK_STORAGE_FLOW_ADDRESS: FLOW,
    PROOFLOCK_REGISTRY_V2_ADDRESS: REGISTRY,
    PROOFLOCK_ADMIN_ADDRESS: ADMIN,
    PROOFLOCK_SCANNER_ADDRESS: SCANNER,
    PROOFLOCK_GUARDIAN_ADDRESS: GUARDIAN,
    PROOFLOCK_SCANNER_SOFTWARE_VERSION: "sentinel-prooflock-v2",
    PROOFLOCK_POLICY_VERSION: "1",
    PROOFLOCK_COMPUTE_PROVIDER: PROVIDER,
    PROOFLOCK_COMPUTE_MODEL: "model-tee",
    PROOFLOCK_STATE_DIRECTORY: state,
    PROOFLOCK_SPEND_AUTHORIZED: "true",
    PROOFLOCK_CHAIN_CONFIRMATIONS: "3",
    PROOFLOCK_TRANSACTION_TIMEOUT_MS: "60000",
    PROOFLOCK_RECOVERY_LIVENESS_GRACE_MS: "300000",
    PROOFLOCK_OPERATOR_MAX_CONCURRENCY: "2",
    PROOFLOCK_OPERATOR_RATE_WINDOW_MS: "60000",
    PROOFLOCK_OPERATOR_RATE_LIMIT: "4",
    PROOFLOCK_OPERATOR_DAILY_CEREMONY_LIMIT: "20",
    PROOFLOCK_OPERATOR_DAILY_COST_UNITS_LIMIT: "40",
    SENTINEL_0G_PRIVATE_KEY: SCANNER_KEY,
    PROOFLOCK_GUARDIAN_PRIVATE_KEY: GUARDIAN_KEY,
    PROOFLOCK_COMPUTE_PRIVATE_KEY: COMPUTE_KEY,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("production ProofLock operator", () => {
  it("exports both built-in production factories", () => {
    expect(createProofLockDependencies).toBeTypeOf("function");
    expect(createProofLockDriftOperator).toBeTypeOf("function");
  });

  it("requires explicit Node 24, durable state, spend consent, signers, and mainnet dependencies", async () => {
    const env = await validEnv();
    const config = readProductionOperatorConfig(env, "24.10.0");
    expect(config.scannerAddress).toBe(SCANNER);
    expect(config.guardianAddress).toBe(GUARDIAN);
    expect(config.computeAddress).toBe(COMPUTE);
    expect(config.stateDirectory).toBe(env.PROOFLOCK_STATE_DIRECTORY);
    expect(config.confirmations).toBe(3);
    expect(config.recoveryLivenessGraceMs).toBe(300000);
    expect(config.spendAuthorized).toBe(true);
    expect(config.operationLimits).toEqual({ maxConcurrency: 2, globalMaxConcurrency: 2, rateWindowMs: 60000,
      rateLimit: 4, dailyCeremonyLimit: 20, dailyCostUnitsLimit: 40 });

    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_STATE_DIRECTORY: undefined }, "24.10.0"))
      .toThrow(/STATE_DIRECTORY/);
    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_SPEND_AUTHORIZED: "false" }, "24.10.0"))
      .toThrow(/SPEND_AUTHORIZED/);
    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_OPERATOR_RATE_LIMIT: undefined }, "24.10.0"))
      .toThrow(/PROOFLOCK_OPERATOR_RATE_LIMIT/);
    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_OPERATOR_RATE_LIMIT: "0" }, "24.10.0"))
      .toThrow(/PROOFLOCK_OPERATOR_RATE_LIMIT/);
    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_RECOVERY_LIVENESS_GRACE_MS: undefined }, "24.10.0"))
      .toThrow(/PROOFLOCK_RECOVERY_LIVENESS_GRACE_MS/);
    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_RECOVERY_LIVENESS_GRACE_MS: "30000" }, "24.10.0"))
      .toThrow(/PROOFLOCK_RECOVERY_LIVENESS_GRACE_MS/);
    expect(() => readProductionOperatorConfig(env, "22.0.0")).toThrow(/Node 24/);
    expect(() => readProductionOperatorConfig({ ...env, ZERO_G_RPC: "https://evmrpc-testnet.0g.ai" }, "24.10.0"))
      .toThrow(/mainnet RPC/);
  });

  it("rejects a configured scanner or guardian that does not match its signing key", async () => {
    const env = await validEnv();
    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_SCANNER_ADDRESS: GUARDIAN }, "24.10.0"))
      .toThrow(/scanner signing key/);
    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_GUARDIAN_PRIVATE_KEY: SCANNER_KEY,
      PROOFLOCK_GUARDIAN_ADDRESS: SCANNER }, "24.10.0"))
      .toThrow(/distinct/);
    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_COMPUTE_PRIVATE_KEY: SCANNER_KEY }, "24.10.0"))
      .toThrow(/Compute payer key must remain distinct/);
    expect(() => readProductionOperatorConfig({ ...env, PROOFLOCK_ADMIN_ADDRESS: COMPUTE }, "24.10.0"))
      .toThrow(/Compute payer key must remain distinct/);
  });

  it("refuses nested executable leases until AgentGate can enforce their live code", () => {
    expect(() => assertProductionSealableSubject({ kind: "EIP7702_DELEGATED_EOA" }, {})).toThrow(/not sealable/);
    expect(() => assertProductionSealableSubject({ kind: "CONTRACT" }, { proxyImplementation: PROVIDER })).toThrow(/not sealable/);
    expect(() => assertProductionSealableSubject({ kind: "CONTRACT" }, {})).not.toThrow();
  });

  it("maps signed contract-risk output into the onchain code-risk band", () => {
    expect(parseContractCodeRisk('{"riskScore":0}')).toBe(0);
    expect(parseContractCodeRisk('{"riskScore":30}')).toBe(1);
    expect(parseContractCodeRisk('{"riskScore":60}')).toBe(2);
    expect(parseContractCodeRisk('{"riskScore":100}')).toBe(2);
    expect(() => parseContractCodeRisk("not-json")).toThrow(/non-JSON/);
  });

  it("injects registry, scanner, software, policy, and TTL on the server", async () => {
    const progress = vi.fn();
    const run = vi.fn(async (input: RunnerInput, _report?: unknown, _signal?: unknown,
      reportProgress?: (value: unknown) => void) => { reportProgress?.({ type: "admission", recoveryId: "rec" }); return input; });
    const bound = bindOperatorRunner({ run }, { registryAddress: REGISTRY, scanner: SCANNER,
      scannerSoftwareVersion: "sentinel-prooflock-v2", policyVersion: 7, validForSeconds: 604800 });
    await bound.run({ identity: { namespace: "eip155", chainId: 16661,
      registryAddress: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", agentId: "42" }, mode: "SEAL" },
    undefined, undefined, progress);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ registryAddress: REGISTRY,
      scanner: SCANNER, scannerSoftwareVersion: "sentinel-prooflock-v2",
      policyVersion: 7, validForSeconds: 604800 }), undefined, undefined, progress);
    expect(progress).toHaveBeenCalledWith({ type: "admission", recoveryId: "rec" });
  });
});
