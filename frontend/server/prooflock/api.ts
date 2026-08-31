import { randomUUID } from "node:crypto";
import { z } from "zod";

import { isCanonicalAgentId, parseNonZeroBytes32 } from "@/lib/prooflock-validation";
import { computeIdentityKey, type RegistryProofLockRecord } from "./chain";
import { IdentityError, ProofLocatorHintRequiredError, ProofMismatchError } from "./errors";
import type { AgentIdentity, Bytes32, HexAddress, ResolvedAgentIdentity } from "./types";
import { ProofLockStageError, type RunnerStage, type RunnerTerminalResult } from "./runner";
import type { RunnerProgress } from "./runner";
import type { PublicWriteOutcome } from "./operation-journal";
import { WriteRecoveryError } from "./recovery";
import { authenticateOperator } from "./auth";
import type { CurrentAccessV1 } from "@/lib/prooflock-types";

const MAX_BODY_BYTES = 16_384;
const READ_CACHE = "no-store";
const DETAIL_ENRICHMENT_TIMEOUT_MS = 2_000;

export type ApiStage = RunnerStage | "AUTHENTICATING" | "RESOLVING_IDENTITY" | "READING_PROOF" | "VERIFYING_PROOF" | "HEALTH_CHECK" | "RECOVERING_WRITE";
export type ApiErrorCode =
  | "INVALID_INPUT" | "UNAUTHORIZED" | "NOT_FOUND" | "GONE" | "METHOD_NOT_ALLOWED"
  | "AGENT_NOT_FOUND" | "AGENT_WALLET_UNSET" | "IDENTITY_UNAVAILABLE"
  | "DEPENDENCY_UNAVAILABLE" | "COMPUTE_UNVERIFIED" | "MISMATCH" | "HINT_REQUIRED"
  | "REQUEST_ABORTED" | "INTERNAL_ERROR" | "SUBMISSION_OUTCOME_UNKNOWN"
  | "FINALIZED_READBACK_UNAVAILABLE" | "NOT_BROADCAST" | "SEALED" | "REVERTED" | "RECOVERY_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT" | "IDENTITY_ACTIVE" | "CONCURRENCY_LIMIT" | "RATE_LIMIT"
  | "OPERATOR_CONCURRENCY_LIMIT" | "GLOBAL_CONCURRENCY_LIMIT" | "DAILY_CEREMONY_LIMIT" | "DAILY_COST_LIMIT";

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
  readCurrentAccess(agentId: string, identityKey: string, signal: AbortSignal): Promise<CurrentAccessV1>;
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
    signal?: AbortSignal, reportProgress?: (progress: RunnerProgress) => void): Promise<RunnerTerminalResult | unknown>;
}>;
export type OperatorRequestInput = Readonly<{ identity: AgentIdentity; mode: "SEAL" | "RESEAL";
  expectedPriorVersion?: bigint; previousProofId?: Bytes32; idempotencyKey?: string }>;
export type DriftRunner = Readonly<{ run(identityKey: string, mark: boolean): Promise<unknown> }>;
export type RecoveryRunner = Readonly<{ recover(recoveryId: string, transactionHash?: string, signal?: AbortSignal): Promise<PublicWriteOutcome> }>;
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

