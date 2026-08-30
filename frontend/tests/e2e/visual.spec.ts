import { expect, test } from "@playwright/test";
import { fixtureIds, installFixture, primaryRoutes, type FixtureScenario } from "./fixtures";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
  { name: "compact", width: 320, height: 700 },
] as const;

const adverse: readonly { name: string; path: string; scenario: FixtureScenario }[] = [
  { name: "inventory-empty", path: "/agents", scenario: "empty" },
  { name: "inventory-partial", path: "/agents", scenario: "partial" },
  { name: "inventory-unavailable", path: "/agents", scenario: "unavailable" },
  { name: "inventory-maximum", path: "/agents", scenario: "maximum" },
  { name: "health-matrix", path: "/proof", scenario: "health-matrix" },
  { name: "proof-mismatch", path: proofPath(), scenario: "proof-mismatch" },
];

for (const viewport of viewports) {
  for (const route of primaryRoutes) {
    test(`@visual ${route.name} ${viewport.name}`, async ({ page }) => {
      await installFixture(page, "full"); await page.setViewportSize(viewport);
      await page.goto(route.path); await ready(page);
      await expect(page).toHaveScreenshot(`${route.name}-${viewport.name}.png`, screenshotOptions());
    });
  }
  for (const state of adverse) {
    test(`@visual ${state.name} ${viewport.name}`, async ({ page }) => {
      await installFixture(page, state.scenario); await page.setViewportSize(viewport);
      await page.goto(state.path); await ready(page); await settleState(page, state.scenario);
      await expect(page).toHaveScreenshot(`${state.name}-${viewport.name}.png`, screenshotOptions());
    });
  }
}

function proofPath() {
  return `/proof/${fixtureIds.proofId}?identityKey=${fixtureIds.identityKey}&sourceTxHash=${fixtureIds.transactionHash}`;
}

async function ready(page: import("@playwright/test").Page) {
  await page.locator("main").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function settleState(page: import("@playwright/test").Page, scenario: FixtureScenario) {
  if (scenario === "proof-mismatch") {
    await page.getByRole("button", { name: "Verify exact evidence" }).click();
    await page.getByRole("heading", { name: "Historical artifact mismatch" }).waitFor();
  }
}

function screenshotOptions() {
  return { animations: "disabled" as const, caret: "hide" as const, fullPage: true };
}
