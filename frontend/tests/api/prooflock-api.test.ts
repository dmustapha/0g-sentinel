import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { authenticateOperator } from "../../server/prooflock/auth";
import { IdentityError } from "../../server/prooflock/errors";
import { ProofLockStageError } from "../../server/prooflock/runner";
import {
  apiErrorResponse,
  createDriftHandler,
  createProofLockReadHandlers,
  createProofLockStreamHandler,
  methodNotAllowedResponse,
  type ProofLockReadDependencies,
} from "../../server/prooflock/api";

const hex = (byte: string, size: number) => `0x${byte.repeat(size)}`;
const identityKey = hex("11", 32);
const proofId = hex("22", 32);

describe("operator authentication", () => {
  it.each([undefined, "", "Bearer", "Basic abc", "Bearer wrong", "Bearer wrong-but-longer"])(
    "rejects missing or invalid authorization without exposing the token (%s)",
    (authorization) => {
      const result = authenticateOperator(authorization, "correct-token");
      expect(result).toBe(false);
    },
  );

  it("accepts only an exact Bearer token", () => {
    expect(authenticateOperator("Bearer correct-token", "correct-token")).toBe(true);
    expect(authenticateOperator("bearer correct-token", "correct-token")).toBe(false);
  });

  it("fails closed when the configured token is empty", () => {
    expect(authenticateOperator("Bearer anything", "")).toBe(false);
  });
});

