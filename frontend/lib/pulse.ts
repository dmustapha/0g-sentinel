// File: frontend/lib/pulse.ts
export type ProbeStatus = "HEALTHY" | "UNHEALTHY" | "UNKNOWN";
export type ProbeName = "rpc" | "identity" | "registry" | "gate" | "compute" | "storage";
export type ProbeResult = Readonly<{
  status: ProbeStatus; latencyMs: number; detail?: Readonly<Record<string, unknown>>;
}>;
export type HealthProbe = (signal: AbortSignal) => Promise<Readonly<Record<string, unknown>> | null>;
export type HealthProbeDependencies = Readonly<Record<ProbeName, HealthProbe>>;

export type PulseStatus = Readonly<{
  status: "HEALTHY" | "DEGRADED";
  dependencies: Readonly<Record<ProbeName, ProbeResult>>;
  chain: boolean; compute: boolean; storage: boolean; gate: boolean;
}>;

const names: readonly ProbeName[] = ["rpc", "identity", "registry", "gate", "compute", "storage"];

export async function checkSystemPulse(injected?: HealthProbeDependencies, signal?: AbortSignal): Promise<PulseStatus> {
  const dependencies = injected ?? await productionDependencies();
  const parent = signal ?? new AbortController().signal;
  const entries = await Promise.all(names.map(async (name) => [name, await probe(dependencies[name], parent)] as const));
  const results = Object.fromEntries(entries) as Record<ProbeName, ProbeResult>;
  const healthy = names.every((name) => results[name].status === "HEALTHY");
  return Object.freeze({
    status: healthy ? "HEALTHY" : "DEGRADED", dependencies: Object.freeze(results),
    chain: results.rpc.status === "HEALTHY" && results.registry.status === "HEALTHY",
    compute: results.compute.status === "HEALTHY", storage: results.storage.status === "HEALTHY",
    gate: results.gate.status === "HEALTHY",
  });
}

export function createHealthHandler(dependencies?: HealthProbeDependencies) {
  return async (request: Request): Promise<Response> => {
    const pulse = await checkSystemPulse(dependencies, request.signal).catch(() => degradedPulse());
    return new Response(JSON.stringify(pulse), {
      status: pulse.status === "HEALTHY" ? 200 : 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  };
}

async function probe(operation: HealthProbe, signal: AbortSignal): Promise<ProbeResult> {
  const started = performance.now();
  try {
    signal.throwIfAborted();
    const detail = await operation(signal);
    signal.throwIfAborted();
    return Object.freeze({ status: detail ? "HEALTHY" : "UNKNOWN", latencyMs: elapsed(started), ...(detail ? { detail } : {}) });
  } catch {
    return Object.freeze({ status: "UNHEALTHY", latencyMs: elapsed(started) });
  }
}

async function productionDependencies(): Promise<HealthProbeDependencies> {
  const { createProductionHealthProbes } = await import("../server/prooflock/health");
  return createProductionHealthProbes();
}

function elapsed(started: number): number { return Math.max(0, Math.round((performance.now() - started) * 100) / 100); }

function degradedPulse(): PulseStatus {
  const unknown = Object.fromEntries(names.map((name) => [name, { status: "UNKNOWN", latencyMs: 0 }])) as Record<ProbeName, ProbeResult>;
  return { status: "DEGRADED", dependencies: unknown, chain: false, compute: false, storage: false, gate: false };
}
