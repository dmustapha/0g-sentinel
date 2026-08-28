import { createProofLockStreamHandler, methodNotAllowedResponse } from "@/server/prooflock/api";
import { loadProofLockRunner } from "@/server/prooflock/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = createProofLockStreamHandler({
  operatorToken: process.env.PROOFLOCK_OPERATOR_TOKEN,
  loadRunner: loadProofLockRunner,
});
export const GET = () => methodNotAllowedResponse("AUTHENTICATING");
