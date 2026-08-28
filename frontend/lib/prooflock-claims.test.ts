import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLAIM_REGISTRY,
  CLAIM_KEYS,
  assertClaimAllowed,
  claimFor,
  formatComputeClaim,
} from "./prooflock-claims";
import { assertObservation, observationStatusAt } from "./prooflock-observations";

const hash = (byte: string) => `0x${byte.repeat(64)}` as const;
const address = (byte: string) => `0x${byte.repeat(40)}` as const;
const current = {
  observedAt: "2026-08-28T16:00:00.000Z",
  observationBlockNumber: "1234",
  observationBlockHash: hash("2"),
  serverIssuedAt: "2026-08-28T16:00:00.000Z",
  ttlMs: 60_000,
  freshnessExpiresAt: "2026-08-28T16:01:00.000Z",
} as const;

const storageObservation = () => {
  const observation = assertObservation({
    scope: "HISTORICAL", subsystem: "storage", status: "VERIFIED",
    observedAt: current.observedAt, storageRoot: hash("6"), artifactHash: hash("7"),
    storageUploadTxHash: hash("1"),
    capability: {
      proofClass: "ROOT_MATCHED_NO_NETWORK_PROOF",
      retrievalVerified: true,
      networkProofVerified: false,
    },
  });
  if (observation.scope !== "HISTORICAL" || observation.status !== "VERIFIED" ||
      observation.subsystem !== "storage") throw new TypeError("unexpected storage observation");
  return observation;
};

function currentSuccess(subsystem: "lease"): Extract<ReturnType<typeof assertObservation>, { subsystem: "lease"; status: "VERIFIED" }>;
function currentSuccess(subsystem: "gate"): Extract<ReturnType<typeof assertObservation>, { subsystem: "gate"; status: "VERIFIED" }>;
function currentSuccess(subsystem: "consumer"): Extract<ReturnType<typeof assertObservation>, { subsystem: "consumer"; status: "VERIFIED" }>;
function currentSuccess(subsystem: "lease" | "gate" | "consumer") {
  const payload = subsystem === "gate" ? { allowed: true, reasonCode: "ALLOWED" } :
    subsystem === "consumer" ? { accepted: true } : {};
  const observation = assertObservation({
    scope: "CURRENT", subsystem, status: "VERIFIED", ...payload, ...current,
  });
  if (observation.scope !== "CURRENT" || observation.status !== "VERIFIED" ||
      observation.subsystem !== subsystem) throw new TypeError(`unexpected ${subsystem} observation`);
  return observation as Extract<ReturnType<typeof assertObservation>, {
    subsystem: "lease" | "gate" | "consumer"; status: "VERIFIED";
  }>;
}

const admissionObservations = () => ({
  lease: currentSuccess("lease"),
  gate: currentSuccess("gate"),
  consumer: currentSuccess("consumer"),
});

const registryObservation = () => {
  const observation = assertObservation({
    scope: "CURRENT", subsystem: "registry", status: "VERIFIED",
    operation: "CURRENT_RECORD_READ", registrySourceTxHash: hash("9"), ...current,
  });
  if (observation.scope !== "CURRENT" || observation.status !== "VERIFIED" ||
      observation.subsystem !== "registry") throw new TypeError("unexpected Registry observation");
  return observation;
};

