import { describe, expect, it } from "vitest";

import {
  OBSERVATION_PRESENTATION,
  OBSERVATION_IDS,
  assertComputeCapability,
  assertObservation,
  indexComputeCapabilities,
  observationStatusAt,
  type ProofLockObservation,
} from "./prooflock-observations";

const hash = (byte: string) => `0x${byte.repeat(64)}` as const;
const address = (byte: string) => `0x${byte.repeat(40)}` as const;

const historicalStorage = {
  scope: "HISTORICAL",
  subsystem: "storage",
  status: "VERIFIED",
  observedAt: "2026-08-28T16:00:00.000Z",
  storageRoot: hash("1"),
  artifactHash: hash("2"),
  storageUploadTxHash: hash("3"),
  capability: {
    proofClass: "ROOT_MATCHED_NO_NETWORK_PROOF",
    retrievalVerified: true,
    networkProofVerified: false,
  },
} as const;

const currentMetadata = {
  observedAt: "2026-08-28T16:00:00.000Z",
  observationBlockNumber: "1234",
  observationBlockHash: hash("4"),
  serverIssuedAt: "2026-08-28T16:00:00.000Z",
  ttlMs: 60_000,
  freshnessExpiresAt: "2026-08-28T16:01:00.000Z",
} as const;

const computeCapability = () => ({
  sdkVersion: "0.9.0", method: "processResponse", provider: address("9"), model: "model",
  proofClass: "DECENTRALIZED_MODEL_TEE", processResponseVerified: true,
  boundHashes: {
    receiptDigest: hash("1"), requestDigest: hash("2"), responseDigest: hash("3"),
    signedTextSha256: hash("4"), requestSha256: hash("5"), rawResponseSha256: hash("6"),
    responseHeadersSha256: hash("7"), artifactHash: hash("8"),
  },
} as const);

