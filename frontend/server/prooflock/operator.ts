import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { markProofLockDrift, type RegistryChainAdapter } from "./chain";
import { runOnDemandDriftCheck, type DriftFingerprint } from "./drift";
import { createProofLockRunner, type ProofLockRunnerDependencies } from "./runner";
import type { Bytes32 } from "./types";
import type { DriftRunner, StreamRunner } from "./api";

type DriftOperator = Readonly<{
  chainAdapter: RegistryChainAdapter; registryAddress: `0x${string}`; confirmations: number; timeoutMs: number;
  readSealedSnapshot(identityKey: Bytes32): Promise<Readonly<{ identityKey: Bytes32; version: bigint; fingerprint: DriftFingerprint }>>;
  resolveCurrentFingerprint(identityKey: Bytes32): Promise<DriftFingerprint>;
}>;
type OperatorModule = Readonly<{
  createProofLockDependencies(): Promise<ProofLockRunnerDependencies> | ProofLockRunnerDependencies;
  createProofLockDriftOperator(): Promise<DriftOperator> | DriftOperator;
}>;

export async function loadProofLockRunner(): Promise<StreamRunner> {
  const loaded = await loadModule();
  if (typeof loaded.createProofLockDependencies !== "function") throw new Error("Operator runner is unavailable");
  return createProofLockRunner(await loaded.createProofLockDependencies());
}

export async function loadProofLockDrift(): Promise<DriftRunner> {
  const loaded = await loadModule();
  if (typeof loaded.createProofLockDriftOperator !== "function") throw new Error("Drift operator is unavailable");
  const operator = await loaded.createProofLockDriftOperator();
  return Object.freeze({ run: (identityKey, mark) => runOnDemandDriftCheck({
    readSealedSnapshot: operator.readSealedSnapshot,
    resolveCurrentFingerprint: operator.resolveCurrentFingerprint,
    markDrift: (request) => markProofLockDrift(operator.chainAdapter, { registryAddress: operator.registryAddress, ...request },
      { confirmations: operator.confirmations, timeoutMs: operator.timeoutMs }),
  }, identityKey as Bytes32, mark) });
}

async function loadModule(): Promise<Partial<OperatorModule>> {
  const path = process.env.PROOFLOCK_OPERATOR_MODULE;
  if (!path || !isAbsolute(path)) throw new Error("Operator module is not configured");
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Operator module is invalid");
  return await import(/* webpackIgnore: true */ pathToFileURL(path).href) as Partial<OperatorModule>;
}
