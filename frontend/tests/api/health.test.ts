import { describe, expect, it, vi } from "vitest";

import { checkSystemPulse, createHealthHandler, type HealthProbeDependencies } from "../../lib/pulse";
import { assertZeroGMainnetRpc, guardedZeroGMainnetRead } from "../../server/prooflock/rpc";
import { probeComputeService } from "../../server/prooflock/health";

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
      expect(new Date(probe.observedAt).toISOString()).toBe(probe.observedAt);
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

describe("0G RPC chain guard", () => {
  it("uses raw eth_chainId and accepts only 16661", async () => {
    const rpcFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: "sentinel-chain-id", result: "0x4115" })));
    await expect(assertZeroGMainnetRpc("https://rpc.example", new AbortController().signal, rpcFetch)).resolves.toBeUndefined();
    expect(JSON.parse(String(rpcFetch.mock.calls[0]?.[1]?.body))).toEqual({ jsonrpc: "2.0", id: "sentinel-chain-id", method: "eth_chainId", params: [] });
  });

  it("rejects a healthy-looking RPC on the wrong chain", async () => {
    const rpcFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: "sentinel-chain-id", result: "0x1" })));
    await expect(assertZeroGMainnetRpc("https://rpc.example", new AbortController().signal, rpcFetch)).rejects.toThrow("chain");
  });

  it("does not perform a downstream contract read after a wrong-chain response", async () => {
    const rpcFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: "sentinel-chain-id", result: "0x1" })));
    const contractRead = vi.fn().mockResolvedValue("0x1234");
    await expect(guardedZeroGMainnetRead("https://rpc.example", new AbortController().signal,
      contractRead, rpcFetch)).rejects.toThrow("chain");
    expect(contractRead).not.toHaveBeenCalled();
  });
});

describe("read-only Compute health policy", () => {
  const provider = "0x1111111111111111111111111111111111111111";
  const signer = "0x2222222222222222222222222222222222222222";
  const service = (additional: Record<string, unknown>, acknowledged = true) => ({
    provider, url: "https://compute.example", model: "model-tee",
    additionalInfo: JSON.stringify(additional), teeSignerAddress: signer,
    teeSignerAcknowledged: acknowledged,
  });
  const broker = (value: unknown) => ({ listService: vi.fn().mockResolvedValue([value]) });

  it("accepts only an acknowledged decentralized separated model TEE without spend methods", async () => {
    const readOnly = broker(service({ ProviderType: "decentralized", TargetSeparated: true, TargetTeeAddress: signer }));
    const result = await probeComputeService(readOnly, provider, "model-tee", new AbortController().signal);
    expect(result).toMatchObject({ proofClass: "DECENTRALIZED_MODEL_TEE", expectedSigner: signer,
      observation: "SERVICE_DISCOVERY", paidInference: false, inferenceExecuted: false });
    expect(Object.keys(readOnly)).toEqual(["listService"]);
  });

  it.each([
    ["centralized", service({ ProviderType: "centralized", TargetSeparated: true, TargetTeeAddress: signer })],
    ["unseparated", service({ ProviderType: "decentralized", TargetSeparated: false, TargetTeeAddress: signer })],
    ["unacknowledged", service({ ProviderType: "decentralized", TargetSeparated: true, TargetTeeAddress: signer }, false)],
  ])("rejects %s Compute services", async (_label, value) => {
    await expect(probeComputeService(broker(value), provider, "model-tee", new AbortController().signal)).rejects.toThrow();
  });
});
