const productionHttps = process.env.NODE_ENV === "production"
  && process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://");

function contentSecurityPolicy() {
  const rpcOrigin = safeOrigin(process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai");
  // Cloudflare Turnstile (config-gated): the challenge widget loads a script + renders an iframe +
  // posts from https://challenges.cloudflare.com. Only widen the CSP to that origin when Turnstile is
  // actually enabled (site key set at build), so the policy stays minimal when the challenge is off.
  const turnstile = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").length > 0;
  const cf = "https://challenges.cloudflare.com";
  const scriptExtra = turnstile ? ` ${cf}` : "";
  const connectSources = ["'self'", rpcOrigin, turnstile ? cf : ""].filter(Boolean).join(" ");
  const scriptSources = process.env.NODE_ENV === "production"
    ? `script-src 'self' 'unsafe-inline'${scriptExtra}` : `script-src 'self' 'unsafe-inline' 'unsafe-eval'${scriptExtra}`;
  const directives = [
    "default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'", "object-src 'none'",
    "form-action 'self'", scriptSources, "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:", "img-src 'self' data: blob:", `connect-src ${connectSources}`,
    "worker-src 'self' blob:", "manifest-src 'self'", "media-src 'self'",
  ];
  if (turnstile) directives.push(`frame-src ${cf}`);
  if (productionHttps) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

function securityHeaders() {
  const headers = [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), clipboard-write=(self)" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  ];
  if (productionHttps) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}

function safeOrigin(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.origin : "";
  } catch {
    return "";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  distDir: process.env.PROOFLOCK_PLAYWRIGHT_DEV === "1"
    ? "output/playwright/mock-next"
    : ".next",
  experimental: {
    outputFileTracingIncludes: {
      "/*": ["./.prooflock-build/sdk-worker.cjs"],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders(),
      },
    ];
  },
  env: {
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
};

export default nextConfig;
