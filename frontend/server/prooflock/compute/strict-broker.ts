import {
  createZGComputeNetworkBroker,
  InferenceVerifier,
} from "@0gfoundation/0g-compute-ts-sdk";
import { hexlify, keccak256, randomBytes, sha256, toUtf8Bytes } from "ethers";
import { z } from "zod";

import { receiptDigest } from "../canonical";
import type { ComputeProof, HexAddress } from "../types";
import {
  SafeComputeHttpError,
  safeComputeTransport,
  validateComputeUrl,
  type ComputeHttpRequest,
  type ComputeHttpResponse,
  type ComputeHttpTransport,
} from "./safe-https";

export type { ComputeHttpRequest, ComputeHttpResponse, ComputeHttpTransport };

export type StrictComputeErrorCode =
  | "COMPUTE_INPUT_INVALID"
  | "COMPUTE_METADATA_INVALID"
  | "COMPUTE_MODEL_MISMATCH"
  | "COMPUTE_BROKER_ERROR"
  | "COMPUTE_PROVIDER_HTTP_ERROR"
  | "COMPUTE_RESPONSE_TOO_LARGE"
  | "COMPUTE_RESPONSE_INVALID"
  | "COMPUTE_CHAT_ID_MISSING"
  | "COMPUTE_PROVIDER_MISMATCH"
  | "COMPUTE_SERVICE_UNAVAILABLE"
  | "COMPUTE_SIGNER_UNACKNOWLEDGED"
  | "COMPUTE_SIGNER_MISMATCH"
  | "COMPUTE_SIGNATURE_INVALID"
  | "COMPUTE_SIGNED_TEXT_INVALID"
  | "COMPUTE_REQUEST_BINDING_FAILED"
  | "COMPUTE_RESPONSE_BINDING_FAILED"
  | "COMPUTE_RECEIPT_REPLAY"
  | "COMPUTE_REPLAY_STORE_REQUIRED"
  | "COMPUTE_REPLAY_STORE_FULL"
  | "COMPUTE_VERIFICATION_FAILED"
  | "COMPUTE_VERIFICATION_ERROR"
  | "COMPUTE_TIMEOUT";

export class StrictComputeError extends Error {
  constructor(
    public readonly code: StrictComputeErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "StrictComputeError";
  }
}

type ServiceDetail = Readonly<{
  provider: string;
  url: string;
  model: string;
  additionalInfo: string;
  teeSignerAddress: string;
  teeSignerAcknowledged: boolean;
}>;

export type StrictComputeBroker = Readonly<{
  inference: Readonly<{
    getServiceMetadata(
      provider: string,
      model?: string
    ): Promise<{ endpoint: string; model: string }>;
    getRequestHeaders(provider: string, content?: string): Promise<unknown>;
    processResponse(
      provider: string,
      chatId?: string,
      usage?: string
    ): Promise<boolean | null>;
    checkProviderSignerStatus(provider: string): Promise<{
      isAcknowledged: boolean;
      teeSignerAddress: string;
    }>;
    listService(
      offset?: number,
      limit?: number,
      includeUnacknowledged?: boolean
    ): Promise<readonly ServiceDetail[]>;
  }>;
}>;

export type ReceiptClaimStore = Readonly<{
  claim(key: string): Promise<string | null>;
  commit(key: string, token: string): Promise<void>;
  release(key: string, token: string): Promise<void>;
}>;

export type StrictComputeInput = Readonly<{
  chainId: 16661;
  purpose: "behavioral-risk" | "contract-risk";
  provider: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
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
    signatureVerified: true;
  }>;
}>;

export type StrictComputeDependencies = Readonly<{
  broker: StrictComputeBroker;
  receiptStore: ReceiptClaimStore;
  transport?: ComputeHttpTransport;
  signatureVerifier?: Readonly<{
    verifySignature(
      text: string,
      signature: string,
      expectedSigner: string
    ): boolean;
  }>;
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
          .passthrough()
      )
      .min(1)
      .max(16),
    usage: usageSchema,
    x_0g_trace: traceSchema.optional(),
  })
  .passthrough();
const signatureSchema = z
  .object({
    text: nonempty(256),
    signature: nonempty(512),
    signing_address: z.string().regex(addressPattern).optional(),
  })
  .passthrough();
const serviceSchema = z
  .object({
    provider: z.string().regex(addressPattern),
    url: nonempty(4_096),
    model: nonempty(256),
    additionalInfo: z.string().max(65_536),
    teeSignerAddress: z.string().regex(addressPattern),
    teeSignerAcknowledged: z.boolean(),
  })
  .passthrough();

