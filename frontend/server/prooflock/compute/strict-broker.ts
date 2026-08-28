import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { keccak256, toUtf8Bytes } from "ethers";
import { z } from "zod";

import { receiptDigest } from "../canonical";
import type { ComputeProof, HexAddress } from "../types";
import {
  SafeComputeHttpError,
  safeComputeTransport,
  type ComputeHttpRequest,
  type ComputeHttpResponse,
  type ComputeHttpTransport,
} from "./safe-https";
import {
  assertSameServiceSnapshot,
  assertServiceEndpoint,
  resolveExpectedSigner,
  resolveService,
  validateBaseUrl,
  type ServiceDetail,
} from "./service";
import {
  decodeUtf8,
  parseSignature,
  normalizeResponseHeaders,
  responseHeadersSha256,
  verifyContentBinding,
  type ContentBinding,
  type FetchedSignature,
  type SignatureVerifier,
} from "./transcript";

export type { ComputeHttpRequest, ComputeHttpResponse, ComputeHttpTransport };

export { StrictComputeError } from "./strict-error";
export type { StrictComputeErrorCode } from "./strict-error";
import { computeFailure as failure, StrictComputeError } from "./strict-error";
import { SubprocessComputeSdk, type ComputeSdk } from "./process-response";
import {
  FileReceiptClaimStore,
  MIN_COMMITTED_RETENTION_MS,
  type ReceiptClaimMetadata,
  type ReceiptClaimStore,
} from "./receipt-store";
export { FileReceiptClaimStore, MemoryReceiptClaimStore } from "./receipt-store";
export type { ReceiptClaimMetadata, ReceiptClaimStore } from "./receipt-store";
export { SubprocessComputeSdk } from "./process-response";
export type { ComputeSdk, ProcessResponseVerification } from "./process-response";

export type StrictComputeBroker = Readonly<{
  inference: Readonly<{
    getServiceMetadata(
      provider: string,
      model?: string,
    ): Promise<{ endpoint: string; model: string }>;
    getRequestHeaders(provider: string, content?: string): Promise<unknown>;
    processResponse(provider: string, chatId?: string, usage?: string): Promise<boolean | null>;
    listService(
      offset?: number,
      limit?: number,
      includeUnacknowledged?: boolean,
    ): Promise<readonly unknown[]>;
  }>;
}>;

export type StrictComputeInput = Readonly<{
  chainId: 16661;
  purpose: "behavioral-risk" | "contract-risk";
  provider: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  spendAuthorized: true;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>;

export type StrictComputeResult = Readonly<{
  content: string;
  proof: ComputeProof;
  receiptSource: "ZG-Res-Key" | "body-id-fallback";
  rawResponseHeaders: readonly (readonly [string, string])[];
  routerVerification: Readonly<{ reportedTeeVerified: boolean | null }>;
  billingMetadata: unknown | null;
  contentBinding: Readonly<{
    expectedSigner: HexAddress;
    signedText: string;
    requestSha256: `0x${string}`;
    responseSha256: `0x${string}`;
    signature: string;
    signedTextSha256: `0x${string}`;
    signatureVerified: true;
  }>;
}>;

export type StrictComputeDependencies = Readonly<{
  sdk: ComputeSdk;
  receiptStore: ReceiptClaimStore;
  transport?: ComputeHttpTransport;
  signatureVerifier?: SignatureVerifier;
}>;

export type ProductionStrictComputeOptions = Readonly<{
  privateKey: string;
  rpcUrl: string;
  stateDirectory: string;
  transport?: ComputeHttpTransport;
  signatureVerifier?: StrictComputeDependencies["signatureVerifier"];
}>;

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const nonempty = (maximum: number) => z.string().trim().min(1).max(maximum);
const tokenCount = z.number().int().nonnegative().safe();
const inputSchema = z
  .object({
    chainId: z.literal(16661),
    purpose: z.enum(["behavioral-risk", "contract-risk"]),
    provider: z
      .string()
      .regex(addressPattern)
      .refine((value) => !/^0x0{40}$/i.test(value)),
    model: nonempty(256),
    systemPrompt: nonempty(32_768),
    userMessage: nonempty(262_144),
    spendAuthorized: z.literal(true),
    timeoutMs: z.number().int().min(1).max(120_000).default(90_000),
    maxResponseBytes: z.number().int().min(256).max(1_048_576).default(131_072),
  })
  .strict();
const traceSchema = z
  .object({
    provider: z.string().regex(addressPattern).optional(),
    tee_verified: z.boolean().optional(),
    billing: z.unknown().optional(),
  })
  .passthrough();
const usageSchema = z
  .object({
    prompt_tokens: tokenCount,
    completion_tokens: tokenCount,
    total_tokens: tokenCount,
  })
  .passthrough()
  .superRefine((usage, context) => {
    if (usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens) {
      context.addIssue({
        code: "custom",
        message: "usage total does not match components",
      });
    }
  });
const responseSchema = z
  .object({
    id: nonempty(512).optional(),
    model: nonempty(256),
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: nonempty(65_536) }).passthrough(),
          })
          .passthrough(),
      )
      .min(1)
      .max(16),
    usage: usageSchema,
    x_0g_trace: traceSchema.optional(),
  })
  .passthrough();
