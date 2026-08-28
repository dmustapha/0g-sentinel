import { apiErrorResponse, createLazyProofLockReadHandlers, methodNotAllowedResponse } from "@/server/prooflock/api";
import { createProductionReadDependencies } from "@/server/prooflock/read-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createLazyProofLockReadHandlers(createProductionReadDependencies);

export async function GET(request: Request, context: { params: { proofId: string } }): Promise<Response> {
  try { return await handlers.verifyProof(context.params.proofId, request); }
  catch (error) { return apiErrorResponse(error, { code: "DEPENDENCY_UNAVAILABLE", message: "Proof verifier is unavailable", stage: "VERIFYING_PROOF", retryable: true, status: 503 }); }
}
export const POST = () => methodNotAllowedResponse("VERIFYING_PROOF");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
