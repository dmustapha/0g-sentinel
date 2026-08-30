import { expect, test, type Page, type Route } from "@playwright/test";

import { installFixture } from "./fixtures";

const address = `0x${"88".repeat(20)}`;
const hash = (byte: string) => `0x${byte.repeat(64)}`;
const recoveryId = "rec_1234567890abcdef";

test.beforeEach(async ({ page }) => installFixture(page, "full"));

test("@mocked Enter resolves an operator identity and failure restores focus", async ({ browserName, page }) => {
  let requests = 0;
  await page.route("**/api/v1/identities/resolve?*", async (route) => {
    requests += 1;
    await json(route, { error: { code: "AGENT_NOT_FOUND", message: "Agent is not registered.",
      stage: "RESOLVING_IDENTITY", retryable: false, requestId: "e2e-resolution" } }, 404);
  });

  await page.goto("/operator");
  const input = page.getByLabel("ERC-8004 Agent ID");
  const button = page.getByRole("button", { name: "Resolve identity" });
  await input.fill("7");
  await input.focus(); await tab(page, browserName); await expect(button).toBeFocused();
  await tab(page, browserName, true); await expect(input).toBeFocused();
  await input.press("Enter");

  await expect(page.getByText(/MISSING/)).toBeVisible();
  await expect(input).toBeFocused();
  expect(requests).toBe(1);

  await button.click();
  await expect(page.getByText(/MISSING/)).toBeVisible();
});

