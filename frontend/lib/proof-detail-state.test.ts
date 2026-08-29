import { describe, expect, it } from "vitest";
import {
  currentRefreshDelay, initialProofDetailState, mapCurrentPlane, mapHistoricalPlane,
  proofDetailReducer, safeSealedObservedAt,
} from "./proof-detail-state";
import type {
  CurrentAccessV1, CurrentObservationEntry, ProofLockCurrentDetailResponse,
  ProofLockObservation, VerifiedProof,
} from "./prooflock-types";
import type { LinkedHistoricalProof } from "./prooflock-routes";

const HASH = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const ADDRESS = (byte: string) => `0x${byte.repeat(40)}` as `0x${string}`;
const OBSERVED_AT = "2026-08-29T12:00:00.000Z";
const EXPIRES_AT = "2026-08-29T12:01:00.000Z";

describe("proof detail view state", () => {
  it("maps a matched artifact and fresh pinned observations without coupling the planes", () => {
    const historical = mapHistoricalPlane({ status: "MATCH", proof: proof() }, OBSERVED_AT);
    const current = mapCurrentPlane(currentAccess(), Date.parse(OBSERVED_AT) + 30_000);

    expect(historical.status).toBe("MATCH");
    expect(historical.observations.map(({ subsystem, status }) => [subsystem, status])).toEqual([
      ["identity", "VERIFIED"], ["checks", "VERIFIED"], ["compute", "VERIFIED"],
      ["storage", "VERIFIED"], ["registry", "VERIFIED"],
    ]);
    const storage = historical.observations.find((item) => item.subsystem === "storage");
    expect(storage).toMatchObject({ storageRoot: HASH("7"), artifactHash: HASH("9"),
      storageUploadTxHash: HASH("c"), capability: { proofClass: "ROOT_MATCHED_NO_NETWORK_PROOF",
        retrievalVerified: true, networkProofVerified: false } });
    expect(current.decision).toMatchObject({ status: "VERIFIED", reason: "ALLOWED",
      observationBlockNumber: "1234", observedAt: OBSERVED_AT, freshnessExpiresAt: EXPIRES_AT });
    expect(current.observations).toHaveLength(4);
  });

  it("keeps Storage and Registry verified when Compute capability is unavailable", () => {
    const matched = proof();
    const historical = mapHistoricalPlane({ status: "MATCH", proof: { ...matched,
      storage: { ...matched.storage, computeVerification: undefined } } }, OBSERVED_AT);
    expect(statusOf(historical.observations, "compute")).toBe("UNAVAILABLE");
    expect(statusOf(historical.observations, "storage")).toBe("VERIFIED");
    expect(statusOf(historical.observations, "registry")).toBe("VERIFIED");
    expect(historical.status).toBe("MATCH");
  });

  it("rejects a valid Compute capability that is not bound to the sealed transcript", () => {
    const matched = proof();
    const capability = matched.storage.computeVerification?.[0] as Record<string, unknown>;
    const historical = mapHistoricalPlane({ status: "MATCH", proof: { ...matched, storage: {
      ...matched.storage, computeVerification: [{ ...capability, provider: ADDRESS("7") }],
    } } }, OBSERVED_AT);
    expect(statusOf(historical.observations, "compute")).toBe("UNAVAILABLE");
    expect(statusOf(historical.observations, "storage")).toBe("VERIFIED");
  });

  it.each(["MISMATCH", "HINT_REQUIRED", "STALE_LINK", "UNAVAILABLE"] as const)(
    "maps historical %s explicitly without retaining a proof payload",
    (status) => {
      const historical = mapHistoricalPlane({ status } as LinkedHistoricalProof, OBSERVED_AT);
      expect(historical.status).toBe(status);
      expect("proof" in historical).toBe(false);
      expect(historical.observations.every((item) => item.status === (status === "MISMATCH"
        ? "MISMATCH" : "UNAVAILABLE"))).toBe(true);
    },
  );

  it("derives blocked, partial, mismatch, and exact TTL states only from current observations", () => {
    const blocked = mapCurrentPlane(currentAccess({ gate: entry("gate", "BLOCKED", "DRIFTED") }),
      Date.parse(OBSERVED_AT) + 1);
    const partial = mapCurrentPlane(currentAccess({ consumer: entry("consumer", "UNAVAILABLE") }),
      Date.parse(OBSERVED_AT) + 1);
    const mismatch = mapCurrentPlane(currentAccess({ identity: entry("identity", "MISMATCH", "IDENTITY_MISMATCH") }),
      Date.parse(OBSERVED_AT) + 1);
    const stale = mapCurrentPlane(currentAccess(), Date.parse(EXPIRES_AT));

    expect(blocked.decision).toMatchObject({ status: "BLOCKED", reason: "DRIFTED" });
    expect(partial.decision.status).toBe("UNAVAILABLE");
    expect(mismatch.decision.status).toBe("MISMATCH");
    expect(stale.decision).toMatchObject({ status: "STALE", reason: "OBSERVATION_EXPIRED" });
    expect(stale.observations.every((item) => item.status === "VERIFIED")).toBe(true);
  });

  it.each([
    ["Gate denied", { gate: entry("gate", "BLOCKED", "BEHAVIORAL_RISK") }, "BLOCKED", "BEHAVIORAL_RISK"],
    ["consumer unknown", { consumer: entry("consumer", "UNAVAILABLE", "CURRENT_CONSUMER_UNAVAILABLE", {}, "EVIDENCE_UNAVAILABLE") }, "UNAVAILABLE", "CURRENT_CONSUMER_UNAVAILABLE"],
    ["drift", { lease: entry("lease", "BLOCKED", "DRIFTED") }, "BLOCKED", "DRIFTED"],
    ["expired", { lease: entry("lease", "BLOCKED", "EXPIRED") }, "BLOCKED", "EXPIRED"],
  ] as const)("maps %s without suppressing sibling observations", (_label, overrides, status, reason) => {
    const current = mapCurrentPlane(currentAccess(overrides), Date.parse(OBSERVED_AT) + 1);
    expect(current.decision).toMatchObject({ status, reason });
    expect(current.observations).toHaveLength(4);
  });

  it("rejects mixed-block observations before they can enter rendered state", () => {
    expect(() => mapCurrentPlane(currentAccess({ identity: entry("identity", "VERIFIED", undefined,
      { observationBlockNumber: "1235" }) }), Date.parse(OBSERVED_AT))).toThrow(/pinned access coordinate/);
  });

  it("rejects mixed server-issued times before they can enter rendered state", () => {
    expect(() => mapCurrentPlane(currentAccess({ consumer: entry("consumer", "VERIFIED", undefined,
      { serverIssuedAt: "2026-08-29T12:00:01.000Z" }) }), Date.parse(OBSERVED_AT))).toThrow(
      /pinned access coordinate/,
    );
  });

  it("keeps a historical match visible when current access is unavailable", () => {
    const start = initialProofDetailState("agent-7", Date.parse(OBSERVED_AT));
    const historical = mapHistoricalPlane({ status: "MATCH", proof: proof() }, OBSERVED_AT);
    const sealed = proofDetailReducer(start, { type: "HISTORICAL_SETTLED", key: "agent-7",
      generation: 0, historical });
    const unavailable = proofDetailReducer(sealed, { type: "CURRENT_FAILED", key: "agent-7",
      generation: 0, message: "current unavailable" });
    expect(unavailable.historical).toBe(historical);
    expect(unavailable.current.snapshot).toBeNull();
  });

  it("keeps sealed evidence across atomic current refresh success and failure", () => {
    const start = initialProofDetailState("agent-7", 100);
    const base = detailResponse();
    const historical = mapHistoricalPlane({ status: "MATCH", proof: proof() }, OBSERVED_AT);
    const firstCurrent = mapCurrentPlane(currentAccess(), Date.parse(OBSERVED_AT));
    const secondCurrent = mapCurrentPlane(currentAccess({ block: "1235" }), Date.parse(OBSERVED_AT));
    const ready = proofDetailReducer(start, { type: "BASE_READY", key: "agent-7", generation: 0, base });
    const sealed = proofDetailReducer(ready, { type: "HISTORICAL_SETTLED", key: "agent-7", generation: 0,
      historical });
    const current = proofDetailReducer(sealed, { type: "CURRENT_SUCCEEDED", key: "agent-7", generation: 0,
      current: firstCurrent, nowMs: Date.parse(OBSERVED_AT) });
    const refreshing = proofDetailReducer(current, { type: "CURRENT_STARTED", key: "agent-7", generation: 0 });
    const failed = proofDetailReducer(refreshing, { type: "CURRENT_FAILED", key: "agent-7", generation: 0,
      message: "dependency unavailable" });
    const refreshed = proofDetailReducer(failed, { type: "CURRENT_SUCCEEDED", key: "agent-7", generation: 0,
      current: secondCurrent, nowMs: Date.parse(OBSERVED_AT) + 1 });

    expect(failed.historical).toBe(historical);
    expect(failed.current.snapshot).toBe(firstCurrent);
    expect(failed.current.error).toBe("dependency unavailable");
    expect(refreshed.historical).toBe(historical);
    expect(refreshed.current.snapshot?.access.observationBlock.number).toBe("1235");
    expect(proofDetailReducer(refreshed, { type: "CURRENT_FAILED", key: "old", generation: 0,
      message: "stale" })).toBe(refreshed);
  });

  it("expires the cached leading decision on a clock tick while preserving the snapshot", () => {
    const start = initialProofDetailState("agent-7", Date.parse(OBSERVED_AT));
    const current = mapCurrentPlane(currentAccess(), Date.parse(OBSERVED_AT));
    const completionNow = Date.parse(OBSERVED_AT) + 10_000;
    const ready = proofDetailReducer(start, { type: "CURRENT_SUCCEEDED", key: "agent-7",
      generation: 0, current, nowMs: completionNow });
    expect(ready.nowMs).toBe(completionNow);
    expect(currentRefreshDelay(ready.current.snapshot!.access, ready.nowMs)).toBe(50_000);
    const expired = proofDetailReducer(ready, { type: "CLOCK_TICK", nowMs: Date.parse(EXPIRES_AT) });
    expect(expired.current.snapshot?.decision).toMatchObject({
      status: "STALE", reason: "OBSERVATION_EXPIRED",
    });
    expect(expired.current.snapshot?.access).toBe(current.access);
  });

  it("turns valid uint48 values outside the JavaScript Date range into an unavailable time", () => {
    expect(safeSealedObservedAt(((1n << 48n) - 1n).toString())).toBeNull();
    expect(safeSealedObservedAt("1000")).toBe("1970-01-01T00:16:40.000Z");
    const matched = mapHistoricalPlane({ status: "MATCH", proof: proof() }, null);
    expect(matched.status).toBe("MATCH"); expect(matched.observations).toEqual([]);
  });

  it("resets all payloads on locator change and schedules exact freshness boundaries", () => {
    const start = initialProofDetailState("agent-7", Date.parse(OBSERVED_AT));
    const reset = proofDetailReducer(start, { type: "START", key: "agent-8", generation: 1,
      nowMs: Date.parse(OBSERVED_AT) + 1 });
    expect(reset).toEqual(initialProofDetailState("agent-8", Date.parse(OBSERVED_AT) + 1, 1));
    expect(currentRefreshDelay(currentAccess(), Date.parse(EXPIRES_AT) - 1)).toBe(1);
    expect(currentRefreshDelay(currentAccess(), Date.parse(EXPIRES_AT))).toBe(0);
    expect(currentRefreshDelay(null, Date.parse(EXPIRES_AT))).toBeNull();
  });
});

