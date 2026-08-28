import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { authenticateOperator } from "../../server/prooflock/auth";
import { IdentityError, ProofMismatchError } from "../../server/prooflock/errors";
import { ProofLockStageError, computeProofRoot } from "../../server/prooflock/runner";
import { canonicalizeEvidence, hashCanonical, receiptDigest } from "../../server/prooflock/canonical";
import { REGISTRY_V2_INTERFACE, computeIdentityKey, computeProofLockId } from "../../server/prooflock/chain";
import { enrichProofLockDetail, recoverHistoricalProofLock } from "../../server/prooflock/read-api";
import { ERC8004_IDENTITY_REGISTRY, type Bytes32, type EvidenceEnvelopeV1 } from "../../server/prooflock/types";
import {
  apiErrorResponse,
  createDriftHandler,
  createProofLockReadHandlers,
  createProofLockStreamHandler,
  methodNotAllowedResponse,
  type ProofLockReadDependencies,
} from "../../server/prooflock/api";

const hex = (byte: string, size: number): `0x${string}` => `0x${byte.repeat(size)}`;
const identityKey = hex("11", 32);
const proofId = hex("22", 32);
const operatorToken = "s".repeat(32);

function detailEnvelope(agentId = "7"): EvidenceEnvelopeV1 {
  const registryAddress = ERC8004_IDENTITY_REGISTRY;
  return {
    schema: "sentinel.prooflock/evidence-v1", proofClass: "COMPUTE_VERIFIED", schemaVersion: 1,
    policyVersion: 1, coverage: { preStorageMask: 0x5f, requiredSealMask: 0x7f,
      identityValidated: true, subjectClassified: true, deterministicChecksRun: true,
      behavioralComputeVerified: true, codeCompute: { status: "NOT_APPLICABLE", reason: "EOA" },
      evidenceStorage: "PENDING_EXTERNAL_COMMITMENT", policyEvaluated: true },
    identity: { namespace: "eip155", chainId: 16661, registryAddress, agentId,
      owner: hex("aa", 20) as `0x${string}`, agentWallet: hex("bb", 20) as `0x${string}`,
      registrationUri: "https://agent.example/card.json", registrationDigest: hex("31", 32) as Bytes32 },
    source: { blockNumber: "100", blockHash: hex("32", 32) as Bytes32 },
    subject: { address: hex("bb", 20) as `0x${string}`, kind: "EOA", runtimeCodeHash: hex("00", 32) as Bytes32 },
    deterministicChecks: [{ id: "eoa", version: "1", status: "WARN", inputDigest: hex("33", 32) as Bytes32,
      outputDigest: hex("34", 32) as Bytes32, findings: ["NO_HISTORY"] }],
    computeProofs: [{ proofClass: "DECENTRALIZED_MODEL_TEE", purpose: "behavioral-risk",
      provider: hex("55", 20) as `0x${string}`, model: "model", chatId: "chat-detail",
      receiptDigest: receiptDigest("chat-detail"), requestDigest: hex("35", 32) as Bytes32,
      responseDigest: hex("36", 32) as Bytes32, signatureScheme: "EIP191",
      expectedSigner: hex("66", 20) as `0x${string}`, signature: `0x${"ab".repeat(65)}`,
      signedTextSha256: hex("37", 32) as Bytes32, requestSha256: hex("35", 32) as Bytes32,
      rawResponseSha256: hex("38", 32) as Bytes32, receiptSource: "ZG-Res-Key",
      responseHeadersSha256: hex("39", 32) as Bytes32,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, processResponseVerified: true }],
    verdict: { riskScore: 10, label: "SAFE" }, omissions: [],
    scanner: { address: hex("44", 20) as `0x${string}`, softwareVersion: "1.0.0" },
  };
}

function detailRecord(envelope = detailEnvelope()) {
  return {
    identityKey: computeIdentityKey(envelope.identity), subject: envelope.subject.address,
    envelopeDigest: hashCanonical(envelope), storageRoot: hex("44", 32) as Bytes32, computeRoot: computeProofRoot(envelope.computeProofs),
    artifactHash: hex("66", 32) as Bytes32, runtimeCodeHash: envelope.subject.runtimeCodeHash,
    version: 1n, issuedAt: 10n, validUntil: 20n, policyVersion: 1, behavioralScore: 10,
    codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0,
  } as const;
}