/** Bounded process-local helper for tests and one-shot CLI runs; not a durable production store. */
export class MemoryReceiptClaimStore implements ReceiptClaimStore {
  private readonly records = new Map<
    string,
    { token: string; state: "CLAIMED" | "COMMITTED" }
  >();

  constructor(private readonly maximum = 10_000) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100_000) {
      throw new TypeError("MemoryReceiptClaimStore maximum is out of bounds");
    }
  }

  async claim(key: string): Promise<string | null> {
    if (this.records.has(key)) return null;
    if (this.records.size >= this.maximum) {
      throw failure(
        "COMPUTE_REPLAY_STORE_FULL",
        "test-only receipt store is full"
      );
    }
    const token = hexlify(randomBytes(32));
    this.records.set(key, { token, state: "CLAIMED" });
    return token;
  }

  async commit(key: string, token: string): Promise<void> {
    const record = this.records.get(key);
    if (!record || record.token !== token || record.state !== "CLAIMED")
      storeConflict();
    record.state = "COMMITTED";
  }

  async release(key: string, token: string): Promise<void> {
    const record = this.records.get(key);
    if (record?.token === token && record.state === "CLAIMED")
      this.records.delete(key);
  }
}

export async function createStrictComputeBroker(
  signer: Parameters<typeof createZGComputeNetworkBroker>[0]
): Promise<StrictComputeBroker> {
  return await createZGComputeNetworkBroker(signer);
}

export async function runStrictCompute(
  rawInput: StrictComputeInput,
  dependencies: StrictComputeDependencies
): Promise<StrictComputeResult> {
  const input = parseInput(rawInput);
  if (!dependencies.receiptStore) {
    throw failure(
      "COMPUTE_REPLAY_STORE_REQUIRED",
      "an atomic receipt claim store is required"
    );
  }
  const controller = new AbortController();
  const deadline = createDeadline(input.timeoutMs, controller);
  try {
    return await Promise.race([
      execute(input, dependencies, controller.signal),
      deadline.promise,
    ]);
  } catch (error) {
    if (deadline.expired())
      throw failure("COMPUTE_TIMEOUT", "0G Compute deadline exceeded", error);
    if (error instanceof StrictComputeError) throw error;
    if (error instanceof SafeComputeHttpError)
      throw mapSafeTransportError(error);
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
  signal: AbortSignal
): Promise<StrictComputeResult> {
  const metadata = parseMetadata(
    await stage(
      dependencies.broker.inference.getServiceMetadata(
        input.provider,
        input.model
      ),
      signal
    ),
    input.model
  );
  const service = await resolveService(
    dependencies.broker,
    input.provider,
    signal
  );
  assertServiceEndpoint(metadata.endpoint, service.url);
  const expectedSigner = await resolveExpectedSigner(
    dependencies.broker,
    input.provider,
    service,
    signal
  );
  const requestBytes = buildRequestBytes(input);
  const signedHeaders = await stage(
    dependencies.broker.inference.getRequestHeaders(
      input.provider,
      input.userMessage
    ),
    signal
  );
  const response = await requestInference(
    metadata.endpoint,
    requestBytes,
    signedHeaders,
    input,
    dependencies,
    signal
  );
  return verifyAndAccept(
    input,
    requestBytes,
    response,
    service.url,
    expectedSigner,
    dependencies,
    signal
  );
}

function parseInput(input: StrictComputeInput): ParsedInput {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw failure("COMPUTE_INPUT_INVALID", parsed.error.message);
  return { ...parsed.data, provider: parsed.data.provider.toLowerCase() };
}

function parseMetadata(
  value: { endpoint: string; model: string },
  expectedModel: string
) {
  const parsed = z
    .object({ endpoint: z.string().url(), model: nonempty(256) })
    .strict()
    .safeParse(value);
  if (!parsed.success) metadataFailure();
  validateBaseUrl(parsed.data.endpoint);
  if (parsed.data.model !== expectedModel) modelFailure("metadata");
  return parsed.data;
}

function validateBaseUrl(endpoint: string): URL {
  try {
    return validateComputeUrl(endpoint, false);
  } catch (error) {
    throw failure(
      "COMPUTE_METADATA_INVALID",
      "0G Compute endpoint is not a safe HTTPS base URL",
      error
    );
  }
}

async function resolveService(
  broker: StrictComputeBroker,
  provider: string,
  signal: AbortSignal
): Promise<ServiceDetail> {
  for (let offset = 0; offset < 1_000; offset += 50) {
    const page = await stage(
      broker.inference.listService(offset, 50, true),
      signal
    );
    const candidate = page.find(
      (service) => service.provider.toLowerCase() === provider
    );
    if (candidate) {
      const parsed = serviceSchema.safeParse(candidate);
      if (!parsed.success) {
        throw failure(
          "COMPUTE_SERVICE_UNAVAILABLE",
          "on-chain service detail is malformed"
        );
      }
      return parsed.data;
    }
    if (page.length < 50) break;
  }
  throw failure(
    "COMPUTE_SERVICE_UNAVAILABLE",
    "configured 0G Compute service was not found on-chain"
  );
}

function assertServiceEndpoint(
  metadataEndpoint: string,
  serviceEndpoint: string
): void {
  const metadata = validateBaseUrl(metadataEndpoint);
  const service = validateBaseUrl(serviceEndpoint);
  const expected = `${service.href.replace(/\/$/, "")}/v1/proxy`;
  if (metadata.href.replace(/\/$/, "") !== expected) {
    throw failure(
      "COMPUTE_METADATA_INVALID",
      "metadata endpoint differs from on-chain service endpoint"
    );
  }
}

async function resolveExpectedSigner(
  broker: StrictComputeBroker,
  provider: string,
  service: ServiceDetail,
  signal: AbortSignal
): Promise<HexAddress> {
  if (!service.teeSignerAcknowledged) signerUnacknowledged();
  const status = await stage(
    broker.inference.checkProviderSignerStatus(provider),
    signal
  );
  if (!status.isAcknowledged) signerUnacknowledged();
  if (!sameAddress(status.teeSignerAddress, service.teeSignerAddress)) {
    throw failure(
      "COMPUTE_SIGNER_MISMATCH",
      "service and signer status disagree"
    );
  }
  const additional = parseAdditionalInfo(service.additionalInfo);
  const providerType =
    additional.ProviderType === "centralized" ? "centralized" : "decentralized";
  const target =
    additional.TargetSeparated === true &&
    providerType === "decentralized" &&
    typeof additional.TargetTeeAddress === "string"
      ? additional.TargetTeeAddress
      : undefined;
  const expected = target ?? service.teeSignerAddress;
  if (!addressPattern.test(expected) || /^0x0{40}$/i.test(expected)) {
    throw failure(
      "COMPUTE_SIGNER_MISMATCH",
      "expected signer address is invalid"
    );
  }
  return expected.toLowerCase() as HexAddress;
}

function parseAdditionalInfo(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new TypeError();
    return value;
  } catch (error) {
    throw failure(
      "COMPUTE_SERVICE_UNAVAILABLE",
      "service additionalInfo is invalid",
      error
    );
  }
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
    })
  );
}

