import { readFileSync } from "node:fs";

import type { OperatorRequestInput } from "../../frontend/server/prooflock/api";
import type { AgentIdentity, Bytes32, HexAddress } from "../../frontend/server/prooflock/types";

const ALLOWED_KEYS = new Set(["identity", "mode", "expectedPriorVersion", "previousProofId"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9]\d*)$/;

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Usage: npm run prooflock:run -- <operator-input.json>");
  const input = parseInput(readFileSync(inputPath, "utf8"));
  const { loadProofLockRunner } = await import("../../frontend/server/prooflock/operator.js");
  const result = await (await loadProofLockRunner()).run(input, reportStage);
  process.stdout.write(`${JSON.stringify(result, bigintReplacer)}\n`);
}

function parseInput(raw: string): OperatorRequestInput {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("Operator input is not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Operator input must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`Operator input contains forbidden field: ${key}`);
  }
  const identity = parseIdentity(record.identity);
  if (record.mode !== "SEAL" && record.mode !== "RESEAL") throw new Error("mode must be SEAL or RESEAL");
  const expectedPriorVersion = optionalVersion(record.expectedPriorVersion);
  const previousProofId = optionalBytes32(record.previousProofId);
  return Object.freeze({ identity, mode: record.mode, ...(expectedPriorVersion === undefined ? {} : { expectedPriorVersion }),
    ...(previousProofId === undefined ? {} : { previousProofId }) });
}

function parseIdentity(value: unknown): AgentIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("identity must be an object");
  const identity = value as Record<string, unknown>;
  const keys = Object.keys(identity);
  if (keys.some((key) => !["namespace", "chainId", "registryAddress", "agentId"].includes(key))) {
    throw new Error("identity contains an unknown field");
  }
  if (identity.namespace !== "eip155" || identity.chainId !== 16661
    || typeof identity.registryAddress !== "string" || !ADDRESS.test(identity.registryAddress)
    || identity.registryAddress.toLowerCase() !== "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432"
    || typeof identity.agentId !== "string" || !DECIMAL.test(identity.agentId)) {
    throw new Error("identity must name a canonical 0G mainnet ERC-8004 agent");
  }
  return Object.freeze({ namespace: "eip155", chainId: 16661,
    registryAddress: identity.registryAddress as HexAddress, agentId: identity.agentId });
}

function optionalVersion(value: unknown): bigint | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error("expectedPriorVersion must be a positive decimal string");
  }
  return BigInt(value);
}

function optionalBytes32(value: unknown): Bytes32 | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !BYTES32.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error("previousProofId must be a nonzero bytes32 value");
  }
  return value.toLowerCase() as Bytes32;
}

function reportStage(stage: string): void {
  process.stderr.write(`${JSON.stringify({ stage })}\n`);
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

main().catch((error: unknown) => {
  const failure = error instanceof Error ? error : new Error("Unknown ProofLock runner failure");
  process.stderr.write(`${JSON.stringify({ error: failure.name, message: failure.message })}\n`);
  process.exitCode = 1;
});
