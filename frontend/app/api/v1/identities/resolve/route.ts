import { apiErrorResponse, createProofLockReadHandlers, methodNotAllowedResponse } from "@/server/prooflock/api";
import { createProductionReadDependencies } from "@/server/prooflock/read-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try { return await createProofLockReadHandlers(createProductionReadDependencies()).resolve(request); }
  catch (error) { return unavailable(error, "RESOLVING_IDENTITY"); }
}
export const POST = () => methodNotAllowedResponse("RESOLVING_IDENTITY");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;

function unavailable(error: unknown, stage: "RESOLVING_IDENTITY") {
  return apiErrorResponse(error, { code: "DEPENDENCY_UNAVAILABLE", message: "Identity resolver is unavailable", stage, retryable: true, status: 503 });
}
