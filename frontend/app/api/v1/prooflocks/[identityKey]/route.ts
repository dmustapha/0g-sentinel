import { apiErrorResponse, createLazyProofLockReadHandlers, methodNotAllowedResponse } from "@/server/prooflock/api";
import { createProductionReadDependencies } from "@/server/prooflock/read-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Detail enrichment re-downloads 0G Storage evidence + re-verifies Compute + recovers the Flow
// commitment; allow it to finish rather than being cut by the default function budget.
export const maxDuration = 60;
const handlers = createLazyProofLockReadHandlers(createProductionReadDependencies);

export async function GET(request: Request, context: { params: { identityKey: string } }): Promise<Response> {
  try { return await handlers.proofLock(context.params.identityKey, request); }
  catch (error) { return apiErrorResponse(error, { code: "DEPENDENCY_UNAVAILABLE", message: "ProofLock reader is unavailable", stage: "READING_PROOF", retryable: true, status: 503 }); }
}
export const POST = () => methodNotAllowedResponse("READING_PROOF");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