async function requestInference(
  endpoint: string,
  body: Uint8Array,
  signedHeaders: unknown,
  input: ParsedInput,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal
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
    signal
  );
  if (response.status < 200 || response.status >= 300)
    httpFailure(response.status);
  return response;
}

async function verifyAndAccept(
  input: ParsedInput,
  requestBytes: Uint8Array,
  rawResponse: ComputeHttpResponse,
  serviceUrl: string,
  expectedSigner: HexAddress,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal
): Promise<StrictComputeResult> {
  const response = parseResponse(rawResponse.body);
  if (response.model !== input.model) modelFailure("response");
  assertReturnedProvider(
    input.provider,
    response.x_0g_trace?.provider,
    rawResponse.headers
  );
  const receipt = selectReceipt(rawResponse.headers, response.id);
  const signature = await fetchSignature(
    input,
    serviceUrl,
    receipt.chatId,
    dependencies,
    signal
  );
  const binding = verifyContentBinding(
    signature,
    expectedSigner,
    requestBytes,
    rawResponse.body,
    dependencies
  );
  const key = receiptClaimKey(input, receipt.chatId, binding.responseSha256);
  return withReceiptClaim(
    key,
    input,
    response,
    receipt,
    rawResponse,
    binding,
    dependencies,
    signal
  );
}

async function fetchSignature(
  input: ParsedInput,
  serviceUrl: string,
  chatId: string,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal
): Promise<SignatureResponse> {
  const base = validateBaseUrl(serviceUrl).href.replace(/\/$/, "");
  const url = `${base}/v1/proxy/signature/${encodeURIComponent(
    chatId
  )}?model=${encodeURIComponent(input.model)}`;
  const raw = await stage(
    (dependencies.transport ?? safeComputeTransport).request({
      url,
      method: "GET",
      headers: { accept: "application/json" },
      signal,
      maxResponseBytes: 16_384,
      allowRedirects: false,
    }),
    signal
  );
  if (raw.status < 200 || raw.status >= 300) httpFailure(raw.status);
  return parseSignature(raw.body);
}

