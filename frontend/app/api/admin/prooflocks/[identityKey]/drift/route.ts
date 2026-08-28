import { createDriftHandler, methodNotAllowedResponse } from "@/server/prooflock/api";
import { loadProofLockDrift } from "@/server/prooflock/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createDriftHandler({
  operatorToken: process.env.PROOFLOCK_OPERATOR_TOKEN,
  loadDrift: loadProofLockDrift,
});

export function POST(request: Request, context: { params: { identityKey: string } }): Promise<Response> {
  return handler(context.params.identityKey, request);
}
export const GET = () => methodNotAllowedResponse("AUTHENTICATING");