export function createLazyProofLockReadHandlers(loadDependencies: () => ProofLockReadDependencies) {
  return Object.freeze({
    resolve: async (request: Request) => {
      const agentId = new URL(request.url).searchParams.get("agentId") ?? "";
      if (!isCanonicalAgentId(agentId)) return invalidReadInput("RESOLVING_IDENTITY");
      return createProofLockReadHandlers(loadDependencies()).resolve(request);
    },
    proofLock: async (identityKey: string, request: Request) => {
      const agentId = new URL(request.url).searchParams.get("agentId");
      if (!parseNonZeroBytes32(identityKey)
        || (agentId !== null && !isCanonicalAgentId(agentId))) return invalidReadInput("READING_PROOF");
      return createProofLockReadHandlers(loadDependencies()).proofLock(identityKey, request);
    },
    verifyProof: async (proofId: string, request: Request) => {
      const url = new URL(request.url);
      const identityKey = url.searchParams.get("identityKey") ?? "";
      const sourceTxHash = url.searchParams.get("sourceTxHash");
      if (!parseNonZeroBytes32(proofId) || !parseNonZeroBytes32(identityKey)
        || (sourceTxHash !== null && !parseNonZeroBytes32(sourceTxHash))) {
        return invalidReadInput("VERIFYING_PROOF");
      }
      return createProofLockReadHandlers(loadDependencies()).verifyProof(proofId, request);
    },
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

// Public "scan any agent" front door. It runs the SAME audited seal ceremony as the operator
// stream, but requires NO client token: the server injects the operator token, so anyone can trigger
// a real, on-chain scan+seal. The HARD spend ceiling is the pre-funded role-key + compute-ledger
// balance (serverless-safe: when funds run out, the ceremony fails closed). A best-effort in-memory
// rate limit throttles bursts per instance. It never returns or accepts a secret.
export function createPublicScanStreamHandler(config: Readonly<{
  operatorToken: string | undefined;
  loadRunner(): Promise<StreamRunner>;
  loadReads(): ProofLockReadDependencies;
  registryAddress: string;
  rate?: Readonly<{ max: number; windowMs: number }>;
}>) {
  const inner = createProofLockStreamHandler({ operatorToken: config.operatorToken, loadRunner: config.loadRunner });
  const hits: number[] = [];
  const max = config.rate?.max ?? 6;
  const windowMs = config.rate?.windowMs ?? 60_000;
  return async (request: Request): Promise<Response> => {
    const requestId = createRequestId();
    const now = Date.now();
    while (hits.length > 0 && hits[0] < now - windowMs) hits.shift();
    if (hits.length >= max) {
      return apiErrorResponse(null, { code: "RATE_LIMIT", message: "Public scan is busy; try again shortly",
        stage: "AUTHENTICATING", retryable: true, status: 429, requestId });
    }
    let agentId: string;
    try {
      const body = await parseSmallObject(request, deadline(request.signal));
      if (Object.keys(body).some((key) => key !== "agentId") || typeof body.agentId !== "string"
        || !isCanonicalAgentId(body.agentId)) {
        return apiErrorResponse(null, { code: "INVALID_INPUT", message: "A canonical ERC-8004 agentId is required",
          stage: "VALIDATING_IDENTITY", retryable: false, status: 400, requestId });
      }
      agentId = body.agentId;
    } catch (error) { return mapApiError(error, "VALIDATING_IDENTITY", requestId); }

    const identity: AgentIdentity = { namespace: "eip155", chainId: 16661,
      registryAddress: config.registryAddress as HexAddress, agentId };
    const identityKey = computeIdentityKey(identity);
    // Auto-detect: RESEAL an agent that already has a sealed proof, otherwise SEAL a fresh one.
    let opInput: Record<string, unknown> = { identity, mode: "SEAL" };
    try {
      const reads = config.loadReads();
      const record = await reads.readProofLock(identityKey, deadline(request.signal));
      const previousProofId = reads.computeProofId(config.registryAddress, record);
      opInput = { identity, mode: "RESEAL", expectedPriorVersion: record.version.toString(), previousProofId };
    } catch { /* no current lease: fall through to SEAL */ }

    hits.push(now);
    const proxied = new Request(request.url, { method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.operatorToken ?? ""}` },
      body: JSON.stringify(opInput) });
    return inner(proxied);
  };
}

export function createRecoveryHandler(config: Readonly<{
  operatorToken: string | undefined; loadRecovery(signal?: AbortSignal): Promise<RecoveryRunner>;
}>) {
  return async (request: Request): Promise<Response> => {
    const requestId = createRequestId();
    if (!authenticateOperator(request.headers.get("authorization"), config.operatorToken)) {
      return apiErrorResponse(null, unauthorized(requestId));
    }
    try {
      const signal = deadline(request.signal);
      const body = await parseSmallObject(request, signal);
      if (Object.keys(body).some((key) => !["recoveryId", "transactionHash"].includes(key))
        || typeof body.recoveryId !== "string" || !/^rec_[0-9a-f]{16,64}$/i.test(body.recoveryId)
        || (body.transactionHash !== undefined && (typeof body.transactionHash !== "string"
          || !parseNonZeroBytes32(body.transactionHash)))) invalid();
      const recovery = await config.loadRecovery(signal);
      const result = writeOutcomeDto(await recovery.recover(body.recoveryId, body.transactionHash as string | undefined, signal));
      return json({ result }, 200, "no-store");
    } catch (error) {
      if (error instanceof WriteRecoveryError) return apiErrorResponse(error, { code: error.code === "RECOVERY_NOT_FOUND"
        ? "RECOVERY_NOT_FOUND" : "INVALID_INPUT", message: error.code === "RECOVERY_NOT_FOUND"
          ? "Recovery operation was not found" : "Recovery input is invalid", stage: "RECOVERING_WRITE",
        retryable: false, status: error.code === "RECOVERY_NOT_FOUND" ? 404 : 400, requestId });
      return mapApiError(error, "RECOVERING_WRITE", requestId);
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
    const params = new URL(request.url).searchParams;
    const agentId = params.get("agentId") ?? "";
    const locatorVersion = params.get("locator");
    if (!isCanonicalAgentId(agentId)) invalid();
    if (locatorVersion !== null && locatorVersion !== "identity-v1") invalid();
    const identity = await deps.resolveIdentity(agentId, deadline(request.signal));
    const body = locatorVersion === "identity-v1"
      ? { identity, identityKey: computeIdentityKey(identity.identity) } : { identity };
    return json(body, 200, READ_CACHE);
  } catch (error) { return mapApiError(error, "RESOLVING_IDENTITY", requestId); }
}

async function readProofLock(key: string, request: Request, deps: ProofLockReadDependencies): Promise<Response> {
  const requestId = createRequestId();
  try {
    const identityKey = bytes32(key);
    const params = new URL(request.url).searchParams;
    const agentId = params.get("agentId");
    const locatorVersion = params.get("locator");
    if (agentId !== null && !isCanonicalAgentId(agentId)) invalid();
    if (locatorVersion !== null && locatorVersion !== "registry-v1") invalid();
    const signal = deadline(request.signal);
    const proofLock = await deps.readProofLock(identityKey, signal);
    assertRecord(identityKey, proofLock);
    if (agentId !== null) return await currentDetailResponse(agentId, identityKey, proofLock,
      deps, signal, locatorVersion === "registry-v1");
    const detail = await deps.readProofLockDetail(proofLock, signal);
    return json({ identityKey, proofLock, detail }, 200, READ_CACHE);
  } catch (error) { return mapApiError(error, "READING_PROOF", requestId); }
}

async function currentDetailResponse(agentId: string, identityKey: Bytes32,
  proofLock: RegistryProofLockRecord, deps: ProofLockReadDependencies, signal: AbortSignal,
  includeLocator: boolean) {
  const sibling = new AbortController();
  const detail = boundedLegacyDetail(proofLock, deps,
    AbortSignal.any([signal, sibling.signal]));
  let result: readonly [ProofLockDetail, CurrentAccessV1];
  try {
    result = await Promise.all([detail, deps.readCurrentAccess(agentId, identityKey, signal)]);
  } catch (error) {
    sibling.abort(error);
    await detail.catch(() => undefined);
    throw error;
  }
  const [sealedDetail, currentAccess] = result;
  const sealedEvidence = Object.freeze({ schema: "sentinel.prooflock/sealed-evidence-v1" as const,
    version: 1 as const, proofLock, detail: sealedDetail });
  const body = { identityKey, proofLock, detail: sealedDetail, responseVersion: 2,
    sealedEvidence, currentAccess };
  if (!includeLocator) return json(body, 200, READ_CACHE);
  if (!deps.registryAddress) throw new Error("RegistryV2 is not configured");
  const locator = Object.freeze({ identityKey,
    proofId: deps.computeProofId(deps.registryAddress, proofLock),
    registryAddress: deps.registryAddress.toLowerCase() });
  return json({ ...body, proofId: locator.proofId, registryAddress: locator.registryAddress,
    locator }, 200, READ_CACHE);
}

function boundedLegacyDetail(record: RegistryProofLockRecord,
  deps: ProofLockReadDependencies, signal: AbortSignal): Promise<ProofLockDetail> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const controller = new AbortController();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => { controller.abort(signal.reason);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError")); });
    const timer = setTimeout(() => finish(() => {
      controller.abort(new Error("Sealed detail enrichment timed out"));
      resolve(unavailableLegacyDetail(new Error("Sealed detail enrichment timed out"), signal));
    }), DETAIL_ENRICHMENT_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => deps.readProofLockDetail(record, controller.signal)).then(
      (value) => finish(() => resolve(value)),
      (error) => signal.aborted ? abort() : finish(() => resolve(unavailableLegacyDetail(error, signal))),
    );
  });
}

function unavailableLegacyDetail(error: unknown, signal: AbortSignal): ProofLockDetail {
  if (signal.aborted) throw signal.reason ?? error;
  return Object.freeze({ status: "UNAVAILABLE", code: "EVIDENCE_UNAVAILABLE",
    identity: null, resolution: null, gate: Object.freeze({ status: "UNKNOWN",
      allowed: false, reason: null }), consumer: Object.freeze({ status: "UNKNOWN", accepted: false }) });
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
        }, linked.controller.signal, (progress) => send({ type: "progress", progress: progressDto(
          progress.type === "chain" ? progress.progress : progress), requestId }));
        if (!linked.controller.signal.aborted) send({ type: "complete", result: terminalDto(result), requestId });
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
  const suppliedKey = request.headers.get("idempotency-key");
  if (suppliedKey !== null && !/^[A-Za-z0-9._:-]{8,128}$/.test(suppliedKey)) invalid();
  const idempotencyKey = suppliedKey ?? `request-${randomUUID()}`;
  return Object.freeze({ identity, mode: raw.mode, idempotencyKey,
    ...(expectedPriorVersion ? { expectedPriorVersion } : {}),
    ...(previousProofId ? { previousProofId: previousProofId as Bytes32 } : {}) });
}

function parseOperatorIdentity(value: unknown): AgentIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !["namespace", "chainId", "registryAddress", "agentId"].includes(key))
    || raw.namespace !== "eip155" || raw.chainId !== 16661 || typeof raw.registryAddress !== "string"
    || !/^0x[0-9a-fA-F]{40}$/.test(raw.registryAddress) || /^0x0{40}$/i.test(raw.registryAddress)
    || typeof raw.agentId !== "string" || !isCanonicalAgentId(raw.agentId)) invalid();
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
function bytes32(value: string): Bytes32 { const parsed = parseNonZeroBytes32(value); if (!parsed) invalid(); return parsed; }
function optionalBytes32(value: string | null): string | undefined { return value === null ? undefined : bytes32(value); }
function invalidReadInput(stage: ApiStage): Response { return apiErrorResponse(null, { code: "INVALID_INPUT", message: "Request input is invalid", stage, retryable: false, status: 400 }); }
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
    if (error.outcome) {
      const code = error.outcome.status;
      const message = code === "SUBMISSION_OUTCOME_UNKNOWN"
        ? "Submission attempted; broadcast not yet proven"
        : code === "FINALIZED_READBACK_UNAVAILABLE"
          ? "Registry write finalized; exact readback is temporarily unavailable"
          : code === "REVERTED" ? "Registry transaction finalized and reverted"
            : "Registry submission was not attempted";
      return { ...errorBody(error, code, message, error.stage, code === "NOT_BROADCAST", requestId),
        writeOutcome: writeOutcomeDto(error.outcome) };
    }
    const admissionCodes = new Set<ApiErrorCode>(["IDEMPOTENCY_CONFLICT", "IDENTITY_ACTIVE", "CONCURRENCY_LIMIT",
      "OPERATOR_CONCURRENCY_LIMIT", "GLOBAL_CONCURRENCY_LIMIT",
      "RATE_LIMIT", "DAILY_CEREMONY_LIMIT", "DAILY_COST_LIMIT"]);
    if (error.code && admissionCodes.has(error.code as ApiErrorCode)) return errorBody(error,
      error.code as ApiErrorCode, "Operation admission was rejected", error.stage, false, requestId);
    const compute = error.stage === "RUNNING_COMPUTE";
    return errorBody(error, compute ? "COMPUTE_UNVERIFIED" : "DEPENDENCY_UNAVAILABLE",
      compute ? "0G Compute response verification failed" : "ProofLock run stopped safely",
      error.stage, true, requestId);
  }
  return errorBody(error, "INTERNAL_ERROR", "ProofLock run failed", "VALIDATING_IDENTITY", true, requestId);
}

const recoveryIdSchema = z.string().regex(/^rec_[0-9a-f]{16,64}$/i);
const hashSchema = z.string().regex(/^0x[0-9a-f]{64}$/i);
const decimalSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const writeOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_BROADCAST"), recoveryId: recoveryIdSchema }),
  z.object({ status: z.literal("SUBMISSION_OUTCOME_UNKNOWN"), recoveryId: recoveryIdSchema, transactionHash: hashSchema.optional() }),
  z.object({ status: z.literal("FINALIZED_READBACK_UNAVAILABLE"), recoveryId: recoveryIdSchema, transactionHash: hashSchema,
    identityKey: hashSchema, version: decimalSchema }),
  z.object({ status: z.literal("SEALED"), recoveryId: recoveryIdSchema, transactionHash: hashSchema,
    identityKey: hashSchema, version: decimalSchema }),
  z.object({ status: z.literal("REVERTED"), recoveryId: recoveryIdSchema, transactionHash: hashSchema }),
]);
const terminalSchema = z.union([
  z.object({ kind: z.literal("SEALED"), stage: z.literal("SEALED"),
    identity: z.record(z.string(), z.unknown()).optional(), subject: z.record(z.string(), z.unknown()).optional(),
    envelope: z.record(z.string(), z.unknown()).optional(), storage: z.object({ envelopeDigest: hashSchema,
      storageRoot: hashSchema, uploadTxHash: hashSchema, retrievedDigest: hashSchema, finalizedAtBlock: decimalSchema,
      retrievalVerified: z.literal(true), networkProofVerified: z.literal(false) }).optional(),
    chain: z.object({ transactionHash: hashSchema, expectedVersion: z.bigint(), signer: z.string().regex(/^0x[0-9a-f]{40}$/i) }).optional(),
    proofLock: z.record(z.string(), z.unknown()).optional(),
    writeOutcome: writeOutcomeSchema.refine((value) => value.status === "SEALED") }),
  z.object({ kind: z.literal("EXISTING_OPERATION"), operation: z.object({ recoveryId: recoveryIdSchema,
    phase: z.enum(["REQUESTED", "COMPUTE_VERIFIED", "STORAGE_VERIFIED", "CHAIN_INPUT_COMMITTED", "SUBMISSION_ATTEMPTED",
      "HASH_KNOWN", "FINALIZED", "RECOVERY_REQUIRED", "TERMINAL"]), writeOutcome: writeOutcomeSchema.optional() }) }),
]);
const progressSchema = z.union([
  z.object({ type: z.literal("admission"), state: z.enum(["ACCEPTED", "DEDUPLICATED"]), recoveryId: recoveryIdSchema,
    idempotencyKey: z.string().min(8).max(128) }),
  z.object({ phase: z.literal("PRE_SEND") }), z.object({ phase: z.literal("SUBMISSION_ATTEMPTED") }),
  z.object({ phase: z.enum(["HASH_KNOWN", "REVERTED"]), transactionHash: hashSchema }),
  z.object({ phase: z.literal("FINALIZED"), transactionHash: hashSchema, blockHash: hashSchema,
    blockNumber: decimalSchema, confirmations: z.number().int().positive() }),
]);
function writeOutcomeDto(value: unknown): PublicWriteOutcome { return writeOutcomeSchema.parse(value) as PublicWriteOutcome; }
function terminalDto(value: unknown): unknown { return terminalSchema.parse(value); }
function progressDto(value: unknown): unknown { return progressSchema.parse(value); }

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
