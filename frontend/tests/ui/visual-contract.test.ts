import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("industrial proof-ledger visual contract", () => {
  it("defines graphite, warm evidence, provenance violet, and two elevations as tokens", async () => {
    const css = await readFile(resolve(process.cwd(), "app/styles/tokens.css"), "utf8");
    for (const token of ["--graphite", "--paper", "--violet", "--elevation-1", "--elevation-2"]) expect(css).toContain(token);
  });
  it("preserves 390px and 320px layouts, focus, reduced motion, and overflow containment", async () => {
    const css = await Promise.all(["layouts.css", "motion.css", "utilities.css"].map((file) =>
      readFile(resolve(process.cwd(), `app/styles/${file}`), "utf8")));
    const source = css.join("\n");
    expect(source).toContain("@media (max-width: 390px)"); expect(source).toContain("@media (max-width: 320px)");
    expect(source).toContain("prefers-reduced-motion: reduce"); expect(source).toContain(":focus-visible"); expect(source).toContain("overflow-wrap: anywhere");
  });
  it("uses the approved type family and policy-scoped product claim", async () => {
    const brand = JSON.parse(await readFile(resolve(process.cwd(), "brand.json"), "utf8"));
    expect(brand.canonicalStyleSource).toBe("app/styles/tokens.css");
    expect(brand.tagline).toContain("policy-scoped admission"); expect(brand.tagline).not.toContain("Every AI agent");
  });
});