type SignatureResponse = z.infer<typeof signatureSchema>;

function parseSignature(bytes: Uint8Array): SignatureResponse {
  try {
    const parsed = signatureSchema.safeParse(JSON.parse(decode(bytes)));
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } catch (error) {
    throw failure(
      "COMPUTE_SIGNATURE_INVALID",
      "provider signature response is malformed",
      error
    );
  }
}

type ContentBinding = StrictComputeResult["contentBinding"];

function verifyContentBinding(
  signature: SignatureResponse,
  expectedSigner: HexAddress,
  requestBytes: Uint8Array,
  responseBytes: Uint8Array,
  dependencies: StrictComputeDependencies
): ContentBinding {
  if (
    signature.signing_address &&
    !sameAddress(signature.signing_address, expectedSigner)
  ) {
    throw failure(
      "COMPUTE_SIGNER_MISMATCH",
      "signature response names a different signer"
    );
  }
  const verifier = dependencies.signatureVerifier ?? InferenceVerifier;
  let signatureValid = false;
  try {
    signatureValid = verifier.verifySignature(
      signature.text,
      signature.signature,
      expectedSigner
    );
  } catch (error) {
    throw failure(
      "COMPUTE_SIGNATURE_INVALID",
      "provider signature is malformed",
      error
    );
  }
  if (!signatureValid) {
    throw failure(
      "COMPUTE_SIGNATURE_INVALID",
      "provider signature does not match expected signer"
    );
  }
  const parts = /^([0-9a-f]{64}):([0-9a-f]{64})$/.exec(signature.text);
  if (!parts)
    throw failure(
      "COMPUTE_SIGNED_TEXT_INVALID",
      "signed text is not two SHA-256 hashes"
    );
  const requestSha256 = sha256(requestBytes) as `0x${string}`;
  const responseSha256 = sha256(responseBytes) as `0x${string}`;
  if (parts[1] !== requestSha256.slice(2))
    bindingFailure("COMPUTE_REQUEST_BINDING_FAILED");
  if (parts[2] !== responseSha256.slice(2))
    bindingFailure("COMPUTE_RESPONSE_BINDING_FAILED");
  return {
    expectedSigner,
    signedText: signature.text,
    requestSha256,
    responseSha256,
    signatureVerified: true,
  };
}

async function withReceiptClaim(
  key: string,
  input: ParsedInput,
  response: ResponseBody,
  receipt: Receipt,
  rawResponse: ComputeHttpResponse,
  binding: ContentBinding,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal
): Promise<StrictComputeResult> {
  const token = await stage(dependencies.receiptStore.claim(key), signal);
  if (!token)
    throw failure(
      "COMPUTE_RECEIPT_REPLAY",
      "0G Compute receipt was already processed"
    );
  try {
    await requireSdkVerification(
      dependencies.broker,
      input.provider,
      receipt.chatId,
      response.usage,
      signal
    );
    signal.throwIfAborted();
    await stage(dependencies.receiptStore.commit(key, token), signal);
    return buildResult(input, response, receipt, rawResponse, binding);
  } catch (error) {
    await dependencies.receiptStore.release(key, token);
    throw error;
  }
}

async function requireSdkVerification(
  broker: StrictComputeBroker,
  provider: string,
  chatId: string,
  usage: ResponseBody["usage"],
  signal: AbortSignal
): Promise<void> {
  // SDK 0.9 does not accept AbortSignal and may finish its internal fee-cache update late.
  // The post-await abort check prevents that late completion from accepting our receipt/proof.
  let result: boolean | null;
  try {
    result = await stage(
      broker.inference.processResponse(provider, chatId, JSON.stringify(usage)),
      signal
    );
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw failure(
      "COMPUTE_VERIFICATION_ERROR",
      "0G Compute SDK verification threw",
      error
    );
  }
  if (result !== true) verificationFailure();
}

type ResponseBody = z.infer<typeof responseSchema>;

function parseResponse(bytes: Uint8Array): ResponseBody {
  try {
    const parsed = responseSchema.safeParse(JSON.parse(decode(bytes)));
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } catch (error) {
    throw failure(
      "COMPUTE_RESPONSE_INVALID",
      "0G Compute response is invalid",
      error
    );
  }
}