export async function createStrictComputeBroker(
  signer: Parameters<typeof createZGComputeNetworkBroker>[0],
): Promise<StrictComputeBroker> {
  return await createZGComputeNetworkBroker(signer);
}

export function createProductionStrictComputeDependencies(
  options: ProductionStrictComputeOptions,
): StrictComputeDependencies {
  return {
    sdk: new SubprocessComputeSdk({ privateKey: options.privateKey, rpcUrl: options.rpcUrl }),
    receiptStore: new FileReceiptClaimStore({
      stateDirectory: options.stateDirectory,
    }),
    transport: options.transport ?? safeComputeTransport,
    signatureVerifier: options.signatureVerifier,
  };
}

export async function runStrictCompute(
  rawInput: StrictComputeInput,
  dependencies: StrictComputeDependencies,
): Promise<StrictComputeResult> {
  const input = parseInput(rawInput);
  if (!dependencies.receiptStore) {
    throw failure("COMPUTE_REPLAY_STORE_REQUIRED", "an atomic receipt claim store is required");
  }
  const controller = new AbortController();
  const deadline = createDeadline(input.timeoutMs, controller);
  try {
    return await execute(input, dependencies, controller.signal);
  } catch (error) {
    if (deadline.expired()) throw failure("COMPUTE_TIMEOUT", "0G Compute deadline exceeded", error);
    if (error instanceof StrictComputeError) throw error;
    if (error instanceof SafeComputeHttpError) throw mapSafeTransportError(error);
    throw failure("COMPUTE_BROKER_ERROR", "0G Compute request failed", error);
  } finally {
    deadline.clear();
    controller.abort();
  }
}

type ParsedInput = z.infer<typeof inputSchema>;

async function execute(
  input: ParsedInput,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal,
): Promise<StrictComputeResult> {
  const metadata = parseMetadata(
    await nonCancelableStage(
      dependencies.sdk.getServiceMetadata(input.provider, input.model, signal),
      signal,
    ),
    input.model,
  );
  const service = await resolveService(dependencies.sdk, input.provider, input.model, signal);
  assertServiceEndpoint(metadata.endpoint, service.url);
  const expectedSigner = resolveExpectedSigner(service);
  const requestBytes = buildRequestBytes(input);
  const signedHeaders = await nonCancelableStage(
    dependencies.sdk.getRequestHeaders(input.provider, input.userMessage, signal),
    signal,
  );
  const response = await requestInference(
    metadata.endpoint,
    requestBytes,
    signedHeaders,
    input,
    dependencies,
    signal,
  );
  return verifyAndAccept(
    input,
    requestBytes,
    response,
    service,
    expectedSigner,
    dependencies,
    signal,
  );
}

