import { randomUUID } from "node:crypto";

import type { RegistryProofLockRecord } from "./chain";
import { IdentityError, ProofLocatorHintRequiredError, ProofMismatchError } from "./errors";
import type { AgentIdentity, Bytes32, HexAddress, ResolvedAgentIdentity } from "./types";
import { ProofLockStageError, type RunnerResult, type RunnerStage } from "./runner";
import { authenticateOperator } from "./auth";

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9]\d*)$/;
const MAX_BODY_BYTES = 16_384;
const READ_CACHE = "no-store";

export type ApiStage = RunnerStage | "AUTHENTICATING" | "RESOLVING_IDENTITY" | "READING_PROOF" | "VERIFYING_PROOF" | "HEALTH_CHECK";
export type ApiErrorCode =
  | "INVALID_INPUT" | "UNAUTHORIZED" | "NOT_FOUND" | "GONE" | "METHOD_NOT_ALLOWED"
  | "AGENT_NOT_FOUND" | "AGENT_WALLET_UNSET" | "IDENTITY_UNAVAILABLE"
  | "DEPENDENCY_UNAVAILABLE" | "COMPUTE_UNVERIFIED" | "MISMATCH" | "HINT_REQUIRED"
  | "REQUEST_ABORTED" | "INTERNAL_ERROR";

export type ApiErrorOptions = Readonly<{
  code: ApiErrorCode; message: string; stage: ApiStage; retryable: boolean;
  status: number; requestId?: string;
}>;

export type ProofLockReadDependencies = Readonly<{
  resolveIdentity(agentId: string, signal: AbortSignal): Promise<ResolvedAgentIdentity>;
  readProofLock(identityKey: string, signal: AbortSignal): Promise<RegistryProofLockRecord>;
  readProofById(identityKey: string, proofId: string, sourceTxHash: string | undefined,
    signal: AbortSignal): Promise<HistoricalProofLock | null>;
  readProofLockDetail(record: RegistryProofLockRecord, signal: AbortSignal): Promise<ProofLockDetail>;
  computeProofId(registryAddress: string, record: RegistryProofLockRecord): string;
  verifyStoredEvidence(record: RegistryProofLockRecord, signal: AbortSignal): Promise<Readonly<{
    envelope: unknown; retrievalVerified: true; networkProofVerified: false;
  }>>;
  registryAddress?: string;
}>;

export type HistoricalProofLock = Readonly<{ record: RegistryProofLockRecord;
  source: Readonly<{ kind: "ProofLocked"; registryAddress: HexAddress; transactionHash: Bytes32;
    blockNumber: number; blockHash: Bytes32; logIndex: number }> }>;

export type ProofLockDetail =
  | Readonly<{ status: "VERIFIED"; identity: ProofLockIdentitySummary;
    resolution: ProofLockResolutionSummary; gate: GateDetail; consumer: ConsumerDetail }>
  | Readonly<{ status: "UNAVAILABLE"; code: "EVIDENCE_UNAVAILABLE" | "EVIDENCE_INVALID" | "IDENTITY_UNAVAILABLE" | "IDENTITY_INVALID";
    identity: null; resolution: null; gate: UnknownGateDetail; consumer: UnknownConsumerDetail }>;
export type GateDetail = Readonly<{ status: "VERIFIED"; allowed: boolean; reason: number;
  subject: HexAddress; version: string }> | UnknownGateDetail;
type UnknownGateDetail = Readonly<{ status: "UNKNOWN"; allowed: false; reason: null }>;
export type ConsumerDetail = Readonly<{ status: "VERIFIED"; accepted: boolean; address: HexAddress;
  subject: HexAddress; version: string }> | UnknownConsumerDetail;
type UnknownConsumerDetail = Readonly<{ status: "UNKNOWN"; accepted: false }>;
export type ProofLockIdentitySummary = AgentIdentity & Readonly<{ identityKey: Bytes32; owner: HexAddress;
  agentWallet: HexAddress; registrationUri: string; registrationDigest: Bytes32;
  sourceBlockNumber: string; sourceBlockHash: Bytes32 }>;
