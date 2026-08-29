import { describe, expect, it } from "vitest";

import {
  coverageItems,
  compareProofLockUrgency,
  gateReasonMeta,
  leaseStatus,
  verificationSummary,
} from "./prooflock-status";
import type { ProofLockRecord } from "./prooflock-types";
import type { ProofLockInventoryItem } from "./prooflock-types";

const lock = (overrides: Partial<ProofLockRecord> = {}): ProofLockRecord => ({
  identityKey: `0x${"11".repeat(32)}`,
  subject: `0x${"22".repeat(20)}`,
  envelopeDigest: `0x${"33".repeat(32)}`,
  storageRoot: `0x${"44".repeat(32)}`,
  computeRoot: `0x${"55".repeat(32)}`,
  artifactHash: `0x${"66".repeat(32)}`,
  runtimeCodeHash: `0x${"77".repeat(32)}`,
  version: "2",
  issuedAt: "1000",
  validUntil: "704800",
  policyVersion: 3,
  behavioralScore: 12,
  codeRisk: 0,
  coverage: 0x7f,
  state: 1,
  stateReason: 0,
  ...overrides,
});

describe("ProofLock status semantics", () => {
  it("never calls SAFE or a current lease admitted without Gate ALLOWED", () => {
    expect(verificationSummary({ historicalMatch: true, lease: "ACTIVE", gateReason: 3 })).toEqual({
      historical: "MATCH",
      current: "BLOCKED",
      admitted: false,
    });
    expect(verificationSummary({ historicalMatch: false, lease: "ACTIVE", gateReason: 0 }).admitted).toBe(true);
  });

  it.each([
    [0, "ALLOWED", "Allowed"],
    [1, "NO_PROOF", "No ProofLock"],
    [2, "REVOKED", "Revoked"],
    [3, "DRIFTED", "Drift detected"],
    [4, "EXPIRED", "Lease expired"],
    [5, "SUBJECT_CHANGED", "Agent wallet changed"],
    [6, "RUNTIME_CODE_DRIFT", "Runtime code drift"],
    [7, "POLICY_TOO_OLD", "Policy too old"],
    [8, "COVERAGE_INCOMPLETE", "Coverage incomplete"],
    [9, "COMPUTE_UNVERIFIED", "Compute unverified"],
    [10, "STORAGE_UNVERIFIED", "Storage unverified"],
    [11, "BEHAVIORAL_RISK", "Behavioral policy denied"],
    [12, "CODE_RISK", "Code policy denied"],
    [13, "IDENTITY_UNAVAILABLE", "Identity unavailable"],
    [14, "AGENT_NOT_FOUND", "Agent not found"],
    [15, "AGENT_WALLET_UNSET", "Agent wallet unset"],
    [16, "IDENTITY_MISMATCH", "Identity mismatch"],
  ])("maps Gate reason %i to stable code %s", (reason, code, label) => {
    expect(gateReasonMeta(reason)).toMatchObject({ code, label, allowed: reason === 0 });
  });

  it("fails closed for an unknown Gate reason", () => {
    expect(gateReasonMeta(99)).toMatchObject({ code: "UNKNOWN_REASON", allowed: false });
  });

  it("derives active, expiring, expired, revoked, and drifted lease states", () => {
    expect(leaseStatus(lock(), 10_000)).toBe("ACTIVE");
    expect(leaseStatus(lock({ validUntil: "10500" }), 10_000)).toBe("EXPIRING");
    expect(leaseStatus(lock({ validUntil: "9999" }), 10_000)).toBe("EXPIRED");
    expect(leaseStatus(lock({ state: 2 }), 10_000)).toBe("REVOKED");
    expect(leaseStatus(lock({ state: 3 }), 10_000)).toBe("DRIFTED");
  });

  it("orders whole discovery rows by operational urgency with Gate denial ahead of admitted ACTIVE", () => {
    const items = [
      item("01", {}, 100, 0),
      item("02", { state: 3 }, 100, 3),
      item("03", { state: 2 }, 100, 2),
      item("04", { validUntil: "9999" }, 100, 0),
      item("05", { coverage: 0x3f }, 100, 0),
      item("06", {}, 100, 11),
      unavailable("07", 100),
    ];
    expect(items.sort((a, b) => compareProofLockUrgency(a, b, 10_000))
      .map((value) => value.identityKey.slice(2, 4))).toEqual(["02", "03", "06", "04", "05", "07", "01"]);
  });

  it("uses block-descending then identity-ascending deterministic ties", () => {
    const items = [item("03", {}, 99, 11), item("02", {}, 100, 11), item("01", {}, 100, 11)];
    expect(items.sort((a, b) => compareProofLockUrgency(a, b, 10_000))
      .map((value) => value.identityKey.slice(2, 4))).toEqual(["01", "02", "03"]);
  });

  it("expands the fixed 0x7f mask into seven named typed checks", () => {
    const full = coverageItems(0x7f);
    expect(full).toHaveLength(7);
    expect(full.every((item) => item.covered)).toBe(true);
    expect(coverageItems(0x5f).find((item) => item.bit === 0x20)?.covered).toBe(false);
  });
});

function item(byte: string, overrides: Partial<ProofLockRecord>, blockNumber: number, gateReason: number): ProofLockInventoryItem {
  const wallet = `0x${"99".repeat(20)}` as `0x${string}`;
  const proofLock = lock({ identityKey: `0x${byte.repeat(32)}`, subject: wallet, ...overrides });
  return { status: "VERIFIED", identityKey: proofLock.identityKey, proofId: `0x${"bb".repeat(32)}`,
    transactionHash: `0x${"aa".repeat(32)}`,
    blockNumber, proofLock, detail: { status: "VERIFIED", identity: { identityKey: proofLock.identityKey,
      namespace: "eip155", chainId: 16661, registryAddress: `0x${"88".repeat(20)}`, agentId: byte,
      owner: wallet, agentWallet: wallet, registrationUri: "https://agent.test", registrationDigest: `0x${"77".repeat(32)}`,
      sourceBlockNumber: "90", sourceBlockHash: `0x${"66".repeat(32)}` }, resolution: { owner: wallet,
      agentWallet: wallet, agentURI: "https://agent.test", registrationDigest: `0x${"77".repeat(32)}`,
      sourceBlockNumber: "90", sourceBlockHash: `0x${"66".repeat(32)}` }, gate: { status: "VERIFIED",
      allowed: gateReason === 0, reason: gateReason, subject: wallet, version: proofLock.version }, consumer: {
      status: "VERIFIED", accepted: gateReason === 0, address: `0x${"55".repeat(20)}`, subject: wallet,
      version: proofLock.version } } };
}

function unavailable(byte: string, blockNumber: number): ProofLockInventoryItem {
  return { status: "ENRICHMENT_UNAVAILABLE", identityKey: `0x${byte.repeat(32)}`,
    transactionHash: `0x${"aa".repeat(32)}`, blockNumber, code: "DEPENDENCY_UNAVAILABLE" };
}
