import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    outputFileTracingIncludes: {
      "/*": ["./.prooflock-build/sdk-worker.cjs"],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS,
    NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS,
    NEXT_PUBLIC_AGENT_GATE_ADDRESS: process.env.NEXT_PUBLIC_AGENT_GATE_ADDRESS,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  webpack: (config) => {
    // Allow Next.js API routes to import from ../scanner/ (outside project root)
    config.resolve.alias["@scanner"] = path.resolve(__dirname, "./scanner");
    return config;
  },
};

export default nextConfig;
