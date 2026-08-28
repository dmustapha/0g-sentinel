// File: frontend/app/api/health/route.ts
import { createHealthHandler } from "@/lib/pulse";
import { methodNotAllowedResponse } from "@/server/prooflock/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createHealthHandler();
export const POST = () => methodNotAllowedResponse("HEALTH_CHECK");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
