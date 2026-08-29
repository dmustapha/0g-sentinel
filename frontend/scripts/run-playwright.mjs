import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { selectPlaywrightServer } from "./playwright-project.mjs";

const args = process.argv.slice(2);
const server = selectPlaywrightServer(args);
const cli = resolve(process.cwd(), "node_modules/@playwright/test/cli.js");
const child = spawn(process.execPath, [cli, "test", ...args], {
  env: { ...process.env, PROOFLOCK_E2E_SERVER: server },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

const childExit = await new Promise((complete) => {
  child.once("error", () => complete(1));
  child.once("exit", (code) => complete(code ?? 1));
});
const leakedPorts = await waitForReleasedPorts([4317, 4318]);
if (leakedPorts.length > 0) console.error(`Playwright server teardown failed: ${leakedPorts.join(", ")}`);
else console.info("Playwright servers released: 4317, 4318");
process.exitCode = childExit === 0 && leakedPorts.length === 0 ? 0 : 1;

async function waitForReleasedPorts(ports) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const open = await openPorts(ports);
    if (open.length === 0) return [];
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return openPorts(ports);
}

async function openPorts(ports) {
  const states = await Promise.all(ports.map(async (port) => ({ port, open: await isOpen(port) })));
  return states.filter(({ open }) => open).map(({ port }) => port);
}

function isOpen(port) {
  return new Promise((complete) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open) => { socket.destroy(); complete(open); };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