function statusOf(observations: readonly ProofLockObservation[], subsystem: string) {
  return observations.find((item) => item.subsystem === subsystem)?.status;
}

function proof(): VerifiedProof {
  const computeProof = { provider: ADDRESS("9"), model: "llama-3", processResponseVerified: true,
    receiptDigest: HASH("1"), requestDigest: HASH("2"), responseDigest: HASH("3"),
    signedTextSha256: HASH("4"), requestSha256: HASH("5"), rawResponseSha256: HASH("6"),
    responseHeadersSha256: HASH("8") };
  return { proofId: HASH("1"), identityKey: HASH("2"), source: { kind: "ProofLocked",
    registryAddress: ADDRESS("8"), transactionHash: HASH("3"), blockNumber: 100,
    blockHash: HASH("4"), logIndex: 0 }, proofLock: record(), storage: {
      retrievalVerified: true, networkProofVerified: false,
      envelope: { scanner: { softwareVersion: "sentinel-v2" }, deterministicChecks: [{}],
        computeProofs: [computeProof] }, computeVerification: [{ sdkVersion: "0.9.0",
        method: "processResponse", provider: ADDRESS("9"), model: "llama-3",
        proofClass: "DECENTRALIZED_MODEL_TEE", processResponseVerified: true, boundHashes: {
          receiptDigest: HASH("1"), requestDigest: HASH("2"), responseDigest: HASH("3"),
          signedTextSha256: HASH("4"), requestSha256: HASH("5"), rawResponseSha256: HASH("6"),
          responseHeadersSha256: HASH("8"), artifactHash: HASH("9"),
        } }],
      storageCommitment: { uploadTxHash: HASH("c") },
    } };
}

