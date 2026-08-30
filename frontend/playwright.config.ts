import { defineConfig, devices } from "@playwright/test";

delete process.env.NO_COLOR;

for (const name of [
  "DEPLOYER_PRIVATE_KEY", "PROOFLOCK_COMPUTE_PRIVATE_KEY", "PROOFLOCK_GUARDIAN_PRIVATE_KEY",
  "PROOFLOCK_OPERATOR_TOKEN", "SCANNER_PRIVATE_KEY", "SENTINEL_0G_PRIVATE_KEY",
  "ZERO_G_COMPUTE_API_KEY", "ZERO_G_PRIVATE_KEY",
]) delete process.env[name];

const MOCKED_PORT = 4317;
const STANDALONE_PORT = 4318;
const E2E_HOST = process.env.PROOFLOCK_E2E_HOST ?? "127.0.0.1";
const registryAddress = `0x${"88".repeat(20)}`;
const mockedTests = /(?:routes|accessibility|operator)\.spec\.ts/;

const mockedServer = {
  command: `npm run dev -- --hostname 127.0.0.1 --port ${MOCKED_PORT}`,
  url: `http://127.0.0.1:${MOCKED_PORT}`,
  reuseExistingServer: false,
  timeout: 120_000,
  gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
  env: {
    WATCHPACK_POLLING: "true",
    PROOFLOCK_PLAYWRIGHT_DEV: "1",
    PROOFLOCK_E2E_ERROR_TRIGGER: "enabled",
    NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID: "7",
    NEXT_PUBLIC_RPC_URL: "https://evmrpc.0g.ai",
    ZERO_G_RPC: "https://evmrpc.0g.ai",
    NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS: registryAddress,
    NEXT_PUBLIC_PROOFLOCK_ADMIN_ADDRESS: "",
    NEXT_PUBLIC_PROOFLOCK_GUARDIAN_ADDRESS: "",
    NEXT_PUBLIC_PROOFLOCK_SCANNER_ADDRESS: "",
    NEXT_PUBLIC_PROOFLOCK_CUSTODY_CONSTRAINT: "",
  },
};

const standaloneServer = {
  command: "node .next/standalone/server.js",
  url: `http://127.0.0.1:${STANDALONE_PORT}`,
  reuseExistingServer: false,
  timeout: 60_000,
  gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
  env: { HOSTNAME: "127.0.0.1", NODE_NO_WARNINGS: "1", PORT: String(STANDALONE_PORT) },
};

function selectedWebServers() {
  if (process.env.PROOFLOCK_E2E_SERVER === "external") return [];
  if (process.env.PROOFLOCK_E2E_SERVER === "mocked") return [mockedServer];
  if (process.env.PROOFLOCK_E2E_SERVER === "standalone") return [standaloneServer];
  return [mockedServer, standaloneServer];
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "/tmp/prooflock-playwright/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  globalSetup: "./tests/e2e/fixtures.ts",
  expect: { timeout: 8_000, toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "/tmp/prooflock-playwright/report" }],
  ],
  use: {
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: selectedWebServers(),
  projects: [
    {
      name: "chromium-mocked",
      grep: /@mocked/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://${E2E_HOST}:${MOCKED_PORT}`,
      },
    },
    {
      name: "firefox-mocked",
      testMatch: mockedTests,
      grep: /@mocked/,
      use: {
        ...devices["Desktop Firefox"],
        baseURL: `http://${E2E_HOST}:${MOCKED_PORT}`,
      },
    },
    {
      name: "webkit-mocked",
      testMatch: mockedTests,
      grep: /@mocked/,
      use: {
        ...devices["Desktop Safari"],
        baseURL: `http://${E2E_HOST}:${MOCKED_PORT}`,
      },
    },
    {
      name: "chromium-visual",
      testMatch: /visual\.spec\.ts/,
      grep: /@visual/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://${E2E_HOST}:${MOCKED_PORT}`,
      },
    },
    {
      name: "chromium-performance",
      testMatch: /performance\.spec\.ts/,
      grep: /@performance/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://${E2E_HOST}:${MOCKED_PORT}`,
      },
    },
    {
      name: "standalone-smoke",
      testMatch: /(?:public-smoke|routes)\.spec\.ts/,
      grep: /@standalone/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${STANDALONE_PORT}`,
      },
    },
  ],
});