export type ProofLockResolutionSummary = Readonly<{ owner: HexAddress; agentWallet: HexAddress;
  agentURI: string; registrationDigest: Bytes32; sourceBlockNumber: string; sourceBlockHash: Bytes32 }>;

export type StreamRunner = Readonly<{
  run(input: OperatorRequestInput, report?: (stage: RunnerStage) => void,
    signal?: AbortSignal): Promise<RunnerResult | unknown>;
}>;
export type OperatorRequestInput = Readonly<{ identity: AgentIdentity; mode: "SEAL" | "RESEAL";
  expectedPriorVersion?: bigint; previousProofId?: Bytes32 }>;
export type DriftRunner = Readonly<{ run(identityKey: string, mark: boolean): Promise<unknown> }>;
type LinkedAbort = Readonly<{ controller: AbortController; cleanup(): void }>;

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
    const linked = linkedAbort(request.signal);
    try {
      const input = await parseRunnerInput(request, linked.controller.signal);
      linked.controller.signal.throwIfAborted();
      const runner = await config.loadRunner();
      return streamRun(runner, input, linked, requestId);
    } catch (error) {
      linked.cleanup();
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
      const body = await parseSmallObject(request, deadline(request.signal));
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
    return json({ identity }, 200, READ_CACHE);
  } catch (error) { return mapApiError(error, "RESOLVING_IDENTITY", requestId); }
}

async function readProofLock(key: string, request: Request, deps: ProofLockReadDependencies): Promise<Response> {
  const requestId = createRequestId();
  try {
    const identityKey = bytes32(key);
    const signal = deadline(request.signal);
    const proofLock = await deps.readProofLock(identityKey, signal);
    assertRecord(identityKey, proofLock);
    const detail = await deps.readProofLockDetail(proofLock, signal);
    return json({ identityKey, proofLock, detail }, 200, READ_CACHE);
  } catch (error) { return mapApiError(error, "READING_PROOF", requestId); }
}

async function verifyProof(proof: string, request: Request, deps: ProofLockReadDependencies): Promise<Response> {
  const requestId = createRequestId();
  try {
    const proofId = bytes32(proof);
    const identityKey = bytes32(new URL(request.url).searchParams.get("identityKey") ?? "");
    const signal = deadline(request.signal);
    const sourceTxHash = optionalBytes32(new URL(request.url).searchParams.get("sourceTxHash"));
    const historical = await deps.readProofById(identityKey, proofId, sourceTxHash, signal);
    if (!historical) notFound();
    const record = historical.record;
    assertRecord(identityKey, record);
    const expected = deps.computeProofId(requiredRegistry(deps), record).toLowerCase();
    if (expected !== proofId) notFound();
    const storage = await deps.verifyStoredEvidence(record, signal);
    return json({ proofId, identityKey, proofLock: record, source: historical.source, storage }, 200, READ_CACHE);
  } catch (error) { return mapApiError(error, "VERIFYING_PROOF", requestId); }
}

function streamRun(runner: StreamRunner, input: OperatorRequestInput, linked: LinkedAbort, requestId: string): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => {
        const queued = safeEnqueue(controller, encoder.encode(`data: ${safeJson(value)}\n\n`), linked.controller.signal);
        if (!queued && !linked.controller.signal.aborted) {
          linked.controller.abort(new DOMException("Response stream closed", "AbortError"));
        }
        linked.controller.signal.throwIfAborted();
      };
      try {
        const result = await runner.run(input, (stage) => {
          linked.controller.signal.throwIfAborted();
          send({ type: "stage", stage, requestId });
        }, linked.controller.signal);
        if (!linked.controller.signal.aborted) send({ type: "complete", result, requestId });
      } catch (error) {
        if (!linked.controller.signal.aborted) send({ type: "error", ...runnerErrorBody(error, requestId) });
      } finally {
        linked.cleanup();
        if (!cancelled) try { controller.close(); } catch { cancelled = true; }
      }
    },
    cancel() {
      cancelled = true;
      linked.controller.abort(new DOMException("Response stream cancelled", "AbortError"));
      linked.cleanup();
    },
  });
  return new Response(stream, { headers: {
    "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store",
    connection: "keep-alive", "x-content-type-options": "nosniff",
  } });
}

