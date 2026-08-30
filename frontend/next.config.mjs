const productionHttps = process.env.NODE_ENV === "production"
  && process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://");

function contentSecurityPolicy() {
  const rpcOrigin = safeOrigin(process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai");
  const connectSources = ["'self'", rpcOrigin].filter(Boolean).join(" ");
  const scriptSources = process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const directives = [
    "default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'", "object-src 'none'",
    "form-action 'self'", scriptSources, "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:", "img-src 'self' data: blob:", `connect-src ${connectSources}`,
    "worker-src 'self' blob:", "manifest-src 'self'", "media-src 'self'",
  ];
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
