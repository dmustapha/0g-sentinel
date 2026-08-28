import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readApi = vi.hoisted(() => ({
  createProductionReadDependencies: vi.fn(() => {
    throw new Error("production dependencies must not be constructed");
  }),
}));

vi.mock("../../server/prooflock/read-api", () => readApi);

import { GET as resolveIdentity } from "../../app/api/v1/identities/resolve/route";
import { GET as readProofLock } from "../../app/api/v1/prooflocks/[identityKey]/route";
import { GET as verifyProof } from "../../app/api/v1/proofs/[proofId]/verify/route";

const valid = `0x${"ab".repeat(32)}`;
const zero = `0x${"00".repeat(32)}`;
const originalRpc = process.env.ZERO_G_RPC;
const originalPublicRpc = process.env.NEXT_PUBLIC_RPC_URL;

describe("public read route validation order", () => {
  beforeEach(() => {
    delete process.env.ZERO_G_RPC;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    readApi.createProductionReadDependencies.mockClear();
  });

  afterEach(() => {
    if (originalRpc === undefined) delete process.env.ZERO_G_RPC;
    else process.env.ZERO_G_RPC = originalRpc;
    if (originalPublicRpc === undefined) delete process.env.NEXT_PUBLIC_RPC_URL;
    else process.env.NEXT_PUBLIC_RPC_URL = originalPublicRpc;
  });

  it("rejects a malformed agent ID before constructing identity dependencies", async () => {
    const response = await resolveIdentity(new Request("https://sentinel.test/api/v1/identities/resolve?agentId=01"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
    expect(readApi.createProductionReadDependencies).not.toHaveBeenCalled();
  });

  it("rejects a zero identity key before constructing ProofLock dependencies", async () => {
    const response = await readProofLock(new Request("https://sentinel.test"), { params: { identityKey: zero } });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
    expect(readApi.createProductionReadDependencies).not.toHaveBeenCalled();
  });

  it("rejects a malformed proof request before constructing verifier dependencies", async () => {
    const response = await verifyProof(
      new Request(`https://sentinel.test/api/v1/proofs/0x123/verify?identityKey=${valid}`),
      { params: { proofId: "0x123" } },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
    expect(readApi.createProductionReadDependencies).not.toHaveBeenCalled();
  });
});
