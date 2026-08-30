import { expect, test, type Locator, type Page } from "@playwright/test";
import { discoveryResponse, fixtureIds, gateReasonCodes, installFixture, primaryRoutes,
  proofLockDetail, type FixtureScenario } from "./fixtures";

const MAX_LEASE_SECONDS = 30 * 24 * 60 * 60;

test("@mocked every ProofLock fixture obeys the production lease contract", () => {
  const records = [proofLockDetail().proofLock, ...discoveryResponse("maximum").identities.flatMap((item) =>
    item.status === "VERIFIED" ? [item.proofLock] : [])];
  for (const record of records) {
    const lifetime = Number(record.validUntil) - Number(record.issuedAt);
    expect(lifetime, record.identityKey).toBeGreaterThan(0);
    expect(lifetime, record.identityKey).toBeLessThanOrEqual(MAX_LEASE_SECONDS);
  }
});

for (const route of primaryRoutes) {
  test(`@mocked ${route.name} renders from one labeled deterministic fixture`, async ({ page }) => {
      await installFixture(page, "full");
      const response = await visitSettled(page, route.path);
      expect(response?.status(), route.path).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
      if (route.name === "agent-detail") await expect(page.locator("[data-demo-fixture=true]").first()).toBeVisible();
  });
}

for (const [scenario, copy] of [
  ["empty", "No recent finalized events"],
  ["partial", "Partial results"],
  ["unavailable", "ProofLock inventory unavailable"],
  ["maximum", "100 returned · cap 100"],
] as const) {
  test(`@mocked inventory exposes the ${scenario} state truthfully`, async ({ page }) => {
    await installFixture(page, scenario); await navigate(page, "/agents");
    await expect(page.getByText(copy, { exact: false }).first()).toBeVisible();
  });
}

test("@mocked loading is explicit and cancellable navigation does not leave stale state", async ({ page }) => {
  await installFixture(page, "loading"); await navigate(page, "/agents");
  await expect(page.getByText("Reading recent ProofLocks")).toBeVisible();
  await navigate(page, "/");
  await expect(page.getByRole("heading", { name: /Admission should be/ })).toBeVisible();
  await expect(page.getByText("Reading recent ProofLocks")).toHaveCount(0);
});

for (const [scenario, copy] of [
  ["proof-match", /Historical artifact matches/i],
  ["proof-mismatch", /Historical artifact mismatch/i],
] as readonly (readonly [FixtureScenario, RegExp])[]) {
  test(`@mocked verifier presents ${scenario} without changing the locator`, async ({ page }) => {
    await installFixture(page, scenario); await navigate(page, proofPath());
    await clickHydrated(page.getByRole("button", { name: "Verify exact evidence" }));
    await expect(page.getByText(copy).first()).toBeVisible();
    expect(page.url()).toContain(fixtureIds.proofId);
  });
}