function detailResolution(agentId = "7") {
  return {
    identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: ERC8004_IDENTITY_REGISTRY, agentId },
    owner: hex("aa", 20) as `0x${string}`, agentWallet: hex("bb", 20) as `0x${string}`,
    agentURI: "https://agent.example/card.json", registrationDigest: hex("31", 32) as Bytes32,
    sourceBlockNumber: "101", sourceBlockHash: hex("41", 32) as Bytes32,
    card: { type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const, registrations: [] },
  };
}

describe("operator authentication", () => {
  it.each([undefined, "", "Bearer", "Basic abc", "Bearer wrong", "Bearer wrong-but-longer"])(
    "rejects missing or invalid authorization without exposing the token (%s)",
    (authorization) => {
      const result = authenticateOperator(authorization, operatorToken);
      expect(result).toBe(false);
    },
  );

  it("accepts only an exact Bearer token", () => {
    expect(authenticateOperator(`Bearer ${operatorToken}`, operatorToken)).toBe(true);
    expect(authenticateOperator(`bearer ${operatorToken}`, operatorToken)).toBe(false);
  });

  it("fails closed when the configured token is empty", () => {
    expect(authenticateOperator("Bearer anything", "")).toBe(false);
  });

  it("rejects configured tokens outside the 32..256 UTF-8 byte policy", () => {
    expect(authenticateOperator("Bearer short", "short")).toBe(false);
    expect(authenticateOperator(`Bearer ${"x".repeat(257)}`, "x".repeat(257))).toBe(false);
    expect(authenticateOperator(`Bearer ${"💥".repeat(16)}`, "💥".repeat(16))).toBe(true);
    expect(authenticateOperator(`Bearer ${"💥".repeat(65)}`, "💥".repeat(65))).toBe(false);
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
      readProofById: vi.fn().mockResolvedValue({ record, source: {
        kind: "ProofLocked", transactionHash: hex("90", 32), blockNumber: 9,
      } }),
      readProofLockDetail: vi.fn().mockResolvedValue({ status: "VERIFIED", identity: { agentId: "7" },
        resolution: { agentWallet: record.subject }, gate: { status: "VERIFIED", allowed: true, reason: 0,
          subject: record.subject, version: "1" }, consumer: { status: "VERIFIED", accepted: true,
          address: hex("77", 20), subject: record.subject, version: "1" } }),
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
    expect(response.headers.get("cache-control")).toBe("no-store");
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

  it("returns proof-bound identity resolution and the actual AgentGate decision", async () => {
    const deps = dependencies();
    const response = await createProofLockReadHandlers(deps).proofLock(identityKey, new Request("https://sentinel.test"));
    expect(response.status).toBe(200);
    expect(deps.readProofLockDetail).toHaveBeenCalledWith(record, expect.any(AbortSignal));
    expect(await response.json()).toMatchObject({ detail: { status: "VERIFIED",
      identity: { agentId: "7" }, resolution: { agentWallet: record.subject },
      gate: { status: "VERIFIED", allowed: true, reason: 0, subject: record.subject, version: "1" },
      consumer: { status: "VERIFIED", accepted: true, subject: record.subject, version: "1" } } });
    expect(response.headers.get("cache-control")).toBe("no-store");
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
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a proofId mismatch without retrieving Storage", async () => {
    const deps = dependencies({ readProofById: vi.fn().mockResolvedValue(null) });
    const response = await createProofLockReadHandlers(deps).verifyProof(
      proofId,
      new Request(`https://sentinel.test?identityKey=${identityKey}`),
    );
    expect(response.status).toBe(404);
    expect(deps.verifyStoredEvidence).not.toHaveBeenCalled();
  });

  it("verifies an exact superseded proof record without reading the current registry snapshot", async () => {
    const historical = { ...record, version: 1n, envelopeDigest: hex("71", 32) };
    const current = { ...record, version: 2n, envelopeDigest: hex("72", 32) };
    const historicalId = computeProofLockId(hex("12", 20), historical);
    const deps = dependencies({ readProofLock: vi.fn().mockResolvedValue(current),
      readProofById: vi.fn().mockResolvedValue({ record: historical,
        source: { kind: "ProofLocked", transactionHash: hex("91", 32), blockNumber: 8 } }),
      computeProofId: computeProofLockId });
    const response = await createProofLockReadHandlers(deps).verifyProof(historicalId,
      new Request(`https://sentinel.test?identityKey=${identityKey}`));
    expect(response.status).toBe(200);
    expect(deps.readProofLock).not.toHaveBeenCalled();
    expect(deps.verifyStoredEvidence).toHaveBeenCalledWith(historical, expect.any(AbortSignal));
    expect(await response.json()).toMatchObject({ proofLock: { version: "1", envelopeDigest: hex("71", 32) },
      source: { kind: "ProofLocked", transactionHash: hex("91", 32), blockNumber: 8 } });
  });

  it("maps cryptographic proof mismatch to stable non-retryable MISMATCH", async () => {
    const deps = dependencies({ verifyStoredEvidence: vi.fn().mockRejectedValue(new ProofMismatchError()) });
    const response = await createProofLockReadHandlers(deps).verifyProof(proofId,
      new Request(`https://sentinel.test?identityKey=${identityKey}`));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "MISMATCH", retryable: false,
      stage: "VERIFYING_PROOF" } });
  });
});