function currentAccess(overrides: Readonly<{ identity?: CurrentObservationEntry<any>;
  lease?: CurrentObservationEntry<any>; gate?: CurrentObservationEntry<any>;
  consumer?: CurrentObservationEntry<any>; block?: string }> = {}): CurrentAccessV1 {
  const block = overrides.block ?? "1234";
  const metadata = { observationBlockNumber: block };
  return { schema: "sentinel.prooflock/current-access-v1", version: 1, agentId: "7",
    identityKey: HASH("2"), observationBlock: { number: block, hash: HASH("4"), timestamp: "2000" },
    observedAt: OBSERVED_AT, freshnessExpiresAt: EXPIRES_AT, observations: {
      identity: overrides.identity ?? entry("identity", "VERIFIED", undefined, metadata),
      lease: overrides.lease ?? entry("lease", "VERIFIED", undefined, metadata),
      gate: overrides.gate ?? entry("gate", "VERIFIED", "ALLOWED", metadata),
      consumer: overrides.consumer ?? entry("consumer", "VERIFIED", undefined, metadata),
    } };
}

function entry(subsystem: "identity" | "lease" | "gate" | "consumer",
  status: ProofLockObservation["status"], reason?: string,
  metadata: Readonly<{ observationBlockNumber?: string; serverIssuedAt?: string }> = {}, observationReason = reason): CurrentObservationEntry<any> {
  const observation = { scope: "CURRENT", subsystem, status, observedAt: OBSERVED_AT,
    observationBlockNumber: metadata.observationBlockNumber ?? "1234", observationBlockHash: HASH("4"),
    serverIssuedAt: metadata.serverIssuedAt ?? OBSERVED_AT, ttlMs: 60_000, freshnessExpiresAt: EXPIRES_AT,
    ...(status === "VERIFIED" && subsystem === "gate" ? { allowed: true, reasonCode: "ALLOWED" } : {}),
    ...(status === "VERIFIED" && subsystem === "consumer" ? { accepted: true } : {}),
    ...(status !== "VERIFIED" && observationReason ? { reasonCode: observationReason } : {}),
  } as ProofLockObservation;
  const value = status === "VERIFIED" ? subsystem === "gate" ? { allowed: true, reason: 0,
    subject: ADDRESS("1"), version: "2" } : subsystem === "consumer" ? { accepted: true,
    address: ADDRESS("2"), subject: ADDRESS("1"), version: "2" } : subsystem === "lease" ? record()
    : { identity: { namespace: "eip155", chainId: 16661, registryAddress: ADDRESS("8"), agentId: "7" },
      owner: ADDRESS("1"), agentWallet: ADDRESS("1"), agentURI: "ipfs://agent", registrationDigest: HASH("5"),
      sourceBlockNumber: metadata.observationBlockNumber ?? "1234", sourceBlockHash: HASH("4") } : null;
  return { capability: `${subsystem}-capability` as never, reason: (reason ?? "OBSERVED") as never,
    observation, value };
}

