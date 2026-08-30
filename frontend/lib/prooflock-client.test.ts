import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverProofLocks, readProofLockDetail } from "./prooflock-client";
import { computeIdentityKey } from "../server/prooflock/chain";
import { ERC8004_IDENTITY_REGISTRY } from "../server/prooflock/types";

const bytes32 = (byte: string) => `0x${byte.repeat(64)}`;
const address = (byte: string) => `0x${byte.repeat(40)}`;

afterEach(() => vi.unstubAllGlobals());

describe("ProofLock discovery client contract", () => {
  it("accepts a self-consistent finalized discovery response", async () => {
    respond(validResponse());
    await expect(discoverProofLocks()).resolves.toMatchObject({ complete: false, returned: 1, toBlock: 116 });
  });

  it("rejects block numbers outside JavaScript's exact integer range", async () => {
    const body = validResponse();
    body.latestBlock = Number.MAX_SAFE_INTEGER + 1;
    body.toBlock = body.latestBlock - body.confirmations + 1;
    body.fromBlock = body.toBlock;
    body.identities[0]!.blockNumber = body.toBlock;
    respond(body);
    await expect(discoverProofLocks()).rejects.toThrow();
  });

  it.each([
    ["zero identity", (body: DiscoveryBody) => { body.identities[0]!.identityKey = bytes32("0"); }],
    ["zero source transaction", (body: DiscoveryBody) => { body.identities[0]!.transactionHash = bytes32("0"); }],
    ["row below range", (body: DiscoveryBody) => { body.identities[0]!.blockNumber = 106; }],
    ["row above range", (body: DiscoveryBody) => { body.identities[0]!.blockNumber = 117; }],
    ["duplicate identity", (body: DiscoveryBody) => { body.identities.push({ ...body.identities[0]! }); body.returned = 2; }],
    ["returned mismatch", (body: DiscoveryBody) => { body.returned = 0; }],
    ["cap mismatch", (body: DiscoveryBody) => { body.cap = 0; }],
    ["invalid range", (body: DiscoveryBody) => { body.fromBlock = 117; }],
    ["invalid finality equation", (body: DiscoveryBody) => { body.toBlock = 115; }],
  ] as const)("rejects hostile cross-field metadata: %s", async (_name, mutate) => {
    const body = validResponse();
    mutate(body);
    respond(body);
    await expect(discoverProofLocks()).rejects.toThrow();
  });

  it.each([
    ["identity binding", (body: DiscoveryBody) => { verified(body).proofLock.identityKey = bytes32("9"); }],
    ["zero proof identifier", (body: DiscoveryBody) => { verified(body).proofId = bytes32("0"); }],
  ] as const)("rejects a malformed verified row: %s", async (_name, mutate) => {
    const body = verifiedResponse();
    mutate(body);
    respond(body);
    await expect(discoverProofLocks()).rejects.toThrow();
  });
});