describe("ProofLock claim registry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-28T16:00:30.000Z");
  });

  afterEach(() => vi.useRealTimers());

  it("permits fully qualified static verifier language", () => {
    const claim = claimFor("verifier");
    expect(assertClaimAllowed(claim)).toBe(claim.text);
    expect(claim.text).toContain(CLAIM_REGISTRY.verifier.qualification);
  });

  it("binds chain history to a verified current Registry read", () => {
    const claim = claimFor("chainHistory", registryObservation());
    expect(assertClaimAllowed(claim)).toContain(hash("9"));
    expect(claim.text).toContain("block 1234");
  });

  it("rejects a stale current Registry read after its status expires", () => {
    const registry = registryObservation();
    vi.setSystemTime(current.freshnessExpiresAt);
    expect(observationStatusAt(registry)).toBe("STALE");
    expect(() => claimFor("chainHistory", registry)).toThrow(/stale|fresh/i);
  });

  it("governs Storage with its upload transaction and honest capability", () => {
    const claim = claimFor("storage", storageObservation());
    expect(assertClaimAllowed(claim)).toContain(`0x${"1".repeat(64)}`);
    expect(claim.text).toContain(hash("6"));
    expect(claim.text).toContain(hash("7"));
    expect(claim.text).toContain("ROOT_MATCHED_NO_NETWORK_PROOF");
    expect(claim.text).toContain("retrievalVerified: true");
    expect(claim.text).toContain("networkProofVerified: false");
  });

  it("governs admission with current block, observation time, and freshness", () => {
    const claim = claimFor("admission", admissionObservations());
    expect(assertClaimAllowed(claim)).toContain("block 1234");
    expect(claim.text).toContain("Gate allowed: true (ALLOWED)");
    expect(claim.text).toContain("consumer accepted: true");
    expect(claim.text).toContain("2026-08-28T16:01:00.000Z");
  });

  it("rejects stale admission observations after their status expires", () => {
    const observations = admissionObservations();
    vi.setSystemTime(current.freshnessExpiresAt);
    expect(observationStatusAt(observations.gate)).toBe("STALE");
    expect(() => claimFor("admission", observations)).toThrow(/stale|fresh/i);
  });

  it("rejects admission observations that do not share one coordinate", () => {
    const observations = admissionObservations();
    const gate = {
      ...observations.gate,
      observedAt: "2026-08-28T17:00:00.000Z",
      serverIssuedAt: "2026-08-28T17:00:00.000Z",
      freshnessExpiresAt: "2026-08-28T17:01:00.000Z",
    };
    expect(() => (claimFor as any)("admission", { ...observations, gate })).toThrow(/coordinate/i);
  });

  it("rejects admission without Gate and consumer success", () => {
    const observations = admissionObservations();
    expect(() => (claimFor as any)("admission", {
      ...observations,
      gate: { ...observations.gate, status: "BLOCKED", allowed: false, reasonCode: "NO_PROOF" },
    })).toThrow(/gate|verified|payload/i);
    expect(() => (claimFor as any)("admission", {
      ...observations,
      consumer: { ...observations.consumer, accepted: false },
    })).toThrow(/consumer|accepted/i);
  });

  it("governs drift with its observation time", () => {
    const claim = claimFor("drift", { observedAt: "2026-08-28T16:00:00.000Z" });
    expect(assertClaimAllowed(claim)).toContain("2026-08-28T16:00:00.000Z");
  });

  it("governs discovery with actual range and cap", () => {
    const claim = claimFor("discovery", { fromBlock: "100", toBlock: "200", cap: 50 });
    expect(assertClaimAllowed(claim)).toContain("block 100 to 200, capped at 50");
    expect(claim.text).not.toMatch(/\bX\b|\bY\b|\bN\b/);
  });

  it("governs authority with named scanners and guardian disclosure", () => {
    const claim = claimFor("authority", {
      submittedBy: address("3"),
      authorizedScanners: [address("3"), address("4")],
      sourceTxHash: hash("8"),
      guardianAddress: address("5"),
      guardianCanMarkDrift: true,
    });
    expect(assertClaimAllowed(claim)).toContain(`0x${"3".repeat(40)}`);
    expect(claim.text).toContain(`guardian 0x${"5".repeat(40)} can mark drift`);
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim.context)).toBe(true);
    expect(claim.text).toContain(hash("8"));
    expect(Object.isFrozen(claim.context.authorizedScanners)).toBe(true);
  });

  it.each(["compute", "storage", "chainHistory", "admission", "drift", "discovery", "authority"] as const)(
    "rejects a bare governed row for %s",
    (key) => {
      expect(() => (claimFor as any)(key)).toThrow(/context|formatter/i);
    },
  );

  it.each([
    ["storage", { storageUploadTxHash: hash("1"), networkProofVerified: false }],
    ["admission", current],
    ["chainHistory", { registrySourceTxHash: hash("9"), ...current }],
    ["drift", { observedAt: "August 28" }],
    ["discovery", { fromBlock: "200", toBlock: "100", cap: 0 }],
    ["discovery", { fromBlock: "1", toBlock: "18446744073709551616", cap: 50 }],
    ["authority", { submittedBy: address("6"), authorizedScanners: [address("3")], sourceTxHash: hash("8"), guardianAddress: address("5"), guardianCanMarkDrift: true }],
    ["authority", { submittedBy: address("3"), authorizedScanners: [address("3")], sourceTxHash: hash("0"), guardianAddress: address("5"), guardianCanMarkDrift: true }],
  ])("rejects incomplete or noncanonical context for %s", (key, context) => {
    expect(() => (claimFor as any)(key, context)).toThrow(/context|nonzero|canonical|ISO|range|cap|scanner/i);
  });

  it.each([
    "ProofLock is an offline verifier.",
    "This agent is universally safe.",
    "This agent is safe.",
    "ProofLock provides continuous drift monitoring.",
    "0G Storage networkProofVerified: true.",
    "This response is TEE-attested.",
  ])("rejects prohibited language: %s", (claim) => {
    expect(() => assertClaimAllowed(claim)).toThrow(/prohibited claim/i);
  });

  it("allows TEE-attested only with an exact proof class and successful verification", () => {
    const claim = formatComputeClaim({
      sdkVersion: "0.9.0", method: "processResponse", provider: `0x${"9".repeat(40)}`, model: "model",
      proofClass: "DECENTRALIZED_MODEL_TEE", processResponseVerified: true,
      boundHashes: {
        receiptDigest: `0x${"1".repeat(64)}`, requestDigest: `0x${"2".repeat(64)}`,
        responseDigest: `0x${"3".repeat(64)}`, signedTextSha256: `0x${"4".repeat(64)}`,
        requestSha256: `0x${"5".repeat(64)}`, rawResponseSha256: `0x${"6".repeat(64)}`,
        responseHeadersSha256: `0x${"7".repeat(64)}`, artifactHash: `0x${"8".repeat(64)}`,
      },
    });
    expect(assertClaimAllowed(claim)).toContain("DECENTRALIZED_MODEL_TEE");
  });

  it("does not let qualified TEE language bypass another prohibited claim", () => {
    const claim = "TEE-attested (proofClass: DECENTRALIZED_MODEL_TEE; processResponseVerified: true) offline verifier.";
    expect(() => assertClaimAllowed(claim)).toThrow(/prohibited claim: verifier/i);
  });

  it("does not let one qualified TEE occurrence launder an unqualified occurrence", () => {
    const claim = "TEE-attested (proofClass: DECENTRALIZED_MODEL_TEE; processResponseVerified: true); another TEE-attested response.";
    expect(() => assertClaimAllowed(claim)).toThrow(/prohibited claim: compute/i);
  });

  it.each([
    "Public root matching was verified.",
    "The agent is secure.",
    "Storage network‑proof verified.",
    "TEE‑attested (proofClass: DECENTRALIZED_MODEL_TEE; processResponseVerified: true).",
  ])("default-denies ungoverned rephrasing: %s", (claim) => {
    expect(() => assertClaimAllowed(claim)).toThrow(/ungoverned|prohibited claim/i);
  });

  it("publishes the permitted and prohibited language table", () => {
    expect(CLAIM_KEYS).toEqual([
      "compute", "storage", "chainHistory", "admission", "drift", "discovery", "verifier", "authority",
    ]);
    for (const key of CLAIM_KEYS) {
      expect(Object.isFrozen(CLAIM_REGISTRY[key])).toBe(true);
      expect(CLAIM_REGISTRY[key]).toEqual({
        permitted: expect.any(String),
        qualification: expect.any(String),
        prohibited: expect.any(String),
      });
    }
  });

  it.each([
    "This is an immutable record.",
    "This is an immutable verdict.",
    "All ProofLocks are listed.",
    "There is no centralized oracle.",
    "A single validator controls admission.",
    "A single-validator controls admission.",
    "The Storage network-proof verified successfully.",
  ])("rejects the remaining prohibited design language: %s", (claim) => {
    expect(() => assertClaimAllowed(claim)).toThrow(/prohibited claim/i);
  });
});
