import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const standalone = resolve(root, ".next/standalone");

copyRequired(resolve(root, "public"), resolve(standalone, "public"));
mkdirSync(resolve(standalone, ".next"), { recursive: true });
copyRequired(resolve(root, ".next/static"), resolve(standalone, ".next/static"));

function copyRequired(source, target) {
  if (!existsSync(source)) throw new Error(`Required standalone asset directory is missing: ${source}`);
  cpSync(source, target, { recursive: true, force: true });
}