describe("ProofLock detail provenance", () => {
  function detailDependencies(overrides: Record<string, unknown> = {}) {
    return {
      downloadEvidence: vi.fn().mockResolvedValue(new TextEncoder().encode(canonicalizeEvidence(detailEnvelope()))),
      verifyStorageRoot: vi.fn().mockResolvedValue(undefined),
      resolveIdentity: vi.fn().mockResolvedValue(detailResolution()),
      checkGate: vi.fn().mockResolvedValue({ allowed: true, reason: 0, subject: hex("bb", 20), version: 1n }),
      simulateConsumer: vi.fn().mockResolvedValue({ accepted: true, address: hex("77", 20) }),
      ...overrides,
    };
  }

  it("binds canonical Storage evidence, current ERC-8004 resolution, and Gate result", async () => {
    const envelope = detailEnvelope();
    const record = detailRecord(envelope);
    const deps = detailDependencies();
    const result = await enrichProofLockDetail(record, deps, new AbortController().signal);
    expect(result).toMatchObject({ status: "VERIFIED",
      identity: { identityKey: record.identityKey, chainId: 16661, registryAddress: ERC8004_IDENTITY_REGISTRY,
        agentId: "7", owner: envelope.identity.owner, agentWallet: record.subject },
      resolution: { owner: envelope.identity.owner, agentWallet: record.subject, sourceBlockNumber: "101" },
      gate: { status: "VERIFIED", allowed: true, reason: 0, subject: record.subject, version: "1" },
      consumer: { status: "VERIFIED", accepted: true, address: hex("77", 20),
        subject: record.subject, version: "1" } });
    expect(deps.resolveIdentity).toHaveBeenCalledWith("7", expect.any(AbortSignal));
    expect(deps.checkGate).toHaveBeenCalledWith("7", expect.any(AbortSignal));
  });

  it("fails closed on an envelope hash mismatch without resolving or calling Gate", async () => {
    const deps = detailDependencies({ downloadEvidence: vi.fn().mockResolvedValue(
      new TextEncoder().encode(canonicalizeEvidence(detailEnvelope("8"))),
    ) });
    const result = await enrichProofLockDetail(detailRecord(), deps, new AbortController().signal);
    expect(result).toEqual({ status: "UNAVAILABLE", code: "EVIDENCE_INVALID", identity: null,
      resolution: null, gate: { status: "UNKNOWN", allowed: false, reason: null },
      consumer: { status: "UNKNOWN", accepted: false } });
    expect(deps.resolveIdentity).not.toHaveBeenCalled();
    expect(deps.checkGate).not.toHaveBeenCalled();
  });

  it("rejects a wrong embedded agentId rather than attempting reverse lookup or fallback", async () => {
    const envelope = detailEnvelope("8");
    const record = { ...detailRecord(), envelopeDigest: hashCanonical(envelope) };
    const deps = detailDependencies({ downloadEvidence: vi.fn().mockResolvedValue(
      new TextEncoder().encode(canonicalizeEvidence(envelope))),
    });
    const result = await enrichProofLockDetail(record, deps, new AbortController().signal);
    expect(result).toMatchObject({ status: "UNAVAILABLE", code: "EVIDENCE_INVALID",
      gate: { status: "UNKNOWN", allowed: false, reason: null } });
    expect(deps.resolveIdentity).not.toHaveBeenCalled();
    expect(deps.checkGate).not.toHaveBeenCalled();
  });

  it("returns unavailable when Storage cannot produce the exact envelope", async () => {
    const deps = detailDependencies({ downloadEvidence: vi.fn().mockRejectedValue(new Error("private indexer detail")) });
    await expect(enrichProofLockDetail(detailRecord(), deps, new AbortController().signal)).resolves.toEqual({
      status: "UNAVAILABLE", code: "EVIDENCE_UNAVAILABLE", identity: null, resolution: null,
      gate: { status: "UNKNOWN", allowed: false, reason: null }, consumer: { status: "UNKNOWN", accepted: false },
    });
    expect(deps.resolveIdentity).not.toHaveBeenCalled();
  });

  it("keeps sealed identity visible and surfaces Gate SUBJECT_CHANGED for the current wallet", async () => {
    const changedWallet = hex("cc", 20);
    const deps = detailDependencies({ resolveIdentity: vi.fn().mockResolvedValue({
      ...detailResolution(), agentWallet: changedWallet,
    }), checkGate: vi.fn().mockResolvedValue({ allowed: false, reason: 5,
      subject: changedWallet, version: 1n }),
    simulateConsumer: vi.fn().mockResolvedValue({ accepted: false, address: hex("77", 20) }) });
    const result = await enrichProofLockDetail(detailRecord(), deps, new AbortController().signal);
    expect(result).toMatchObject({ status: "VERIFIED",
      identity: { agentWallet: hex("bb", 20) }, resolution: { agentWallet: changedWallet },
      gate: { status: "VERIFIED", allowed: false, reason: 5, subject: changedWallet, version: "1" },
      consumer: { status: "VERIFIED", accepted: false, subject: changedWallet, version: "1" } });
    expect(deps.checkGate).toHaveBeenCalledWith("7", expect.any(AbortSignal));
    expect(deps.simulateConsumer).toHaveBeenCalledWith("7", changedWallet, expect.any(AbortSignal));
  });

  it("preserves a verified Gate denial as its exact stable reason", async () => {
    const deps = detailDependencies({ checkGate: vi.fn().mockResolvedValue({
      allowed: false, reason: 3, subject: hex("bb", 20), version: 1n,
    }), simulateConsumer: vi.fn().mockResolvedValue({ accepted: false, address: hex("77", 20) }) });
    const result = await enrichProofLockDetail(detailRecord(), deps, new AbortController().signal);
    expect(result).toMatchObject({ status: "VERIFIED",
      gate: { status: "VERIFIED", allowed: false, reason: 3, subject: hex("bb", 20), version: "1" },
      consumer: { status: "VERIFIED", accepted: false, subject: hex("bb", 20), version: "1" } });
  });

  it("returns a fail-closed UNKNOWN Gate result when the Gate read reverts", async () => {
    const deps = detailDependencies({ checkGate: vi.fn().mockRejectedValue(new Error("private RPC revert")) });
    const result = await enrichProofLockDetail(detailRecord(), deps, new AbortController().signal);
    expect(result).toMatchObject({ status: "VERIFIED",
      gate: { status: "UNKNOWN", allowed: false, reason: null },
      consumer: { status: "UNKNOWN", accepted: false } });
    expect(deps.simulateConsumer).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private RPC revert");
  });
});

