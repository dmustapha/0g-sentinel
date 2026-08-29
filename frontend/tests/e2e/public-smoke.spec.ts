import { expect, test, type Page, type Route } from "@playwright/test";
import { AbiCoder, keccak256 } from "ethers";

const address = `0x${"88".repeat(20)}`;
const subject = `0x${"33".repeat(20)}`;
const identityKey = keccak256(AbiCoder.defaultAbiCoder().encode(
  ["uint256", "address", "uint256"], [16661, address, 7n],
));
const h = (byte: string) => `0x${byte.repeat(64)}`;
const standaloneOrigin = "http://127.0.0.1:4318";

test("@mocked public routes stay secret-free and operator work stays isolated", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Admission should be provable");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText("One-time operator token")).toHaveCount(0);

  await page.goto("/operator");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resolve first. Mutate second.");
  await expect(page.getByText("Named operator authority.")).toBeVisible();
});

test("@mocked blank trust roles render explicit fallbacks", async ({ page }) => {
  await installDetailFixtures(page);
  await page.goto("/agents/7");

  await expect(page.getByRole("heading", { name: "Named trust roles" })).toBeVisible();
  await expect(page.getByText("not configured", { exact: true })).toHaveCount(3);
  await expect(page.getByText("custody constraint not configured", { exact: true })).toBeVisible();
});

test("@mocked production error boundary has a deterministic test-only trigger", async ({ page }) => {
  await page.goto("/?__prooflock_e2e_error=1");
  await expect(page.getByRole("heading", { name: "Proof surface unavailable" })).toBeVisible();
  await expect(page.getByText("No admission state has been inferred.")).toBeVisible();
});

test("@standalone packaged routes, APIs, health, fonts, and media load without interception", async ({ page, request }) => {
  const failures: string[] = [];
  const assets: AssetResponse[] = [];
  const consoleErrors: ConsoleError[] = [];
  const degradedApiUrls = new Set<string>();
  const pageErrors: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== standaloneOrigin) return;
    if (url.pathname.startsWith("/api/") && response.status() === 503) degradedApiUrls.add(url.href);
    const kind = assetKind(response.request().resourceType(), url.pathname);
    if (kind) assets.push({ kind, url: url.href, status: response.status(),
      contentType: response.headers()["content-type"] ?? "" });
    if (response.status() >= 400 && !url.pathname.startsWith("/api/")) {
      failures.push(`${response.status()} ${url.pathname}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url });
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const route of ["/", "/proof", "/agents", "/operator"]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("main")).toBeVisible();
  }

  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Packaged logo failed to load"));
    image.src = "/logo.png";
    document.body.append(image);
  }));
  assertPackagedAssets(assets);

  const favicon = await request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toMatch(/^image\//);
  const logo = await request.get("/logo.png");
  expect(logo.status()).toBe(200);
  expect(logo.headers()["content-type"]).toMatch(/^image\//);

  const health = await request.get("/api/health", { timeout: 30_000 });
  expect([200, 503]).toContain(health.status());
  expect(health.headers()["content-type"]).toContain("application/json");
  const healthBody = await health.json();
  expect(healthBody.status).toBe(health.status() === 200 ? "HEALTHY" : "DEGRADED");

  const discover = await request.get("/api/discover", { timeout: 30_000 });
  expect([200, 503]).toContain(discover.status());
  expect(discover.headers()["content-type"]).toContain("application/json");

  await page.goto("/operator");
  const agentId = page.getByLabel("ERC-8004 Agent ID");
  await agentId.fill("7");
  await expect(page.getByRole("button", { name: "Resolve identity" })).toBeEnabled();
  expect(await agentId.inputValue()).toBe("7");
  expect(failures).toEqual([]);
  expect(consoleErrors.filter((error) => !expectedDegradedConsole(error, degradedApiUrls))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

type AssetKind = "script" | "stylesheet" | "font" | "image" | "media";
type AssetResponse = Readonly<{ kind: AssetKind; url: string; status: number; contentType: string }>;
type ConsoleError = Readonly<{ text: string; url: string }>;

function expectedDegradedConsole(error: ConsoleError, degradedApiUrls: ReadonlySet<string>): boolean {
  return error.text === "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
    && degradedApiUrls.has(error.url);
}

function assetKind(resourceType: string, pathname: string): AssetKind | null {
  if (resourceType === "script" || resourceType === "stylesheet" || resourceType === "font"
    || resourceType === "image" || resourceType === "media") return resourceType;
  if (/\.(?:png|jpe?g|gif|svg|ico|webp|avif)$/i.test(pathname)) return "image";
  return null;
}

function assertPackagedAssets(assets: readonly AssetResponse[]): void {
  for (const required of ["script", "stylesheet", "font", "image"] as const) {
    expect(assets.some(({ kind }) => kind === required), `${required} asset requested`).toBe(true);
  }
  for (const asset of assets) {
    expect(asset.status, asset.url).toBeGreaterThanOrEqual(200);
    expect(asset.status, asset.url).toBeLessThan(300);
    expect(asset.contentType, asset.url).not.toMatch(/^text\/html/i);
    const expected = { script: /javascript/, stylesheet: /^text\/css/i, font: /font|woff/i,
      image: /^image\//i, media: /^(?:audio|video)\//i }[asset.kind];
    expect(asset.contentType, asset.url).toMatch(expected);
  }
}

async function installDetailFixtures(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/identities/resolve") return json(route, { identity: identity() });
    if (url.pathname.startsWith("/api/v1/prooflocks/")) return json(route, detail());
    if (url.pathname.startsWith("/api/v1/proofs/")) {
      const proofId = url.pathname.split("/").at(-2)!;
      return json(route, proof(proofId));
    }
    return route.fallback();
  });
}

function identity() {
  return { identity: { namespace: "eip155", chainId: 16661, registryAddress: address, agentId: "7" },
    owner: subject, agentWallet: subject, agentURI: "ipfs://agent", registrationDigest: h("a"),
    sourceBlockNumber: "8", sourceBlockHash: h("b"), card: {} };
}

function record() {
  return { identityKey, subject, envelopeDigest: h("4"), storageRoot: h("5"), computeRoot: h("6"),
    artifactHash: h("7"), runtimeCodeHash: h("8"), version: "2", issuedAt: "1",
    validUntil: "9999999999", policyVersion: 1, behavioralScore: 10, codeRisk: 0,
    coverage: 127, state: 1, stateReason: 0 };
}

function detail() {
  return { identityKey, proofLock: record(), detail: { status: "VERIFIED", identity: { identityKey,
    namespace: "eip155", chainId: 16661, registryAddress: address, agentId: "7", owner: subject,
    agentWallet: subject, registrationUri: "ipfs://agent", registrationDigest: h("a"),
    sourceBlockNumber: "8", sourceBlockHash: h("b") }, resolution: { owner: subject,
    agentWallet: subject, agentURI: "ipfs://agent", registrationDigest: h("a"),
    sourceBlockNumber: "8", sourceBlockHash: h("b") }, gate: { status: "VERIFIED", allowed: true,
    reason: 0, subject, version: "2" }, consumer: { status: "VERIFIED", accepted: true,
    address, subject, version: "2" } } };
}

function proof(proofId: string) {
  return { proofId, identityKey, source: { kind: "ProofLocked", registryAddress: address,
    transactionHash: h("c"), blockNumber: 8, blockHash: h("b"), logIndex: 1 }, proofLock: record(),
    storage: { retrievalVerified: true, networkProofVerified: false,
      envelope: { computeProofs: [{ provider: "provider-tee", model: "model-tee" }] },
      storageCommitment: { uploadTxHash: h("d") } } };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
