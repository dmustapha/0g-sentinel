import { expect, test, type Page, type Route } from "@playwright/test";

const address = `0x${"88".repeat(20)}`;
const h = (byte: string) => `0x${byte.repeat(64)}`;

test.beforeEach(async ({ page }) => installOperatorFixtures(page));

test("@mocked Enter submits identity resolution and focus returns after failure", async ({ page }) => {
  let resolutions = 0;
  await page.route("**/api/v1/identities/resolve?*", async (route) => {
    resolutions += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await json(route, { error: { code: "AGENT_NOT_FOUND", message: "Agent is not registered.",
      stage: "RESOLVING_IDENTITY", retryable: false, requestId: "e2e-resolution" } }, 404);
  });
  await page.goto("/operator");
  const input = page.getByLabel("ERC-8004 Agent ID");
  await input.fill("7");
  await input.press("Enter");
  await expect(page.getByText(/MISSING/)).toBeVisible();
  await expect(input).toBeFocused();
  expect(resolutions).toBe(1);

  const resolveButton = page.getByRole("button", { name: "Resolve identity" });
  await resolveButton.click();
  await expect(page.getByText(/MISSING/)).toBeVisible();
  await expect(resolveButton).toBeFocused();
});

test("@mocked operator token stays out of URL, storage, console, and request bodies", async ({ page }) => {
  const token = `synthetic-${crypto.randomUUID()}`;
  const consoleMessages: string[] = [];
  const requestBodies: string[] = [];
  const observedUrls: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("request", (request) => {
    observedUrls.push(request.url());
    requestBodies.push(request.postData() ?? "");
  });
  page.on("response", (response) => observedUrls.push(response.url()));
  page.on("framenavigated", (frame) => observedUrls.push(frame.url()));

  await page.goto("/operator");
  await page.getByLabel("ERC-8004 Agent ID").fill("7");
  await page.getByLabel("ERC-8004 Agent ID").press("Enter");
  const password = page.getByLabel("One-time operator token");
  await expect(password).toBeVisible();
  await password.fill(token);
  await page.getByRole("button", { name: "Run verified evaluation" }).click();

  await expect(page.getByText(/No lease was issued/)).toBeVisible();
  await expect(password).toHaveValue("");
  expect(page.url()).not.toContain(token);
  expect(consoleMessages.join("\n")).not.toContain(token);
  expect(requestBodies.join("\n")).not.toContain(token);
  expect(observedUrls.join("\n")).not.toContain(token);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(storage).not.toContain(token);
});

test("@mocked authenticated writes reject redirect query-leak traps", async ({ page }) => {
  const token = `synthetic-${crypto.randomUUID()}`;
  const observedUrls: string[] = [];
  page.on("request", (request) => observedUrls.push(request.url()));
  page.on("response", (response) => observedUrls.push(response.url()));
  page.on("framenavigated", (frame) => observedUrls.push(frame.url()));
  await page.route("**/api/admin/prooflocks/stream", (route) => route.fulfill({
    status: 307,
    headers: { location: `/operator?credential=${encodeURIComponent(token)}` },
  }));

  await page.goto("/operator");
  await page.getByLabel("ERC-8004 Agent ID").fill("7");
  await page.getByLabel("ERC-8004 Agent ID").press("Enter");
  const password = page.getByLabel("One-time operator token");
  await password.fill(token);
  await page.getByRole("button", { name: "Run verified evaluation" }).click();

  await expect(password).toHaveValue("");
  expect(observedUrls.join("\n")).not.toContain(token);
  expect(page.url()).not.toContain(token);
});

async function installOperatorFixtures(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/identities/resolve") return json(route,
      { identity: identity(), identityKey: h("e") });
    if (url.pathname.startsWith("/api/v1/prooflocks/")) return json(route, { error: {
      code: "NOT_FOUND", message: "No ProofLock exists.", stage: "READING_PROOF",
      retryable: false, requestId: "e2e-prooflock" } }, 404);
    if (url.pathname === "/api/admin/prooflocks/stream") return sseNotBroadcast(route);
    return route.fallback();
  });
}

function identity() {
  return { identity: { namespace: "eip155", chainId: 16661, registryAddress: address, agentId: "7" },
    owner: address, agentWallet: address, agentURI: "ipfs://agent", registrationDigest: h("a"),
    sourceBlockNumber: "8", sourceBlockHash: h("b"), card: {} };
}

async function sseNotBroadcast(route: Route): Promise<void> {
  const recoveryId = "rec_1234567890abcdef";
  const frames = [
    { type: "admission", state: "ACCEPTED", recoveryId, idempotencyKey: "e2e-idempotency" },
    { type: "error", error: { code: "NOT_BROADCAST", message: "Stopped before submission.",
      stage: "RUNNING_COMPUTE", retryable: true, requestId: "e2e-run" },
      writeOutcome: { status: "NOT_BROADCAST", recoveryId } },
  ];
  await route.fulfill({ status: 200, contentType: "text/event-stream",
    body: frames.map((frame, index) => `data: ${JSON.stringify(index === 0
      ? { type: "progress", progress: frame } : frame)}\n\n`).join("") });
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