describe("historical ProofLocked recovery", () => {
  function historicalLog() {
    const envelope = detailEnvelope();
    const record = detailRecord(envelope);
    const event = REGISTRY_V2_INTERFACE.encodeEventLog(REGISTRY_V2_INTERFACE.getEvent("ProofLocked")!, [
      record.identityKey, record.subject, record.version, record.issuedAt, record.validUntil,
      record.envelopeDigest, record.storageRoot, record.computeRoot, record.artifactHash,
      record.runtimeCodeHash, record.policyVersion, record.behavioralScore, record.codeRisk, record.coverage,
    ]);
    return { record, log: { address: hex("12", 20), topics: event.topics, data: event.data,
      transactionHash: hex("93", 32), blockNumber: 123 } };
  }

  it("reconstructs the immutable record and source from the exact proofId event", () => {
    const { record, log } = historicalLog();
    const proof = recoverHistoricalProofLock(hex("12", 20), record.identityKey,
      computeProofLockId(hex("12", 20), record), [log]);
    expect(proof).toEqual({ record, source: { kind: "ProofLocked", transactionHash: hex("93", 32), blockNumber: 123 } });
  });

  it("does not substitute another version when no event matches the requested proofId", () => {
    const { record, log } = historicalLog();
    expect(recoverHistoricalProofLock(hex("12", 20), record.identityKey, hex("99", 32), [log])).toBeNull();
  });
});