describe("versioned ProofLock detail client contract", () => {
  it("keeps parsing the legacy response without adding an agentId query", async () => {
    const body = legacyDetailResponse();
    const fetchMock = vi.fn(async () => response(body));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readProofLockDetail(body.identityKey)).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/prooflocks/${body.identityKey}`, {
      signal: undefined, headers: { accept: "application/json" },
    });
  });

  it("accepts the maximum onchain policy version exactly", async () => {
    const body = legacyDetailResponse();
    body.proofLock.policyVersion = 4_294_967_295;
    respond(body);
    await expect(readProofLockDetail(body.identityKey)).resolves
      .toMatchObject({ proofLock: { policyVersion: 4_294_967_295 } });
  });

  it.each([0, 4_294_967_296, 1e100])(
    "rejects an out-of-range policy version %s", async (policyVersion) => {
      const body = legacyDetailResponse();
      body.proofLock.policyVersion = policyVersion;
      respond(body);
      await expect(readProofLockDetail(body.identityKey)).rejects.toThrow();
    });

  it("requests and parses the additive sealedEvidence/currentAccess response", async () => {
    const body: any = currentDetailResponse();
    const fetchMock = vi.fn(async () => response(body));
    vi.stubGlobal("fetch", fetchMock);

    const result = await readProofLockDetail(body.identityKey, undefined, "7");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/prooflocks/${body.identityKey}?agentId=7&locator=registry-v1`, {
        signal: undefined, headers: { accept: "application/json" },
      });
    expect(result).toMatchObject({ responseVersion: 2,
      sealedEvidence: { schema: "sentinel.prooflock/sealed-evidence-v1" },
      currentAccess: { agentId: "7", identityKey: body.identityKey,
        observations: { gate: { reason: "RUNTIME_CODE_DRIFT",
          observation: { status: "BLOCKED", reasonCode: "RUNTIME_CODE_DRIFT" } } } } });
  });

  it.each([
    ["ALLOWED without identity", true, "identity"], ["ALLOWED without lease", true, "lease"],
    ["blocked without identity", false, "identity"], ["blocked without lease", false, "lease"],
  ])("accepts a coherent partial snapshot: %s", async (_label, allowed, missing) => {
    const body: any = currentDetailResponse();
    if (allowed) makeCurrentAccessAllowed(body);
    makeUnavailable(body.currentAccess.observations[missing]);
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));
    await expect(readProofLockDetail(body.identityKey, undefined, "7")).resolves.toBeTruthy();
  });

  it("rejects an overflowing canonical-looking agentId before accepting its tuple", async () => {
    const body: any = currentDetailResponse();
    const overflow = (1n << 256n).toString();
    body.currentAccess.agentId = overflow;
    body.currentAccess.observations.identity.value.identity.agentId = overflow;
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));
    await expect(readProofLockDetail(body.identityKey, undefined, overflow)).rejects.toThrow();
  });

  it("rejects a returned identity tuple whose recomputed key differs", async () => {
    const body: any = currentDetailResponse();
    body.currentAccess.agentId = "8";
    body.currentAccess.observations.identity.value.identity.agentId = "8";
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));
    await expect(readProofLockDetail(body.identityKey, undefined, "8")).rejects.toThrow();
  });

  it.each([[13, "IDENTITY_UNAVAILABLE"], [14, "AGENT_NOT_FOUND"], [15, "AGENT_WALLET_UNSET"]])(
    "accepts exact identity-failure Gate reason %i", async (reason, code) => {
      const body = currentDetailResponse();
      makeIdentityFailure(body, reason, code);
      vi.stubGlobal("fetch", vi.fn(async () => response(body)));
      await expect(readProofLockDetail(body.identityKey, undefined, "7")).resolves.toBeTruthy();
    });

  it.each([[13, "IDENTITY_UNAVAILABLE"], [14, "AGENT_NOT_FOUND"], [15, "AGENT_WALLET_UNSET"]])(
    "rejects identity-failure Gate reason %i when identity is verified", async (reason, code) => {
      const body: any = currentDetailResponse();
      const verifiedIdentity = structuredClone(body.currentAccess.observations.identity);
      makeIdentityFailure(body, reason, code);
      body.currentAccess.observations.identity = verifiedIdentity;
      vi.stubGlobal("fetch", vi.fn(async () => response(body)));
      await expect(readProofLockDetail(body.identityKey, undefined, "7")).rejects.toThrow();
    });

  it("rejects an alternate internally-consistent key when identity observation is unavailable", async () => {
    const body: any = currentDetailResponse();
    makeUnavailable(body.currentAccess.observations.identity);
    const wrongKey = bytes32("f");
    body.identityKey = wrongKey;
    body.proofLock.identityKey = wrongKey;
    body.sealedEvidence.proofLock.identityKey = wrongKey;
    body.currentAccess.identityKey = wrongKey;
    body.currentAccess.observations.lease.value.identityKey = wrongKey;
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));
    await expect(readProofLockDetail(wrongKey, undefined, "7")).rejects.toThrow();
  });

  it.each([
    ["active+DRIFTED", {}, null, 3, "DRIFTED", false],
    ["revoked+ALLOWED", { state: 2 }, "REVOKED", 0, "ALLOWED", true],
    ["drifted+ALLOWED", { state: 3 }, "DRIFTED", 0, "ALLOWED", true],
    ["expired+ALLOWED", { validUntil: "1800000000" }, "EXPIRED", 0, "ALLOWED", true],
    ["Compute priority", { coverage: 0x77 }, "COVERAGE_INCOMPLETE", 8, "COVERAGE_INCOMPLETE", false],
    ["Storage priority", { coverage: 0x5f }, "COVERAGE_INCOMPLETE", 8, "COVERAGE_INCOMPLETE", false],
    ["remaining coverage", { coverage: 0x6f }, "COVERAGE_INCOMPLETE", 0, "ALLOWED", true],
  ])("rejects Gate reason contradicting intrinsic lease state: %s", async (
    _label, leaseOverride, leaseReason, gateReason, gateCode, allowed,
  ) => {
    const body: any = currentDetailResponse();
    if (leaseReason) setBlockedLease(body, leaseOverride, leaseReason);
    else Object.assign(body.currentAccess.observations.lease.value, leaseOverride);
    setGate(body, gateReason, gateCode, allowed);
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));
    await expect(readProofLockDetail(body.identityKey, undefined, "7")).rejects.toThrow();
  });

  it("accepts SUBJECT_CHANGED before revoked state evaluation", async () => {
    const body: any = currentDetailResponse();
    setBlockedLease(body, { state: 2, subject: address("f") }, "REVOKED");
    setGate(body, 5, "SUBJECT_CHANGED", false);
    body.currentAccess.observations.consumer.value.subject = address("2");
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));
    await expect(readProofLockDetail(body.identityKey, undefined, "7")).resolves.toBeTruthy();
  });

  it("accepts exact NO_PROOF semantics and rejects another reason for that plane", async () => {
    const valid: any = currentDetailResponse();
    setNoProof(valid);
    vi.stubGlobal("fetch", vi.fn(async () => response(valid)));
    await expect(readProofLockDetail(valid.identityKey, undefined, "7")).resolves.toBeTruthy();

    const hostile: any = currentDetailResponse();
    setNoProof(hostile);
    setGate(hostile, 6, "RUNTIME_CODE_DRIFT", false);
    hostile.currentAccess.observations.gate.value.version = "0";
    hostile.currentAccess.observations.consumer.value.version = "0";
    vi.stubGlobal("fetch", vi.fn(async () => response(hostile)));
    await expect(readProofLockDetail(hostile.identityKey, undefined, "7")).rejects.toThrow();
  });

  it("accepts maximumAge-style EXPIRED only after higher-priority checks pass", async () => {
    const valid: any = currentDetailResponse();
    setGate(valid, 4, "EXPIRED", false);
    vi.stubGlobal("fetch", vi.fn(async () => response(valid)));
    await expect(readProofLockDetail(valid.identityKey, undefined, "7")).resolves.toBeTruthy();

    for (const override of [{ state: 2 }, { state: 2, subject: address("f") }]) {
      const hostile: any = currentDetailResponse();
      setBlockedLease(hostile, override, "REVOKED");
      setGate(hostile, 4, "EXPIRED", false);
      vi.stubGlobal("fetch", vi.fn(async () => response(hostile)));
      await expect(readProofLockDetail(hostile.identityKey, undefined, "7")).rejects.toThrow();
    }
  });

  it.each([
    ["agentId", (body: any) => { body.currentAccess.agentId = "8"; }],
    ["identityKey", (body: any) => { body.currentAccess.identityKey = bytes32("f"); }],
    ["sealed record", (body: any) => { body.sealedEvidence.proofLock.version = "3"; }],
    ["block metadata", (body: any) => {
      body.currentAccess.observations.gate.observation.observationBlockHash = bytes32("f");
    }],
    ["identity source block", (body: any) => {
      body.currentAccess.observations.identity.value.sourceBlockNumber = "124";
    }],
    ["identity registry", (body: any) => {
      body.currentAccess.observations.identity.value.identity.registryAddress = address("8");
    }],
    ["freshness", (body: any) => {
      body.currentAccess.observations.gate.observation.freshnessExpiresAt = "2026-08-29T12:02:00.000Z";
    }],
    ["impossible observation", (body: any) => {
      body.currentAccess.observations.gate.observation.status = "VERIFIED";
    }],
    ["unavailable value", (body: any) => {
      body.currentAccess.observations.identity.observation.status = "UNAVAILABLE";
      body.currentAccess.observations.identity.observation.reasonCode = "IDENTITY_UNAVAILABLE";
    }],
    ["unavailable reason", (body: any) => {
      body.currentAccess.observations.identity.observation.status = "UNAVAILABLE";
      body.currentAccess.observations.identity.observation.reasonCode = "IDENTITY_UNAVAILABLE";
      body.currentAccess.observations.identity.value = null;
    }],
    ["blocked Gate boolean", (body: any) => {
      body.currentAccess.observations.gate.value.allowed = true;
    }],
    ["blocked Gate reason", (body: any) => {
      body.currentAccess.observations.gate.reason = "REVOKED";
    }],
    ["blocked Gate subject provenance", (body: any) => {
      body.currentAccess.observations.gate.value.subject = address("f");
    }],
    ["blocked Gate version provenance", (body: any) => {
      body.currentAccess.observations.gate.value.version = "2";
    }],
    ["identity failure nonzero subject", (body: any) => {
      makeIdentityFailure(body, 13, "IDENTITY_UNAVAILABLE");
      body.currentAccess.observations.gate.value.subject = address("f");
    }],
    ["identity failure nonzero version", (body: any) => {
      makeIdentityFailure(body, 13, "IDENTITY_UNAVAILABLE");
      body.currentAccess.observations.gate.value.version = "1";
    }],
    ["blocked consumer boolean", (body: any) => {
      body.currentAccess.observations.consumer.value.accepted = true;
    }],
    ["lease status at pinned timestamp", (body: any) => {
      body.currentAccess.observations.lease.value.validUntil = "1800000000";
    }],
    ["allowed subject coherence", (body: any) => {
      makeCurrentAccessAllowed(body);
      body.currentAccess.observations.gate.value.subject = address("f");
    }],
    ["allowed version coherence", (body: any) => {
      makeCurrentAccessAllowed(body);
      body.currentAccess.observations.consumer.value.version = "2";
    }],
  ] as const)("rejects inconsistent versioned detail binding: %s", async (_label, mutate) => {
    const body = currentDetailResponse();
    mutate(body);
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));
    await expect(readProofLockDetail(body.identityKey, undefined, "7")).rejects.toThrow();
  });
});

