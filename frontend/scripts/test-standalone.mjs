import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { connect, createServer } from "node:net";
import { relative, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const proofId = `0x${"1".repeat(64)}`;
const identityKey = `0x${"2".repeat(64)}`;
const runtime = await startStandalone();
const { origin, port } = runtime;

try {
  const routes = [
    ["/", "Overview"], ["/agents", "ProofLock ledger"], ["/agents/7", "ProofLock ledger"],
    ["/proof", "Historical proof verifier"],
    [`/proof/${proofId}?identityKey=${identityKey}`, "Historical proof verifier"],
    ["/operator", "ProofLock operator"],
  ];
  const pages = [];
  for (const [path, title] of routes) pages.push(await requirePage(origin, path, title));
  await requireOneHeading(origin, "/__prooflock_missing_route__", 404);
  await requireErrorBoundary(origin);
  for (const page of [pages[0], pages[2], pages[4]]) await requireSocialImage(origin, page);
  await requireAllPackagedAssets(origin);
  await requireAsset(origin, "/favicon.ico");
  console.log(`Standalone release smoke passed on isolated port ${port}.`);
} catch (error) {
  const output = runtime.output();
  if (output) console.error(output.trim());
  throw error;
} finally {
  await stopStandalone(runtime);
  await requireReleasedPort(port);
}

async function startStandalone() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = await findAvailablePort();
    const candidate = spawnStandalone(port);
    try {
      await waitForServer(candidate);
      return candidate;
    } catch (error) {
      await stopStandalone(candidate);
      if (!candidate.output().includes("EADDRINUSE") || attempt === 2) throw error;
    }
  }
  throw new Error("Standalone server could not reserve an isolated port");
}

function spawnStandalone(port) {
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [".next/standalone/server.js"], {
    cwd: process.cwd(), env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port),
      PROOFLOCK_E2E_ERROR_TRIGGER: "enabled" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  const exitPromise = new Promise((resolveExit, reject) => {
    server.once("exit", () => resolveExit(true));
    server.once("error", reject);
  });
  return { exitPromise, origin, output: () => output, port, server };
}

async function findAvailablePort() {
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolveClose) => probe.close(resolveClose));
  return address.port;
}

async function waitForServer(runtime) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (runtime.server.exitCode !== null) {
      throw new Error(`Standalone server exited with ${runtime.server.exitCode}: ${runtime.output()}`);
    }
    try {
      if ((await fetchBounded(runtime.origin, 500)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("Standalone server did not become ready");
}

async function requirePage(origin, path, title) {
  const page = await requireHtml(origin, path, 200);
  assert.match(page.html, new RegExp(`<title>${escapeRegex(title)}(?: · 0G Sentinel)?</title>`), `${path} title`);
  requireHeaders(page.response);
  return page;
}

async function requireHtml(origin, path, status) {
  const response = await fetchBounded(`${origin}${path}`);
  assert.equal(response.status, status, `${path} status`);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/, `${path} MIME`);
  return { path, response, html: await response.text() };
}

async function requireOneHeading(origin, path, status) {
  const { html } = await requireHtml(origin, path, status);
  assert.equal(html.match(/<h1(?:\s|>)/g)?.length, 1, `${path} must contain one h1`);
}

async function requireErrorBoundary(origin) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ extraHTTPHeaders: { "x-prooflock-e2e-error": "1" } });
    page.setDefaultTimeout(10_000);
    const response = await page.goto(`${origin}/proof`, { waitUntil: "domcontentloaded", timeout: 10_000 });
    assert.equal(response?.status(), 500, "production error response");
    await page.locator("h1").waitFor();
    assert.equal(await page.locator("h1").count(), 1, "production error boundary h1");
    assert.equal(await page.locator("h1").textContent(), "Proof surface unavailable");
  } finally {
    await browser.close();
  }
}

function requireHeaders(response) {
  const expected = { "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin" };
  for (const [name, value] of Object.entries(expected)) assert.equal(response.headers.get(name), value, name);
  assert.ok(response.headers.get("Permissions-Policy"), "Permissions-Policy");
  assert.ok(response.headers.get("Content-Security-Policy"), "Content-Security-Policy");
  if (!process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://")) {
    assert.equal(response.headers.get("Strict-Transport-Security"), null, "local HTTP HSTS");
    assert.doesNotMatch(response.headers.get("Content-Security-Policy") ?? "", /upgrade-insecure-requests/);
  }
}

async function requireSocialImage(origin, { html, path }) {
  const tag = html.match(/<meta[^>]+property="og:image"[^>]*>/)?.[0];
  const url = tag?.match(/content="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  assert.ok(url, `${path} must publish opengraph-image metadata`);
  const published = new URL(url, origin);
  const response = await fetchBounded(new URL(`${published.pathname}${published.search}`, origin));
  assert.equal(response.status, 200, `${path} opengraph-image status`);
  assert.match(response.headers.get("content-type") ?? "", /^image\/png\b/, `${path} opengraph-image MIME`);
}

async function requireAllPackagedAssets(origin) {
  const staticRoot = resolve(process.cwd(), ".next/standalone/.next/static");
  const files = walkFiles(staticRoot);
  assert.ok(files.some((path) => path.endsWith(".js")), "packaged JavaScript");
  assert.ok(files.some((path) => path.endsWith(".css")), "packaged CSS");
  assert.ok(files.some((path) => /\.(?:woff2?|ttf|otf)$/.test(path)), "packaged font/media");
  for (const file of files) {
    const path = `/_next/static/${relative(staticRoot, file).split(sep).join("/")}`;
    await requireAsset(origin, path);
  }
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

async function requireAsset(origin, path) {
  const response = await fetchBounded(`${origin}${path}`);
  assert.ok(response.ok, `${path} status`);
  const mime = response.headers.get("content-type") ?? "";
  assert.doesNotMatch(mime, /^text\/html\b/, `${path} must not be an HTML fallback`);
  if (path.endsWith(".js")) assert.match(mime, /javascript/, `${path} MIME`);
  if (path.endsWith(".css")) assert.match(mime, /^text\/css\b/, `${path} MIME`);
  if (/\.(?:woff2?|ttf|otf)$/.test(path)) assert.match(mime, /^font\//, `${path} MIME`);
  if (/\.(?:png|jpe?g|gif|webp|ico|svg)$/.test(path)) assert.match(mime, /^image\//, `${path} MIME`);
}

function fetchBounded(url, timeoutMs = 10_000) {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

async function stopStandalone(runtime) {
  if (runtime.server.exitCode !== null) return runtime.exitPromise;
  runtime.server.kill("SIGTERM");
  const stopped = await Promise.race([runtime.exitPromise, delay(5000).then(() => false)]);
  if (!stopped && runtime.server.exitCode === null) runtime.server.kill("SIGKILL");
  const killed = await Promise.race([runtime.exitPromise, delay(5000).then(() => false)]);
  assert.equal(killed, true, "Standalone server must terminate");
}

async function requireReleasedPort(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!await portIsOpen(port)) return;
    await delay(100);
  }
  throw new Error(`Standalone server did not release port ${port}`);
}

function portIsOpen(port) {
  return new Promise((resolveOpen) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(500, () => { socket.destroy(); resolveOpen(false); });
    socket.once("connect", () => { socket.destroy(); resolveOpen(true); });
    socket.once("error", () => resolveOpen(false));
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
