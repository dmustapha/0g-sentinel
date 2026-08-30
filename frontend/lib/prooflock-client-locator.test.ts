import { afterEach, describe, expect, it, vi } from "vitest";

import { computeProofId, discoverProofLocks, readProofLockDetail, resolveIdentityLocator } from "./prooflock-client";
import { computeProofLockId } from "../server/prooflock/chain";
import { canonicalIdentity, discoveryResponse, fixtureIds, proofLockDetail } from "../tests/e2e/fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("server-derived Registry locators", () => {
  it("accepts a bound identity locator and rejects a substituted Agent ID", async () => {
    stubJson({ identity: canonicalIdentity(), identityKey: fixtureIds.identityKey });
    await expect(resolveIdentityLocator("7")).resolves.toMatchObject({ identityKey: fixtureIds.identityKey });

    stubJson({ identity: canonicalIdentity("8"), identityKey: hex32("f") });
    await expect(resolveIdentityLocator("7")).rejects.toThrow("binding is inconsistent");
  });

  it("rejects a detail locator that is not bound to the requested identity", async () => {
    const detail = proofLockDetail();
    stubJson({ ...detail, locator: { ...detail.locator, identityKey: hex32("f") } });
    await expect(readProofLockDetail(fixtureIds.identityKey, undefined, "7"))
      .rejects.toThrow("binding is inconsistent");
  });

  it.each([
    ["proof ID", (detail: ReturnType<typeof proofLockDetail>) => ({ ...detail.locator,
      proofId: hex32("f") })],
    ["Registry", (detail: ReturnType<typeof proofLockDetail>) => ({ ...detail.locator,
      registryAddress: `0x${"ff".repeat(20)}` })],
  ])("rejects a detail locator with a substituted %s", async (_label, mutate) => {
    const detail = proofLockDetail(); stubJson({ ...detail, locator: mutate(detail) });
    await expect(readProofLockDetail(fixtureIds.identityKey, undefined, "7"))
      .rejects.toThrow("binding is inconsistent");
  });

  it("rejects a discovery locator whose finalized source tuple was substituted", async () => {
    const body = discoveryResponse(); const first = body.identities[0]!;
    stubJson({ ...body, identities: [{ ...first,
      locator: { ...first.locator!, transactionHash: hex32("f") } }] });
    await expect(discoverProofLocks()).rejects.toThrow("Discovery metadata is inconsistent");
  });

  it.each([
    ["proof ID", { proofId: hex32("f") }],
    ["Registry", { registryAddress: `0x${"ff".repeat(20)}` }],
  ])("rejects a discovery locator with a substituted %s", async (_label, mutation) => {
    const body = discoveryResponse(); const first = body.identities[0]!;
    stubJson({ ...body, identities: [{ ...first, locator: { ...first.locator!, ...mutation } }] });
    await expect(discoverProofLocks()).rejects.toThrow("Discovery metadata is inconsistent");
  });

  it("preserves exact proof ID parity while moving derivation to the server", () => {
    const record = proofLockDetail().proofLock;
    const serverRecord = { ...record, version: BigInt(record.version), issuedAt: BigInt(record.issuedAt),
      validUntil: BigInt(record.validUntil) };
    expect(computeProofLockId(fixtureIds.registryAddress, serverRecord))
      .toBe(computeProofId(fixtureIds.registryAddress, record));
  });
});

function stubJson(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  })));
}

function hex32(byte: string): `0x${string}` { return `0x${byte.repeat(64)}`; }
