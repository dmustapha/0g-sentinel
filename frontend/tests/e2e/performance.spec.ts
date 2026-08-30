import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { fixtureIds, installFixture } from "./fixtures";

const origin = "http://127.0.0.1:4318";
const profile = Object.freeze({ latency: 150, downloadThroughput: 1_600_000 / 8,
  uploadThroughput: 750_000 / 8, cpu: 4 });
const routes = ["/", "/agents", "/agents/7", "/proof",
  `/proof/${fixtureIds.proofId}?identityKey=${fixtureIds.identityKey}`, "/operator"] as const;
const assetBaselines = Object.freeze({
  "/": { js: 103_169, css: 11_045, font: 99_932 },
  "/agents": { js: 149_898, css: 11_045, font: 99_932 },
  "/agents/7": { js: 165_276, css: 11_045, font: 99_932 },
  "/proof": { js: 152_796, css: 11_045, font: 99_932 },
  [routes[4]]: { js: 156_879, css: 11_045, font: 99_932 },
  "/operator": { js: 163_131, css: 11_045, font: 99_932 },
});

test("@performance production routes meet three-sample slow-4G budgets", async ({ browser }) => {
  test.setTimeout(180_000);
  const results: RouteSample[] = [];
  for (const path of routes) for (let sample = 0; sample < 3; sample++)
    results.push(await sampleRoute(browser, path));
  const medians = routes.map((path) => medianRoute(path, results));
  console.log(`PROOFLOCK_PERFORMANCE=${JSON.stringify(medians)}`);
  for (const metric of medians) {
    expect(metric.lcp, `${metric.path} LCP observation`).toBeGreaterThan(0);
    expect(metric.lcp, `${metric.path} LCP`).toBeLessThanOrEqual(2_500);
    expect(metric.cls, `${metric.path} CLS`).toBeLessThanOrEqual(0.1);
    for (const asset of ["js", "css", "font"] as const) {
      expect(metric[asset], `${metric.path} ${asset} transfer`).toBeGreaterThan(0);
      expect(metric[asset], `${metric.path} ${asset} growth`)
        .toBeLessThanOrEqual(assetBaselines[metric.path as keyof typeof assetBaselines][asset] * 1.1);
    }
  }
});

test("@performance operator INP and active-control position stay stable", async ({ browser }) => {
  test.setTimeout(60_000);
  const samples = [];
  for (let sample = 0; sample < 3; sample++) samples.push(await sampleInteraction(browser));
  const result = { inp: median(samples.map(({ inp }) => inp)),
    shift: median(samples.map(({ shift }) => shift)) };
  console.log(`PROOFLOCK_INTERACTION=${JSON.stringify(result)}`);
  expect(result.inp).toBeGreaterThan(0); expect(result.inp).toBeLessThanOrEqual(200);
  expect(result.shift).toBeLessThanOrEqual(1);
});

async function sampleRoute(browser: Browser, path: string): Promise<RouteSample> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await preparedPage(context, path === "/agents" ? "maximum" : "full");
  await page.goto(`${origin}${path}`); await ready(page, path);
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
  const result = await page.evaluate(readMetrics); await context.close();
  return { path, ...result };
}

async function sampleInteraction(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await preparedPage(context, "full"); await page.goto(`${origin}/operator`);
  const input = page.getByLabel("ERC-8004 Agent ID"); await input.click();
  const before = await input.boundingBox(); await input.pressSequentially("7");
  await expect(page.getByRole("button", { name: "Resolve identity" })).toBeEnabled();
  await page.waitForTimeout(100); const after = await input.boundingBox();
  const inp = await page.evaluate(() => Math.max(0, ...window.__prooflockMetrics.events));
  await context.close(); return { inp, shift: boxShift(before, after) };
}

async function preparedPage(context: BrowserContext, scenario: "full" | "maximum") {
  await context.addInitScript(installObservers); const page = await context.newPage();
  const session = await context.newCDPSession(page); await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Network.emulateNetworkConditions", { offline: false, ...profile,
    connectionType: "cellular4g" });
  await session.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  await installFixture(page, scenario); return page;
}

function installObservers() {
  window.__prooflockMetrics = { lcp: 0, cls: 0, events: [] };
  new PerformanceObserver((list) => { for (const entry of list.getEntries())
    window.__prooflockMetrics.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries() as LayoutShift[])
    if (!entry.hadRecentInput) window.__prooflockMetrics.cls += entry.value; })
    .observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries() as InteractionEntry[])
    if (entry.interactionId) window.__prooflockMetrics.events.push(entry.duration); })
    .observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
}

async function ready(page: Page, path: string) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (path === "/agents") {
    await expect(page.locator(".inventory-card")).toHaveCount(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "100-row horizontal overflow").toBe(true);
    const frameDelay = await page.evaluate(() => new Promise<number>((resolve) => {
      const started = performance.now(); requestAnimationFrame(() => resolve(performance.now() - started));
    }));
    expect(frameDelay, "100-row main-thread response").toBeLessThanOrEqual(200);
  }
  if (path === "/proof") await expect(page.locator(".health-cell").first()).toBeVisible();
  if (path.startsWith("/agents/")) {
    const historical = page.locator("[data-plane=historical]");
    await expect(historical).toBeVisible();
    await expect(historical).not.toContainText("Historical verification is in progress");
    await expect(page.locator("[data-plane=current]")).toBeVisible();
  }
}

function readMetrics() {
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const bytes = (pattern: RegExp) => resources.filter(({ name }) => pattern.test(new URL(name).pathname))
    .reduce((sum, entry) => sum + entry.encodedBodySize, 0);
  return { lcp: window.__prooflockMetrics.lcp, cls: window.__prooflockMetrics.cls,
    js: bytes(/\.js$/), css: bytes(/\.css$/), font: bytes(/\.woff2$/) };
}

function medianRoute(path: string, results: RouteSample[]): RouteSample {
  const samples = results.filter((result) => result.path === path);
  return { path, lcp: median(samples.map(({ lcp }) => lcp)), cls: median(samples.map(({ cls }) => cls)),
    js: median(samples.map(({ js }) => js)), css: median(samples.map(({ css }) => css)),
    font: median(samples.map(({ font }) => font)) };
}

function median(values: number[]) { return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]; }
function boxShift(before: { x: number; y: number } | null, after: { x: number; y: number } | null) {
  return before && after ? Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y)) : Infinity;
}

type RouteSample = Readonly<{ path: string; lcp: number; cls: number; js: number; css: number; font: number }>;

declare global {
  interface Window { __prooflockMetrics: { lcp: number; cls: number; events: number[] } }
  interface LayoutShift extends PerformanceEntry { hadRecentInput: boolean; value: number }
  interface InteractionEntry extends PerformanceEntry { interactionId: number; duration: number }
}
