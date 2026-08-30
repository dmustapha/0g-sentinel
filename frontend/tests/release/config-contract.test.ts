import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "../../app/error";
import NotFound from "../../app/not-found";

const PUBLIC_V2 = [
  "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_RPC_URL", "NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS",
  "NEXT_PUBLIC_AGENT_GATE_V2_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_CONSUMER_ADDRESS",
  "NEXT_PUBLIC_PROOFLOCK_ADMIN_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_SCANNER_ADDRESS",
  "NEXT_PUBLIC_PROOFLOCK_GUARDIAN_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_CUSTODY_CONSTRAINT",
  "NEXT_PUBLIC_PROOFLOCK_VALIDATOR_ADDRESS", "NEXT_PUBLIC_PROOFLOCK_VALIDATOR_VERSION",
  "NEXT_PUBLIC_PROOFLOCK_POLICY_VERSION", "NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID",
];
const SERVER_V2 = ["PROOFLOCK_REGISTRY_V2_FROM_BLOCK", "PROOFLOCK_CONSUMER_ADDRESS"];
const FEATURED_PROOF = [
  "PROOFLOCK_FEATURED_PROOF_ID", "PROOFLOCK_FEATURED_IDENTITY_KEY", "PROOFLOCK_FEATURED_SOURCE_TX_HASH",
];
const FEATURED_METADATA = ["PROOFLOCK_FEATURED_AGENT_ID", "PROOFLOCK_FEATURED_VERIFIED_AT"];
const OPERATOR_V2 = [
  "SENTINEL_0G_PRIVATE_KEY", "PROOFLOCK_GUARDIAN_PRIVATE_KEY", "PROOFLOCK_COMPUTE_PRIVATE_KEY",
  "PROOFLOCK_SCANNER_SOFTWARE_VERSION", "PROOFLOCK_POLICY_VERSION",
  "PROOFLOCK_COMPUTE_PROVIDER", "PROOFLOCK_COMPUTE_MODEL",
  "PROOFLOCK_STATE_DIRECTORY", "PROOFLOCK_SPEND_AUTHORIZED",
  "PROOFLOCK_CHAIN_CONFIRMATIONS", "PROOFLOCK_TRANSACTION_TIMEOUT_MS",
  "PROOFLOCK_RECOVERY_LIVENESS_GRACE_MS",
  "PROOFLOCK_OPERATOR_MAX_CONCURRENCY", "PROOFLOCK_OPERATOR_RATE_WINDOW_MS",
  "PROOFLOCK_OPERATOR_RATE_LIMIT", "PROOFLOCK_OPERATOR_DAILY_CEREMONY_LIMIT",
  "PROOFLOCK_OPERATOR_DAILY_COST_UNITS_LIMIT",
];
const DEPLOY_V2 = [
  "PROOFLOCK_ADMIN_ADDRESS", "PROOFLOCK_SCANNER_ADDRESS", "PROOFLOCK_GUARDIAN_ADDRESS",
  "PROOFLOCK_MAX_BEHAVIORAL_SCORE", "PROOFLOCK_MAX_CODE_RISK", "PROOFLOCK_REQUIRED_COVERAGE",
  "PROOFLOCK_MINIMUM_POLICY_VERSION", "PROOFLOCK_MAXIMUM_AGE_SECONDS", "PROOFLOCK_DEPLOY_CONFIRMATIONS",
];
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), clipboard-write=(self)",
};
const OBSOLETE_UI = ["AnimatedScoreBar", "ChainDiscovery", "FineTuneButton", "GridOverlays",
  "QueueBanner", "RadarHero"] as const;
const LEGACY_PUBLIC_ENV = ["NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS",
  "NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS", "NEXT_PUBLIC_AGENT_GATE_ADDRESS"] as const;
const LEGACY_TOMBSTONES = ["app/api/agents/route.ts", "app/api/fine-tuning/route.ts",
  "app/api/scan/behavioral/route.ts", "app/api/scan/code/route.ts", "app/api/scan/inft/route.ts",
  "app/api/scan/queue/route.ts", "app/api/scan/stream/route.ts", "app/api/verify-evidence/route.ts",
  "app/api/v1/attestation/[address]/route.ts"] as const;

