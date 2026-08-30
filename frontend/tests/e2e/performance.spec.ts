import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures";

test("@performance maximum inventory remains responsive without horizontal overflow", async ({ page }) => {
  await installFixture(page, "maximum");
  await page.addInitScript(() => {
    (window as Window & { __prooflockLongTasks?: number[] }).__prooflockLongTasks = [];
    new PerformanceObserver((list) => {
      const target = window as Window & { __prooflockLongTasks?: number[] };
      target.__prooflockLongTasks?.push(...list.getEntries().map(({ duration }) => duration));
    }).observe({ type: "longtask", buffered: true });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents");
  await expect(page.locator(".inventory-card")).toHaveCount(100);
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    longest: Math.max(0, ...((window as Window & { __prooflockLongTasks?: number[] }).__prooflockLongTasks ?? [])),
  }));
  expect(metrics.overflow).toBeLessThanOrEqual(1);
  expect(metrics.longest).toBeLessThan(1_000);
});

test("@performance operator input gives immediate visual feedback", async ({ page }) => {
  await installFixture(page, "full"); await page.goto("/operator");
  const input = page.getByLabel("ERC-8004 Agent ID");
  const start = await page.evaluate(() => performance.now());
  await input.fill("7");
  await expect(page.getByRole("button", { name: "Resolve identity" })).toBeEnabled();
  const elapsed = await page.evaluate((before) => performance.now() - before, start);
  expect(elapsed).toBeLessThan(500);
});
