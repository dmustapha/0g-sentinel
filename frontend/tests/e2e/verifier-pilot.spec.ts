import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const h = (byte: string) => `0x${byte.repeat(64)}`;
const proofId = h("1");
const identityKey = h("2");
const address = `0x${"88".repeat(20)}`;
const subject = `0x${"33".repeat(20)}`;

test("@mocked verifier entry validates source hints and focuses the navigated result", async ({ page }) => {
  await installHealth(page);
  await page.goto("/proof");

  const proof = page.getByRole("textbox", { name: "Proof ID" });
  const identity = page.getByRole("textbox", { name: "Identity key" });
  const source = page.getByRole("textbox", { name: "Optional Registry source transaction" });
  await proof.fill("invalid"); await proof.press("Enter");
  await expect(proof).toBeFocused();

  await proof.fill(proofId); await identity.fill(identityKey); await source.fill("invalid");
  await expect(page.getByRole("button", { name: "Open verifier" })).toBeEnabled();
  await source.press("Enter"); await expect(source).toBeFocused();
  await source.fill(h("3")); await page.getByRole("button", { name: "Open verifier" }).press("Enter");

  await expect(page).toHaveURL(new RegExp(`sourceTxHash=${h("3")}$`));
  await expect(page.getByRole("heading", { name: "Proof verification" })).toBeFocused();
  await expect(page.getByText(h("3"), { exact: true })).toBeVisible();
});

test("@mocked verifier failure has concise announcements and heading-to-retry keyboard order", async ({ page }, testInfo) => {
  await page.route("**/api/v1/proofs/**", (route) => apiError(route, "MISMATCH", 409));
  await page.goto(`/proof/${proofId}?identityKey=${identityKey}`);
  await page.getByRole("button", { name: "Verify exact evidence" }).press("Enter");

  const heading = page.getByRole("heading", { name: "Historical artifact mismatch" });
  await expect(heading).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Retry" })).toBeFocused();
  const live = page.locator('[role="status"]');
  await expect(live).toHaveCount(1); await expect(live).toHaveText("Historical artifact mismatch");

  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const transitionSeconds = await page.getByRole("button", { name: "Retry" }).evaluate((button) =>
    Number.parseFloat(getComputedStyle(button).transitionDuration));
  expect(transitionSeconds).toBeLessThanOrEqual(0.000001);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize(viewport); await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`mismatch-${viewport.width}.png`), fullPage: true });
  }
});

test("@mocked verifier pilot captures the exact 21-state viewport matrix", async ({ browser }, testInfo) => {
  test.slow();
  const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 700 }];
  for (const viewport of viewports) {
    for (const state of ["loading", "error", "mixed"] as const) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
      const page = await context.newPage(); await openHealthState(page, state);
      await exactScreenshot(page, testInfo.outputPath(`health-${state}-${viewport.width}.png`), viewport);
      await context.close();
    }
    for (const state of ["idle", "match", "mismatch", "unavailable"] as const) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
      const page = await context.newPage(); await openVerifierState(page, state);
      await exactScreenshot(page, testInfo.outputPath(`verifier-${state}-${viewport.width}.png`), viewport);
      await context.close();
    }
  }
});

async function installHealth(page: Page): Promise<void> {
  const probe = (status: "HEALTHY" | "UNHEALTHY" | "UNKNOWN") => ({
    status, latencyMs: 12, observedAt: "2026-08-29T10:00:00.000Z",
  });
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ status: "DEGRADED", dependencies: { rpc: probe("HEALTHY"), identity: probe("UNHEALTHY"),
      registry: probe("HEALTHY"), gate: probe("UNKNOWN"), compute: probe("HEALTHY"), storage: probe("UNHEALTHY") } }) }));
}

async function openHealthState(page: Page, state: "loading" | "error" | "mixed"): Promise<void> {
  await page.route("**/api/health", (route) => {
    if (state === "loading") return new Promise(() => {});
    if (state === "error") return apiError(route, "DEPENDENCY_UNAVAILABLE", 503);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(healthSnapshot()) });
  });
  await page.goto("/proof");
  const target = state === "loading" ? page.getByText("Probing six dependencies", { exact: true })
    : state === "error" ? page.getByText("Health response unavailable", { exact: true })
      : page.getByText("Service discovery only", { exact: false });
  await target.waitFor(); await target.scrollIntoViewIfNeeded();
}

