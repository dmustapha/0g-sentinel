import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ProofLockRunnerDependencies,
  RunnerInput,
} from "../../frontend/server/prooflock/runner";

type OperatorModule = Readonly<{
  createProofLockDependencies(): Promise<ProofLockRunnerDependencies> | ProofLockRunnerDependencies;
}>;

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Usage: ts-node scripts/prooflock/run.ts <operator-input.json>");
  const input = parseInput(readFileSync(inputPath, "utf8"));
  const dependencies = await loadOperatorDependencies();
  const { createProofLockRunner } = await import("../../frontend/server/prooflock/runner.js");
  const result = await createProofLockRunner(dependencies).run(input, reportStage);
  process.stdout.write(`${JSON.stringify(result, bigintReplacer)}\n`);
}

function parseInput(raw: string): RunnerInput {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("Operator input is not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Operator input must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  if (record.expectedPriorVersion !== undefined) {
    if (typeof record.expectedPriorVersion !== "string" || !/^[1-9]\d*$/.test(record.expectedPriorVersion)) {
      throw new Error("expectedPriorVersion must be a positive decimal string");
    }
    record.expectedPriorVersion = BigInt(record.expectedPriorVersion);
  }
  return record as RunnerInput;
}

async function loadOperatorDependencies(): Promise<ProofLockRunnerDependencies> {
  const path = process.env.PROOFLOCK_OPERATOR_MODULE;
  if (!path || !isAbsolute(path)) throw new Error("PROOFLOCK_OPERATOR_MODULE must be an absolute path");
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Operator module must be a regular file");
  const loaded = await import(pathToFileURL(path).href) as Partial<OperatorModule>;
  if (typeof loaded.createProofLockDependencies !== "function") {
    throw new Error("Operator module must export createProofLockDependencies()");
  }
  return await loaded.createProofLockDependencies();
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
