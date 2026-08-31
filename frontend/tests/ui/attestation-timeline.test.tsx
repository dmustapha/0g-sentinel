import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttestationTimeline, type TimelineHead } from "../../components/AttestationTimeline";

const IDENTITY_KEY = `0x${"22".repeat(32)}`;
const STORAGE_ROOT = `0x${"ab".repeat(32)}`;
const SOURCE_TX = `0x${"cd".repeat(32)}`;

function head(overrides: Partial<TimelineHead> = {}): TimelineHead {
  return { version: "2", storageRoot: STORAGE_ROOT, sourceTxHash: SOURCE_TX,
    gate: { status: "VERIFIED", label: "Allowed" }, drifted: false, verified: true, ...overrides };
}

describe("attestation timeline", () => {
  it("labels a version above one as RESEALED and links its source transaction to the 0G explorer", () => {
    const html = renderToStaticMarkup(React.createElement(AttestationTimeline,
      { head: head(), identityKey: IDENTITY_KEY }));
    expect(html).toContain("RESEALED");
    expect(html).toContain("v2");
    expect(html).toContain(`https://chainscan.0g.ai/tx/${SOURCE_TX}`);
    expect(html).toContain(STORAGE_ROOT);
    expect(html).toContain("Allowed");
  });

  it("labels the first version as SEALED and marks GENESIS when no predecessor exists", () => {
    const html = renderToStaticMarkup(React.createElement(AttestationTimeline,
      { head: head({ version: "1" }), identityKey: IDENTITY_KEY }));
    expect(html).toContain("SEALED");
    expect(html).toContain("GENESIS");
    expect(html).not.toContain("RESEALED");
  });

  it("surfaces a DRIFTED node without inventing an unproven newer version", () => {
    const html = renderToStaticMarkup(React.createElement(AttestationTimeline,
      { head: head({ drifted: true, gate: { status: "BLOCKED", label: "Blocked: drift detected" } }),
        identityKey: IDENTITY_KEY }));
    expect(html).toContain("DRIFTED");
    expect(html).toContain("RESEAL PENDING");
  });

  it("links the append-preserved predecessor proof under the same identity key", () => {
    const previous = `0x${"11".repeat(32)}`;
    const html = renderToStaticMarkup(React.createElement(AttestationTimeline,
      { head: head(), previousProofId: previous, identityKey: IDENTITY_KEY }));
    expect(html).toContain("SUPERSEDED");
    expect(html).toContain(`/proof/${previous}?identityKey=${IDENTITY_KEY}`);
  });

  it("notes a registry-only head where the historical source is not yet linked", () => {
    const html = renderToStaticMarkup(React.createElement(AttestationTimeline,
      { head: head({ sourceTxHash: undefined, verified: false }), identityKey: IDENTITY_KEY }));
    expect(html).toContain("Historical source unavailable");
    expect(html).toContain("Registry snapshot only");
    expect(html).not.toContain("chainscan.0g.ai/tx/");
  });
});
