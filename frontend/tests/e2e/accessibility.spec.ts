import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { installFixture, primaryRoutes } from "./fixtures";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

test("@mocked every primary route has zero unwaived WCAG A/AA findings", async ({ page }) => {
  await installFixture(page, "full");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of primaryRoutes) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectTargetFloors(page); await expectInputFloors(page); await expectTextFloors(page);
    await expectNoHorizontalOverflow(page);
    const result = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })), route.path)
      .toEqual([]);
  }
});

test("@mocked text, controls, focus, and motion meet computed floors", async ({ browserName, page }) => {
  await installFixture(page, "full");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operator");
  const input = page.getByLabel("ERC-8004 Agent ID");
  const button = page.getByRole("button", { name: "Resolve identity" });
  await expectTargetFloors(page); await expectInputFloors(page);
  await input.fill("7"); await input.focus(); await tabForward(page, browserName); await expect(button).toBeFocused();
  await installRailProbe(page);
  await expectBoundaryContrast(page, button);
  await expectTextFloors(page);
  await expectTokenizedMotion(page);
});

test("@mocked forced colors, text zoom, and 400 percent reflow preserve content", async ({ page }) => {
  await installFixture(page, "maximum");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/agents");
  await expectInventoryContent(page, "table");
  await expectNoHorizontalOverflow(page); await expectFocusBoundary(page, page.locator(".inventory-table a").first());
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expectInventoryContent(page, "table"); await expectNoClippedContent(page);
  await expectFocusBoundary(page, page.locator(".inventory-table a").first());
  await page.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("16px");
  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("16px");
  await expectNoHorizontalOverflow(page); await expectInventoryContent(page, "cards");
  await expectFocusBoundary(page, page.locator(".inventory-card a").first());
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
});

test("@mocked responsive inventory keeps table and card semantics equivalent", async ({ page }) => {
  await installFixture(page, "full");
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/agents");
  await expect(page.locator(".inventory-row")).toHaveCount(1);
  const tableSemantics = await inventorySemantics(page.locator(".inventory-table"), "table");
  await page.setViewportSize({ width: 390, height: 844 });
  const cardSemantics = await inventorySemantics(page.locator(".inventory-card").first(), "card");
  expect(cardSemantics).toEqual(tableSemantics);
  await expect(page.locator(".inventory-card-identity dt", { hasText: "Identity" })).toHaveClass(/sr-only/);
});

test("@mocked blank trust-role content keeps an explicit accessible fallback", async ({ page }) => {
  await installFixture(page, "full"); await page.goto("/agents/7");
  const roles = page.locator(".trust-disclosure");
  await expect(roles).toContainText("not configured");
  await expect(roles).toContainText("Role configuration unavailable");
});

async function expectBoxFloor(locator: Locator, floor: number) {
  const box = await locator.boundingBox(); expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(floor); expect(box!.height).toBeGreaterThanOrEqual(floor);
}

async function expectTargetFloors(page: Page) {
  const targets = page.locator('button:not([disabled]), input:not([type="hidden"]), a[href]:not(.sr-only)');
  for (const target of await targets.all()) if (await target.isVisible()) await expectBoxFloor(target, 44);
  const skip = page.locator("a.sr-only");
  if (await skip.count()) { await skip.focus(); await expectBoxFloor(skip, 44); }
}

async function expectInputFloors(page: Page) {
  const inputs = page.locator('input:not([type="hidden"]), select, textarea');
  for (const input of await inputs.all()) if (await input.isVisible())
    expect(await fontSize(input)).toBeGreaterThanOrEqual(16);
}

async function fontSize(locator: Locator) {
  return locator.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
}

async function expectTextFloors(page: Page) {
  const sizes = await page.locator("main *").evaluateAll((nodes) => nodes.filter((node) => {
    const element = node as HTMLElement; const directText = [...node.childNodes]
      .some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
    return element.offsetParent !== null && directText;
  }).map((node) => [node.tagName, Number.parseFloat(getComputedStyle(node).fontSize),
    `${(node as HTMLElement).className}: ${node.textContent?.trim().slice(0, 60)}`] as const));
  for (const [tag, size, context] of sizes) expect(size, `${tag} ${context}`).toBeGreaterThanOrEqual(
    ["INPUT", "TEXTAREA", "SELECT"].includes(tag) ? 16
      : tag === "P" ? 14 : tag.startsWith("H") ? 16 : 12);
}

async function expectTokenizedMotion(page: Page) {
  const violations = await page.locator("main *").evaluateAll((nodes) => nodes.flatMap((node) => {
    const style = getComputedStyle(node); const properties = style.transitionProperty.split(",").map((item) => item.trim());
    const active = style.transitionDuration.split(",").some((item) => Number.parseFloat(item) > 0);
    return active && properties.some((item) => !["none", "opacity", "transform"].includes(item)) ? [properties.join(",")] : [];
  }));
  expect(violations).toEqual([]);
}

