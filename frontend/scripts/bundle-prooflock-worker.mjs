import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { build } from "esbuild";

const entry = resolve("server/prooflock/compute/sdk-worker.mjs");
const output = resolve(".prooflock-build/sdk-worker.cjs");

await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await build({
  entryPoints: [entry],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  packages: "bundle",
  sourcemap: false,
  legalComments: "none",
});
