import { afterEach, describe, expect, it, vi } from "vitest";

import { observationStatusAt } from "../../lib/prooflock-observations";
import { computeIdentityKey } from "../../server/prooflock/chain";
import {
  CURRENT_OBSERVATION_CAPABILITIES,
  observeCurrentAccess,
  type CurrentObservationDependencies,
} from "../../server/prooflock/current-observations";
import { ProofMismatchError } from "../../server/prooflock/errors";
import { ERC8004_IDENTITY_REGISTRY } from "../../server/prooflock/types";

const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const address = (byte: string) => `0x${byte.repeat(40)}` as `0x${string}`;
const blockHash = hash("a");
const observedAt = "2026-08-29T12:00:00.000Z";
const identity = {
  namespace: "eip155" as const,
  chainId: 16661 as const,
  registryAddress: ERC8004_IDENTITY_REGISTRY,
  agentId: "7",
};
const identityKey = computeIdentityKey(identity);
const resolution = {
  identity,
  owner: address("1"),
  agentWallet: address("2"),
  agentURI: "https://agent.example/card.json",
  registrationDigest: hash("3"),
  sourceBlockNumber: "123",
  sourceBlockHash: blockHash,
  card: {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const,
    registrations: [],
  },
};
const lease = {
  identityKey,
  subject: resolution.agentWallet,
  envelopeDigest: hash("4"),
  storageRoot: hash("5"),
  computeRoot: hash("6"),
  artifactHash: hash("7"),
  runtimeCodeHash: hash("8"),
  version: 2n,
  issuedAt: 1_700_000_000n,
  validUntil: 2_000_000_000n,
  policyVersion: 2,
  behavioralScore: 7,
  codeRisk: 0,
  coverage: 0x7f,
  state: 1,
  stateReason: 0,
};

function dependencies(overrides: Partial<CurrentObservationDependencies> = {}): CurrentObservationDependencies {
  return {
    pinFinalizedBlock: vi.fn().mockResolvedValue({ number: 123, hash: blockHash, timestamp: 1_800_000_000 }),
    confirmPinnedBlock: vi.fn().mockResolvedValue(true),
    resolveIdentity: vi.fn().mockResolvedValue(resolution),
    readLease: vi.fn().mockResolvedValue(lease),
    readGate: vi.fn().mockResolvedValue({ allowed: true, reason: 0,
      subject: resolution.agentWallet, version: 2n }),
    readConsumer: vi.fn().mockResolvedValue({ accepted: true, address: address("9"),
      subject: resolution.agentWallet, version: 2n }),
    ...overrides,
  };
}

const options = {
  ttlMs: 60_000,
  readTimeoutMs: 100,
  confirmationTimeoutMs: 100,
  now: () => new Date(observedAt),
  signal: new AbortController().signal,
};

afterEach(() => vi.useRealTimers());