type DiscoveryRow = Record<string, any>;
type DiscoveryBody = ReturnType<typeof validResponse>;

function validResponse() {
  const identityKey = bytes32("1"); const proofId = bytes32("e");
  const transactionHash = bytes32("2"); const blockNumber = 115;
  return { identities: [{ status: "ENRICHMENT_UNAVAILABLE", identityKey,
    proofId, registryAddress: address("a"), transactionHash, blockNumber, locator: { identityKey, proofId,
      registryAddress: address("a"), transactionHash, blockNumber },
    code: "DEPENDENCY_UNAVAILABLE" }] as DiscoveryRow[],
    latestBlock: 120, fromBlock: 107, toBlock: 116, confirmations: 5,
    observedAt: "2026-08-29T12:00:00.000Z", cap: 100, returned: 1, complete: false as const };
}

function verifiedResponse(): DiscoveryBody {
  const body = validResponse();
  const identityKey = bytes32("1");
  const subject = address("2");
  const proofId = bytes32("e"); const transactionHash = bytes32("2"); const blockNumber = 115;
  body.identities = [{ status: "VERIFIED", identityKey, proofId, registryAddress: address("a"), transactionHash,
    blockNumber, locator: { identityKey, proofId, registryAddress: address("a"), transactionHash, blockNumber },
    proofLock: { identityKey, subject, envelopeDigest: bytes32("3"), storageRoot: bytes32("4"),
      computeRoot: bytes32("5"), artifactHash: bytes32("6"), runtimeCodeHash: bytes32("7"), version: "1",
      issuedAt: "100", validUntil: "2000000000", policyVersion: 1, behavioralScore: 10, codeRisk: 0, coverage: 127,
      state: 1, stateReason: 0 }, detail: { status: "VERIFIED", identity: { identityKey, namespace: "eip155",
      chainId: 16661, registryAddress: address("8"), agentId: "7", owner: address("9"), agentWallet: subject,
      registrationUri: "https://agent.test", registrationDigest: bytes32("a"), sourceBlockNumber: "116",
      sourceBlockHash: bytes32("b") }, resolution: { owner: address("9"), agentWallet: subject,
      agentURI: "https://agent.test", registrationDigest: bytes32("a"), sourceBlockNumber: "116",
      sourceBlockHash: bytes32("b") }, gate: { status: "VERIFIED", allowed: true, reason: 0, subject, version: "1" },
      consumer: { status: "VERIFIED", accepted: true, address: address("c"), subject, version: "1" } } }];
  return body;
}

