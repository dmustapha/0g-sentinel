import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";
import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

test("@mocked primitive fixture exercises the real component contracts", async ({ page }) => {
  const pageSource = await readFile(resolve(process.cwd(), "app/page.tsx"), "utf8");
  expect(pageSource).not.toContain("PrimitiveE2EFixture");
  const productionGraph = await importGraph(await sourceFiles("app"));
  expect(productionGraph.keys()).not.toContain("components/ui/PrimitiveE2EFixture.tsx");
  expect([...productionGraph.values()].join("\n")).not.toContain("PrimitiveE2EFixture");
  const pageErrors: string[] = []; const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const css = await fixtureCss();
  await page.setContent(`<!doctype html><html lang="en"><head><title>Primitive contract</title>
    <style>${css}</style></head><body><main><div id="primitive-root"></div></main></body></html>`);
  await page.addScriptTag({ content: await fixtureBundle() });
  await page.waitForTimeout(100);
  expect(pageErrors, "fixture bundle runtime errors").toEqual([]);
  expect(consoleErrors, "fixture bundle console errors").toEqual([]);
  const fixture = page.getByRole("region", { name: "Primitive contract fixture" });
  await expect(fixture).toBeVisible();

  for (const [variant, floor] of [["primary", 48], ["secondary", 44], ["quiet", 44], ["destructive", 44]] as const) {
    await expectMinimumHeight(fixture.getByTestId(`primitive-${variant}`), floor);
  }

  let pending = fixture.getByRole("button", { name: "Seal proof" });
  const idleWidth = (await pending.boundingBox())!.width;
  pending.focus(); await pending.press("Enter");
  pending = fixture.getByRole("button", { name: "Sealing proof" });
  await expect(pending).toBeFocused(); await expect(fixture.getByTestId("activation-count")).toHaveText("Activations: 1");
  const pendingWidth = (await pending.boundingBox())!.width;
  expect(Math.abs(pendingWidth - idleWidth)).toBeLessThanOrEqual(1);
  await pending.press("Enter"); await pending.press("Space"); await pending.click({ force: true });
  await expect(fixture.getByTestId("activation-count")).toHaveText("Activations: 1");

  await pending.press("Tab");
  const field = fixture.getByLabel("Agent ID");
  await expect(field).toBeFocused();
  await field.press("Shift+Tab"); await expect(pending).toBeFocused();
  const outlineWidth = await pending.evaluate((node) => Number.parseFloat(getComputedStyle(node).outlineWidth));
  expect(outlineWidth).toBeGreaterThanOrEqual(2);
  await expectMinimumHeight(field, 44);
  expect(await field.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDuration = await pending.evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration));
  expect(reducedDuration).toBeLessThanOrEqual(0.000001);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  for (const control of [pending, field, fixture.locator(".ui-state-message--unavailable")]) {
    expect(await control.evaluate((node) => Number.parseFloat(getComputedStyle(node).borderWidth))).toBeGreaterThan(0);
  }
  expect(await pending.evaluate((node) => Number.parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThanOrEqual(2);
  await expect(fixture.locator(".ui-state-message--unavailable .ui-state-message__mark")).toBeVisible();

  await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
  const retry = fixture.getByRole("button", { name: "Retry read" });
  retry.focus(); await retry.press("Enter");
  await expect(fixture.getByTestId("recovery-count")).toHaveText("Recoveries: 1");
  await expect(fixture.getByRole("status")).toContainText("Read recovered");

  const results = await new AxeBuilder({ page }).include('[aria-label="Primitive contract fixture"]')
    .withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.map(({ id }) => id)).toEqual([]);
  expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]);
});

async function expectMinimumHeight(locator: Locator, pixels: number): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, "primitive must render").not.toBeNull(); expect(box!.height).toBeGreaterThanOrEqual(pixels);
}

async function fixtureCss(): Promise<string> {
  const files = ["tokens.css", "foundations.css", "components.css"];
  return (await Promise.all(files.map((file) => readFile(resolve(process.cwd(), "app/styles", file), "utf8")))).join("\n");
}

async function fixtureBundle(): Promise<string> {
  const result = await build({
    stdin: { contents: `import { createElement } from "react";
      import { createRoot } from "react-dom/client";
      import { PrimitiveE2EFixture } from "./components/ui/PrimitiveE2EFixture";
      createRoot(document.getElementById("primitive-root")).render(createElement(PrimitiveE2EFixture));`,
      loader: "tsx", resolveDir: process.cwd() },
    bundle: true, define: { "process.env.NODE_ENV": '"production"' }, jsx: "automatic",
    format: "iife", platform: "browser", write: false,
  });
  return result.outputFiles[0].text;
}

async function importGraph(entries: readonly string[]): Promise<Map<string, string>> {
  const graph = new Map<string, string>();
  async function visit(path: string): Promise<void> {
    if (graph.has(path)) return;
    const source = await readFile(resolve(process.cwd(), path), "utf8"); graph.set(path, source);
    const imports = [...source.matchAll(/(?:import|export)\s+(?:[^"']*?\sfrom\s*)?["']([^"']+)["']/g)];
    for (const match of imports) {
      const dependency = await localModule(path, match[1]);
      if (dependency) await visit(dependency);
    }
  }
  for (const entry of entries) await visit(entry);
  return graph;
}

async function localModule(importer: string, specifier: string): Promise<string | undefined> {
  const base = specifier.startsWith("@/") ? specifier.slice(2)
    : specifier.startsWith(".") ? resolve(dirname(importer), specifier) : undefined;
  if (!base) return undefined;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const relative = candidate.replace(`${process.cwd()}/`, "");
    try { await readFile(resolve(process.cwd(), relative)); return relative; } catch { /* try suffix */ }
  }
  return undefined;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(resolve(process.cwd(), directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}
