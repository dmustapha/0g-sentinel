import { describe, expect, it, vi } from "vitest";

import { checkSystemPulse, createHealthHandler, type HealthProbeDependencies } from "../../lib/pulse";

const ok = (detail: Record<string, unknown> = {}) => async () => detail;

function dependencies(overrides: Partial<HealthProbeDependencies> = {}): HealthProbeDependencies {
  return {
    rpc: ok({ chainId: 16661 }), identity: ok({ bytecode: true, read: true }),
    registry: ok({ bytecode: true, read: true }), gate: ok({ bytecode: true, registryPointer: true }),
    compute: ok({ model: "model", provider: "provider", paidInference: false }),
    storage: ok({ root: `0x${"11".repeat(32)}`, retrievalVerified: true, networkProofVerified: false }),
    ...overrides,
  };
}

describe("ProofLock health", () => {
  it("reports every dependency independently with latency and does not spend on Compute", async () => {
    const compute = vi.fn(ok({ paidInference: false }));
    const pulse = await checkSystemPulse(dependencies({ compute }));
    expect(pulse.status).toBe("HEALTHY");
    expect(Object.keys(pulse.dependencies)).toEqual(["rpc", "identity", "registry", "gate", "compute", "storage"]);
    for (const probe of Object.values(pulse.dependencies)) {
      expect(probe.status).toBe("HEALTHY");
      expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when a required dependency fails", async () => {
    const handler = createHealthHandler(dependencies({ storage: async () => { throw new Error("indexer secret"); } }));
    const response = await handler(new Request("https://sentinel.test/api/health"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("DEGRADED");
    expect(body.dependencies.storage.status).toBe("UNHEALTHY");
    expect(JSON.stringify(body)).not.toContain("indexer secret");
  });

  it("never turns missing configuration into green", async () => {
    const response = await createHealthHandler(dependencies({ storage: async () => null }))(
      new Request("https://sentinel.test/api/health"),
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.dependencies.storage.status).toBe("UNKNOWN");
    expect(body.status).toBe("DEGRADED");
  });

  it("honors request abort without reporting success", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await createHealthHandler(dependencies())(
      new Request("https://sentinel.test/api/health", { signal: controller.signal }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe("DEGRADED");
  });
});