test("@mocked verifier times out and restores a retry action", async ({ page }) => {
  test.setTimeout(25_000); await installFixture(page, "proof-timeout"); await navigate(page, proofPath());
  await clickHydrated(page.getByRole("button", { name: "Verify exact evidence" }));
  await expect(page.getByRole("heading", { name: "Verification timed out" })).toBeFocused({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("@mocked verifier cancellation is explicit and focus-safe", async ({ page }) => {
  await installFixture(page, "canceled"); await navigate(page, proofPath());
  await clickHydrated(page.getByRole("button", { name: "Verify exact evidence" }));
  await page.getByRole("button", { name: "Cancel historical verification" }).click();
  await expect(page.getByRole("heading", { name: "Verification canceled" })).toBeFocused();
});

test("@mocked stale source locators never claim a historical match", async ({ page }) => {
  await installFixture(page, "stale");
  await navigate(page, `/agents/7?sourceTxHash=${fixtureIds.transactionHash}`);
  await expect(page.getByText("Stale proof link", { exact: true })).toBeVisible();
  await expect(page.getByText("Historical artifact matches")).toHaveCount(0);
});

test("@mocked invalid locators fail closed", async ({ page }) => {
  await installFixture(page, "full"); await navigate(page, "/proof/not-a-proof?identityKey=invalid");
  await expect(page.getByText(/invalid/i).first()).toBeVisible();
});

test("@mocked unavailable dependencies fail closed", async ({ page }) => {
  await installFixture(page, "unavailable"); await navigate(page, proofPath());
  await clickHydrated(page.getByRole("button", { name: "Verify exact evidence" }));
  await expect(page.getByRole("heading", { name: "Evidence unavailable" })).toBeVisible();
});

test("@mocked health matrix distinguishes healthy, unhealthy, and unknown probes", async ({ page }) => {
  await installFixture(page, "health-matrix"); await navigate(page, "/proof");
  for (const status of ["HEALTHY", "UNHEALTHY", "UNKNOWN"])
    await expect(page.getByText(status, { exact: true }).first()).toBeVisible();
});

test("@mocked maximum fixture exposes every lease and Gate reason state", async ({ page }) => {
  await installFixture(page, "maximum"); await navigate(page, "/agents");
  await expect(page.locator(".inventory-row")).toHaveCount(100);
  const expectedLeases = ["ACTIVE", "EXPIRING", "EXPIRED", "REVOKED", "DRIFTED", "INCOMPLETE"];
  const leaseCells = await page.locator(".inventory-row td:nth-child(4)").allInnerTexts();
  for (const state of expectedLeases) expect(leaseCells.some((cell) => cell.includes(state)), state).toBe(true);
  const content = await page.locator("body").innerText();
  for (const reason of gateReasonCodes) expect(content).toContain(reason);
});

test("@mocked source links are safe", async ({ page }) => {
  await installFixture(page, "full"); await visitSettled(page, "/agents");
  await expectSafeSourceLink(page.locator('a[href*="chainscan"]').first());
});

for (const route of primaryRoutes) {
  test(`@mocked ${route.name} stays secret-free and has clean traffic`, async ({ page }) => {
    const traffic = observeTraffic(page); await installFixture(page, "full");
    await visitSettled(page, route.path);
    expect(await page.locator("main").textContent()).not.toContain("operator-secret-canary");
    await expectTrafficClean(traffic);
  });
}

for (const scenario of ["loading", "empty", "partial", "maximum", "health-matrix", "proof-match",
  "proof-mismatch", "unavailable", "stale", "canceled", "proof-timeout"] as const) {
  test(`@mocked ${scenario} is free of unexpected console and request failures`, async ({ page }) => {
    if (scenario === "proof-timeout") test.setTimeout(25_000);
    const traffic = observeTraffic(page); await installFixture(page, scenario);
    await exerciseAdverseState(page, scenario);
    await expectTrafficClean(traffic, expectedHttpResponses(scenario));
  });
}

test("@standalone packaged runtime serves all routes and MIME types without interception", async ({ page }) => {
  for (const path of ["/", "/agents", "/agents/7", "/proof", proofPath(), "/operator", "/missing-prooflock-route"]) {
    const response = await page.goto(path); expect(response, path).not.toBeNull();
    expect(response!.headers()["content-type"], path).toContain("text/html");
    expect([200, 404], path).toContain(response!.status());
  }
  const script = await page.locator('script[src^="/_next/"]').first().getAttribute("src");
  const asset = await page.request.get(script!);
  expect(asset.status()).toBe(200); expect(asset.headers()["content-type"]).toMatch(/javascript/);
});

function proofPath() {
  return `/proof/${fixtureIds.proofId}?identityKey=${fixtureIds.identityKey}&sourceTxHash=${fixtureIds.transactionHash}`;
}

async function visitSettled(page: Page, path: string) {
  const response = await navigate(page, path); await page.locator("main").waitFor();
  if (path === "/agents") await page.locator(".inventory-row").first().waitFor();
  if (path === "/proof") await page.locator(".health-cell").first().waitFor();
  if (path.startsWith("/agents/")) await page.locator("[data-demo-fixture=true]").first().waitFor();
  return response;
}

type HttpResponse = Readonly<{ status: number; path: string }>;
type Traffic = { errors: string[]; failures: string[]; responses: HttpResponse[]; mime: string[];
  pendingApis: Set<string> };

function observeTraffic(page: Page, traffic: Traffic = {
  errors: [], failures: [], responses: [], mime: [], pendingApis: new Set(),
}): Traffic {
  page.on("pageerror", ({ message }) => traffic.errors.push(message));
  page.on("console", (message) => { if (message.type() === "error") traffic.errors.push(message.text()); });
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/"))
    traffic.pendingApis.add(request.url()); });
  page.on("requestfinished", (request) => traffic.pendingApis.delete(request.url()));
  page.on("requestfailed", (request) => { const error = request.failure()?.errorText ?? "unknown";
    traffic.pendingApis.delete(request.url());
    if (!["net::ERR_ABORTED", "NS_BINDING_ABORTED", "cancelled"].includes(error))
      traffic.failures.push(`${request.method()} ${request.url()} ${error}`); });
  page.on("response", (response) => { const path = new URL(response.url()).pathname;
    if (response.status() >= 400) traffic.responses.push({ status: response.status(), path });
    if (path.startsWith("/api/") && !response.headers()["content-type"]?.includes("application/json"))
      traffic.mime.push(response.url()); });
  return traffic;
}

async function expectTrafficClean(traffic: Traffic, expectedResponses: readonly HttpResponse[] = []) {
  await expect.poll(() => traffic.pendingApis.size).toBe(0);
  const allowedStatuses = expectedResponses.map(({ status }) => status);
  const unexpectedErrors = traffic.errors.filter((message) => !allowedStatuses.some((status) =>
    /failed to load resource|HTTP load failed/i.test(message) && message.includes(String(status))));
  expect(unexpectedErrors).toEqual([]); expect(traffic.failures).toEqual([]); expect(traffic.mime).toEqual([]);
  expect(traffic.responses).toEqual(expectedResponses);
}

function expectedHttpResponses(scenario: FixtureScenario): readonly HttpResponse[] {
  if (scenario === "proof-mismatch") return [{ status: 409,
    path: `/api/v1/proofs/${fixtureIds.proofId}/verify` }];
  if (scenario === "unavailable") return [{ status: 503, path: "/api/discover" }];
  if (scenario === "stale") return [{ status: 404,
    path: `/api/v1/proofs/${fixtureIds.proofId}/verify` }];
  return [];
}

async function exerciseAdverseState(page: Page, scenario: FixtureScenario) {
  if (["loading", "empty", "partial", "maximum", "unavailable"].includes(scenario)) {
    await navigate(page, "/agents");
    if (scenario === "loading") { await page.getByText("Reading recent ProofLocks").waitFor();
      await navigate(page, "/"); await page.getByRole("heading", { name: /Admission should be/ }).waitFor(); return; }
    const copy = scenario === "empty" ? "No recent finalized events" : scenario === "partial" ? "Partial results"
      : scenario === "maximum" ? "100 returned · cap 100" : "ProofLock inventory unavailable";
    await page.getByText(copy, { exact: false }).first().waitFor(); return;
  }
  if (scenario === "health-matrix") { await navigate(page, "/proof");
    for (const status of ["HEALTHY", "UNHEALTHY", "UNKNOWN"])
      await page.getByText(status, { exact: true }).first().waitFor(); return; }
  if (scenario === "stale") { await navigate(page, `/agents/7?sourceTxHash=${fixtureIds.transactionHash}`);
    await page.getByText("Stale proof link", { exact: true }).waitFor(); return; }
  await navigate(page, proofPath()); await clickHydrated(page.getByRole("button", { name: "Verify exact evidence" }));
  if (scenario === "canceled") await page.getByRole("button", { name: "Cancel historical verification" }).click();
  const result = scenario === "proof-match" ? "Historical artifact matches" : scenario === "proof-mismatch"
    ? "Historical artifact mismatch" : scenario === "unavailable" ? "Evidence unavailable"
      : scenario === "canceled" ? "Verification canceled" : "Verification timed out";
  await page.getByRole("heading", { name: result }).waitFor({ timeout: scenario === "proof-timeout" ? 15_000 : 8_000 });
}

function navigate(page: Page, path: string) {
  return page.goto(path);
}

async function clickHydrated(button: Locator) {
  await expect.poll(() => button.evaluate((node) => Object.keys(node)
    .some((key) => key.startsWith("__reactProps$")))).toBe(true);
  await button.click();
}

async function expectSafeSourceLink(source: Locator) {
  await expect(source).toHaveAttribute("rel", /noopener/);
  await expect(source).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(await source.getAttribute("href")).toMatch(/^https:\/\/chainscan\.0g\.ai\/tx\/0x[0-9a-f]{64}$/);
}
