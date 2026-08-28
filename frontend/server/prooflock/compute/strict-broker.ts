import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { keccak256, toUtf8Bytes } from "ethers";
import { z } from "zod";

import { receiptDigest } from "../canonical";
import type { ComputeProof, HexAddress } from "../types";

export type StrictComputeErrorCode =
  | "COMPUTE_INPUT_INVALID"
  | "COMPUTE_METADATA_INVALID"
  | "COMPUTE_BROKER_ERROR"
  | "COMPUTE_PROVIDER_HTTP_ERROR"
  | "COMPUTE_RESPONSE_TOO_LARGE"
  | "COMPUTE_RESPONSE_INVALID"
  | "COMPUTE_CHAT_ID_MISSING"
  | "COMPUTE_PROVIDER_MISMATCH"
  | "COMPUTE_RECEIPT_REPLAY"
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

export type StrictComputeBroker = Readonly<{
  inference: Readonly<{
    getServiceMetadata(
      provider: string
    ): Promise<{ endpoint: string; model: string }>;
    getRequestHeaders(provider: string, content?: string): Promise<unknown>;
    processResponse(
      provider: string,
      chatId?: string,
      content?: string
    ): Promise<boolean | null>;
  }>;
}>;

export type StrictComputeInput = Readonly<{
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
}>;

export type StrictComputeDependencies = Readonly<{
  broker: StrictComputeBroker;
  fetch?: typeof fetch;
  replayGuard?: ReceiptReplayGuard;
}>;

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const nonempty = (maximum: number) => z.string().trim().min(1).max(maximum);
const tokenCount = z.number().int().nonnegative().safe();
const inputSchema = z
  .object({
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
    usage: z
      .object({
        prompt_tokens: tokenCount,
        completion_tokens: tokenCount,
        total_tokens: tokenCount,
      })
      .passthrough(),
    x_0g_trace: traceSchema.optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (
      value.usage.total_tokens !==
      value.usage.prompt_tokens + value.usage.completion_tokens
    ) {
      context.addIssue({
        code: "custom",
        message: "usage total does not match components",
      });
    }
  });

export class ReceiptReplayGuard {
  private readonly claimed = new Set<string>();
  private readonly accepted = new Set<string>();

  claim(chatId: string): void {
    if (this.claimed.has(chatId) || this.accepted.has(chatId)) {
      throw failure(
        "COMPUTE_RECEIPT_REPLAY",
        "0G Compute receipt was already processed"
      );
    }
    this.claimed.add(chatId);
  }

  accept(chatId: string): void {
    this.claimed.delete(chatId);
    this.accepted.add(chatId);
  }

  release(chatId: string): void {
    this.claimed.delete(chatId);
  }
}

const defaultReplayGuard = new ReceiptReplayGuard();

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
  const controller = new AbortController();
  const deadline = createDeadline(input.timeoutMs, controller);
  try {
    return await withinDeadline(
      execute(input, dependencies, controller.signal),
      deadline
    );
  } catch (error) {
    if (deadline.expired())
      throw failure("COMPUTE_TIMEOUT", "0G Compute deadline exceeded", error);
    if (error instanceof StrictComputeError) throw error;
    throw failure("COMPUTE_BROKER_ERROR", "0G Compute request failed", error);
  } finally {
    deadline.clear();
    controller.abort();
  }
}

async function execute(
  input: ParsedInput,
  dependencies: StrictComputeDependencies,
  signal: AbortSignal
): Promise<StrictComputeResult> {
  const metadata = parseMetadata(
    await dependencies.broker.inference.getServiceMetadata(input.provider)
  );
  const requestBody = buildRequest(input, metadata.model);
  const requestContent = JSON.stringify(requestBody);
  const signedHeaders = await dependencies.broker.inference.getRequestHeaders(
    input.provider,
    input.userMessage
  );
  const providerResponse = await callProvider(
    metadata.endpoint,
    requestContent,
    signedHeaders,
    signal,
    dependencies.fetch ?? fetch
  );
  return verifyProviderResponse(
    input,
    requestContent,
    providerResponse,
    dependencies
  );
}

type ParsedInput = z.infer<typeof inputSchema>;

function parseInput(input: StrictComputeInput): ParsedInput {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw failure("COMPUTE_INPUT_INVALID", parsed.error.message);
  return { ...parsed.data, provider: parsed.data.provider.toLowerCase() };
}

function parseMetadata(value: { endpoint: string; model: string }) {
  const parsed = z
    .object({ endpoint: z.string().url(), model: nonempty(256) })
    .strict()
    .safeParse(value);
  if (
    !parsed.success ||
    new URL(parsed.success ? parsed.data.endpoint : "https://invalid")
      .protocol !== "https:"
  ) {
    throw failure(
      "COMPUTE_METADATA_INVALID",
      "0G Compute metadata must name an HTTPS endpoint and model"
    );
  }
  return parsed.data;
}

function buildRequest(input: ParsedInput, providerModel: string) {
  return {
    model: providerModel || input.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userMessage },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1_024,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  };
}