function verified(body: DiscoveryBody): DiscoveryRow { return body.identities[0]!; }

function respond(body: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => response(body)));
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

function legacyDetailResponse() {
  const row = verifiedResponse().identities[0]!;
  return { identityKey: row.identityKey, proofLock: row.proofLock, detail: row.detail };
}

function currentDetailResponse() {
  const legacy = legacyDetailResponse();
  const canonicalIdentity = { namespace: "eip155" as const, chainId: 16661 as const,
    registryAddress: ERC8004_IDENTITY_REGISTRY, agentId: "7" };
  const canonicalKey = computeIdentityKey(canonicalIdentity);
  legacy.identityKey = canonicalKey;
  legacy.proofLock.identityKey = canonicalKey;
  legacy.detail.identity.identityKey = canonicalKey;
  const metadata = { scope: "CURRENT", observedAt: "2026-08-29T12:00:00.000Z",
    observationBlockNumber: "123", observationBlockHash: bytes32("d"),
    serverIssuedAt: "2026-08-29T12:00:00.000Z", ttlMs: 60_000,
    freshnessExpiresAt: "2026-08-29T12:01:00.000Z" };
  const identityValue = { identity: canonicalIdentity, owner: address("9"), agentWallet: address("2"),
    agentURI: "https://agent.test", registrationDigest: bytes32("a"), sourceBlockNumber: "123",
    sourceBlockHash: bytes32("d") };
  const gateValue = { allowed: false, reason: 6, subject: address("2"), version: "1" };
  const consumerValue = { accepted: false, address: address("c"), subject: address("2"), version: "1" };
  const entry = (capability: string, reason: string, subsystem: string, status: string,
    value: unknown, reasonCode?: string) => ({ capability, reason,
      observation: { ...metadata, subsystem, status, ...(reasonCode ? { reasonCode } : {}) }, value });
  const currentAccess = { schema: "sentinel.prooflock/current-access-v1", version: 1, agentId: "7",
    identityKey: legacy.identityKey, observationBlock: { number: "123", hash: bytes32("d"),
      timestamp: "1800000000" },
    observedAt: metadata.observedAt, freshnessExpiresAt: metadata.freshnessExpiresAt,
    observations: {
      identity: entry("ERC8004_IDENTITY_AT_FINALIZED_BLOCK", "OBSERVED", "identity", "VERIFIED", identityValue),
      lease: entry("REGISTRY_V2_LEASE_AT_FINALIZED_BLOCK", "OBSERVED", "lease", "VERIFIED",
        structuredClone(legacy.proofLock)),
      gate: entry("AGENT_GATE_V2_AT_FINALIZED_BLOCK", "RUNTIME_CODE_DRIFT", "gate", "BLOCKED",
        gateValue, "RUNTIME_CODE_DRIFT"),
      consumer: entry("GUARDED_CONSUMER_AT_FINALIZED_BLOCK", "GUARDED_CONSUMER_BLOCKED",
        "consumer", "BLOCKED", consumerValue, "UNKNOWN_REASON"),
    } };
  return { ...legacy, responseVersion: 2,
    proofId: bytes32("e"), registryAddress: address("a"),
    locator: { identityKey: legacy.identityKey, proofId: bytes32("e"), registryAddress: address("a") },
    sealedEvidence: { schema: "sentinel.prooflock/sealed-evidence-v1", version: 1,
      proofLock: structuredClone(legacy.proofLock), detail: structuredClone(legacy.detail) },
    currentAccess };
}

