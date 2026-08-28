import { randomUUID } from "node:crypto";

import type { RegistryProofLockRecord } from "./chain";
import { IdentityError } from "./errors";
import type { ResolvedAgentIdentity } from "./types";
import { ProofLockStageError, type RunnerInput, type RunnerResult, type RunnerStage } from "./runner";
import { authenticateOperator } from "./auth";

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9]\d*)$/;
const MAX_BODY_BYTES = 16_384;
const PUBLIC_CACHE = "public, max-age=15, stale-while-revalidate=45";

export type ApiStage = RunnerStage | "AUTHENTICATING" | "RESOLVING_IDENTITY" | "READING_PROOF" | "VERIFYING_PROOF" | "HEALTH_CHECK";
export type ApiErrorCode =
  | "INVALID_INPUT" | "UNAUTHORIZED" | "NOT_FOUND" | "GONE" | "METHOD_NOT_ALLOWED"
  | "AGENT_NOT_FOUND" | "AGENT_WALLET_UNSET" | "IDENTITY_UNAVAILABLE"
  | "DEPENDENCY_UNAVAILABLE" | "COMPUTE_UNVERIFIED" | "REQUEST_ABORTED" | "INTERNAL_ERROR";

export type ApiErrorOptions = Readonly<{
  code: ApiErrorCode; message: string; stage: ApiStage; retryable: boolean;
  status: number; requestId?: string;
}>;

export type ProofLockReadDependencies = Readonly<{
  resolveIdentity(agentId: string, signal: AbortSignal): Promise<ResolvedAgentIdentity>;
  readProofLock(identityKey: string, signal: AbortSignal): Promise<RegistryProofLockRecord>;
  computeProofId(registryAddress: string, record: RegistryProofLockRecord): string;
  verifyStoredEvidence(record: RegistryProofLockRecord, signal: AbortSignal): Promise<Readonly<{
    envelope: unknown; retrievalVerified: true; networkProofVerified: false;
  }>>;
  registryAddress?: string;
}>;

export type StreamRunner = Readonly<{
  run(input: RunnerInput, report?: (stage: RunnerStage) => void, signal?: AbortSignal): Promise<RunnerResult | unknown>;
}>;
export type DriftRunner = Readonly<{ run(identityKey: string, mark: boolean): Promise<unknown> }>;

export function apiErrorResponse(_cause: unknown, options: ApiErrorOptions): Response {
  const requestId = options.requestId ?? createRequestId();
  return json({ error: {
    code: options.code, message: options.message, stage: options.stage,
    retryable: options.retryable, requestId,
  } }, options.status, "no-store");
}

export function createProofLockReadHandlers(dependencies: ProofLockReadDependencies) {
  return Object.freeze({
    resolve: (request: Request) => resolveIdentity(request, dependencies),
    proofLock: (identityKey: string, request: Request) => readProofLock(identityKey, request, dependencies),
    verifyProof: (proofId: string, request: Request) => verifyProof(proofId, request, dependencies),
  });
}

export function createProofLockStreamHandler(config: Readonly<{
  operatorToken: string | undefined;
  loadRunner(): Promise<StreamRunner>;
}>) {
  return async (request: Request): Promise<Response> => {
    const requestId = createRequestId();
    if (!authenticateOperator(request.headers.get("authorization"), config.operatorToken)) {
      return apiErrorResponse(null, unauthorized(requestId));
    }
    try {
      const input = await parseRunnerInput(request);
      if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const runner = await config.loadRunner();
      return streamRun(runner, input, request, requestId);
    } catch (error) {
      return mapApiError(error, "VALIDATING_IDENTITY", requestId);
    }
  };
}