async function callProvider(
  endpoint: string,
  body: string,
  signedHeaders: unknown,
  signal: AbortSignal,
  fetchImpl: typeof fetch
): Promise<Response> {
  const headers = parseRequestHeaders(signedHeaders);
  headers.set("content-type", "application/json");
  const response = await fetchImpl(
    `${endpoint.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers,
      body,
      signal,
      keepalive: false,
    }
  );
  if (!response.ok) {
    throw failure(
      "COMPUTE_PROVIDER_HTTP_ERROR",
      `0G Compute provider returned HTTP ${response.status}`
    );
  }
  return response;
}

function parseRequestHeaders(value: unknown): Headers {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure(
      "COMPUTE_BROKER_ERROR",
      "0G Compute request headers are invalid"
    );
  }
  const headers = new Headers();
  for (const [name, headerValue] of Object.entries(value)) {
    if (headerValue === undefined) continue;
    if (typeof headerValue !== "string") {
      throw failure(
        "COMPUTE_BROKER_ERROR",
        "0G Compute request headers are invalid"
      );
    }
    headers.set(name, headerValue);
  }
  if (!headers.has("authorization")) {
    throw failure(
      "COMPUTE_BROKER_ERROR",
      "0G Compute signed authorization is missing"
    );
  }
  return headers;
}

async function verifyProviderResponse(
  input: ParsedInput,
  requestContent: string,
  response: Response,
  dependencies: StrictComputeDependencies
): Promise<StrictComputeResult> {
  const rawResponseHeaders = [...response.headers.entries()] as [
    string,
    string
  ][];
  const responseText = await readBounded(response, input.maxResponseBytes);
  const parsed = parseResponse(responseText);
  assertReturnedProvider(
    input.provider,
    parsed.x_0g_trace?.provider,
    response.headers
  );
  const receipt = selectReceipt(response.headers, parsed.id);
  const guard = dependencies.replayGuard ?? defaultReplayGuard;
  guard.claim(receipt.chatId);
  try {
    await requireIndependentVerification(
      dependencies.broker,
      input.provider,
      receipt.chatId,
      parsed.choices[0].message.content
    );
    guard.accept(receipt.chatId);
  } catch (error) {
    guard.release(receipt.chatId);
    throw error;
  }
  return buildResult(
    input,
    requestContent,
    parsed,
    receipt,
    rawResponseHeaders
  );
}

function parseResponse(responseText: string): ResponseBody {
  let value: unknown;
  try {
    value = JSON.parse(responseText);
  } catch (error) {
    throw failure(
      "COMPUTE_RESPONSE_INVALID",
      "0G Compute response is not JSON",
      error
    );
  }
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success)
    throw failure("COMPUTE_RESPONSE_INVALID", parsed.error.message);
  return parsed.data;
}

type ResponseBody = z.infer<typeof responseSchema>;

function assertReturnedProvider(
  configured: string,
  traced: string | undefined,
  headers: Headers
) {
  const returned = traced ?? headers.get("x-0g-provider") ?? undefined;
  if (returned && returned.toLowerCase() !== configured.toLowerCase()) {
    throw failure(
      "COMPUTE_PROVIDER_MISMATCH",
      "0G Compute returned a different provider"
    );
  }
}

function selectReceipt(headers: Headers, bodyId?: string) {
  const header = headers.get("ZG-Res-Key");
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
    source:
      header === null ? ("body-id-fallback" as const) : ("ZG-Res-Key" as const),
  };
}

async function requireIndependentVerification(
  broker: StrictComputeBroker,
  provider: string,
  chatId: string,
  content: string
) {
  let result: boolean | null;
  try {
    result = await broker.inference.processResponse(provider, chatId, content);
  } catch (error) {
    if (error instanceof StrictComputeError) throw error;
    throw failure(
      "COMPUTE_VERIFICATION_ERROR",
      "0G Compute verification threw",
      error
    );
  }
  if (result !== true) {
    throw failure(
      "COMPUTE_VERIFICATION_FAILED",
      "0G Compute response verification was not true"
    );
  }
}

function buildResult(
  input: ParsedInput,
  requestContent: string,
  response: ResponseBody,
  receipt: { chatId: string; source: "ZG-Res-Key" | "body-id-fallback" },
  rawResponseHeaders: [string, string][]
): StrictComputeResult {
  const content = response.choices[0].message.content;
  return {
    content,
    proof: {
      purpose: input.purpose,
      provider: input.provider as HexAddress,
      model: response.model,
      chatId: receipt.chatId,
      receiptDigest: receiptDigest(receipt.chatId),
      requestDigest: digest(requestContent),
      responseDigest: digest(content),
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
      processResponseVerified: true,
    },
    receiptSource: receipt.source,
    rawResponseHeaders,
    routerVerification: {
      reportedTeeVerified: response.x_0g_trace?.tee_verified ?? null,
    },
    billingMetadata: response.x_0g_trace?.billing ?? null,
  };
}

async function readBounded(
  response: Response,
  maximum: number
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw failure(
      "COMPUTE_RESPONSE_TOO_LARGE",
      "0G Compute response exceeds byte limit"
    );
  }
  const bytes = await readBoundedBytes(response, maximum);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw failure(
      "COMPUTE_RESPONSE_INVALID",
      "0G Compute response is not valid UTF-8",
      error
    );
  }
}

async function readBoundedBytes(
  response: Response,
  maximum: number
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw failure(
        "COMPUTE_RESPONSE_TOO_LARGE",
        "0G Compute response exceeds byte limit"
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function digest(value: string) {
  return keccak256(toUtf8Bytes(value)) as `0x${string}`;
}

function createDeadline(timeoutMs: number, controller: AbortController) {
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      reject(failure("COMPUTE_TIMEOUT", "0G Compute deadline exceeded"));
    }, timeoutMs);
  });
  return { expired: () => expired, clear: () => clearTimeout(timer), promise };
}

async function withinDeadline<T>(
  operation: Promise<T>,
  deadline: ReturnType<typeof createDeadline>
): Promise<T> {
  return await Promise.race([operation, deadline.promise]);
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
