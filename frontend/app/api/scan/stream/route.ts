import { createPublicScanStreamHandler, methodNotAllowedResponse } from "@/server/prooflock/api";
import { loadProofLockRunner } from "@/server/prooflock/operator";
import { createProductionReadDependencies } from "@/server/prooflock/read-api";
import { createProductionAddressResolver, resolveAgentIdByAddress } from "@/server/prooflock/identity/resolve-by-address";
import { createTurnstileVerifier } from "@/server/prooflock/turnstile";
import { ERC8004_IDENTITY_REGISTRY } from "@/server/prooflock/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Public scan+seal front door. No client token: the server injects the operator token and the spend
// ceiling is the pre-funded balance. See createPublicScanStreamHandler.
export const POST = createPublicScanStreamHandler({
  operatorToken: process.env.PROOFLOCK_OPERATOR_TOKEN,
  loadRunner: loadProofLockRunner,
  loadReads: () => createProductionReadDependencies(process.env),
  registryAddress: ERC8004_IDENTITY_REGISTRY,
  resolveAddress: (address) => resolveAgentIdByAddress(address, createProductionAddressResolver(process.env)),
  rate: { max: 6, windowMs: 60_000 },
  // Config-gated: active only when TURNSTILE_SECRET_KEY is set (staged rollout, no regression otherwise).
  verifyTurnstile: createTurnstileVerifier(process.env.TURNSTILE_SECRET_KEY),
});
export const GET = () => methodNotAllowedResponse("AUTHENTICATING");