export function createDriftHandler(config: Readonly<{
  operatorToken: string | undefined;
  loadDrift(): Promise<DriftRunner>;
}>) {
  return async (key: string, request: Request): Promise<Response> => {
    const requestId = createRequestId();
    if (!authenticateOperator(request.headers.get("authorization"), config.operatorToken)) {
      return apiErrorResponse(null, unauthorized(requestId));
    }
    try {
      const identityKey = bytes32(key);
      const body = await parseSmallObject(request);
      if (body.mark !== undefined && typeof body.mark !== "boolean") invalid();
      const operator = await config.loadDrift();
      const result = await operator.run(identityKey, body.mark === true);
      return json({ identityKey, result }, 200, "no-store");
    } catch (error) { return mapApiError(error, "READING_PROOF", requestId); }
  };
}

export function goneResponse(stage: ApiStage = "AUTHENTICATING"): Response {
  return apiErrorResponse(null, {
    code: "GONE", message: "This legacy mutation endpoint is disabled",
    stage, retryable: false, status: 410,
  });
}

export function methodNotAllowedResponse(stage: ApiStage): Response {
  return apiErrorResponse(null, {
    code: "METHOD_NOT_ALLOWED", message: "HTTP method is not allowed for this endpoint",
    stage, retryable: false, status: 405,
  });
}

async function resolveIdentity(request: Request, deps: ProofLockReadDependencies): Promise<Response> {
  const requestId = createRequestId();
  try {
    const agentId = new URL(request.url).searchParams.get("agentId") ?? "";
    if (!DECIMAL.test(agentId) || BigInt(agentId) >= 1n << 256n) invalid();
    const identity = await deps.resolveIdentity(agentId, deadline(request.signal));
    return json({ identity }, 200, PUBLIC_CACHE);
  } catch (error) { return mapApiError(error, "RESOLVING_IDENTITY", requestId); }
}

async function readProofLock(key: string, request: Request, deps: ProofLockReadDependencies): Promise<Response> {
  const requestId = createRequestId();
  try {
    const identityKey = bytes32(key);
    const proofLock = await deps.readProofLock(identityKey, deadline(request.signal));
    assertRecord(identityKey, proofLock);
    return json({ identityKey, proofLock }, 200, PUBLIC_CACHE);
  } catch (error) { return mapApiError(error, "READING_PROOF", requestId); }
}

async function verifyProof(proof: string, request: Request, deps: ProofLockReadDependencies): Promise<Response> {
  const requestId = createRequestId();
  try {
    const proofId = bytes32(proof);
    const identityKey = bytes32(new URL(request.url).searchParams.get("identityKey") ?? "");
    const signal = deadline(request.signal);
    const record = await deps.readProofLock(identityKey, signal);
    assertRecord(identityKey, record);
    const expected = deps.computeProofId(requiredRegistry(deps), record).toLowerCase();
    if (expected !== proofId) notFound();
    const storage = await deps.verifyStoredEvidence(record, signal);
    return json({ proofId, identityKey, proofLock: record, storage }, 200, PUBLIC_CACHE);
  } catch (error) { return mapApiError(error, "VERIFYING_PROOF", requestId); }
}

