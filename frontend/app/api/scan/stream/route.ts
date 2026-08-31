import { createPublicScanStreamHandler, methodNotAllowedResponse } from "@/server/prooflock/api";
import { loadProofLockRunner } from "@/server/prooflock/operator";
import { createProductionReadDependencies } from "@/server/prooflock/read-api";
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
  rate: { max: 6, windowMs: 60_000 },
});
export const GET = () => methodNotAllowedResponse("AUTHENTICATING");