function parseRequestHeaders(value: unknown): Headers {
  if (!value || typeof value !== "object" || Array.isArray(value))
    brokerHeaderFailure();
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

function selectReceipt(
  headers: ComputeHttpResponse["headers"],
  bodyId?: string
): Receipt {
  const header = headerValue(headers, "zg-res-key");
  const chatId = header === null ? bodyId : header;
  if (!chatId?.trim())
    throw failure(
      "COMPUTE_CHAT_ID_MISSING",
      "0G Compute response has no chat ID"
    );
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
  headers: ComputeHttpResponse["headers"]
) {
  const returned = traced ?? headerValue(headers, "x-0g-provider") ?? undefined;
  if (returned && !sameAddress(returned, configured)) {
    throw failure(
      "COMPUTE_PROVIDER_MISMATCH",
      "0G Compute returned a different provider"
    );
  }
}

function receiptClaimKey(
  input: ParsedInput,
  chatId: string,
  responseSha256: string
): string {
  return JSON.stringify([
    input.chainId,
    input.provider,
    input.model,
    chatId,
    responseSha256,
  ]);
}

function buildResult(
  input: ParsedInput,
  response: ResponseBody,
  receipt: Receipt,
  rawResponse: ComputeHttpResponse,
  binding: ContentBinding
): StrictComputeResult {
  const content = response.choices[0].message.content;
  return {
    content,
    proof: buildProof(
      input,
      response,
      receipt.chatId,
      content,
      binding.requestSha256
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
  requestSha256: string
): ComputeProof {
  return {
    purpose: input.purpose,
    provider: input.provider as HexAddress,
    model: response.model,
    chatId,
    receiptDigest: receiptDigest(chatId),
    requestDigest: requestSha256 as `0x${string}`,
    responseDigest: keccak256(toUtf8Bytes(content)) as `0x${string}`,
    usage: {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
    },
    processResponseVerified: true,
  };
}

async function stage<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const result = await promise;
  signal.throwIfAborted();
  return result;
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw failure(
      "COMPUTE_RESPONSE_INVALID",
      "0G Compute bytes are not valid UTF-8",
      error
    );
  }
}

function headerValue(
  headers: ComputeHttpResponse["headers"],
  name: string
): string | null {
  return (
    headers.find(
      ([header]) => header.toLowerCase() === name.toLowerCase()
    )?.[1] ?? null
  );
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
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      const error = failure("COMPUTE_TIMEOUT", "0G Compute deadline exceeded");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  return { expired: () => expired, clear: () => clearTimeout(timer), promise };
}

function failure(
  code: StrictComputeErrorCode,
  message: string,
  cause?: unknown
) {
  return new StrictComputeError(
    code,
    message,
    cause === undefined ? undefined : { cause }
  );
}

function metadataFailure(): never {
  throw failure("COMPUTE_METADATA_INVALID", "0G Compute metadata is malformed");
}

function modelFailure(boundary: string): never {
  throw failure(
    "COMPUTE_MODEL_MISMATCH",
    `configured model differs at ${boundary} boundary`
  );
}

function signerUnacknowledged(): never {
  throw failure(
    "COMPUTE_SIGNER_UNACKNOWLEDGED",
    "0G Compute signer is not acknowledged"
  );
}

function bindingFailure(
  code: "COMPUTE_REQUEST_BINDING_FAILED" | "COMPUTE_RESPONSE_BINDING_FAILED"
): never {
  throw failure(code, "provider signature does not bind the exact HTTP bytes");
}

function brokerHeaderFailure(): never {
  throw failure(
    "COMPUTE_BROKER_ERROR",
    "0G Compute signed authorization headers are invalid"
  );
}

function verificationFailure(): never {
  throw failure(
    "COMPUTE_VERIFICATION_FAILED",
    "0G Compute SDK verification was not true"
  );
}

function storeConflict(): never {
  throw failure(
    "COMPUTE_RECEIPT_REPLAY",
    "receipt claim token is stale or invalid"
  );
}

function httpFailure(status: number): never {
  throw failure(
    "COMPUTE_PROVIDER_HTTP_ERROR",
    `0G Compute provider returned HTTP ${status}`
  );
}

function mapSafeTransportError(
  error: SafeComputeHttpError
): StrictComputeError {
  if (error.reason === "TOO_LARGE") {
    return failure(
      "COMPUTE_RESPONSE_TOO_LARGE",
      "0G Compute response exceeds byte limit",
      error
    );
  }
  if (error.reason === "INVALID_URL" || error.reason === "PRIVATE_NETWORK") {
    return failure(
      "COMPUTE_METADATA_INVALID",
      "0G Compute endpoint failed network safety checks",
      error
    );
  }
  return failure(
    "COMPUTE_BROKER_ERROR",
    "safe 0G Compute transport failed",
    error
  );
}
