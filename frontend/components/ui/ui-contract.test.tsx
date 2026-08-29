// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
});