function streamRun(runner: StreamRunner, input: RunnerInput, request: Request, requestId: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${safeJson(value)}\n\n`));
      try {
        const result = await runner.run(input, (stage) => {
          if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
          send({ type: "stage", stage, requestId });
        }, request.signal);
        if (!request.signal.aborted) send({ type: "complete", result, requestId });
      } catch (error) {
        if (!request.signal.aborted) send({ type: "error", ...runnerErrorBody(error, requestId) });
      } finally { try { controller.close(); } catch { /* Client disconnected. */ } }
    },
  });
  return new Response(stream, { headers: {
    "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store",
    connection: "keep-alive", "x-content-type-options": "nosniff",
  } });
}

async function parseRunnerInput(request: Request): Promise<RunnerInput> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length < 0 || length > MAX_BODY_BYTES) invalid();
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) invalid();
  let value: unknown;
  try { value = JSON.parse(text); } catch { invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const input = { ...(value as Record<string, unknown>) };
  if (input.expectedPriorVersion !== undefined) {
    if (typeof input.expectedPriorVersion !== "string" || !/^[1-9]\d*$/.test(input.expectedPriorVersion)) invalid();
    input.expectedPriorVersion = BigInt(input.expectedPriorVersion);
  }
  return input as RunnerInput;
}

async function parseSmallObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) invalid();
  if (!text.trim()) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function mapApiError(error: unknown, stage: ApiStage, requestId: string): Response {
  if (error instanceof ApiInputError) return apiErrorResponse(error, { code: error.code, message: error.message, stage, retryable: false, status: error.status, requestId });
  if (error instanceof IdentityError) return identityErrorResponse(error, stage, requestId);
  if (isAbort(error)) return apiErrorResponse(error, { code: "REQUEST_ABORTED", message: "Request was aborted", stage, retryable: true, status: 499, requestId });
  return apiErrorResponse(error, { code: "DEPENDENCY_UNAVAILABLE", message: "Required dependency is unavailable", stage, retryable: true, status: 503, requestId });
}

function identityErrorResponse(error: IdentityError, stage: ApiStage, requestId: string): Response {
  if (error.code === "AGENT_NOT_FOUND") return apiErrorResponse(error, { code: "AGENT_NOT_FOUND", message: "ERC-8004 agent was not found", stage, retryable: false, status: 404, requestId });
  if (error.code === "AGENT_WALLET_UNSET") return apiErrorResponse(error, { code: "AGENT_WALLET_UNSET", message: "ERC-8004 agent wallet is not set", stage, retryable: false, status: 422, requestId });
  if (error.code === "INVALID_IDENTITY") return apiErrorResponse(error, { code: "INVALID_INPUT", message: "ERC-8004 identity is invalid", stage, retryable: false, status: 400, requestId });
  return apiErrorResponse(error, { code: "IDENTITY_UNAVAILABLE", message: "ERC-8004 identity could not be verified", stage, retryable: error.retryable, status: 503, requestId });
}

class ApiInputError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "NOT_FOUND", message: string, readonly status: number) { super(message); }
}

function invalid(): never { throw new ApiInputError("INVALID_INPUT", "Request input is invalid", 400); }
function notFound(): never { throw new ApiInputError("NOT_FOUND", "Proof was not found", 404); }
function assertRecord(identityKey: string, record: RegistryProofLockRecord): void {
  if (!record || record.identityKey.toLowerCase() !== identityKey || record.version < 1n) notFound();
}
function bytes32(value: string): string { if (!BYTES32.test(value) || /^0x0{64}$/i.test(value)) invalid(); return value.toLowerCase(); }
function requiredRegistry(deps: ProofLockReadDependencies): string { if (!deps.registryAddress) throw new Error("Registry is unavailable"); return deps.registryAddress; }
function unauthorized(requestId: string): ApiErrorOptions { return { code: "UNAUTHORIZED", message: "Operator authorization required", stage: "AUTHENTICATING", retryable: false, status: 401, requestId }; }
function createRequestId(): string { return `req_${randomUUID()}`; }
function isAbort(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }
function json(value: unknown, status: number, cache: string): Response { return new Response(safeJson(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache, "x-content-type-options": "nosniff" } }); }
function safeJson(value: unknown): string { return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item); }
function errorBody(_error: unknown, code: ApiErrorCode, message: string, stage: ApiStage, retryable: boolean, requestId: string) { return { error: { code, message, stage, retryable, requestId } }; }
function deadline(signal: AbortSignal): AbortSignal { return AbortSignal.any([signal, AbortSignal.timeout(10_000)]); }
function runnerErrorBody(error: unknown, requestId: string) {
  if (error instanceof ProofLockStageError) {
    const compute = error.stage === "RUNNING_COMPUTE";
    return errorBody(error, compute ? "COMPUTE_UNVERIFIED" : "DEPENDENCY_UNAVAILABLE",
      compute ? "0G Compute response verification failed" : "ProofLock run stopped safely",
      error.stage, true, requestId);
  }
  return errorBody(error, "INTERNAL_ERROR", "ProofLock run failed", "VALIDATING_IDENTITY", true, requestId);
}