describe("release configuration and legacy boundary", () => {
  it("publishes a truthful generated root social image", () => {
    const layout = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");
    const image = readFileSync(resolve(process.cwd(), "app/opengraph-image.tsx"), "utf8");
    expect(layout).not.toContain("/dashboard.png");
    expect(image).toContain('contentType = "image/png"');
    expect(image).toContain("Policy-scoped agent admission");
    expect(image).not.toMatch(/\b(?:LIVE|ADMITTED|SAFE|BLOCKED)\b/);
  });

  it.each([
    ["error", GlobalError, { error: new Error("test"), reset: () => undefined }],
    ["404", NotFound, {}],
  ] as const)("renders exactly one h1 on the %s surface", (_name, Component, props) => {
    const html = renderToStaticMarkup(React.createElement(Component as React.ComponentType<any>, props));
    expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
  });

  it("enforces the reviewed security headers and CSP without a reporting token sink", async () => {
    const config = (await import("../../next.config.mjs")).default;
    expect(config.headers).toBeTypeOf("function");
    const definitions = await config.headers!();
    const headers = Object.fromEntries(definitions[0]!.headers.map(({ key, value }) => [key, value]));
    expect(definitions[0]!.source).toBe("/(.*)");
    expect(headers).toMatchObject(SECURITY_HEADERS);
    const csp = headers["Content-Security-Policy"];
    for (const directive of ["default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'",
      "object-src 'none'", "form-action 'self'", "script-src", "style-src", "font-src", "img-src",
      "connect-src"]) expect(csp).toContain(directive);
    expect(csp).not.toMatch(/report-(?:to|uri)/i);
    expect(headers).not.toHaveProperty("Content-Security-Policy-Report-Only");
  });

  it("emits HSTS and upgrade-insecure-requests only for production HTTPS", () => {
    const https = loadSecurityHeaders("production", "https://sentinel.example");
    const http = loadSecurityHeaders("production", "http://127.0.0.1:3000");
    const development = loadSecurityHeaders("development", "https://sentinel.example");
    expect(https["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(https["Content-Security-Policy"]).toContain("upgrade-insecure-requests");
    expect(https["Content-Security-Policy"]).toContain("https://evmrpc.0g.ai");
    expect(development["Content-Security-Policy"]).toContain("'unsafe-eval'");
    for (const headers of [https, http]) expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    for (const headers of [http, development]) {
      expect(headers).not.toHaveProperty("Strict-Transport-Security");
      expect(headers["Content-Security-Policy"]).not.toContain("upgrade-insecure-requests");
    }
  });

  it("runs the packaged standalone release smoke with guaranteed teardown", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = readFileSync(resolve(process.cwd(), "scripts/test-release.mjs"), "utf8");
    expect(packageJson.scripts?.["test:release"]).toBe("node scripts/test-release.mjs");
    for (const contract of [".next/standalone/server.js", 'property="og:image"', "X-Frame-Options",
      "X-Content-Type-Options", "Referrer-Policy", "SIGTERM"]) expect(script).toContain(contract);
  });

  it("checks every exercised route asset and observes server exit without a listener race", () => {
    const script = readFileSync(resolve(process.cwd(), "scripts/test-release.mjs"), "utf8");
    expect(script).toContain('const routes = ["/", "/proof", "/agents", "/operator"]');
    expect(script).toContain("for (const page of pages) await requirePackagedAssets(page)");
    const exitPromise = script.indexOf("const serverExit = new Promise");
    expect(exitPromise).toBeGreaterThan(script.indexOf("const server = spawn"));
    expect(exitPromise).toBeLessThan(script.indexOf("try {"));
    expect(script).not.toContain("function onceExit");
  });

  it("packages browser assets into the standalone runtime after every build", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.postbuild).toBe("node scripts/prepare-standalone.mjs");
  });

  it("defines descriptive route metadata and truthful dynamic social images", () => {
    const files = ["app/agents/layout.tsx", "app/proof/layout.tsx", "app/operator/layout.tsx",
      "app/agents/[address]/opengraph-image.tsx", "app/proof/[proofId]/opengraph-image.tsx"];
    const source = files.map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");
    const dynamicImages = ["app/agents/[address]/opengraph-image.tsx",
      "app/proof/[proofId]/opengraph-image.tsx"]
      .map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");
    for (const title of ["ProofLock ledger", "Historical proof verifier", "ProofLock operator"])
      expect(source).toContain(`title: "${title}"`);
    expect(source).not.toMatch(/\b(?:LIVE|ADMITTED|SAFE|BLOCKED)\b/);
    for (const unverifiedClaim of ["CANONICAL ERC-8004 IDENTITY", "HISTORICAL PROOF ARTIFACT",
      "identity-bound evidence", "Gate decision"])
      expect(dynamicImages).not.toContain(unverifiedClaim);
    expect(dynamicImages).toContain("ROUTE LOCATOR");
    expect(dynamicImages).toContain("No share-card verdict");
  });

  it("adds the exhaustive standalone runtime gate", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = readFileSync(resolve(process.cwd(), "scripts/test-standalone.mjs"), "utf8");
    expect(packageJson.scripts?.["test:standalone"]).toBe("node scripts/test-standalone.mjs");
    for (const contract of [".next/standalone/server.js", "findAvailablePort", "try", "finally", "SIGTERM",
      '"/agents/7"', "`/proof/${proofId}?identityKey=${identityKey}`", "opengraph-image", "favicon.ico",
      "packaged font/media"])
      expect(script).toContain(contract);
    for (const safety of ["AbortSignal.timeout", "EADDRINUSE", "startStandalone",
      "x-prooflock-e2e-error"]) expect(script).toContain(safety);
  });

  it.each([".env.example", "../.env.example"])("documents every active public V2 variable in %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    for (const name of PUBLIC_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
    for (const name of SERVER_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
    for (const name of OPERATOR_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
    expect(text).not.toMatch(/^PROOFLOCK_OPERATOR_MODULE=/m);
  });

  it.each([".env.example", "../.env.example"])("documents the server-only featured-proof tuple in %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    for (const name of [...FEATURED_PROOF, ...FEATURED_METADATA]) {
      expect(text).toMatch(new RegExp(`^${name}=`, "m"));
      expect(text).not.toMatch(new RegExp(`^NEXT_PUBLIC_${name}=`, "m"));
    }
    expect(text).toContain("Populate all three only after exact release-time verification");
    expect(text).toContain("keep blank until Task 22 records the exact release audit");
  });

  it("keeps featured-proof configuration on the server and public landing free of mutation controls", () => {
    const featured = readFileSync(resolve(process.cwd(), "components/FeaturedProofLink.tsx"), "utf8");
    const landing = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    expect(featured).not.toContain('"use client"');
    for (const name of [...FEATURED_PROOF, ...FEATURED_METADATA])
      expect(featured).toContain(`process.env.${name}`);
    for (const forbidden of ["operator-token", "One-time operator token", "Run verified evaluation", "ScanInput", "RescanButton"])
      expect(landing).not.toContain(forbidden);
  });

  it("provides skip navigation, semantic shell links, route titles, and neutral network wording", () => {
    const root = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");
    const overview = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    const operator = readFileSync(resolve(process.cwd(), "app/operator/layout.tsx"), "utf8");
    const nav = readFileSync(resolve(process.cwd(), "components/NavLinks.tsx"), "utf8");
    expect(root).toContain('<Link href="#main-content"');
    expect(root).toContain('<Link href="/" className="wordmark"');
    expect(root).toContain("Network configuration · Chain ID 16661");
    expect(root).not.toContain('export const dynamic = "force-dynamic"');
    const proofLayout = readFileSync(resolve(process.cwd(), "app/proof/layout.tsx"), "utf8");
    expect(proofLayout).toContain('export const dynamic = "force-dynamic"');
    expect(proofLayout).toContain("PROOFLOCK_E2E_ERROR_TRIGGER");
    expect(proofLayout).toContain("x-prooflock-e2e-error");
    expect(root).not.toContain("0G MAINNET");
    expect(overview).not.toContain("0G Mainnet");
    expect(overview).toContain("export const metadata");
    expect(operator).toContain("export const metadata");
    expect(nav).toContain('aria-current={pathname === "/" ? "page" : undefined}');
    expect(nav).toContain('aria-current={operatorActive ? "page" : undefined}');
  });

  it.each([".env.example", "../.env.example"])("documents all nine V2 deployment inputs in %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(DEPLOY_V2).toHaveLength(9);
    for (const name of DEPLOY_V2) expect(text).toMatch(new RegExp(`^${name}=`, "m"));
    expect(text).not.toMatch(/^PROOFLOCK_ERC8004_IDENTITY_REGISTRY_ADDRESS=/m);
  });

  it("never falls back from AgentGateV2 to a legacy gate", () => {
    const text = readFileSync(resolve(process.cwd(), "lib/contracts.ts"), "utf8");
    expect(text).not.toContain("?? process.env.NEXT_PUBLIC_AGENT_GATE_ADDRESS");
    expect(text).not.toContain("readGateDecision");
    expect(text).not.toContain("simulateConsumerAction");
  });

  it("guards verifier admission through the bound consumer predicate", () => {
    const text = readFileSync(resolve(process.cwd(), "components/VerifyEvidenceButton.tsx"), "utf8");
    expect(text).toContain("admittedConsumerState");
    expect(text).not.toMatch(/gate\.status === "VERIFIED" && gate\.allowed/);
  });

  it.each(["components/ScanInput.tsx", "components/RescanButton.tsx"])("keeps provenance policy out of browser mutation payloads in %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    for (const field of ["registryAddress:", "scanner:", "scannerSoftwareVersion:", "policyVersion:", "validForSeconds:"]) expect(text).not.toContain(field);
  });

  it("removes the unused legacy share-card claim surface", () => {
    expect(() => readFileSync(resolve(process.cwd(), "components/ShareCard.tsx"), "utf8")).toThrow();
  });

  it("removes only the proven-dead design-era UI and unresolved tokens", () => {
    const source = browserSource();
    for (const component of OBSOLETE_UI) {
      expect(existsSync(resolve(process.cwd(), `components/${component}.tsx`)), component).toBe(false);
      expect(source, component).not.toMatch(new RegExp(`(?:import|require)[^\\n]*${component}`));
    }
    for (const token of ["--cy", "--tx-", "--fs-xs", "--r-2", "--good-12"])
      expect(source, token).not.toContain(token);
  });

  it("removes the unused Tailwind and scanner-alias configuration", () => {
    const packageJson = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    const globals = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    const foundations = readFileSync(resolve(process.cwd(), "app/styles/foundations.css"), "utf8");
    const postcss = readFileSync(resolve(process.cwd(), "postcss.config.js"), "utf8");
    const tsconfig = readFileSync(resolve(process.cwd(), "tsconfig.json"), "utf8");
    const nextConfig = readFileSync(resolve(process.cwd(), "next.config.mjs"), "utf8");
    expect(existsSync(resolve(process.cwd(), "tailwind.config.ts"))).toBe(false);
    for (const source of [packageJson, globals, postcss]) expect(source).not.toMatch(/tailwind/i);
    expect(foundations).toMatch(/small\s*\{\s*font-size:\s*80%/);
    expect(foundations).toMatch(/table\s*\{[^}]*border-collapse:\s*collapse[^}]*border-color:\s*inherit[^}]*text-indent:\s*0/s);
    expect(browserSource()).not.toMatch(/className=[^\n]*(?:sm:|md:|lg:|xl:|hover:|focus:|active:|disabled:|dark:)/);
    expect(tsconfig).not.toContain('"@scanner/*"');
    expect(nextConfig).not.toContain('@scanner');
  });

  it.each([".env.example", "../.env.example"])("removes legacy V1 public addresses from %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    for (const name of LEGACY_PUBLIC_ENV) expect(text).not.toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("keeps the preserved legacy scanner graph server-only", () => {
    const contracts = readFileSync(resolve(process.cwd(), "lib/contracts.ts"), "utf8");
    expect(contracts).toContain("process.env.ATTESTATION_REGISTRY_ADDRESS");
    expect(contracts).toContain("process.env.AGENT_REGISTRY_ADDRESS");
    for (const name of LEGACY_PUBLIC_ENV) expect(contracts).not.toContain(name);
    for (const route of LEGACY_TOMBSTONES)
      expect(readFileSync(resolve(process.cwd(), route), "utf8")).toContain("goneResponse");
  });

  it.each(["../scripts/prooflock/run.ts", "../scripts/prooflock/check-drift.ts"])(
    "loads the built-in production operator in %s",
    (path) => {
      const text = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(text).toContain("loadProofLock");
      expect(text).not.toContain("PROOFLOCK_OPERATOR_MODULE");
      expect(text).not.toContain("pathToFileURL");
    },
  );

  it.each(["app/api/v1/attestation/[address]/route.ts", "app/api/verify-evidence/route.ts"])("retires %s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(text).toContain("goneResponse");
    expect(text).not.toContain("verified: true");
  });

  it("publishes the current fail-closed claim boundary", () => {
    const text = readFileSync(resolve(process.cwd(), "../README.md"), "utf8");
    expect(text).toContain("networkProofVerified: false");
    expect(text).toContain("inferenceExecuted: false");
    expect(text).toContain("Legacy V1");
    for (const claim of ["hosted 0G router fallback", "two independent AI inference pipelines", "immutable 9-field attestations"])
      expect(text).not.toContain(claim);
  });
});

function loadSecurityHeaders(nodeEnv: "production" | "development", appUrl: string): Record<string, string> {
  const program = `const c=(await import('./next.config.mjs?case=${nodeEnv}-${Date.now()}')).default;`
    + `const d=await c.headers();console.log(JSON.stringify(Object.fromEntries(d[0].headers.map(h=>[h.key,h.value]))));`;
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NODE_ENV: nodeEnv,
      NEXT_PUBLIC_APP_URL: appUrl, NEXT_PUBLIC_RPC_URL: "" },
  });
  return JSON.parse(output) as Record<string, string>;
}

function browserSource(): string {
  const roots = ["app", "components"];
  return roots.flatMap((root) => sourceFiles(resolve(process.cwd(), root)))
    .map((path) => readFileSync(path, "utf8")).join("\n");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? [path] : [];
  });
}
