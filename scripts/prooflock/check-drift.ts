import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import {
  compareDriftFingerprints,
  type DriftFingerprint,
} from "../../frontend/server/prooflock/drift";
import type { Bytes32 } from "../../frontend/server/prooflock/types";

type DriftOperator = Readonly<{
  readSealedFingerprint(identityKey: Bytes32): Promise<DriftFingerprint>;
  resolveCurrentFingerprint(identityKey: Bytes32): Promise<DriftFingerprint>;
  markDrift(identityKey: Bytes32, reason: number): Promise<Readonly<{ transactionHash: Bytes32 }>>;
}>;
type OperatorModule = Readonly<{
  createProofLockDriftOperator(): Promise<DriftOperator> | DriftOperator;
}>;

async function main(): Promise<void> {
  const identityKey = parseIdentityKey(process.argv[2]);
  const mark = process.argv.slice(3).includes("--mark");
  const operator = await loadOperator();
  const [expected, current] = await Promise.all([
    operator.readSealedFingerprint(identityKey),
    operator.resolveCurrentFingerprint(identityKey),
  ]);
  const comparison = compareDriftFingerprints(expected, current);
  if (!comparison.drifted || !mark) return print({ mode: "ON_DEMAND", marked: false, ...comparison });
  const receipt = await operator.markDrift(identityKey, comparison.reason);
  print({ mode: "ON_DEMAND", marked: true, ...comparison, transactionHash: receipt.transactionHash });
}

function parseIdentityKey(value: string | undefined): Bytes32 {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error("Usage: ts-node scripts/prooflock/check-drift.ts <identity-key> [--mark]");
  }
  return value.toLowerCase() as Bytes32;
}

async function loadOperator(): Promise<DriftOperator> {
  const path = process.env.PROOFLOCK_OPERATOR_MODULE;
  if (!path || !isAbsolute(path)) throw new Error("PROOFLOCK_OPERATOR_MODULE must be an absolute path");
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Operator module must be a regular file");
  const loaded = await import(pathToFileURL(path).href) as Partial<OperatorModule>;
  if (typeof loaded.createProofLockDriftOperator !== "function") {
    throw new Error("Operator module must export createProofLockDriftOperator()");
  }
  return await loaded.createProofLockDriftOperator();
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

main().catch((error: unknown) => {
  const failure = error instanceof Error ? error : new Error("Unknown on-demand drift failure");
  process.stderr.write(`${JSON.stringify({ error: failure.name, message: failure.message })}\n`);
  process.exitCode = 1;
});