function parseInput(input: StrictComputeInput): ParsedInput {
  if ((input as { spendAuthorized?: unknown }).spendAuthorized !== true) {
    throw failure(
      "COMPUTE_SPEND_NOT_AUTHORIZED",
      "0G Compute voucher spend was not explicitly authorized",
    );
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw failure("COMPUTE_INPUT_INVALID", parsed.error.message);
  return { ...parsed.data, provider: parsed.data.provider.toLowerCase() };
}

function parseMetadata(value: { endpoint: string; model: string }, expectedModel: string) {
  const parsed = z
    .object({ endpoint: z.string().url(), model: nonempty(256) })
    .strict()
    .safeParse(value);
  if (!parsed.success) metadataFailure();
  validateBaseUrl(parsed.data.endpoint);
  if (parsed.data.model !== expectedModel) modelFailure("metadata");
  return parsed.data;
}

function buildRequestBytes(input: ParsedInput): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userMessage },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1_024,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    }),
  );
}

async function requestInference(
  endpoint: string,
  body: Uint8Array,
  signedHeaders: unknown,
  input: ParsedInput,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal,
) {
  const url = `${endpoint.replace(/\/$/, "")}/chat/completions`;
  const response = await stage(
    (dependencies.transport ?? safeComputeTransport).request({
      url,
      method: "POST",
      headers: parseRequestHeaders(signedHeaders),
      body,
      signal,
      maxResponseBytes: input.maxResponseBytes,
      allowRedirects: false,
    }),
    signal,
  );
  if (response.status < 200 || response.status >= 300) httpFailure(response.status);
  return response;
}

async function verifyAndAccept(
  input: ParsedInput,
  requestBytes: Uint8Array,
  rawResponse: ComputeHttpResponse,
  service: ServiceDetail,
  expectedSigner: HexAddress,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal,
): Promise<StrictComputeResult> {
  const response = parseResponse(rawResponse.body);
  if (response.model !== input.model) modelFailure("response");
  assertReturnedProvider(input.provider, response.x_0g_trace?.provider, rawResponse.headers);
  const receipt = selectReceipt(rawResponse.headers, response.id);
  const signature = await fetchSignature(input, service.url, receipt.chatId, dependencies, signal);
  const binding = verifyContentBinding(
    signature.parsed,
    expectedSigner,
    requestBytes,
    rawResponse.body,
    dependencies.signatureVerifier,
  );
  const key = receiptClaimKey(input, receipt.chatId);
  return withReceiptClaim(
    key,
    input,
    requestBytes,
    response,
    receipt,
    rawResponse,
    binding,
    signature,
    service,
    dependencies,
    signal,
  );
}

async function fetchSignature(
  input: ParsedInput,
  serviceUrl: string,
  chatId: string,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal,
): Promise<FetchedSignature> {
  const base = validateBaseUrl(serviceUrl).href.replace(/\/$/, "");
  const url = `${base}/v1/proxy/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(
    input.model,
  )}`;
  const raw = await stage(
    (dependencies.transport ?? safeComputeTransport).request({
      url,
      method: "GET",
      headers: { accept: "application/json" },
      signal,
      maxResponseBytes: 16_384,
      allowRedirects: false,
    }),
    signal,
  );
  if (raw.status < 200 || raw.status >= 300) httpFailure(raw.status);
  return { parsed: parseSignature(raw.body), rawBody: raw.body, url };
}

