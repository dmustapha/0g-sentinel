import { describe, expect, it, vi } from "vitest";
import { runProofLock } from "../../lib/prooflock-client";

describe("operator mutation request", () => {
  it("sends only identity and lifecycle intent, never client-controlled provenance or policy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("data: {\"type\":\"complete\",\"result\":{}}\n\n", {
      status: 200, headers: { "content-type": "text/event-stream" },
    })); vi.stubGlobal("fetch", fetchMock);
    const identity = { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"11".repeat(20)}` as `0x${string}`, agentId: "7" };
    await runProofLock({ identity, mode: "RESEAL", expectedPriorVersion: "2", previousProofId: `0x${"22".repeat(32)}` }, "secret", vi.fn());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ identity, mode: "RESEAL", expectedPriorVersion: "2", previousProofId: `0x${"22".repeat(32)}` });
    for (const key of ["registryAddress", "policyVersion", "scanner", "scannerSoftwareVersion", "validForSeconds"]) expect(body).not.toHaveProperty(key);
    vi.unstubAllGlobals();
  });
});
