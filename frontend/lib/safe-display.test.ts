import { describe, expect, it, vi } from "vitest";

import { configuredDisplayText, displayValue, safeDisplayText } from "./safe-display";

const INVISIBLE_OR_DIRECTIONAL = /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200c\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

describe("safe display text", () => {
  it("removes controls, zero-width characters, and bidi instructions", () => {
    const hostile = "provider\u0000\u200b\u202eevil\u2066name\u2069";
    const result = safeDisplayText(hostile);

    expect(result).toContain("provider");
    expect(result).toContain("evil");
    expect(result).toContain("�");
    expect(result).not.toMatch(INVISIBLE_OR_DIRECTIONAL);
  });

  it("preserves visible Unicode graphemes including combining marks, confusables, and emoji", () => {
    const visible = "Cafe\u0301 p\u0430ypal 🧑🏽‍💻";
    const result = safeDisplayText(visible);

    expect(result).toContain("Café");
    expect(result).toContain("pаypal");
    expect(result).toContain("🧑🏽‍💻");
  });

  it("bounds a 10k display string without splitting its final grapheme", () => {
    const result = safeDisplayText(`${"a".repeat(10_000)}🧑🏽‍💻`, { maxGraphemes: 64 });

    expect(Array.from(result).length).toBeLessThanOrEqual(65);
    expect(result).toBe(`${"a".repeat(64)}…`);
  });

  it("keeps canonical proof data exact while deriving a bounded display value", () => {
    const canonical = `provider\u202e-${"x".repeat(1_000)}`;
    const value = displayValue(canonical, { maxGraphemes: 24 });

    expect(value.canonical).toBe(canonical);
    expect(value.display).not.toMatch(INVISIBLE_OR_DIRECTIONAL);
    expect(value.display).toHaveLength(25);
  });

  it("bounds raw work before normalization or grapheme segmentation", () => {
    const normalize = vi.spyOn(String.prototype, "normalize");
    const canonical = `${"a".repeat(2_000_000)}\u202e`;
    const value = displayValue(canonical, { maxGraphemes: 32 });

    expect(value.canonical).toBe(canonical);
    expect(value.display).toBe(`${"a".repeat(32)}…`);
    expect(String(normalize.mock.instances[0]).length).toBeLessThanOrEqual(4_096);
    normalize.mockRestore();
  });

  it("falls back for a multi-megabyte blank value without projecting it", () => {
    expect(configuredDisplayText(" ".repeat(2_000_000), "Unavailable"))
      .toBe("Unavailable");
  });

  it.each(["\u00ad", "\u2061", "\u2064", "\u206a", "\u206f", "\ufff9", "\u{1bca0}", "\u{e0020}"])(
    "replaces invisible control or format character %j", (value) => {
      expect(safeDisplayText(`left${value}right`)).toBe("left�right");
    });

  it.each(["\u034f", "\u115f", "\u3164", "\u17b4", "\u180b", "\u2065", "\u{e0001}", "\u{e007f}"])(
    "filters default-ignorable code point %j", (value) => {
      expect(safeDisplayText(`left${value}right`)).toBe("left�right");
      expect(configuredDisplayText(value, "Unavailable")).toBe("Unavailable");
    });

  it("preserves ZWJ only inside a valid extended-pictographic sequence", () => {
    expect(safeDisplayText("🧑🏽‍💻")).toBe("🧑🏽‍💻");
    expect(safeDisplayText("a\u200db")).toBe("a�b");
    expect(safeDisplayText("\u200d🧑")).toBe("�🧑");
    expect(safeDisplayText("🧑\u200dA")).toBe("🧑�A");
  });

  it("preserves VS16 only inside a validated keycap sequence", () => {
    expect(safeDisplayText("1️⃣X", { maxGraphemes: 1 })).toBe("1️⃣…");
    expect(safeDisplayText("#️⃣X", { maxGraphemes: 1 })).toBe("#️⃣…");
    expect(safeDisplayText("\ufe0f")).toBe("�");
    expect(safeDisplayText("A\ufe0f\u20e3")).toBe("A�⃣");
  });

  it("uses a grapheme-safe fallback when Intl.Segmenter is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    try {
      expect(safeDisplayText("Ame\u0301lie", { maxGraphemes: 3 })).toBe("Amé…");
      expect(safeDisplayText("🧑🏽‍💻X", { maxGraphemes: 1 })).toBe("🧑🏽‍💻…");
      expect(safeDisplayText("✈️X", { maxGraphemes: 1 })).toBe("✈️…");
      expect(safeDisplayText("🇳🇬X", { maxGraphemes: 1 })).toBe("🇳🇬…");
    } finally {
      if (descriptor) Object.defineProperty(Intl, "Segmenter", descriptor);
    }
  });
});
