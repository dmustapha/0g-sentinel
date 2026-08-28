import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SealLifecycle } from "../../components/SealLifecycle";
import { TrustRoleDisclosure } from "../../components/TrustRoleDisclosure";

describe("proof lifecycle and trust roles", () => {
  it("links the predecessor proof with the same identity key", () => {
    const proof = `0x${"11".repeat(32)}`; const key = `0x${"22".repeat(32)}`;
    const html = renderToStaticMarkup(React.createElement(SealLifecycle, { currentVersion: "2", previousProofId: proof, identityKey: key }));
    expect(html).toContain(`/proof/${proof}?identityKey=${key}`); expect(html).toContain("SUPERSEDED");
  });

  it("renders exact distinct admin, guardian, and validator roles", () => {
    const roles = { admin: `0x${"aa".repeat(20)}`, guardian: `0x${"bb".repeat(20)}`, validator: `0x${"cc".repeat(20)}` };
    const html = renderToStaticMarkup(React.createElement(TrustRoleDisclosure, { ...roles,
      custodyConstraint: "admin-scanner-guardian-must-remain-distinct" }));
    for (const [role, address] of Object.entries(roles)) { expect(html).toContain(role[0]!.toUpperCase() + role.slice(1)); expect(html).toContain(address); }
    expect(html).toContain("three distinct addresses");
    expect(html).toContain("admin-scanner-guardian-must-remain-distinct");
  });
});