async function withReceiptClaim(
  key: string,
  input: ParsedInput,
  requestBytes: Uint8Array,
  response: ResponseBody,
  receipt: Receipt,
  rawResponse: ComputeHttpResponse,
  binding: ContentBinding,
  signature: FetchedSignature,
  service: ServiceDetail,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal,
): Promise<StrictComputeResult> {
  const metadata: ReceiptClaimMetadata = {
    model: input.model,
    requestSha256: binding.requestSha256,
    responseSha256: binding.responseSha256,
  };
  const token = await nonCancelableStage(
    dependencies.receiptStore.claim(key, Object.freeze(metadata), 120_000),
    signal,
  );
  if (!token) throw failure("COMPUTE_RECEIPT_REPLAY", "0G Compute receipt was already processed");
  let releasePromise: Promise<void> | undefined;
  const release = () => (releasePromise ??= boundedRelease(dependencies.receiptStore, key, token));
  const onAbort = () => void release();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await nonCancelableStage(
      dependencies.receiptStore.renew(key, token, 120_000),
      signal,
    );
    await requireSdkVerification(
      dependencies.sdk,
      input.provider,
      receipt.chatId,
      response.usage,
      signature,
      signal,
    );
    const confirmedService = await resolveService(
      dependencies.sdk,
      input.provider,
      input.model,
      signal,
    );
    assertSameServiceSnapshot(service, confirmedService);
    signal.throwIfAborted();
    await nonCancelableStage(
      dependencies.receiptStore.commit(key, token, MIN_COMMITTED_RETENTION_MS),
      signal,
    );
    return buildResult(input, requestBytes, response, receipt, rawResponse, binding, service);
  } catch (error) {
    await release();
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function boundedRelease(store: ReceiptClaimStore, key: string, token: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 1_000);
  });
  try {
    await Promise.race([store.release(key, token), bound]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function requireSdkVerification(
  sdk: ComputeSdk,
  provider: string,
  chatId: string,
  usage: ResponseBody["usage"],
  signature: FetchedSignature,
  signal: AbortSignal,
): Promise<void> {
  // The disposable SDK worker is terminated before an abort settles in this process.
  let result: boolean | null;
  try {
    result = await nonCancelableStage(
      sdk.processResponse({
        provider,
        chatId,
        usage: JSON.stringify(usage),
        signatureUrl: signature.url,
        signatureBody: signature.rawBody,
      }, signal),
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw failure("COMPUTE_VERIFICATION_ERROR", "0G Compute SDK verification threw", error);
  }
  if (result !== true) verificationFailure();
}

type ResponseBody = z.infer<typeof responseSchema>;

function parseResponse(bytes: Uint8Array): ResponseBody {
  try {
    const parsed = responseSchema.safeParse(JSON.parse(decodeUtf8(bytes)));
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } catch (error) {
    throw failure("COMPUTE_RESPONSE_INVALID", "0G Compute response is invalid", error);
  }
}

function parseRequestHeaders(value: unknown): Headers {
  if (!value || typeof value !== "object" || Array.isArray(value)) brokerHeaderFailure();
  const headers = new Headers();
  for (const [name, headerValue] of Object.entries(value)) {
    if (headerValue === undefined) continue;
    if (typeof headerValue !== "string") brokerHeaderFailure();
    headers.set(name, headerValue);
  }
  if (!headers.has("authorization")) brokerHeaderFailure();
  headers.set("content-type", "application/json");
  return headers;
}

type Receipt = Readonly<{
  chatId: string;
  source: "ZG-Res-Key" | "body-id-fallback";
}>;

function selectReceipt(headers: ComputeHttpResponse["headers"], bodyId?: string): Receipt {
  const header = headerValue(headers, "zg-res-key");
  const chatId = header === null ? bodyId : header;
  if (!chatId?.trim())
    throw failure("COMPUTE_CHAT_ID_MISSING", "0G Compute response has no chat ID");
  if (chatId.length > 512)
    throw failure("COMPUTE_RESPONSE_INVALID", "0G Compute chat ID is too long");
  return {
    chatId,
    source: header === null ? "body-id-fallback" : "ZG-Res-Key",
  };
}

function assertReturnedProvider(
  configured: string,
  traced: string | undefined,
  headers: ComputeHttpResponse["headers"],
) {
  const returned = traced ?? headerValue(headers, "x-0g-provider") ?? undefined;
  if (returned && !sameAddress(returned, configured)) {
    throw failure("COMPUTE_PROVIDER_MISMATCH", "0G Compute returned a different provider");
  }
}

function receiptClaimKey(input: ParsedInput, chatId: string): string {
  return JSON.stringify([input.chainId, input.provider, chatId]);
}

function buildResult(
  input: ParsedInput,
  requestBytes: Uint8Array,
  response: ResponseBody,
  receipt: Receipt,
  rawResponse: ComputeHttpResponse,
  binding: ContentBinding,
  service: ServiceDetail,
): StrictComputeResult {
  const content = response.choices[0].message.content;
  return {
    content,
    proof: buildProof(
      input,
      response,
      receipt.chatId,
      content,
      binding,
      receipt.source,
      responseHeadersSha256(rawResponse.headers),
      requestBytes,
      rawResponse,
      service,
    ),
    receiptSource: receipt.source,
    rawResponseHeaders: rawResponse.headers,
    routerVerification: {
      reportedTeeVerified: response.x_0g_trace?.tee_verified ?? null,
    },
    billingMetadata: response.x_0g_trace?.billing ?? null,
    contentBinding: binding,
  };
}

function buildProof(
  input: ParsedInput,
  response: ResponseBody,
  chatId: string,
  content: string,
  binding: ContentBinding,
  receiptSource: Receipt["source"],
  responseHeadersSha256: `0x${string}`,
  requestBytes: Uint8Array,
  rawResponse: ComputeHttpResponse,
  service: ServiceDetail,
): ComputeProof {
  return {
    purpose: input.purpose,
    provider: input.provider as HexAddress,
    model: response.model,
    chatId,
    receiptDigest: receiptDigest(chatId),
    requestDigest: binding.requestSha256,
    responseDigest: keccak256(toUtf8Bytes(content)) as `0x${string}`,
    proofClass: "DECENTRALIZED_MODEL_TEE",
    signatureScheme: "EIP191",
    expectedSigner: binding.expectedSigner,
    signature: binding.signature,
    signedTextSha256: binding.signedTextSha256,
    requestSha256: binding.requestSha256,
    rawResponseSha256: binding.responseSha256,
    receiptSource,
    responseHeadersSha256,
    usage: {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
    },
    processResponseVerified: true,
    requestBodyBase64: Buffer.from(requestBytes).toString("base64"),
    rawResponseBodyBase64: Buffer.from(rawResponse.body).toString("base64"),
    signedText: binding.signedText,
    normalizedResponseHeaders: normalizeResponseHeaders(rawResponse.headers),
    serviceSnapshot: {
      provider: service.provider.toLowerCase() as HexAddress,
      url: service.url,
      model: service.model,
      additionalInfo: service.additionalInfo,
      teeSignerAddress: service.teeSignerAddress.toLowerCase() as HexAddress,
      teeSignerAcknowledged: service.teeSignerAcknowledged,
    },
  };
}

async function stage<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function nonCancelableStage<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const result = await promise;
  signal.throwIfAborted();
  return result;
}

function headerValue(headers: ComputeHttpResponse["headers"], name: string): string | null {
  return headers.find(([header]) => header.toLowerCase() === name.toLowerCase())?.[1] ?? null;
}

function sameAddress(left: string, right: string): boolean {
  return (
    addressPattern.test(left) &&
    addressPattern.test(right) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function createDeadline(timeoutMs: number, controller: AbortController) {
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(failure("COMPUTE_TIMEOUT", "0G Compute deadline exceeded"));
  }, timeoutMs);
  return { expired: () => expired, clear: () => clearTimeout(timer) };
}

function metadataFailure(): never {
  throw failure("COMPUTE_METADATA_INVALID", "0G Compute metadata is malformed");
}

function modelFailure(boundary: string): never {
  throw failure("COMPUTE_MODEL_MISMATCH", `configured model differs at ${boundary} boundary`);
}

function signerUnacknowledged(): never {
  throw failure("COMPUTE_SIGNER_UNACKNOWLEDGED", "0G Compute signer is not acknowledged");
}

function brokerHeaderFailure(): never {
  throw failure("COMPUTE_BROKER_ERROR", "0G Compute signed authorization headers are invalid");
}

function verificationFailure(): never {
  throw failure("COMPUTE_VERIFICATION_FAILED", "0G Compute SDK verification was not true");
}

function httpFailure(status: number): never {
  throw failure("COMPUTE_PROVIDER_HTTP_ERROR", `0G Compute provider returned HTTP ${status}`);
}

function mapSafeTransportError(error: SafeComputeHttpError): StrictComputeError {
  if (error.reason === "TOO_LARGE") {
    return failure("COMPUTE_RESPONSE_TOO_LARGE", "0G Compute response exceeds byte limit", error);
  }
  if (error.reason === "INVALID_URL" || error.reason === "PRIVATE_NETWORK") {
    return failure(
      "COMPUTE_METADATA_INVALID",
      "0G Compute endpoint failed network safety checks",
      error,
    );
  }
  return failure("COMPUTE_BROKER_ERROR", "safe 0G Compute transport failed", error);
}
