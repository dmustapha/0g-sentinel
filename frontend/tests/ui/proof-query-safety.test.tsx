// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

import ProofDetailPage from "../../app/proof/[proofId]/page";

const proofId = h("1");
const identityKey = h("2");

afterEach(() => cleanup());

describe("proof source query display safety", () => {
  it.each([
    "javascript:alert(1)",
    `tx-${String.fromCharCode(0)}-control`,
    `tx-${String.fromCharCode(0x202e)}-bidi`,
    "x".repeat(10_000),
  ])("never renders an invalid hostile source query", (hostile) => {
    navigation.query = query(hostile);
    const view = render(<ProofDetailPage params={{ proofId }} />);
    expect(screen.getByText("Invalid value")).toBeTruthy();
    expect(view.container.textContent).not.toContain(hostile);
    expect(screen.queryByRole("button", { name: "Verify exact evidence" })).toBeNull();
  });

  it("renders only the normalized exact hash in an isolated LTR element", () => {
    const upper = `0x${"AB".repeat(32)}`;
    navigation.query = query(upper);
    render(<ProofDetailPage params={{ proofId }} />);
    const value = screen.getByText(upper.toLowerCase());
    expect(value.tagName).toBe("BDI");
    expect(value.getAttribute("dir")).toBe("ltr");
    expect(screen.queryByText(upper)).toBeNull();
  });
});

function query(sourceTxHash: string): string {
  return new URLSearchParams({ identityKey, sourceTxHash }).toString();
}
function h(byte: string): `0x${string}` { return `0x${byte.repeat(64)}`; }