test("@mocked canceled resolution cannot publish a stale identity", async ({ page }) => {
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route("**/api/v1/identities/resolve?*", async (route) => {
    const agentId = new URL(route.request().url()).searchParams.get("agentId") ?? "";
    if (agentId === "7") await firstResponse;
    await json(route, { identity: identity(agentId), identityKey: hash("e") }).catch(() => undefined);
  });
  await page.route("**/api/v1/prooflocks/**", (route) => missingProofLock(route));

  await page.goto("/operator");
  const input = page.getByLabel("ERC-8004 Agent ID");
  await input.fill("7");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Cancel resolution" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel resolution" }).click();

  await input.fill("8");
  await input.press("Enter");
  await expect(page.getByText(/ERC-8004 Agent #8/)).toBeVisible();
  releaseFirst();

  await expect(page.getByText(/ERC-8004 Agent #7/)).toHaveCount(0);
  await expect(input).toHaveValue("8");
  await expect(input).toBeFocused();
});

test("@mocked uncertain writes recover without leaking operator authority", async ({ page }) => {
  const token = `synthetic-${crypto.randomUUID()}`;
  const observed: ObservedTraffic = { console: [], consoleErrors: [], pageErrors: [], urls: [], bodies: [], authorizations: [] };
  let releaseRecovery!: () => void;
  const recoveryResponse = new Promise<void>((resolve) => { releaseRecovery = resolve; });
  observeTraffic(page, observed);
  await installOperatorResolution(page);
  await page.route("**/api/admin/prooflocks/stream", (route) => uncertainWrite(route));
  await page.route("**/api/admin/prooflocks/recovery", async (route) => {
    await recoveryResponse;
    await sealedRecovery(route);
  });

  await visitPublicRoutes(page);
  assertPublicRequestsAreSecretFree(observed);

  await resolveOperator(page);
  const password = page.getByLabel("One-time operator token");
  await password.fill(token);
  await page.getByRole("button", { name: "Run verified evaluation" }).click();

  await expect(page.getByText(/Submission was attempted, but broadcast is not yet proven/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Recover write" })).toBeDisabled();
  await password.fill(token);
  const recover = page.getByRole("button", { name: "Recover write" });
  await recover.click();
  await expect(recover).toHaveText("Recovering…");
  releaseRecovery();

  await expect(page.getByText("ProofLock v9 sealed.")).toBeVisible();
  await expect(password).toHaveCount(0);
  await assertOperatorSecretIsEphemeral(page, observed, token);
  expect(observed.consoleErrors.filter((message) =>
    !(/failed to load resource|HTTP load failed/i.test(message) && message.includes("404")))).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
});

async function visitPublicRoutes(page: Page): Promise<void> {
  await page.goto("/");
  const discovery = page.waitForRequest((request) => request.url().includes("/api/discover"));
  await page.goto("/agents"); await discovery;
  const health = page.waitForRequest((request) => request.url().includes("/api/health"));
  await page.goto("/proof"); await health;
}

function assertPublicRequestsAreSecretFree(observed: ObservedTraffic): void {
  const requests = observed.authorizations.filter(({ url }) =>
    url.includes("/api/") && !url.includes("/api/admin/"));
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(({ value }) => !value)).toBe(true);
}

async function resolveOperator(page: Page): Promise<void> {
  await page.goto("/operator");
  const input = page.getByLabel("ERC-8004 Agent ID");
  await input.fill("7");
  await input.press("Enter");
  await expect(page.getByLabel("One-time operator token")).toBeVisible();
}

async function assertOperatorSecretIsEphemeral(page: Page, observed: ObservedTraffic,
  token: string): Promise<void> {
  const admin = observed.authorizations.filter(({ url }) => url.includes("/api/admin/"));
  expect(admin.length).toBeGreaterThanOrEqual(2);
  expect(admin.every(({ value }) => value === `Bearer ${token}`)).toBe(true);
  expect(observed.urls.join("\n")).not.toContain(token);
  expect(observed.bodies.join("\n")).not.toContain(token);
  expect(observed.console.join("\n")).not.toContain(token);
  expect(await serializedStorage(page)).not.toContain(token);
}

async function installOperatorResolution(page: Page): Promise<void> {
  await page.route("**/api/v1/identities/resolve?*", async (route) => {
    const agentId = new URL(route.request().url()).searchParams.get("agentId") ?? "7";
    await json(route, { identity: identity(agentId), identityKey: hash("e") });
  });
  await page.route("**/api/v1/prooflocks/**", (route) => missingProofLock(route));
}

function identity(agentId: string) {
  return { identity: { namespace: "eip155", chainId: 16661, registryAddress: address, agentId },
    owner: address, agentWallet: address, agentURI: "ipfs://operator-e2e", registrationDigest: hash("a"),
    sourceBlockNumber: "8", sourceBlockHash: hash("b"), card: {} };
}

async function missingProofLock(route: Route): Promise<void> {
  await json(route, { error: { code: "NOT_FOUND", message: "No ProofLock exists.", stage: "READING_PROOF",
    retryable: false, requestId: "e2e-prooflock" } }, 404);
}

async function uncertainWrite(route: Route): Promise<void> {
  const frames = [
    { type: "progress", progress: { type: "admission", state: "ACCEPTED", recoveryId,
      idempotencyKey: "client-stable-key" } },
    { type: "progress", progress: { phase: "SUBMISSION_ATTEMPTED" } },
    { type: "error", error: { code: "SUBMISSION_OUTCOME_UNKNOWN", message: "Outcome is uncertain.",
      stage: "WRITING_CHAIN", retryable: false, requestId: "e2e-write" },
      writeOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId } },
  ];
  await route.fulfill({ status: 200, contentType: "text/event-stream",
    body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") });
}

async function sealedRecovery(route: Route): Promise<void> {
  await json(route, { result: { status: "SEALED", recoveryId, transactionHash: hash("c"),
    identityKey: hash("d"), version: "9" } });
}

type ObservedTraffic = {
  console: string[];
  consoleErrors: string[];
  pageErrors: string[];
  urls: string[];
  bodies: string[];
  authorizations: Array<{ url: string; value: string | undefined }>;
};

function observeTraffic(page: Page, observed: ObservedTraffic): void {
  page.on("console", (message) => { observed.console.push(message.text());
    if (message.type() === "error") observed.consoleErrors.push(message.text()); });
  page.on("pageerror", ({ message }) => observed.pageErrors.push(message));
  page.on("request", (request) => {
    observed.urls.push(request.url());
    observed.bodies.push(request.postData() ?? "");
    observed.authorizations.push({ url: request.url(), value: request.headers().authorization });
  });
  page.on("response", (response) => observed.urls.push(response.url()));
  page.on("framenavigated", (frame) => observed.urls.push(frame.url()));
}

async function serializedStorage(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({ local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)) }));
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function tab(page: Page, browserName: string, reverse = false) {
  const key = browserName === "webkit" ? `${reverse ? "Shift+" : ""}Alt+Tab` : `${reverse ? "Shift+" : ""}Tab`;
  return page.keyboard.press(key);
}
