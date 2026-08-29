// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProofLockObservation } from "../../lib/prooflock-types";
import { ProofPlane as TypedProofPlane } from "./ProofPlane";

afterEach(cleanup);

const variants = ["primary", "secondary", "quiet", "destructive"] as const;
const states = ["idle", "pending", "disabled"] as const;

describe("Button primitive", () => {
  it.each(variants.flatMap((variant) => states.map((state) => [variant, state] as const)))
  ("renders the %s %s contract", async (variant, state) => {
    const { Button } = await import("./Button");
    render(<Button variant={variant} pending={state === "pending"} disabled={state === "disabled"}
      pendingLabel="Sealing proof">Seal proof</Button>);
    const name = state === "pending" ? "Sealing proof" : "Seal proof";
    const button = screen.getByRole("button", { name });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-variant")).toBe(variant);
    expect(button.getAttribute("data-state")).toBe(state);
    expect(button.classList.contains(`ui-button--${variant}`)).toBe(true);
    expect(button.classList.contains(`ui-button--${state}`)).toBe(true);
    expect((button as HTMLButtonElement).disabled).toBe(state === "disabled");
    expect(button.getAttribute("aria-disabled")).toBe(state === "pending" ? "true" : null);
    expect(button.getAttribute("aria-busy")).toBe(String(state === "pending"));
  });

  it("gives explicit disabled precedence when pending and disabled coincide", async () => {
    const { Button } = await import("./Button");
    render(<Button pending disabled>Seal proof</Button>);
    const button = screen.getByRole("button", { name: "Working…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); expect(button.dataset.state).toBe("disabled");
    expect(button.getAttribute("aria-busy")).toBe("true"); expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("defaults to button while forwarding submit type, refs, and native props", async () => {
    const { Button } = await import("./Button");
    const ref = createRef<HTMLButtonElement>();
    const view = render(<Button ref={ref} name="proof-action" form="proof-form">Default</Button>);
    expect(ref.current).toBe(screen.getByRole("button")); expect(ref.current?.type).toBe("button");
    expect(ref.current?.name).toBe("proof-action"); expect(ref.current?.getAttribute("form")).toBe("proof-form");
    view.rerender(<Button ref={ref} type="submit">Submit</Button>);
    expect(ref.current?.type).toBe("submit");
  });

  it("keeps labels mounted and preserves focus while pending is inert", async () => {
    const { Button } = await import("./Button");
    const user = userEvent.setup(); const onClick = vi.fn();
    const view = render(<><Button onClick={onClick} pendingLabel="Resolving identity">Resolve</Button>
      <Button disabled>Disabled action</Button></>);
    expect(view.container.querySelectorAll(".ui-button__label")).toHaveLength(4);
    expect(screen.getByText("Resolving identity").getAttribute("aria-hidden")).toBe("true");
    view.rerender(<><Button pending onClick={onClick} pendingLabel="Resolving identity">Resolve</Button>
      <Button disabled>Disabled action</Button></>);
    const pending = screen.getByRole("button", { name: "Resolving identity" });
    pending.focus(); await user.keyboard("{Enter}{Space}"); await user.click(pending);
    expect(document.activeElement).toBe(pending); expect(onClick).not.toHaveBeenCalled();
    await user.tab(); expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Disabled action" }));
  });

  it("activates idle buttons", async () => {
    const { Button } = await import("./Button");
    const user = userEvent.setup(); const onClick = vi.fn();
    render(<Button onClick={onClick}>Open proof</Button>);
    await user.click(screen.getByRole("button", { name: "Open proof" })); expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Field primitive", () => {
  it("generates unique IDs, wires labels, and forwards ref/native input props", async () => {
    const { Field } = await import("./Field"); const ref = createRef<HTMLInputElement>();
    render(<><Field ref={ref} label="Agent ID" name="agentId" type="number" autoComplete="off" />
      <Field label="Proof ID" /></>);
    const agent = screen.getByLabelText("Agent ID") as HTMLInputElement;
    const proof = screen.getByLabelText("Proof ID");
    expect(agent.id).toBeTruthy(); expect(proof.id).toBeTruthy(); expect(agent.id).not.toBe(proof.id);
    expect(ref.current).toBe(agent); expect(agent.name).toBe("agentId"); expect(agent.type).toBe("number");
    expect(agent.autocomplete).toBe("off");
  });

  it.each([
    ["hint", "Hint", undefined, ["agent-hint"]],
    ["error", undefined, "Required", ["agent-error"]],
    ["both", "Hint", "Required", ["agent-hint", "agent-error"]],
  ] as const)("associates %s descriptions without dangling IDs", async (_case, hint, error, ids) => {
    const { Field } = await import("./Field");
    render(<Field id="agent" label="Agent ID" hint={hint} error={error} />);
    const input = screen.getByLabelText("Agent ID");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toEqual(ids);
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe(error ? "true" : null);
  });

  it.each([
    ["explicit", true, undefined, true], ["native", undefined, true, true],
    ["error", false, undefined, true], ["false", false, false, false],
  ] as const)("normalizes the %s invalid source", async (_case, invalid, nativeInvalid, expected) => {
    const { Field } = await import("./Field");
    render(<Field label="Agent ID" invalid={invalid} aria-invalid={nativeInvalid}
      error={_case === "error" ? "Required" : undefined} />);
    const input = screen.getByLabelText("Agent ID"); const wrapper = input.closest(".ui-field");
    expect(input.getAttribute("aria-invalid")).toBe(expected ? "true" : null);
    expect(wrapper?.getAttribute("data-invalid")).toBe(expected ? "true" : null);
  });

  it("merges rendered external help and removes generated descriptions on update", async () => {
    const { Field } = await import("./Field");
    const view = render(<><span id="external-help">External help</span><Field id="agent" label="Agent ID"
      hint="Hint" error="Required" aria-describedby="external-help" /></>);
    const input = screen.getByLabelText("Agent ID");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toEqual(["external-help", "agent-hint", "agent-error"]);
    view.rerender(<><span id="external-help">External help</span><Field id="agent" label="Agent ID"
      aria-describedby="external-help" /></>);
    expect(input.getAttribute("aria-describedby")).toBe("external-help");
    expect(document.getElementById("agent-hint")).toBeNull(); expect(document.getElementById("agent-error")).toBeNull();
  });

  it("keeps read-only fields focusable and applies mono only when requested", async () => {
    const { Field } = await import("./Field");
    render(<><Field label="Agent ID" readOnly mono /><Field label="Name" /></>);
    const readonly = screen.getByLabelText("Agent ID") as HTMLInputElement;
    readonly.focus(); expect(document.activeElement).toBe(readonly); expect(readonly.disabled).toBe(false);
    expect(readonly.classList.contains("ui-field__input--mono")).toBe(true);
    expect(screen.getByLabelText("Name").classList.contains("ui-field__input--mono")).toBe(false);
  });
});

describe("StateMessage primitive", () => {
  it.each([
    ["loading", "status", "polite", true], ["empty", "status", "polite", false],
    ["error", "alert", "assertive", false], ["unavailable", "status", "polite", false],
    ["success", "status", "polite", false],
  ] as const)("renders %s with one controlled live region", async (state, role, live, busy) => {
    const { StateMessage } = await import("./StateMessage");
    const view = render(<StateMessage state={state} title={`${state} title`}>Exact state detail</StateMessage>);
    const message = screen.getByRole(role);
    expect(view.container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);
    expect(message.getAttribute("data-state")).toBe(state); expect(message.getAttribute("aria-live")).toBe(live);
    expect(message.getAttribute("aria-atomic")).toBe("true"); expect(message.getAttribute("aria-busy")).toBe(String(busy));
    expect(message.querySelector(".ui-state-message__mark")?.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([["loading", "success"], ["error", "unavailable"]] as const)
  ("preserves its live-node identity across %s to %s", async (from, to) => {
    const { StateMessage } = await import("./StateMessage");
    const view = render(<StateMessage state={from} title="First">First detail</StateMessage>);
    const live = view.container.querySelector(".ui-state-message__live");
    view.rerender(<StateMessage state={to} title="Next">Next detail</StateMessage>);
    expect(view.container.querySelector(".ui-state-message__live")).toBe(live);
    expect(screen.getByText("Next detail")).not.toBeNull();
  });

  it("keeps a keyboard-operable action outside the atomic live node", async () => {
    const { StateMessage } = await import("./StateMessage");
    const user = userEvent.setup(); const retry = vi.fn();
    render(<StateMessage state="unavailable" title="Read unavailable"
      action={<button onClick={retry}>Retry read</button>}>No result is inferred.</StateMessage>);
    const action = screen.getByRole("button", { name: "Retry read" });
    expect(screen.getByRole("status").contains(action)).toBe(false);
    action.focus(); await user.keyboard("{Enter}"); expect(retry).toHaveBeenCalledOnce();
  });

  it("can disable announcements when a parent shell owns them", async () => {
    const { StateMessage } = await import("./StateMessage");
    render(<StateMessage state="loading" announce="off" title="Loading">Waiting</StateMessage>);
    expect(document.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });
});

const observationStatuses = [
  ["VERIFIED", "✓", "Verified"], ["BLOCKED", "×", "Blocked"],
  ["UNAVAILABLE", "—", "Unavailable"], ["STALE", "◷", "Stale"],
  ["MISMATCH", "!", "Mismatch"], ["NOT_APPLICABLE", "○", "Not applicable"],
] as const;

describe("StatusBadge primitive", () => {
  it.each(observationStatuses.flatMap(([status, mark, label]) =>
    (["dark", "paper"] as const).map((surface) => [status, mark, label, surface] as const)))
  ("renders canonical %s meaning on %s", async (status, mark, label, surface) => {
    const { StatusBadge } = await import("./StatusBadge");
    render(<StatusBadge status={status} surface={surface} />);
    const badge = screen.getByText(label).closest("span");
    expect(badge?.getAttribute("data-status")).toBe(status);
    expect(badge?.getAttribute("data-surface")).toBe(surface);
    expect(badge?.textContent).toContain(mark);
    expect(badge?.querySelector("[aria-hidden='true']")?.textContent).toBe(mark);
    expect(badge?.getAttribute("aria-label")).toBe(`Status: ${label}`);
  });
});

describe("EvidenceSheet primitive", () => {
  it("renders a labeled paper dossier with a clipped-corner contract", async () => {
    const { EvidenceSheet } = await import("./EvidenceSheet");
    const view = render(<EvidenceSheet eyebrow="PL / 01" title="Registry evidence">
      <p>Exact finalized provenance.</p>
    </EvidenceSheet>);
    const sheet = screen.getByRole("region", { name: "Registry evidence" });
    expect(sheet.getAttribute("data-surface")).toBe("paper");
    expect(sheet.classList.contains("ui-evidence-sheet")).toBe(true);
    expect(sheet.firstElementChild?.classList.contains("ui-evidence-sheet__clip")).toBe(true);
    expect(screen.getByText("PL / 01").getAttribute("aria-hidden")).toBe("true");
    expect(view.container.querySelector("h2")?.textContent).toBe("Registry evidence");
  });

  it("creates independent heading relationships for repeated sheets", async () => {
    const { EvidenceSheet } = await import("./EvidenceSheet");
    render(<><EvidenceSheet title="First">One</EvidenceSheet><EvidenceSheet title="Second">Two</EvidenceSheet></>);
    const regions = screen.getAllByRole("region");
    expect(regions[0]?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(regions[0]?.getAttribute("aria-labelledby")).not.toBe(regions[1]?.getAttribute("aria-labelledby"));
  });
});

describe("DataRow primitive", () => {
  it("keeps canonical technical data isolated, wrapped, and fully copyable", async () => {
    const { DataRow } = await import("./DataRow");
    const user = userEvent.setup();
    const canonical = `0x${"ab".repeat(32)}`;
    render(<dl><DataRow label="Artifact hash" value={canonical} displayValue="0xabab…abab" copyable /></dl>);
    const value = screen.getByText("0xabab…abab");
    expect(value.getAttribute("dir")).toBe("ltr");
    expect(value.classList.contains("ui-data-row__technical-value")).toBe(true);
    expect(value.classList.contains("break")).toBe(true);
    const copy = screen.getByRole("button", { name: "Copy Artifact hash" });
    await user.click(copy);
    expect(await navigator.clipboard.readText()).toBe(canonical);
    expect(screen.getByRole("button", { name: "Copied Artifact hash" })).not.toBeNull();
  });

  it("renders explicit missing copy and keeps labels before values", async () => {
    const { DataRow } = await import("./DataRow");
    const view = render(<dl><DataRow label="Provider" value={null} /></dl>);
    expect(screen.getByText("Unavailable")).not.toBeNull();
    const row = view.container.querySelector(".ui-data-row");
    expect(row?.firstElementChild?.tagName).toBe("DT");
    expect(row?.children[1]?.tagName).toBe("DD");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["", "   "])("renders an explicit fallback for blank value %j", async (value) => {
    const { DataRow } = await import("./DataRow");
    render(<dl><DataRow label="Provider" value={value} copyable /></dl>);
    expect(screen.getByText("Unavailable")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("bounds natural display text with bidi isolation", async () => {
    const { DataRow } = await import("./DataRow");
    const hostile = `${"model".repeat(80)}\u202egpj.exe`;
    render(<dl><DataRow label="Model" value={hostile} technical={false} /></dl>);
    const value = screen.getByText(/modelmodel/);
    expect(value.tagName).toBe("BDI");
    expect(value.textContent?.length).toBeLessThan(hostile.length);
    expect(value.textContent).not.toContain("\u202e");
  });

  it("sanitizes an explicit display projection without changing copied canonical data", async () => {
    const { DataRow } = await import("./DataRow");
    const user = userEvent.setup();
    render(<dl><DataRow label="Artifact" value="canonical-full-value"
      displayValue={`${"visible".repeat(80)}\u202eevil`} copyable /></dl>);
    expect(screen.getByText(/visiblevisible/).textContent).not.toContain("\u202e");
    await user.click(screen.getByRole("button", { name: "Copy Artifact" }));
    expect(await navigator.clipboard.readText()).toBe("canonical-full-value");
  });

  it("exposes an accessible retry state when clipboard writing fails", async () => {
    const { DataRow } = await import("./DataRow");
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<dl><DataRow label="Artifact hash" value="canonical" copyable /></dl>);
    await user.click(screen.getByRole("button", { name: "Copy Artifact hash" }));
    expect(screen.getByRole("button", { name: "Retry copy Artifact hash" })).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Clipboard unavailable. Try again.");
  });

  it("resets copied feedback when the canonical value changes", async () => {
    const { DataRow } = await import("./DataRow");
    const user = userEvent.setup();
    const view = render(<dl><DataRow label="Proof ID" value="first" copyable /></dl>);
    await user.click(screen.getByRole("button", { name: "Copy Proof ID" }));
    expect(screen.getByRole("button", { name: "Copied Proof ID" })).not.toBeNull();
    view.rerender(<dl><DataRow label="Proof ID" value="second" copyable /></dl>);
    expect(await screen.findByRole("button", { name: "Copy Proof ID" })).not.toBeNull();
  });

  it("hardens external links without changing the canonical value", async () => {
    const { DataRow } = await import("./DataRow");
    const tx = `0x${"cd".repeat(32)}`;
    render(<dl><DataRow label="Source transaction" value={tx}
      href={`https://chainscan.0g.ai/tx/${tx}`} external /></dl>);
    const link = screen.getByRole("link", { name: tx });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")?.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
    expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "//evil.example/tx/1", "\\\\evil.example",
    "/\\evil.example", "/%5cevil.example",
    "http://chainscan.0g.ai/tx/1", "https://evil.example/tx/1",
    "https://user:pass@chainscan.0g.ai/tx/1"])
  ("degrades unsafe external href %s to inert evidence", async (href) => {
    const { DataRow } = await import("./DataRow");
    render(<dl><DataRow label="Source transaction" value="canonical" href={href} external /></dl>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("canonical")).not.toBeNull();
  });

  it.each(["//evil.example/path", "\\\\evil.example", "/\\evil.example", "/%5cevil.example"])
  ("rejects hostile same-context href %s", async (href) => {
    const { DataRow } = await import("./DataRow");
    render(<dl><DataRow label="Evidence" value="canonical" href={href} /></dl>);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

const currentMetadata = {
  scope: "CURRENT", observedAt: "2026-08-29T12:00:00.000Z",
  observationBlockNumber: "42", observationBlockHash: `0x${"11".repeat(32)}`,
  serverIssuedAt: "2026-08-29T12:00:01.000Z", ttlMs: 60_000,
  freshnessExpiresAt: "2026-08-29T12:01:00.000Z",
} as const;

function currentPlaneRequiresStableTime(observations: readonly ProofLockObservation[]) {
  // @ts-expect-error CURRENT planes require a caller-pinned presentation time.
  return <TypedProofPlane scope="CURRENT" observations={observations as never} />;
}
void currentPlaneRequiresStableTime;

describe("ProofPlane primitive", () => {
  it("renders canonical historical and current headings with independent observations", async () => {
    const { ProofPlane } = await import("./ProofPlane");
    const historical = [{ scope: "HISTORICAL", subsystem: "checks", status: "VERIFIED",
      observedAt: "2026-08-29T12:00:00.000Z" }] as const satisfies readonly ProofLockObservation[];
    const current = [{ ...currentMetadata, subsystem: "gate", status: "VERIFIED",
      allowed: true, reasonCode: "ALLOWED" }] as const satisfies readonly ProofLockObservation[];
    render(<><ProofPlane scope="HISTORICAL" observations={historical} />
      <ProofPlane scope="CURRENT" observations={current} nowMs={Date.parse("2026-08-29T12:00:30.000Z")} /></>);
    expect(screen.getByRole("heading", { name: "Sealed evidence" })).not.toBeNull();
    expect(screen.getByText("Historical, versioned, event-preserved")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Current access" })).not.toBeNull();
    expect(screen.getByText("Independently observed at one finalized block")).not.toBeNull();
    expect(screen.getAllByLabelText("Status: Verified")).toHaveLength(2);
  });

  it.each(["lease", "gate", "consumer"] as const)
  ("fails before render for current verified %s without a pinned probe", async (subsystem) => {
    const { assertProofPlaneObservations } = await import("./ProofPlane");
    const impossible = [{ scope: "CURRENT", subsystem, status: "VERIFIED",
      observedAt: "2026-08-29T12:00:00.000Z" }];
    expect(() => assertProofPlaneObservations("CURRENT", impossible as never))
      .toThrow(/CURRENT observation metadata is invalid/);
  });

  it("rejects current verified Compute instead of inferring a live capability", async () => {
    const { assertProofPlaneObservations } = await import("./ProofPlane");
    const impossible = Array.of({ ...currentMetadata, subsystem: "compute", status: "VERIFIED" });
    expect(() => assertProofPlaneObservations("CURRENT", impossible as never))
      .toThrow(/CURRENT VERIFIED compute is not allowed/);
  });

  it("rejects observations assigned to the wrong plane", async () => {
    const { assertProofPlaneObservations } = await import("./ProofPlane");
    const current = [{ ...currentMetadata, subsystem: "identity", status: "UNAVAILABLE",
      reasonCode: "IDENTITY_UNAVAILABLE" }] as const satisfies readonly ProofLockObservation[];
    expect(() => assertProofPlaneObservations("HISTORICAL", current))
      .toThrow(/does not belong to the HISTORICAL plane/);
  });

  it("rejects mixed current probe coordinates before render", async () => {
    const { assertProofPlaneObservations } = await import("./ProofPlane");
    const observations = [
      { ...currentMetadata, subsystem: "identity", status: "VERIFIED" },
      { ...currentMetadata, observationBlockNumber: "43", observationBlockHash: `0x${"22".repeat(32)}`,
        subsystem: "lease", status: "VERIFIED" },
    ] as const satisfies readonly ProofLockObservation[];
    expect(() => assertProofPlaneObservations("CURRENT", observations))
      .toThrow(/CURRENT observations must share one pinned coordinate/);
  });

  it("renders every current observation state independently", async () => {
    const { ProofPlane } = await import("./ProofPlane");
    const observations = [
      { ...currentMetadata, subsystem: "lease", status: "VERIFIED" },
      { ...currentMetadata, subsystem: "gate", status: "BLOCKED", reasonCode: "DRIFTED" },
      { ...currentMetadata, subsystem: "identity", status: "UNAVAILABLE", reasonCode: "IDENTITY_UNAVAILABLE" },
      { ...currentMetadata, subsystem: "lease", status: "STALE", reasonCode: "EXPIRED" },
      { ...currentMetadata, subsystem: "identity", status: "MISMATCH", reasonCode: "IDENTITY_MISMATCH" },
      { ...currentMetadata, subsystem: "consumer", status: "NOT_APPLICABLE", reasonCode: "NO_PROOF" },
    ] as const satisfies readonly ProofLockObservation[];
    render(<ProofPlane scope="CURRENT" observations={observations}
      nowMs={Date.parse("2026-08-29T12:00:30.000Z")} />);
    for (const label of ["Verified", "Blocked", "Unavailable", "Stale", "Mismatch", "Not applicable"])
      expect(screen.getByLabelText(`Status: ${label}`)).not.toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(6);
  });

  it("derives stale presentation from the current observation TTL before paint", async () => {
    const { ProofPlane } = await import("./ProofPlane");
    const current = [{ ...currentMetadata, subsystem: "lease", status: "VERIFIED" }] as const satisfies readonly ProofLockObservation[];
    render(<ProofPlane scope="CURRENT" observations={current}
      nowMs={Date.parse("2026-08-29T12:01:00.000Z")} />);
    expect(screen.getByLabelText("Status: Stale")).not.toBeNull();
    expect(screen.queryByLabelText("Status: Verified")).toBeNull();
  });
});

describe("primitive CSS contract", () => {
  it("enforces typography, touch, pointer hover, pressed feedback, forced colors, and reduced motion", async () => {
    const css = await readFile(resolve(process.cwd(), "app/styles/components.css"), "utf8");
    expect(css).toMatch(/\.ui-button\s*\{[^}]*min-height:\s*var\(--button-min-height\)/s);
    expect(css).toMatch(/\.ui-field__input\s*\{[^}]*font:\s*400 var\(--type-body\)\/var\(--line-body\) var\(--font-body\)/s);
    expect(css).toMatch(/\.ui-field__input--mono\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
    expect(css).toMatch(/@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
    expect(css).toMatch(/\.ui-button:not\(:disabled\):not\(\[aria-disabled="true"\]\):active\s*\{[^}]*transform:/s);
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/scroll-behavior\s*:\s*smooth/);
  });

  it("enforces dossier geometry, surface-aware status, wrapping, and forced-color meaning", async () => {
    const css = await readFile(resolve(process.cwd(), "app/styles/components.css"), "utf8");
    expect(css).toMatch(/\.ui-evidence-sheet__clip\s*\{[^}]*clip-path:[^}]*var\(--evidence-sheet-cut\)/s);
    expect(css).toMatch(/\.ui-evidence-sheet\s*\{[^}]*box-shadow:\s*var\(--evidence-sheet-shadow\)/s);
    expect(css).toMatch(/\.ui-evidence-sheet__body p\s*\{[^}]*color:\s*var\(--text-muted-on-paper\)/s);
    expect(css).toMatch(/\.ui-status-badge\[data-surface="dark"\]\[data-status="VERIFIED"\][^{]*\{[^}]*var\(--status-success-on-dark\)/s);
    expect(css).toMatch(/\.ui-status-badge\[data-surface="paper"\]\[data-status="VERIFIED"\][^{]*\{[^}]*var\(--status-success-on-paper\)/s);
    expect(css).toMatch(/\.ui-data-row__technical-value\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
    expect(css).toMatch(/\.ui-proof-plane\s*\{[^}]*border:\s*1px solid var\(--proof-plane-border\)/s);
    expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)[\s\S]*\.ui-status-badge[^{]*\{[^}]*border-color:\s*currentColor/s);
    expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)[\s\S]*\.ui-evidence-sheet\s*\{[^}]*border:\s*1px solid currentColor/s);
  });

  it("stacks proof rows at 390 and 320 without changing DOM order", async () => {
    const css = await readFile(resolve(process.cwd(), "app/styles/components.css"), "utf8");
    expect(css).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*\.ui-data-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*\.ui-proof-plane__observation-heading[^{]*\{[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*390px\)[\s\S]*\.ui-proof-plane\s*\{[^}]*padding:\s*var\(--space-3\)/s);
  });
});