describe("structured API errors", () => {
  it("returns the stable schema without leaking the cause", async () => {
    const response = apiErrorResponse(new Error("https://secret-rpc.invalid?key=private"), {
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Required dependency is unavailable",
      stage: "READING_CHAIN_BACK",
      retryable: true,
      status: 503,
      requestId: "req_test",
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: {
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Required dependency is unavailable",
      stage: "READING_CHAIN_BACK",
      retryable: true,
      requestId: "req_test",
    } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a structured 405 for mutation methods on public routes", async () => {
    const response = methodNotAllowedResponse("READING_PROOF");
    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe("METHOD_NOT_ALLOWED");
  });
});

describe("public read handlers", () => {
  const identity = {
    identity: { namespace: "eip155", chainId: 16661, registryAddress: hex("80", 20), agentId: "7" },
    owner: hex("aa", 20), agentWallet: hex("bb", 20), agentURI: "https://example.com/card.json",
    registrationDigest: hex("33", 32), sourceBlockNumber: "100", sourceBlockHash: hex("44", 32),
    card: { type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", registrations: [] },
  } as const;
  const record = {
    identityKey, subject: hex("bb", 20), envelopeDigest: hex("33", 32), storageRoot: hex("44", 32),
    computeRoot: hex("55", 32), artifactHash: hex("66", 32), runtimeCodeHash: hex("77", 32),
    version: 1n, issuedAt: 10n, validUntil: 20n, policyVersion: 1, behavioralScore: 10,
    codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0,
  } as const;

  function dependencies(overrides: Partial<ProofLockReadDependencies> = {}): ProofLockReadDependencies {
    return {
      registryAddress: hex("12", 20),
      resolveIdentity: vi.fn().mockResolvedValue(identity),
      readProofLock: vi.fn().mockResolvedValue(record),
      computeProofId: vi.fn().mockReturnValue(proofId),
      verifyStoredEvidence: vi.fn().mockResolvedValue({ envelope: { schema: "sentinel.prooflock/evidence-v1" }, retrievalVerified: true, networkProofVerified: false }),
      ...overrides,
    };
  }

  it("resolves an ERC-8004 identity with bounded strict input", async () => {
    const deps = dependencies();
    const response = await createProofLockReadHandlers(deps).resolve(
      new Request("https://sentinel.test/api/v1/identities/resolve?agentId=7"),
    );
    expect(response.status).toBe(200);
    expect(deps.resolveIdentity).toHaveBeenCalledWith("7", expect.any(AbortSignal));
    expect(response.headers.get("cache-control")).toBe("public, max-age=15, stale-while-revalidate=45");
  });

  it("maps a missing ERC-8004 token to a stable not-found error", async () => {
    const deps = dependencies({ resolveIdentity: vi.fn().mockRejectedValue(new IdentityError("AGENT_NOT_FOUND", "registry", false)) });
    const response = await createProofLockReadHandlers(deps).resolve(
      new Request("https://sentinel.test/api/v1/identities/resolve?agentId=7"),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("AGENT_NOT_FOUND");
  });

  it("rejects malformed identity keys before a chain read", async () => {
    const deps = dependencies();
    const response = await createProofLockReadHandlers(deps).proofLock("0x123", new Request("https://sentinel.test"));
    expect(response.status).toBe(400);
    expect(deps.readProofLock).not.toHaveBeenCalled();
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
  });

  it("treats a zero or mismatched onchain record as not found", async () => {
    const deps = dependencies({ readProofLock: vi.fn().mockResolvedValue({ ...record, identityKey: hex("99", 32) }) });
    const response = await createProofLockReadHandlers(deps).proofLock(identityKey, new Request("https://sentinel.test"));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("binds proofId and identityKey before returning verified Storage evidence", async () => {
    const deps = dependencies();
    const response = await createProofLockReadHandlers(deps).verifyProof(
      proofId,
      new Request(`https://sentinel.test/api/v1/proofs/${proofId}/verify?identityKey=${identityKey}`),
    );
    expect(response.status).toBe(200);
    expect(deps.verifyStoredEvidence).toHaveBeenCalledWith(record, expect.any(AbortSignal));
    const body = await response.json();
    expect(body.proofId).toBe(proofId);
    expect(body.storage.networkProofVerified).toBe(false);
  });

  it("rejects a proofId mismatch without retrieving Storage", async () => {
    const deps = dependencies({ computeProofId: vi.fn().mockReturnValue(hex("99", 32)) });
    const response = await createProofLockReadHandlers(deps).verifyProof(
      proofId,
      new Request(`https://sentinel.test?identityKey=${identityKey}`),
    );
    expect(response.status).toBe(404);
    expect(deps.verifyStoredEvidence).not.toHaveBeenCalled();
  });
});

describe("admin ProofLock stream", () => {
  it("authenticates before loading an operator or constructing a stream", async () => {
    const loadRunner = vi.fn();
    const response = await createProofLockStreamHandler({ operatorToken: "secret", loadRunner })(
      new Request("https://sentinel.test", { method: "POST", headers: { authorization: "Bearer wrong" }, body: "{}" }),
    );
    expect(response.status).toBe(401);
    expect(loadRunner).not.toHaveBeenCalled();
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("streams only stages and a terminal result for one synchronous run", async () => {
    const run = vi.fn(async (_input, report, _signal?: AbortSignal) => {
      report("VALIDATING_IDENTITY");
      report("SEALED");
      return { stage: "SEALED", chain: { transactionHash: hex("aa", 32) } };
    });
    const request = new Request("https://sentinel.test", {
        method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({ identity: { namespace: "eip155", chainId: 16661, registryAddress: hex("80", 20), agentId: "7" }, registryAddress: hex("12", 20), policyVersion: 1, scanner: hex("13", 20), scannerSoftwareVersion: "1.0.0", validForSeconds: 604800, mode: "SEAL" }),
      });
    const response = await createProofLockStreamHandler({ operatorToken: "secret", loadRunner: async () => ({ run }) })(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const frames = await response.text();
    expect(frames).toContain('"type":"stage","stage":"VALIDATING_IDENTITY"');
    expect(frames).toContain('"type":"complete"');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[2]).toBe(request.signal);
  });

  it("uses the runner stage and stable code for terminal Compute errors", async () => {
    const run = vi.fn().mockRejectedValue(new ProofLockStageError("RUNNING_COMPUTE", "private provider detail"));
    const response = await createProofLockStreamHandler({ operatorToken: "secret", loadRunner: async () => ({ run }) })(
      new Request("https://sentinel.test", { method: "POST", headers: { authorization: "Bearer secret" }, body: JSON.stringify({ mode: "SEAL" }) }),
    );
    const frames = await response.text();
    expect(frames).toContain('"code":"COMPUTE_UNVERIFIED"');
    expect(frames).toContain('"stage":"RUNNING_COMPUTE"');
    expect(frames).not.toContain("private provider detail");
  });
});

describe("admin on-demand drift", () => {
  it("rejects unauthenticated mutation before loading the operator", async () => {
    const loadDrift = vi.fn();
    const response = await createDriftHandler({ operatorToken: "secret", loadDrift })(
      identityKey, new Request("https://sentinel.test", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(401);
    expect(loadDrift).not.toHaveBeenCalled();
  });

  it("runs an explicit on-demand drift check without marking by default", async () => {
    const run = vi.fn().mockResolvedValue({ mode: "ON_DEMAND", drifted: false, marked: false });
    const response = await createDriftHandler({ operatorToken: "secret", loadDrift: async () => ({ run }) })(
      identityKey,
      new Request("https://sentinel.test", { method: "POST", headers: { authorization: "Bearer secret" }, body: "{}" }),
    );
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(identityKey, false);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("legacy spend safety", () => {
  it("removes background enqueue and waitUntil from discovery", async () => {
    const source = await readFile(resolve(process.cwd(), "app/api/discover/route.ts"), "utf8");
    expect(source).not.toMatch(/waitUntil|enqueueAddresses|@scanner\/queue/);
    expect(source).toContain("ProofLocked");
  });

  it.each(["behavioral", "code", "stream", "queue", "inft"])("disables legacy scan route %s", async (name) => {
    const source = await readFile(resolve(process.cwd(), `app/api/scan/${name}/route.ts`), "utf8");
    expect(source).toContain("goneResponse");
    expect(source).not.toMatch(/runFullScan|runCodeScanOnly|enqueueAddresses|getQueueStatus/);
  });

  it("disables the legacy fine-tuning mutation", async () => {
    const source = await readFile(resolve(process.cwd(), "app/api/fine-tuning/route.ts"), "utf8");
    expect(source).toContain("goneResponse");
    expect(source).not.toMatch(/uploadEvidence|privateKey|ZERO_G_PRIVATE_KEY/);
  });
});
