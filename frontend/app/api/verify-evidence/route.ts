import { goneResponse } from "@/server/prooflock/api";

export const GET = () => goneResponse("VERIFYING_PROOF");
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