async function expectBoundaryContrast(page: Page, focus: Locator) {
  const boundaries = [[focus, "outlineColor"], [focus, "borderTopColor"],
    [page.locator(".wordmark .mk"), "backgroundColor"], [page.locator(".rail-node").first(), "borderTopColor"]] as const;
  for (const [locator, property] of boundaries)
    expect(await boundaryContrast(locator, property), property).toBeGreaterThanOrEqual(3);
}

async function installRailProbe(page: Page) {
  await page.evaluate(() => { const rail = document.createElement("div"); rail.hidden = true;
    rail.innerHTML = '<div class="proof-ceremony"><div class="rail-stage"><span class="rail-node">1</span></div></div>';
    document.body.append(rail); rail.hidden = false; });
}

async function boundaryContrast(locator: Locator, property: string) {
  return locator.evaluate((node, key) => {
    const parse = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const luminance = (rgb: number[]) => { const linear = rgb.map((value) => { const channel = value / 255;
      return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]; };
    const background = (current: Element | null): string => { if (!current) return "rgb(0, 0, 0)";
      const value = getComputedStyle(current).backgroundColor;
      return value !== "rgba(0, 0, 0, 0)" ? value : background(current.parentElement); };
    const [a, b] = [luminance(parse(getComputedStyle(node)[key as keyof CSSStyleDeclaration] as string)),
      luminance(parse(background(node.parentElement)))].sort((x, y) => y - x);
    return (a + .05) / (b + .05);
  }, property);
}

async function expectInventoryContent(page: Page, mode: "table" | "cards") {
  await expect(page.getByRole("heading", { name: "Recent ProofLocks" })).toBeVisible();
  const items = page.locator(mode === "table" ? ".inventory-row" : ".inventory-card");
  await expect(items).toHaveCount(100);
  const last = items.last(); await last.scrollIntoViewIfNeeded(); await expect(last).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const reflow = await page.evaluate(() => { const root = document.documentElement;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .sort((left, right) => right.scrollWidth - right.clientWidth - (left.scrollWidth - left.clientWidth)).slice(0, 8)
      .map((node) => { const style = getComputedStyle(node); return { tag: node.tagName,
        className: node.className, parent: node.parentElement?.className,
        client: node.clientWidth, scroll: node.scrollWidth, fontSize: style.fontSize,
        whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap,
        text: node.textContent?.trim().slice(0, 80) }; });
    return { overflow: root.scrollWidth - root.clientWidth, offenders }; });
  expect(reflow.overflow, JSON.stringify(reflow.offenders)).toBeLessThanOrEqual(1);
}

async function expectNoClippedContent(page: Page) {
  const clipped = await page.locator("body *:not(.sr-only)").evaluateAll((nodes) => nodes.flatMap((node) => {
    const element = node as HTMLElement; const style = getComputedStyle(element);
    const clipsX = ["hidden", "clip"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    const clipsY = ["hidden", "clip"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    return (element.offsetParent !== null && (clipsX || clipsY)) ? [element.className || element.tagName] : [];
  }));
  expect(clipped).toEqual([]);
}

async function expectFocusBoundary(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded(); await target.focus(); await expect(target).toBeFocused();
  const boundary = await target.evaluate((node) => { const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect(); return { outline: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth), left: rect.left, right: rect.right,
      viewport: document.documentElement.clientWidth }; });
  expect(boundary.outline).not.toBe("none"); expect(boundary.width).toBeGreaterThanOrEqual(2);
  expect(boundary.left).toBeGreaterThanOrEqual(0); expect(boundary.right).toBeLessThanOrEqual(boundary.viewport + 1);
}

async function inventorySemantics(root: Locator, mode: "table" | "card") {
  if (mode === "table") { const cells = root.locator(".inventory-row").first().locator("td"); return {
    identity: await text(cells.nth(0)), coverage: await text(cells.nth(1)), seal: await text(cells.nth(2).locator("bdi").first()),
    lease: await text(cells.nth(3)), gate: await text(cells.nth(4)), checked: await text(cells.nth(5)),
    action: await text(cells.nth(6)), source: await cells.nth(2).locator('a[href*="chainscan"]').getAttribute("href"),
  }; }
  return { identity: await text(root.locator(".inventory-card-identity dd")),
    coverage: await definitionText(root, "Coverage"), seal: await text(valueByLabel(root, "Seal").locator("bdi")),
    lease: await definitionText(root, "Lease"), gate: await definitionText(root, "Gate"),
    checked: await definitionText(root, "Last checked"), action: await definitionText(root, "Action"),
    source: await root.locator('a[href*="chainscan"]').getAttribute("href") };
}

async function definitionText(root: Locator, label: string) {
  return text(valueByLabel(root, label));
}

function valueByLabel(root: Locator, label: string) { const term = root.locator("dt")
  .filter({ hasText: new RegExp(`^${label}$`) }); return term.locator("xpath=following-sibling::dd[1]"); }

async function text(locator: Locator) { return (await locator.innerText()).replace(/\s+/g, " ").trim(); }

function tabForward(page: Page, browserName: string) {
  return page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
}