function makeCurrentAccessAllowed(body: any) {
  const gate = body.currentAccess.observations.gate;
  gate.reason = "ALLOWED";
  gate.observation.status = "VERIFIED";
  gate.observation.reasonCode = "ALLOWED";
  gate.observation.allowed = true;
  gate.value.allowed = true;
  gate.value.reason = 0;
  const consumer = body.currentAccess.observations.consumer;
  consumer.reason = "OBSERVED";
  consumer.observation.status = "VERIFIED";
  delete consumer.observation.reasonCode;
  consumer.observation.accepted = true;
  consumer.value.accepted = true;
}

function makeUnavailable(entry: any) {
  const subsystem = entry.observation.subsystem;
  const identity = subsystem === "identity";
  entry.reason = `CURRENT_${subsystem.toUpperCase()}_UNAVAILABLE`;
  entry.observation.status = "UNAVAILABLE";
  entry.observation.reasonCode = identity ? "IDENTITY_UNAVAILABLE" : "EVIDENCE_UNAVAILABLE";
  entry.value = null;
}

function makeIdentityFailure(body: any, reason: number, code: string) {
  const { identity, lease, gate, consumer } = body.currentAccess.observations;
  makeUnavailable(identity);
  makeUnavailable(lease);
  makeUnavailable(consumer);
  gate.reason = code;
  gate.observation.status = "BLOCKED";
  gate.observation.reasonCode = code;
  gate.value = { allowed: false, reason, subject: address("0"), version: "0" };
}

