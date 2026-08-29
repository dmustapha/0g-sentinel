import { createRecoveryHandler, methodNotAllowedResponse } from "@/server/prooflock/api";
import { loadProofLockRecovery } from "@/server/prooflock/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = createRecoveryHandler({
  operatorToken: process.env.PROOFLOCK_OPERATOR_TOKEN,
  loadRecovery: loadProofLockRecovery,
});
export const GET = () => methodNotAllowedResponse("RECOVERING_WRITE");