describe("pinned current-access observations", () => {
  it("pins one finalized block once and issues every independent read at that block", async () => {
    const deps = dependencies();
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, deps, options);

    expect(deps.pinFinalizedBlock).toHaveBeenCalledTimes(1);
    expect(deps.resolveIdentity).toHaveBeenCalledWith("7", 123, expect.any(AbortSignal));
    expect(deps.readLease).toHaveBeenCalledWith(identityKey, 123, expect.any(AbortSignal));
    expect(deps.readGate).toHaveBeenCalledWith("7", 123, expect.any(AbortSignal));
    expect(deps.readConsumer).toHaveBeenCalledWith("7", identityKey, 123, expect.any(AbortSignal));
    expect(deps.confirmPinnedBlock).toHaveBeenCalledWith(123, blockHash, expect.any(AbortSignal));
    const readSignals = [deps.resolveIdentity, deps.readLease, deps.readGate, deps.readConsumer]
      .map((read) => vi.mocked(read).mock.calls[0]!.at(-1));
    expect(new Set(readSignals).size).toBe(4);
    expect(readSignals).not.toContain(options.signal);
    expect(result).toMatchObject({
      schema: "sentinel.prooflock/current-access-v1",
      version: 1,
      agentId: "7",
      identityKey,
      observationBlock: { number: "123", hash: blockHash, timestamp: "1800000000" },
      observations: {
        identity: { capability: CURRENT_OBSERVATION_CAPABILITIES.identity,
          reason: "OBSERVED", observation: { scope: "CURRENT", subsystem: "identity",
            status: "VERIFIED", observedAt, observationBlockNumber: "123",
            observationBlockHash: blockHash, ttlMs: 60_000,
            freshnessExpiresAt: "2026-08-29T12:01:00.000Z" } },
        lease: { capability: CURRENT_OBSERVATION_CAPABILITIES.lease,
          reason: "OBSERVED", observation: { status: "VERIFIED" }, value: { version: "2" } },
        gate: { capability: CURRENT_OBSERVATION_CAPABILITIES.gate,
          reason: "ALLOWED", observation: { status: "VERIFIED", reasonCode: "ALLOWED" } },
        consumer: { capability: CURRENT_OBSERVATION_CAPABILITIES.consumer,
          reason: "OBSERVED", observation: { status: "VERIFIED", accepted: true } },
      },
    });
  });

  it("settles a blocked Gate independently from successful identity, lease, and consumer reads", async () => {
    const deps = dependencies({
      readLease: vi.fn().mockResolvedValue({ ...lease, state: 3 }),
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason: 3,
        subject: resolution.agentWallet, version: 2n }),
      readConsumer: vi.fn().mockResolvedValue({ accepted: false, address: address("9"),
        subject: resolution.agentWallet, version: 2n }),
    });
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, deps, options);

    expect(result.observations.identity.observation.status).toBe("VERIFIED");
    expect(result.observations.lease.observation.status).toBe("BLOCKED");
    expect(result.observations.gate).toMatchObject({ reason: "DRIFTED",
      observation: { status: "BLOCKED", reasonCode: "DRIFTED" },
      value: { allowed: false, reason: 3 } });
    expect(result.observations.consumer).toMatchObject({ reason: "GUARDED_CONSUMER_BLOCKED",
      observation: { status: "BLOCKED" }, value: { accepted: false } });
  });

  it("preserves successful observations when one dependency fails", async () => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readLease: vi.fn().mockRejectedValue(new Error("private Registry RPC detail")),
    }), options);

    expect(result.observations.lease).toMatchObject({ reason: "CURRENT_LEASE_UNAVAILABLE",
      observation: { status: "UNAVAILABLE", reasonCode: "EVIDENCE_UNAVAILABLE" }, value: null });
    expect(result.observations.identity.observation.status).toBe("VERIFIED");
    expect(result.observations.gate.observation.status).toBe("VERIFIED");
    expect(result.observations.consumer.observation.status).toBe("VERIFIED");
    expect(JSON.stringify(result)).not.toContain("private Registry RPC detail");
  });

  it("returns stable unavailable entries for multiple dependency failures", async () => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      resolveIdentity: vi.fn().mockRejectedValue(new Error("identity detail")),
      readGate: vi.fn().mockRejectedValue(new Error("gate detail")),
      readConsumer: vi.fn().mockRejectedValue(new Error("consumer detail")),
    }), options);

    expect(result.observations.identity).toMatchObject({ reason: "CURRENT_IDENTITY_UNAVAILABLE",
      observation: { status: "UNAVAILABLE", reasonCode: "IDENTITY_UNAVAILABLE" } });
    expect(result.observations.lease.observation.status).toBe("VERIFIED");
    expect(result.observations.gate).toMatchObject({ reason: "CURRENT_GATE_UNAVAILABLE",
      observation: { status: "UNAVAILABLE" } });
    expect(result.observations.consumer).toMatchObject({ reason: "CURRENT_CONSUMER_UNAVAILABLE",
      observation: { status: "UNAVAILABLE" } });
  });

  it("settles an abort-ignoring never-resolving dependency at its own deadline", async () => {
    vi.useFakeTimers();
    const deps = dependencies({ readLease: vi.fn(() => new Promise<never>(() => undefined)) });
    const pending = observeCurrentAccess({ agentId: "7", identityKey }, deps, options);
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result.observations.lease).toMatchObject({ reason: "CURRENT_LEASE_UNAVAILABLE",
      observation: { status: "UNAVAILABLE" }, value: null });
    expect(result.observations.identity.observation.status).toBe("VERIFIED");
    expect(deps.confirmPinnedBlock).toHaveBeenCalledTimes(1);
  });

  it("settles multiple never-resolving reads and preserves confirmation budget", async () => {
    vi.useFakeTimers();
    const never = vi.fn(() => new Promise<never>(() => undefined));
    const deps = dependencies({ resolveIdentity: never, readLease: never,
      readGate: never, readConsumer: never });
    const pending = observeCurrentAccess({ agentId: "7", identityKey }, deps, options);
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(Object.values(result.observations).map((entry) => entry.observation.status))
      .toEqual(["UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"]);
    expect(deps.confirmPinnedBlock).toHaveBeenCalledTimes(1);
  });

  it("aborts promptly without waiting for abort-ignoring dependency deadlines", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const never = vi.fn(() => new Promise<never>(() => undefined));
    const pending = observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      resolveIdentity: never, readLease: never, readGate: never, readConsumer: never,
    }), { ...options, signal: controller.signal });
    controller.abort(new DOMException("Canceled", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("bounds post-read block confirmation independently", async () => {
    vi.useFakeTimers();
    const pending = observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      confirmPinnedBlock: vi.fn(() => new Promise<never>(() => undefined)),
    }), options);
    const rejected = expect(pending).rejects.toThrow(/confirmation.*timed out/i);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
  });

  it("isolates contradictory same-block Gate and consumer facts as mismatches", async () => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readConsumer: vi.fn().mockResolvedValue({ accepted: false, address: address("9"),
        subject: resolution.agentWallet, version: 2n }),
    }), options);

    expect(result.observations.identity.observation.status).toBe("VERIFIED");
    expect(result.observations.lease.observation.status).toBe("VERIFIED");
    expect(result.observations.gate).toMatchObject({ reason: "CURRENT_GATE_MISMATCH",
      observation: { status: "MISMATCH" }, value: null });
    expect(result.observations.consumer).toMatchObject({ reason: "CURRENT_CONSUMER_MISMATCH",
      observation: { status: "MISMATCH" }, value: null });
  });

  it("isolates an ALLOWED tuple that contradicts the pinned identity and lease", async () => {
    const changedWallet = address("b");
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      resolveIdentity: vi.fn().mockResolvedValue({ ...resolution, agentWallet: changedWallet }),
      readGate: vi.fn().mockResolvedValue({ allowed: true, reason: 0,
        subject: changedWallet, version: 2n }),
      readConsumer: vi.fn().mockResolvedValue({ accepted: true, address: address("9"),
        subject: changedWallet, version: 2n }),
    }), options);
    expect(result.observations.identity.observation.status).toBe("VERIFIED");
    expect(result.observations.lease.observation.status).toBe("VERIFIED");
    expect(result.observations.gate.observation.status).toBe("MISMATCH");
    expect(result.observations.consumer.observation.status).toBe("MISMATCH");
  });

  it("checks an ALLOWED Gate against lease when identity is unavailable", async () => {
    const wrong = address("b");
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      resolveIdentity: vi.fn().mockRejectedValue(new Error("identity offline")),
      readGate: vi.fn().mockResolvedValue({ allowed: true, reason: 0, subject: wrong, version: 2n }),
      readConsumer: vi.fn().mockRejectedValue(new Error("consumer unavailable")),
    }), options);
    expect(result.observations.identity.observation.status).toBe("UNAVAILABLE");
    expect(result.observations.lease.observation.status).toBe("VERIFIED");
    expect(result.observations.gate.observation.status).toBe("MISMATCH");
  });

  it("checks an ALLOWED Gate against identity when lease is unavailable", async () => {
    const wrong = address("b");
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readLease: vi.fn().mockRejectedValue(new Error("lease offline")),
      readGate: vi.fn().mockResolvedValue({ allowed: true, reason: 0, subject: wrong, version: 2n }),
      readConsumer: vi.fn().mockRejectedValue(new Error("consumer unavailable")),
    }), options);
    expect(result.observations.identity.observation.status).toBe("VERIFIED");
    expect(result.observations.lease.observation.status).toBe("UNAVAILABLE");
    expect(result.observations.gate.observation.status).toBe("MISMATCH");
  });

  it("preserves legitimate blocked SUBJECT_CHANGED semantics", async () => {
    const changedWallet = address("b");
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      resolveIdentity: vi.fn().mockResolvedValue({ ...resolution, agentWallet: changedWallet }),
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason: 5,
        subject: changedWallet, version: 2n }),
      readConsumer: vi.fn().mockResolvedValue({ accepted: false, address: address("9"),
        subject: changedWallet, version: 2n }),
    }), options);
    expect(result.observations.gate).toMatchObject({ reason: "SUBJECT_CHANGED",
      observation: { status: "BLOCKED", reasonCode: "SUBJECT_CHANGED" },
      value: { allowed: false, subject: changedWallet } });
    expect(result.observations.consumer.observation.status).toBe("BLOCKED");
  });

  it.each([
    ["subject", { subject: address("b"), version: 2n }],
    ["version", { subject: resolution.agentWallet, version: 3n }],
  ])("rejects blocked Gate provenance with the wrong %s", async (_field, gate) => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason: 3, ...gate }),
      readConsumer: vi.fn().mockRejectedValue(new Error("consumer unavailable")),
    }), options);
    expect(result.observations.gate.observation.status).toBe("MISMATCH");
  });

  it.each([
    [13, "IDENTITY_UNAVAILABLE"], [14, "AGENT_NOT_FOUND"], [15, "AGENT_WALLET_UNSET"],
  ])("accepts exact zero-valued identity failure Gate reason %i", async (reason, code) => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      resolveIdentity: vi.fn().mockRejectedValue(new Error("identity failure")),
      readLease: vi.fn().mockRejectedValue(new Error("lease unavailable")),
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason,
        subject: address("0"), version: 0n }),
      readConsumer: vi.fn().mockRejectedValue(new Error("consumer unavailable")),
    }), options);
    expect(result.observations.gate).toMatchObject({ reason: code,
      observation: { status: "BLOCKED", reasonCode: code },
      value: { allowed: false, subject: address("0"), version: "0" } });
  });

  it.each([13, 14, 15])("rejects identity-failure Gate reason %i when identity is verified", async (reason) => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason,
        subject: address("0"), version: 0n }),
    }), options);
    expect(result.observations.identity.observation.status).toBe("VERIFIED");
    expect(result.observations.gate.observation.status).toBe("MISMATCH");
    expect(result.observations.consumer.observation.status).toBe("MISMATCH");
  });

  it.each([
    ["NO_PROOF", { version: 0n }, { allowed: false, reason: 3, subject: resolution.agentWallet, version: 0n }],
    ["REVOKED", { state: 2 }, { allowed: true, reason: 0, subject: resolution.agentWallet, version: 2n }],
    ["DRIFTED", { state: 3 }, { allowed: true, reason: 0, subject: resolution.agentWallet, version: 2n }],
    ["invalid state", { state: 0 }, { allowed: false, reason: 3, subject: resolution.agentWallet, version: 2n }],
    ["future issuance", { issuedAt: 1_800_000_001n }, { allowed: true, reason: 0, subject: resolution.agentWallet, version: 2n }],
    ["expiry", { validUntil: 1_800_000_000n }, { allowed: true, reason: 0, subject: resolution.agentWallet, version: 2n }],
    ["Compute bit", { coverage: 0x77 }, { allowed: false, reason: 8, subject: resolution.agentWallet, version: 2n }],
    ["Storage bit", { coverage: 0x5f }, { allowed: false, reason: 8, subject: resolution.agentWallet, version: 2n }],
    ["remaining coverage", { coverage: 0x6f }, { allowed: true, reason: 0, subject: resolution.agentWallet, version: 2n }],
    ["active lease", {}, { allowed: false, reason: 3, subject: resolution.agentWallet, version: 2n }],
  ])("rejects Gate reason contradicting intrinsic lease state: %s", async (_label, leaseOverride, gate) => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readLease: vi.fn().mockResolvedValue({ ...lease, ...leaseOverride }),
      readGate: vi.fn().mockResolvedValue(gate),
      readConsumer: vi.fn().mockRejectedValue(new Error("consumer unavailable")),
    }), options);
    expect(result.observations.gate.observation.status).toBe("MISMATCH");
  });

  it("gives SUBJECT_CHANGED priority over a revoked lease", async () => {
    const oldSubject = address("b");
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readLease: vi.fn().mockResolvedValue({ ...lease, subject: oldSubject, state: 2 }),
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason: 5,
        subject: resolution.agentWallet, version: 2n }),
      readConsumer: vi.fn().mockRejectedValue(new Error("consumer unavailable")),
    }), options);
    expect(result.observations.gate).toMatchObject({ reason: "SUBJECT_CHANGED",
      observation: { status: "BLOCKED" } });
  });

  it("accepts the exact NO_PROOF Gate result for a zero-version lease", async () => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readLease: vi.fn().mockResolvedValue({ ...lease, version: 0n }),
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason: 1,
        subject: resolution.agentWallet, version: 0n }),
      readConsumer: vi.fn().mockResolvedValue({ accepted: false, address: address("9"),
        subject: resolution.agentWallet, version: 0n }),
    }), options);
    expect(result.observations.lease).toMatchObject({ reason: "NO_PROOF",
      observation: { status: "BLOCKED" }, value: null });
    expect(result.observations.gate).toMatchObject({ reason: "NO_PROOF",
      observation: { status: "BLOCKED" } });
  });

  it("accepts maximumAge-style EXPIRED when local lease timestamps remain valid", async () => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason: 4,
        subject: resolution.agentWallet, version: 2n }),
      readConsumer: vi.fn().mockResolvedValue({ accepted: false, address: address("9"),
        subject: resolution.agentWallet, version: 2n }),
    }), options);
    expect(result.observations.gate).toMatchObject({ reason: "EXPIRED",
      observation: { status: "BLOCKED", reasonCode: "EXPIRED" } });
  });

  it.each([
    ["revoked", { ...lease, state: 2 }],
    ["subject changed before revoked", { ...lease, state: 2, subject: address("b") }],
  ])("rejects configuration-style EXPIRED behind higher-priority %s", async (_label, record) => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readLease: vi.fn().mockResolvedValue(record),
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason: 4,
        subject: resolution.agentWallet, version: 2n }),
      readConsumer: vi.fn().mockRejectedValue(new Error("consumer unavailable")),
    }), options);
    expect(result.observations.gate.observation.status).toBe("MISMATCH");
  });

  it.each([
    ["non-identity reason", { allowed: false, reason: 3, subject: address("0"), version: 0n }],
    ["identity-failure subject", { allowed: false, reason: 13, subject: address("b"), version: 0n }],
    ["identity-failure version", { allowed: false, reason: 13, subject: address("0"), version: 1n }],
    ["allowed zero tuple", { allowed: true, reason: 0, subject: address("0"), version: 0n }],
  ])("rejects hostile zero Gate combination: %s", async (_label, gate) => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      resolveIdentity: vi.fn().mockRejectedValue(new Error("identity unavailable")),
      readLease: vi.fn().mockRejectedValue(new Error("lease unavailable")),
      readGate: vi.fn().mockResolvedValue(gate),
      readConsumer: vi.fn().mockRejectedValue(new Error("consumer unavailable")),
    }), options);
    expect(result.observations.gate.observation.status).toBe("MISMATCH");
  });

  it("uses the pinned block timestamp, not server wall time, for lease expiry", async () => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      pinFinalizedBlock: vi.fn().mockResolvedValue({ number: 123, hash: blockHash,
        timestamp: Number(lease.validUntil) }),
    }), options);
    expect(result.observations.lease).toMatchObject({ reason: "EXPIRED",
      observation: { status: "BLOCKED", reasonCode: "EXPIRED" } });
  });

  it("rejects a canonical agentId and identityKey mismatch before any RPC work", async () => {
    const deps = dependencies();
    await expect(observeCurrentAccess({ agentId: "8", identityKey }, deps, options))
      .rejects.toBeInstanceOf(ProofMismatchError);
    expect(deps.pinFinalizedBlock).not.toHaveBeenCalled();
    expect(deps.readLease).not.toHaveBeenCalled();
  });

  it("rejects when the resolved identity recomputes to another identity key", async () => {
    const deps = dependencies({ resolveIdentity: vi.fn().mockResolvedValue({
      ...resolution,
      identity: { ...resolution.identity, agentId: "8" },
    }) });
    await expect(observeCurrentAccess({ agentId: "7", identityKey }, deps, options))
      .rejects.toBeInstanceOf(ProofMismatchError);
  });

  it.each([
    ["number", { sourceBlockNumber: "122" }],
    ["hash", { sourceBlockHash: hash("f") }],
  ])("rejects a resolved identity pinned to a contradictory block %s", async (_label, override) => {
    const deps = dependencies({ resolveIdentity: vi.fn().mockResolvedValue({
      ...resolution, ...override,
    }) });
    await expect(observeCurrentAccess({ agentId: "7", identityKey }, deps, options))
      .rejects.toBeInstanceOf(ProofMismatchError);
  });

  it("rejects a reorg-shaped pinned block hash mismatch instead of returning mixed facts", async () => {
    const deps = dependencies({ confirmPinnedBlock: vi.fn().mockResolvedValue(false) });
    await expect(observeCurrentAccess({ agentId: "7", identityKey }, deps, options))
      .rejects.toBeInstanceOf(ProofMismatchError);
  });

  it("fails closed on an inconsistent finalized-block response before issuing reads", async () => {
    const deps = dependencies({ pinFinalizedBlock: vi.fn().mockResolvedValue({
      number: 124, hash: "0x123", timestamp: 1_800_000_000 }) });
    await expect(observeCurrentAccess({ agentId: "7", identityKey }, deps, options))
      .rejects.toThrow(/finalized block/i);
    expect(deps.resolveIdentity).not.toHaveBeenCalled();
  });

  it("becomes stale at the server-issued TTL after background resume", async () => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies(), options);
    const gate = result.observations.gate.observation;
    expect(observationStatusAt(gate, Date.parse(observedAt) + 59_999)).toBe("VERIFIED");
    expect(observationStatusAt(gate, Date.parse(observedAt) + 60_000)).toBe("STALE");
  });

  it("also expires a previously blocked current decision after background resume", async () => {
    const result = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      readLease: vi.fn().mockResolvedValue({ ...lease, state: 3 }),
      readGate: vi.fn().mockResolvedValue({ allowed: false, reason: 3,
        subject: resolution.agentWallet, version: 2n }),
      readConsumer: vi.fn().mockResolvedValue({ accepted: false, address: address("9"),
        subject: resolution.agentWallet, version: 2n }),
    }), options);
    const gate = result.observations.gate.observation;
    expect(observationStatusAt(gate, Date.parse(observedAt) + 59_999)).toBe("BLOCKED");
    expect(observationStatusAt(gate, Date.parse(observedAt) + 60_000)).toBe("STALE");
  });

  it("does not mutate the last frozen snapshot when a later refresh fails", async () => {
    const first = await observeCurrentAccess({ agentId: "7", identityKey }, dependencies(), options);
    const before = structuredClone(first);
    await expect(observeCurrentAccess({ agentId: "7", identityKey }, dependencies({
      pinFinalizedBlock: vi.fn().mockRejectedValue(new Error("RPC offline")),
    }), options)).rejects.toThrow(/RPC offline/);
    expect(first).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.observations.gate)).toBe(true);
  });
});
