import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect } from "node:net";

const port = 4321;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), PROOFLOCK_E2E_ERROR_TRIGGER: "enabled" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverExit = new Promise((resolve, reject) => {
  server.once("exit", () => resolve(true));
  server.once("error", reject);
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

try {
  await waitForServer();
  const routes = ["/", "/proof", "/agents", "/operator"];
  const pages = await Promise.all(routes.map((route) => requireHtml(route, 200)));
  const [root] = pages;
  await requireOneHeading("/__prooflock_missing_route__", 404);
  requireHeaders(root);
  await requireSocialImage(root);
  for (const page of pages) await requirePackagedAssets(page);
  await requireAsset("/favicon.ico");
  console.log("Packaged standalone release smoke passed.");
} catch (error) {
  if (serverOutput) console.error(serverOutput.trim());
  throw error;
} finally {
  await stopServer();
  await requireReleasedPort();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Standalone server exited with ${server.exitCode}`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("Standalone server did not become ready");
}

async function requireHtml(path, status) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, status, `${path} status`);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/, `${path} MIME`);
  return { path, response, html: await response.text() };
}

async function requireOneHeading(path, status) {
  const { html } = await requireHtml(path, status);
  assert.equal(html.match(/<h1(?:\s|>)/g)?.length, 1, `${path} must contain one h1`);
}

function requireHeaders({ response }) {
  const expected = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(response.headers.get(name), value, name);
}

async function requireSocialImage({ html }) {
  const tag = html.match(/<meta[^>]+property="og:image"[^>]*>/)?.[0];
  const url = tag?.match(/content="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  assert.ok(url, "root must publish og:image metadata");
  const published = new URL(url, origin);
  const response = await fetch(new URL(`${published.pathname}${published.search}`, origin));
  assert.equal(response.status, 200, "root og:image status");
  assert.match(response.headers.get("content-type") ?? "", /^image\/png\b/, "root og:image MIME");
}

async function requirePackagedAssets({ html, path: route }) {
  const paths = [...html.matchAll(/["'](\/_next\/static\/[^"'<>\s]+)["']/g)]
    .map((match) => match[1].replaceAll("&amp;", "&"));
  const unique = [...new Set(paths)];
  assert.ok(unique.some((path) => path.endsWith(".js")), `${route} must reference packaged JavaScript`);
  assert.ok(unique.some((path) => path.endsWith(".css")), `${route} must reference packaged CSS`);
  for (const path of unique) await requireAsset(path);
}

async function requireAsset(path) {
  const response = await fetch(`${origin}${path}`);
  assert.ok(response.status >= 200 && response.status < 300, `${path} status`);
  const mime = response.headers.get("content-type") ?? "";
  assert.doesNotMatch(mime, /^text\/html\b/, `${path} must not be an HTML fallback`);
  if (path.endsWith(".js")) assert.match(mime, /javascript/, `${path} MIME`);
  if (path.endsWith(".css")) assert.match(mime, /^text\/css\b/, `${path} MIME`);
  if (path.endsWith(".woff2")) assert.match(mime, /^font\/woff2\b/, `${path} MIME`);
  if (path.endsWith(".woff")) assert.match(mime, /^font\/woff\b/, `${path} MIME`);
  if (path.endsWith(".ico")) assert.match(mime, /^image\//, `${path} MIME`);
}

async function stopServer() {
  if (server.exitCode !== null) return serverExit;
  server.kill("SIGTERM");
  const stopped = await Promise.race([serverExit, delay(5000).then(() => false)]);
  if (!stopped && server.exitCode === null) server.kill("SIGKILL");
  await serverExit;
}

async function requireReleasedPort() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!await portIsOpen()) return;
    await delay(100);
  }
  throw new Error(`Standalone server did not release port ${port}`);
}

function portIsOpen() {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