describe("admin ProofLock stream", () => {
  it("authenticates before loading an operator or constructing a stream", async () => {
    const loadRunner = vi.fn();
    const response = await createProofLockStreamHandler({ operatorToken, loadRunner })(
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
        method: "POST", headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
        body: JSON.stringify({ identity: { namespace: "eip155", chainId: 16661, registryAddress: hex("80", 20), agentId: "7" }, registryAddress: hex("12", 20), policyVersion: 1, scanner: hex("13", 20), scannerSoftwareVersion: "1.0.0", validForSeconds: 604800, mode: "SEAL" }),
      });
    const response = await createProofLockStreamHandler({ operatorToken, loadRunner: async () => ({ run }) })(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const frames = await response.text();
    expect(frames).toContain('"type":"stage","stage":"VALIDATING_IDENTITY"');
    expect(frames).toContain('"type":"complete"');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    expect(run.mock.calls[0]?.[2]).not.toBe(request.signal);
  });

  it("uses the runner stage and stable code for terminal Compute errors", async () => {
    const run = vi.fn().mockRejectedValue(new ProofLockStageError("RUNNING_COMPUTE", "private provider detail"));
    const response = await createProofLockStreamHandler({ operatorToken, loadRunner: async () => ({ run }) })(
      new Request("https://sentinel.test", { method: "POST", headers: { authorization: `Bearer ${operatorToken}` }, body: JSON.stringify({ mode: "SEAL" }) }),
    );
    const frames = await response.text();
    expect(frames).toContain('"code":"COMPUTE_UNVERIFIED"');
    expect(frames).toContain('"stage":"RUNNING_COMPUTE"');
    expect(frames).not.toContain("private provider detail");
  });

  it("aborts the runner when the response reader is cancelled", async () => {
    let paidStageReached = false;
    let runnerSignal: AbortSignal | undefined;
    const run = vi.fn(async (_input, report, signal?: AbortSignal) => {
      runnerSignal = signal;
      report("VALIDATING_IDENTITY");
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
      if (!signal?.aborted) paidStageReached = true;
      throw new DOMException("Aborted", "AbortError");
    });
    const response = await createProofLockStreamHandler({ operatorToken, loadRunner: async () => ({ run }) })(
      new Request("https://sentinel.test", { method: "POST", headers: { authorization: `Bearer ${operatorToken}` }, body: JSON.stringify({ mode: "SEAL" }) }),
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(runnerSignal?.aborted).toBe(true));
    expect(paidStageReached).toBe(false);
  });

  it("cancels an oversized chunked request before loading the runner", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10_000));
        controller.enqueue(new Uint8Array(10_000));
      },
      cancel: cancelled,
    });
    const loadRunner = vi.fn();
    const request = new Request("https://sentinel.test", {
      method: "POST", headers: { authorization: `Bearer ${operatorToken}` }, body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await createProofLockStreamHandler({ operatorToken, loadRunner })(request);
    expect(response.status).toBe(400);
    expect(loadRunner).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalled();
  });
});

describe("admin on-demand drift", () => {
  it("rejects unauthenticated mutation before loading the operator", async () => {
    const loadDrift = vi.fn();
    const response = await createDriftHandler({ operatorToken, loadDrift })(
      identityKey, new Request("https://sentinel.test", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(401);
    expect(loadDrift).not.toHaveBeenCalled();
  });

  it("runs an explicit on-demand drift check without marking by default", async () => {
    const run = vi.fn().mockResolvedValue({ mode: "ON_DEMAND", drifted: false, marked: false });
    const response = await createDriftHandler({ operatorToken, loadDrift: async () => ({ run }) })(
      identityKey,
      new Request("https://sentinel.test", { method: "POST", headers: { authorization: `Bearer ${operatorToken}` }, body: "{}" }),
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