describe("ProofLock observations", () => {
  it("accepts historical Storage root matching without a network-proof claim", () => {
    expect(assertObservation(historicalStorage)).toEqual(historicalStorage);
  });

  it("requires server-issued metadata for a CURRENT VERIFIED fact", () => {
    expect(() => assertObservation({
      scope: "CURRENT",
      subsystem: "gate",
      status: "VERIFIED",
      allowed: true,
      reasonCode: "ALLOWED",
    })).toThrow(/metadata/i);
  });

  it.each([
    "VERIFIED", "BLOCKED", "UNAVAILABLE", "STALE", "MISMATCH", "NOT_APPLICABLE",
  ] as const)("maps %s to one allowed copy key and semantic tone", (status) => {
    expect(OBSERVATION_PRESENTATION[status]).toEqual({
      copyKey: expect.stringMatching(/^observation\./),
      tone: expect.stringMatching(/^(positive|negative|neutral|warning)$/),
    });
  });

  it("freezes every approved observation subsystem ID", () => {
    expect(OBSERVATION_IDS).toEqual([
      "identity", "checks", "compute", "storage", "registry", "lease", "gate", "consumer",
    ]);
  });

  it("derives TTL expiry from wall-clock time after background resume", () => {
    const observation = assertObservation({
      scope: "CURRENT",
      subsystem: "gate",
      status: "VERIFIED",
      allowed: true,
      reasonCode: "ALLOWED",
      ...currentMetadata,
    });

    expect(observationStatusAt(observation, Date.parse(currentMetadata.freshnessExpiresAt) - 1)).toBe("VERIFIED");
    expect(observationStatusAt(observation, Date.parse(currentMetadata.freshnessExpiresAt))).toBe("STALE");
  });

  it.each(["UNAVAILABLE", "MISMATCH"] as const)("never turns %s into stale success", (status) => {
    const observation = assertObservation({
      scope: "CURRENT",
      subsystem: "gate",
      status,
      reasonCode: status === "MISMATCH" ? "IDENTITY_MISMATCH" : "IDENTITY_UNAVAILABLE",
      ...currentMetadata,
    });
    expect(observationStatusAt(observation, Date.parse(currentMetadata.serverIssuedAt) + 120_000)).toBe(status);
  });

  it("requires every Compute capability key and its bound hashes", () => {
    const observation = assertObservation({
      scope: "HISTORICAL",
      subsystem: "compute",
      status: "VERIFIED",
      observedAt: historicalStorage.observedAt,
      capability: {
        sdkVersion: "0.9.0",
        method: "processResponse",
        provider: address("9"),
        model: "llama-3",
        proofClass: "DECENTRALIZED_MODEL_TEE",
        processResponseVerified: true,
        boundHashes: {
          receiptDigest: hash("1"),
          requestDigest: hash("2"),
          responseDigest: hash("3"),
          signedTextSha256: hash("4"),
          requestSha256: hash("5"),
          rawResponseSha256: hash("6"),
          responseHeadersSha256: hash("7"),
          artifactHash: hash("8"),
        },
      },
    });
    if (observation.status !== "VERIFIED" || observation.subsystem !== "compute") {
      throw new Error("expected historical Compute observation");
    }
    expect(observation.capability.processResponseVerified).toBe(true);
    const table = indexComputeCapabilities([observation.capability]);
    const [key] = Object.keys(table);
    expect(key).toContain("0.9.0");
    expect(key).toContain("processResponse");
    expect(key).toContain("llama-3");
    expect(key).toContain(hash("7"));
    expect(key).toContain(hash("8"));

    const missingModel = structuredClone(observation) as Record<string, any>;
    delete missingModel.capability.model;
    expect(() => assertObservation(missingModel)).toThrow(/model/i);

    const missingArtifact = structuredClone(observation) as Record<string, any>;
    delete missingArtifact.capability.boundHashes.artifactHash;
    expect(() => assertObservation(missingArtifact)).toThrow(/artifactHash/i);
  });

  it("uses collision-free capability tuple keys for arbitrary strings", () => {
    const base = {
      sdkVersion: "a:b",
      method: "c",
      provider: address("9"),
      model: "model",
      proofClass: "DECENTRALIZED_MODEL_TEE",
      processResponseVerified: true,
      boundHashes: {
        receiptDigest: hash("1"), requestDigest: hash("2"), responseDigest: hash("3"),
        signedTextSha256: hash("4"), requestSha256: hash("5"), rawResponseSha256: hash("6"),
        responseHeadersSha256: hash("7"), artifactHash: hash("8"),
      },
    } as const;
    const collidingUnderDelimiterJoin = { ...base, sdkVersion: "a", method: "b:c" } as const;
    const table = indexComputeCapabilities([base, collidingUnderDelimiterJoin]);
    expect(Object.keys(table)).toHaveLength(2);
  });

  it("snapshots and freezes indexed Compute capabilities", () => {
    const capability = {
      sdkVersion: "0.9.0", method: "processResponse", provider: address("9"), model: "model",
      proofClass: "DECENTRALIZED_MODEL_TEE", processResponseVerified: true,
      boundHashes: {
        receiptDigest: hash("1"), requestDigest: hash("2"), responseDigest: hash("3"),
        signedTextSha256: hash("4"), requestSha256: hash("5"), rawResponseSha256: hash("6"),
        responseHeadersSha256: hash("7"), artifactHash: hash("8"),
      },
    } as const;
    const table = indexComputeCapabilities([capability]);
    (capability as any).model = "mutated";
    (capability.boundHashes as any).artifactHash = hash("9");
    const indexed = Object.values(table)[0];
    expect(indexed.model).toBe("model");
    expect(indexed.boundHashes.artifactHash).toBe(hash("8"));
    expect(Object.isFrozen(indexed)).toBe(true);
    expect(Object.isFrozen(indexed.boundHashes)).toBe(true);
  });

  it("rejects inherited serialization hooks instead of forging bound hashes", () => {
    let invoked = false;
    const forgedHashes = Object.create({
      toJSON: () => {
        invoked = true;
        return {
          receiptDigest: hash("9"), requestDigest: hash("9"), responseDigest: hash("9"),
          signedTextSha256: hash("9"), requestSha256: hash("9"), rawResponseSha256: hash("9"),
          responseHeadersSha256: hash("9"), artifactHash: hash("9"),
        };
      },
    });
    Object.assign(forgedHashes, computeCapability().boundHashes);
    expect(() => assertComputeCapability({
      ...computeCapability(),
      boundHashes: forgedHashes,
    })).toThrow(/plain|prototype|serialization/i);
    expect(invoked).toBe(false);
  });

  it("rejects accessors without invoking them", () => {
    let invoked = false;
    const capability = { ...computeCapability() } as Record<string, unknown>;
    Object.defineProperty(capability, "provider", {
      enumerable: true,
      get: () => {
        invoked = true;
        return address("9");
      },
    });
    expect(() => assertComputeCapability(capability)).toThrow(/accessor|plain/i);
    expect(invoked).toBe(false);
  });

  it.each([
    [{ ...historicalStorage, status: "STALE" }, /historical.*stale/i],
    [{ ...historicalStorage, capability: { ...historicalStorage.capability, networkProofVerified: true } }, /networkProofVerified/i],
    [{ ...historicalStorage, storageUploadTxHash: undefined, transactionHash: hash("3") }, /unknown.*transactionHash/i],
  ])("rejects prohibited observation combination %#", (observation, message) => {
    expect(() => assertObservation(observation)).toThrow(message as RegExp);
  });

  it("keeps historical validity independent of current access", () => {
    const historical = assertObservation(historicalStorage) satisfies ProofLockObservation;
    const current = assertObservation({
      scope: "CURRENT",
      subsystem: "storage",
      status: "UNAVAILABLE",
      reasonCode: "EVIDENCE_UNAVAILABLE",
      ...currentMetadata,
    });
    expect(historical.status).toBe("VERIFIED");
    expect(current.status).toBe("UNAVAILABLE");
  });

  it("uses distinct Registry and Storage field names without requiring different values", () => {
    expect(() => assertObservation({
      ...historicalStorage,
      registrySourceTxHash: historicalStorage.storageUploadTxHash,
    })).not.toThrow();
  });

  it("validates an optional Registry source transaction on Storage observations", () => {
    expect(() => assertObservation({
      ...historicalStorage,
      registrySourceTxHash: "not-a-hash",
    })).toThrow(/registrySourceTxHash/i);
  });

  it("rejects a non-VERIFIED observation with an unknown reason code", () => {
    expect(() => assertObservation({
      scope: "HISTORICAL",
      subsystem: "storage",
      status: "UNAVAILABLE",
      reasonCode: "MADE_UP_REASON",
      observedAt: historicalStorage.observedAt,
    })).toThrow(/reasonCode/i);
  });

  it("rejects verified payload fields on a non-VERIFIED observation", () => {
    expect(() => assertObservation({
      scope: "HISTORICAL",
      subsystem: "storage",
      status: "UNAVAILABLE",
      reasonCode: "EVIDENCE_UNAVAILABLE",
      observedAt: historicalStorage.observedAt,
      storageRoot: historicalStorage.storageRoot,
    })).toThrow(/non-VERIFIED.*payload/i);
  });

  it("rejects a subsystem-incompatible verified payload", () => {
    expect(() => assertObservation({
      scope: "HISTORICAL",
      subsystem: "identity",
      status: "VERIFIED",
      observedAt: historicalStorage.observedAt,
      capability: historicalStorage.capability,
    })).toThrow(/capability.*identity|identity.*capability/i);
  });

  it.each([
    [{ registrySourceTxHash: hash("9") }, /registrySourceTxHash.*identity|identity.*registrySourceTxHash/i],
    [{ allowed: true }, /allowed.*identity|identity.*allowed/i],
    [{ storageRoot: hash("1") }, /storage.*identity|identity.*storage/i],
    [{ reasonCode: "ALLOWED" }, /reasonCode.*identity|identity.*reasonCode/i],
  ])("rejects another identity-incompatible payload %#", (payload, message) => {
    expect(() => assertObservation({
      scope: "HISTORICAL",
      subsystem: "identity",
      status: "VERIFIED",
      observedAt: historicalStorage.observedAt,
      ...payload,
    })).toThrow(message as RegExp);
  });

  it.each(["lease", "gate", "consumer"] as const)(
    "rejects historical VERIFIED facts for current-only %s",
    (subsystem) => {
      expect(() => assertObservation({
        scope: "HISTORICAL",
        subsystem,
        status: "VERIFIED",
        observedAt: historicalStorage.observedAt,
      })).toThrow(/historical.*verified/i);
    },
  );

  it.each(["checks", "compute", "storage", "registry"] as const)(
    "rejects current VERIFIED facts for historical-plane %s",
    (subsystem) => {
      expect(() => assertObservation({
        scope: "CURRENT",
        subsystem,
        status: "VERIFIED",
        ...currentMetadata,
      })).toThrow(/current.*verified/i);
    },
  );

  it("restricts BLOCKED to current policy observations", () => {
    expect(() => assertObservation({
      scope: "HISTORICAL",
      subsystem: "gate",
      status: "BLOCKED",
      observedAt: historicalStorage.observedAt,
    })).toThrow(/blocked.*current/i);
    expect(() => assertObservation({
      scope: "CURRENT",
      subsystem: "compute",
      status: "BLOCKED",
      ...currentMetadata,
    })).toThrow(/blocked.*policy/i);
  });

  it("rejects ALLOWED as a reason for a current BLOCKED Gate", () => {
    expect(() => assertObservation({
      scope: "CURRENT",
      subsystem: "gate",
      status: "BLOCKED",
      reasonCode: "ALLOWED",
      ...currentMetadata,
    })).toThrow(/blocked.*allowed|allowed.*blocked/i);
  });

  it("requires explicit success for a CURRENT VERIFIED consumer", () => {
    expect(() => assertObservation({
      scope: "CURRENT", subsystem: "consumer", status: "VERIFIED", ...currentMetadata,
    })).toThrow(/accepted/i);
    expect(assertObservation({
      scope: "CURRENT", subsystem: "consumer", status: "VERIFIED", accepted: true, ...currentMetadata,
    }).status).toBe("VERIFIED");
  });

  it("accepts only an explicit current Registry record-read operation", () => {
    expect(assertObservation({
      scope: "CURRENT", subsystem: "registry", status: "VERIFIED",
      operation: "CURRENT_RECORD_READ", registrySourceTxHash: hash("9"), ...currentMetadata,
    }).status).toBe("VERIFIED");
  });

  it.each([
    [{ ...historicalStorage, networkProofVerified: true }, /unknown.*networkProofVerified/i],
    [{ ...historicalStorage, transactionHash: hash("9") }, /unknown.*transactionHash/i],
    [{ ...historicalStorage, storageRoot: hash("0") }, /storageRoot.*nonzero/i],
    [{ ...historicalStorage, extra: "field" }, /unknown.*extra/i],
    [{ scope: "HISTORICAL", subsystem: "identity", status: "VERIFIED", observedAt: "2026-08-28" }, /observedAt.*ISO/i],
    [{ scope: "HISTORICAL", subsystem: "identity", status: "VERIFIED", observedAt: historicalStorage.observedAt, unknown: true }, /unknown.*unknown/i],
  ])("strictly rejects adversarial historical observation %#", (observation, message) => {
    expect(() => assertObservation(observation)).toThrow(message as RegExp);
  });

  it("rejects zero Compute provider provenance", () => {
    const capability = {
      sdkVersion: "0.9.0", method: "processResponse", provider: address("0"), model: "model",
      proofClass: "DECENTRALIZED_MODEL_TEE", processResponseVerified: true,
      boundHashes: {
        receiptDigest: hash("1"), requestDigest: hash("2"), responseDigest: hash("3"),
        signedTextSha256: hash("4"), requestSha256: hash("5"), rawResponseSha256: hash("6"),
        responseHeadersSha256: hash("7"), artifactHash: hash("8"),
      },
    } as const;
    expect(() => assertObservation({
      scope: "HISTORICAL", subsystem: "compute", status: "VERIFIED",
      observedAt: historicalStorage.observedAt, capability,
    })).toThrow(/provider.*nonzero/i);
  });

  it("requires canonical positive current block numbers and strict freshness metadata", () => {
    expect(() => assertObservation({
      scope: "CURRENT", subsystem: "identity", status: "VERIFIED",
      ...currentMetadata, observationBlockNumber: "1e3",
    })).toThrow(/observationBlockNumber.*decimal/i);
    expect(() => assertObservation({
      scope: "CURRENT", subsystem: "identity", status: "VERIFIED",
      ...currentMetadata, serverIssuedAt: "2026-08-28 16:00:00Z",
    })).toThrow(/serverIssuedAt.*ISO/i);
  });

  it("anchors freshness to observedAt instead of a newer serialization time", () => {
    const observation = assertObservation({
      scope: "CURRENT", subsystem: "identity", status: "VERIFIED",
      ...currentMetadata,
      observedAt: "2026-08-28T15:00:00.000Z",
      serverIssuedAt: "2026-08-28T16:00:00.000Z",
      freshnessExpiresAt: "2026-08-28T15:01:00.000Z",
    });
    expect(observationStatusAt(observation, Date.parse("2026-08-28T16:00:00.000Z"))).toBe("STALE");
    expect(() => assertObservation({
      ...observation,
      freshnessExpiresAt: "2026-08-28T16:01:00.000Z",
    })).toThrow(/freshnessExpiresAt.*observedAt.*ttlMs/i);
  });
});