function detailResponse(): ProofLockCurrentDetailResponse {
  const legacyDetail = { status: "VERIFIED" as const, identity: { identityKey: HASH("2"),
    namespace: "eip155" as const, chainId: 16661 as const, registryAddress: ADDRESS("8"), agentId: "7",
    owner: ADDRESS("1"), agentWallet: ADDRESS("1"), registrationUri: "ipfs://agent",
    registrationDigest: HASH("5"), sourceBlockNumber: "1234", sourceBlockHash: HASH("4") },
    resolution: { owner: ADDRESS("1"), agentWallet: ADDRESS("1"), agentURI: "ipfs://agent",
      registrationDigest: HASH("5"), sourceBlockNumber: "1234", sourceBlockHash: HASH("4") },
    gate: { status: "VERIFIED" as const, allowed: true, reason: 0, subject: ADDRESS("1"), version: "2" },
    consumer: { status: "VERIFIED" as const, accepted: true, address: ADDRESS("2"),
      subject: ADDRESS("1"), version: "2" } };
  return { identityKey: HASH("2"), proofLock: record(), detail: legacyDetail, responseVersion: 2,
    sealedEvidence: { schema: "sentinel.prooflock/sealed-evidence-v1", version: 1,
      proofLock: record(), detail: legacyDetail }, currentAccess: currentAccess() };
}

function record() {
  return { identityKey: HASH("2"), subject: ADDRESS("1"), envelopeDigest: HASH("6"),
    storageRoot: HASH("7"), computeRoot: HASH("8"), artifactHash: HASH("9"), runtimeCodeHash: HASH("a"),
    version: "2", issuedAt: "1000", validUntil: "9999999999", policyVersion: 1,
    behavioralScore: 10, codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0 } as const;
}
