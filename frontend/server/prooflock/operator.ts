import { markProofLockDrift, type RegistryChainAdapter } from "./chain";
import { runOnDemandDriftCheck, type DriftFingerprint } from "./drift";
import * as productionOperator from "./production-operator";
import { createProofLockRunner, type ProofLockRunnerDependencies, type RunnerInput,
  type RunnerProgress, type RunnerTerminalResult, type RunnerStage } from "./runner";
import type { Bytes32 } from "./types";
import type { DriftRunner, OperatorRequestInput, StreamRunner } from "./api";
import type { RecoveryRunner } from "./api";
import type { ProductionOperatorBinding } from "./production-operator";

type DriftOperator = Readonly<{
  chainAdapter: RegistryChainAdapter; registryAddress: `0x${string}`; confirmations: number; timeoutMs: number;
  verifyAuthority(): Promise<void>;
  readSealedSnapshot(identityKey: Bytes32): Promise<Readonly<{ identityKey: Bytes32; version: bigint; fingerprint: DriftFingerprint }>>;
  resolveCurrentFingerprint(identityKey: Bytes32): Promise<DriftFingerprint>;
}>;
type OperatorModule = Readonly<{
  createProofLockDependencies(): Promise<ProofLockRunnerDependencies> | ProofLockRunnerDependencies;
  createProofLockDriftOperator(): Promise<DriftOperator> | DriftOperator;
  createProofLockRecoveryOperator(): Promise<RecoveryRunner> | RecoveryRunner;
  readProductionOperatorBinding(): ProductionOperatorBinding;
}>;

export async function loadProofLockRunner(): Promise<StreamRunner> {
  const loaded = await loadModule();
  if (typeof loaded.createProofLockDependencies !== "function") throw new Error("Operator runner is unavailable");
  if (typeof loaded.readProductionOperatorBinding !== "function") throw new Error("Operator binding is unavailable");
  const runner = createProofLockRunner(await loaded.createProofLockDependencies());
  return bindOperatorRunner(runner, loaded.readProductionOperatorBinding());
}

export async function loadProofLockRecovery(signal?: AbortSignal): Promise<RecoveryRunner> {
  signal?.throwIfAborted();
  const loaded = await abortable(loadModule(), signal);
  if (typeof loaded.createProofLockRecoveryOperator !== "function") throw new Error("Recovery operator is unavailable");
  const recovery = await abortable(Promise.resolve(loaded.createProofLockRecoveryOperator()), signal);
  signal?.throwIfAborted(); return recovery;
}

type FullRunner = Readonly<{ run(input: RunnerInput, report?: (stage: RunnerStage) => void,
  signal?: AbortSignal, reportProgress?: (progress: RunnerProgress) => void): Promise<RunnerTerminalResult | unknown> }>;

export function bindOperatorRunner(runner: FullRunner, binding: ProductionOperatorBinding): StreamRunner {
  return Object.freeze({ run: (request: OperatorRequestInput, report, signal, reportProgress) => runner.run({
    ...request, registryAddress: binding.registryAddress, scanner: binding.scanner,
    scannerSoftwareVersion: binding.scannerSoftwareVersion, policyVersion: binding.policyVersion,
    validForSeconds: binding.validForSeconds,
  }, report, signal, reportProgress) });
}

export async function loadProofLockDrift(): Promise<DriftRunner> {
  const loaded = await loadModule();
  if (typeof loaded.createProofLockDriftOperator !== "function") throw new Error("Drift operator is unavailable");
  const operator = await loaded.createProofLockDriftOperator();
  return Object.freeze({ run: async (identityKey, mark) => {
    if (mark) await operator.verifyAuthority();
    return runOnDemandDriftCheck({
    readSealedSnapshot: operator.readSealedSnapshot,
    resolveCurrentFingerprint: operator.resolveCurrentFingerprint,
    markDrift: (request) => markProofLockDrift(operator.chainAdapter, { registryAddress: operator.registryAddress, ...request },
      { confirmations: operator.confirmations, timeoutMs: operator.timeoutMs }),
    }, identityKey as Bytes32, mark);
  } });
}

async function loadModule(): Promise<Partial<OperatorModule>> {
  return productionOperator;
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation; signal.throwIfAborted();
  return Promise.race([operation, new Promise<never>((_, reject) => signal.addEventListener("abort",
    () => reject(signal.reason), { once: true }))]);
}
