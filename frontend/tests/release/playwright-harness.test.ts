import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { selectPlaywrightServer } from "../../scripts/playwright-project.mjs";

describe("Playwright project isolation", () => {
  it.each([
    [["--project=chromium-mocked"], "mocked"],
    [["--project", "standalone-smoke"], "standalone"],
    [["--project=chromium-mocked", "--project=standalone-smoke"], "both"],
    [[], "both"],
  ] as const)("maps %j to %s server selection", (args, expected) => {
    expect(selectPlaywrightServer(args)).toBe(expected);
  });

  it("routes the required npm command through the deterministic teardown wrapper", async () => {
    const [packageJson, config] = await Promise.all([
      readFile(resolve(process.cwd(), "package.json"), "utf8"),
      readFile(resolve(process.cwd(), "playwright.config.ts"), "utf8"),
    ]);
    expect(packageJson).toContain('"test:e2e": "node scripts/run-playwright.mjs"');
    expect(config).toContain("PROOFLOCK_E2E_SERVER");
    expect(config).toContain("selectedWebServers");
  });
});