async function parseRunnerInput(request: Request, signal: AbortSignal): Promise<OperatorRequestInput> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length < 0 || length > MAX_BODY_BYTES) {
    await request.body?.cancel();
    invalid();
  }
  const text = await readBoundedBody(request, signal);
  let value: unknown;
  try { value = JSON.parse(text); } catch { invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["identity", "mode", "expectedPriorVersion", "previousProofId"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) invalid();
  const identity = parseOperatorIdentity(raw.identity);
  if (raw.mode !== "SEAL" && raw.mode !== "RESEAL") invalid();
  const expectedPriorVersion = parsePriorVersion(raw.expectedPriorVersion);
  const previousProofId = raw.previousProofId === undefined ? undefined : bytes32(String(raw.previousProofId));
  if (raw.mode === "SEAL" && (expectedPriorVersion !== undefined || previousProofId !== undefined)) invalid();
  if (raw.mode === "RESEAL" && (expectedPriorVersion === undefined || previousProofId === undefined)) invalid();
  return Object.freeze({ identity, mode: raw.mode, ...(expectedPriorVersion ? { expectedPriorVersion } : {}),
    ...(previousProofId ? { previousProofId: previousProofId as Bytes32 } : {}) });
}

function parseOperatorIdentity(value: unknown): AgentIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !["namespace", "chainId", "registryAddress", "agentId"].includes(key))
    || raw.namespace !== "eip155" || raw.chainId !== 16661 || typeof raw.registryAddress !== "string"
    || !/^0x[0-9a-fA-F]{40}$/.test(raw.registryAddress) || /^0x0{40}$/i.test(raw.registryAddress)
    || typeof raw.agentId !== "string" || !DECIMAL.test(raw.agentId) || BigInt(raw.agentId) >= 1n << 256n) invalid();
  return Object.freeze({ namespace: "eip155", chainId: 16661,
    registryAddress: raw.registryAddress.toLowerCase() as HexAddress, agentId: raw.agentId });
}

function parsePriorVersion(value: unknown): bigint | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) invalid();
  const version = BigInt(value);
  if (version >= 1n << 64n) invalid();
  return version;
}

async function parseSmallObject(request: Request, signal: AbortSignal): Promise<Record<string, unknown>> {
  const text = await readBoundedBody(request, signal);
  if (!text.trim()) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

async function readBoundedBody(request: Request, signal: AbortSignal): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await raceAbort(reader.read(), signal);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); invalid(); }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function mapApiError(error: unknown, stage: ApiStage, requestId: string): Response {
  if (error instanceof ApiInputError) return apiErrorResponse(error, { code: error.code, message: error.message, stage, retryable: false, status: error.status, requestId });
  if (error instanceof IdentityError) return identityErrorResponse(error, stage, requestId);
  if (error instanceof ProofMismatchError) return apiErrorResponse(error, { code: "MISMATCH",
    message: "Proof evidence does not match its onchain commitments", stage, retryable: false, status: 409, requestId });
  if (error instanceof ProofLocatorHintRequiredError) return apiErrorResponse(error, { code: "HINT_REQUIRED",
    message: "A source transaction hash is required for this historical proof",
    stage, retryable: false, status: 422, requestId });
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
function optionalBytes32(value: string | null): string | undefined { return value === null ? undefined : bytes32(value); }
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

function linkedAbort(parent: AbortSignal): LinkedAbort {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason ?? new DOMException("Request aborted", "AbortError"));
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  return { controller, cleanup: () => parent.removeEventListener("abort", abort) };
}

function safeEnqueue(controller: ReadableStreamDefaultController<Uint8Array>, bytes: Uint8Array, signal: AbortSignal): boolean {
  if (signal.aborted) return false;
  try { controller.enqueue(bytes); return true; }
  catch { return false; }
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
