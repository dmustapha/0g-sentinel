import { apiErrorResponse, methodNotAllowedResponse } from "@/server/prooflock/api";
import {
  createProductionAddressResolver,
  isEvmAddress,
  resolveAgentIdByAddress,
} from "@/server/prooflock/identity/resolve-by-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Foolproof address -> agentId lookup. Returns the agentId only when getAgentWallet verifies the
// address on-chain; a non-agent address returns 404 and is never presented as an agent.
export async function GET(request: Request): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  if (!isEvmAddress(address)) {
    return apiErrorResponse(null, { code: "INVALID_INPUT", message: "A valid EVM address is required",
      stage: "RESOLVING_IDENTITY", retryable: false, status: 400 });
  }
  try {
    const resolved = await resolveAgentIdByAddress(address, createProductionAddressResolver(process.env));
    if (resolved.status !== "AGENT") {
      return apiErrorResponse(null, { code: "AGENT_NOT_FOUND",
        message: "This address is not a registered ERC-8004 agent on 0G",
        stage: "RESOLVING_IDENTITY", retryable: false, status: 404 });
    }
    return Response.json({ agentId: resolved.agentId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, { code: "DEPENDENCY_UNAVAILABLE", message: "Address resolution is unavailable",
      stage: "RESOLVING_IDENTITY", retryable: true, status: 503 });
  }
}

export const POST = () => methodNotAllowedResponse("RESOLVING_IDENTITY");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