function setBlockedLease(body: any, override: Record<string, unknown>, reason: string) {
  const lease = body.currentAccess.observations.lease;
  Object.assign(lease.value, override);
  lease.reason = reason;
  lease.observation.status = "BLOCKED";
  lease.observation.reasonCode = reason;
}

function setGate(body: any, reason: number, code: string, allowed: boolean) {
  const gate = body.currentAccess.observations.gate;
  gate.reason = code;
  gate.observation.status = allowed ? "VERIFIED" : "BLOCKED";
  gate.observation.reasonCode = code;
  if (allowed) gate.observation.allowed = true;
  else delete gate.observation.allowed;
  gate.value.allowed = allowed;
  gate.value.reason = reason;
  const consumer = body.currentAccess.observations.consumer;
  consumer.value.accepted = allowed;
  consumer.reason = allowed ? "OBSERVED" : "GUARDED_CONSUMER_BLOCKED";
  consumer.observation.status = allowed ? "VERIFIED" : "BLOCKED";
  if (allowed) {
    delete consumer.observation.reasonCode;
    consumer.observation.accepted = true;
  } else {
    consumer.observation.reasonCode = "UNKNOWN_REASON";
    delete consumer.observation.accepted;
  }
}

function setNoProof(body: any) {
  const lease = body.currentAccess.observations.lease;
  lease.reason = "NO_PROOF";
  lease.observation.status = "BLOCKED";
  lease.observation.reasonCode = "NO_PROOF";
  lease.value = null;
  setGate(body, 1, "NO_PROOF", false);
  body.currentAccess.observations.gate.value.version = "0";
  body.currentAccess.observations.consumer.value.version = "0";
}