async function openVerifierState(page: Page, state: "idle" | "match" | "mismatch" | "unavailable"): Promise<void> {
  await page.route("**/api/v1/proofs/**", (route) => state === "match"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(verifiedProof()) })
    : apiError(route, state === "mismatch" ? "MISMATCH" : "DEPENDENCY_UNAVAILABLE", state === "mismatch" ? 409 : 503));
  await page.route("**/api/v1/prooflocks/**", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify(currentDetail()) }));
  await page.goto(`/proof/${proofId}?identityKey=${identityKey}`);
  if (state === "idle") return;
  await page.getByRole("button", { name: "Verify exact evidence" }).click();
  const heading = state === "match" ? "Historical artifact matches"
    : state === "mismatch" ? "Historical artifact mismatch" : "Evidence unavailable";
  await page.getByRole("heading", { name: heading }).waitFor();
  if (state === "match") await page.getByRole("heading", { name: "Current access: ADMITTED" }).waitFor();
}

async function exactScreenshot(page: Page, screenshotPath: string,
  viewport: Readonly<{ width: number; height: number }>): Promise<void> {
  const image = await page.screenshot({ path: screenshotPath, animations: "disabled" });
  expect(image.readUInt32BE(16)).toBe(viewport.width); expect(image.readUInt32BE(20)).toBe(viewport.height);
}

function healthSnapshot() {
  const probe = (status: "HEALTHY" | "UNHEALTHY" | "UNKNOWN", detail?: Readonly<Record<string, unknown>>) => ({
    status, latencyMs: 12, observedAt: "2026-08-29T10:00:00.000Z", ...(detail ? { detail } : {}),
  });
  return { status: "DEGRADED", dependencies: { rpc: probe("HEALTHY"), identity: probe("UNHEALTHY"),
    registry: probe("HEALTHY"), gate: probe("UNKNOWN"),
    compute: probe("HEALTHY", { observation: "SERVICE_DISCOVERY", inferenceExecuted: false }),
    storage: probe("UNHEALTHY", { observation: "RETRIEVAL_CANARY", networkProofVerified: false }) } };
}

function proofLockRecord() {
  return { identityKey, subject, envelopeDigest: h("4"), storageRoot: h("5"), computeRoot: h("6"),
    artifactHash: h("7"), runtimeCodeHash: h("8"), version: "2", issuedAt: "1", validUntil: "9999999999",
    policyVersion: 1, behavioralScore: 10, codeRisk: 0, coverage: 127, state: 1, stateReason: 0 };
}

function verifiedProof() {
  return { proofId, identityKey, source: { kind: "ProofLocked", registryAddress: address,
    transactionHash: h("c"), blockNumber: 8, blockHash: h("b"), logIndex: 1 }, proofLock: proofLockRecord(),
    storage: { retrievalVerified: true, networkProofVerified: false,
      envelope: { computeProofs: [{ provider: "provider-tee", model: "model-tee" }] },
      storageCommitment: { uploadTxHash: h("d") } } };
}

function currentDetail() {
  return { identityKey, proofLock: proofLockRecord(), detail: { status: "VERIFIED", identity: { identityKey,
    namespace: "eip155", chainId: 16661, registryAddress: address, agentId: "7", owner: subject,
    agentWallet: subject, registrationUri: "ipfs://agent", registrationDigest: h("a"),
    sourceBlockNumber: "8", sourceBlockHash: h("b") }, resolution: { owner: subject, agentWallet: subject,
    agentURI: "ipfs://agent", registrationDigest: h("a"), sourceBlockNumber: "8", sourceBlockHash: h("b") },
    gate: { status: "VERIFIED", allowed: true, reason: 0, subject, version: "2" },
    consumer: { status: "VERIFIED", accepted: true, address, subject, version: "2" } } };
}

async function apiError(route: Route, code: string, status: number): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: {
    code, message: code, stage: "VERIFYING_PROOF", retryable: false, requestId: "verifier-pilot",
  } }) });
}
