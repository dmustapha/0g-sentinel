import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";

test("@mocked public and operator entry points have zero unwaived WCAG A/AA findings", async ({ page }) => {
  for (const route of ["/", "/operator"]) {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).withTags([
      "wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa",
    ]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })), route)
      .toEqual([]);
  }
});

test("@mocked mobile form controls preserve 44px targets and 16px input text", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operator");
  const input = page.getByLabel("ERC-8004 Agent ID");
  const submit = page.getByRole("button", { name: "Resolve identity" });

  await expectMinimumTarget(input, 44);
  await expectMinimumTarget(submit, 44);
  const fontSize = await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
});

async function expectMinimumTarget(locator: Locator, pixels: number): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, "control must have a rendered target").not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(pixels);
  expect(box!.height).toBeGreaterThanOrEqual(pixels);
}
