import { sha256 } from "ethers";
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import {
  FileReceiptClaimStore,
  MemoryReceiptClaimStore,
  SubprocessComputeSdk,
  StrictComputeError,
  runStrictCompute,
  type ComputeHttpRequest,
  type ComputeHttpResponse,
  type ReceiptClaimStore,
  type ComputeSdk,
  type StrictComputeDependencies,
  type StrictComputeInput,
} from "../../server/prooflock/compute/strict-broker";
import {
  SafeComputeHttpError,
  collectBody,
  safeComputeTransport,
  validateComputeUrl,
} from "../../server/prooflock/compute/safe-https";

const PROVIDER = "0x1111111111111111111111111111111111111111";
const OTHER_PROVIDER = "0x2222222222222222222222222222222222222222";
const SIGNER = "0x3333333333333333333333333333333333333333";
const TARGET_SIGNER = "0x4444444444444444444444444444444444444444";
const MODEL = "0GM-1.0-35B-A3B";
const CONTENT = '{"riskScore":8,"label":"SAFE"}';
const SIGNATURE = `0x${"ab".repeat(65)}`;

function input(overrides: Partial<StrictComputeInput> = {}): StrictComputeInput {
  return {
    chainId: 16661,
    purpose: "behavioral-risk",
    provider: PROVIDER,
    model: MODEL,
    systemPrompt: "Return a risk verdict as JSON.",
    userMessage: "Inspect this bounded subject profile.",
    spendAuthorized: true,
    timeoutMs: 1_000,
    maxResponseBytes: 16_384,
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    id: "body-chat-id",
    model: MODEL,
    choices: [{ message: { content: CONTENT } }],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    x_0g_trace: {
      provider: PROVIDER,
      tee_verified: true,
      billing: { charged: "0.00001", unit: "0G" },
    },
    ...overrides,
  };
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
}

function inferenceResponse(
  value: unknown = body(),
  overrides: Partial<ComputeHttpResponse> = {},
): ComputeHttpResponse {
  return {
    status: 200,
    headers: [
      ["content-type", "application/json"],
      ["x-custom-proof-header", "preserve-me"],
      ["zg-res-key", "header-chat-id"],
    ],
    body: encode(value),
    ...overrides,
  };
}

function hash(bytes: Uint8Array): string {
  return sha256(bytes).slice(2);
}

function signedText(request: Uint8Array, response: Uint8Array): string {
  return `${hash(request)}:${hash(response)}`;
}

function harness(
  options: {
    verification?: true | false | null;
    processError?: Error;
    inference?: ComputeHttpResponse;
    metadataModel?: string;
    responseSigner?: string;
    signatureText?: string;
    signatureValid?: boolean;
    serviceAdditionalInfo?: string;
    serviceAcknowledged?: boolean;
    serviceValue?: unknown;
    serviceAfterProcess?: unknown;
    receiptStore?: ReceiptClaimStore;
    hang?: "metadata" | "headers" | "service" | "process";
  } = {},
) {
  const supervised = <T>(stage: string, signal: AbortSignal, value: T): Promise<T> => {
    if (options.hang !== stage) return Promise.resolve(value);
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const processResponse = vi.fn(async (_input, signal): Promise<boolean | null> => {
    if (options.hang === "process") return supervised("process", signal, true);
    if (options.processError) throw options.processError;
    return options.verification === undefined ? true : options.verification;
  });
  let serviceReads = 0;
  const sdk: ComputeSdk = {
      getServiceMetadata: vi.fn(async (_provider, _model, signal) =>
        supervised("metadata", signal, {
              endpoint: "https://compute.example/v1/proxy",
              model: options.metadataModel ?? MODEL,
            }),
      ),
      getRequestHeaders: vi.fn(async (_provider, _content, signal) =>
        supervised("headers", signal, { Authorization: "signed-voucher" }),
      ),
      processResponse,
      listService: vi.fn(async (_offset, _limit, _include, signal) => supervised("service", signal, [
        (serviceReads++ > 0 && options.serviceAfterProcess) ||
          options.serviceValue || {
            provider: PROVIDER,
            url: "https://compute.example",
            model: MODEL,
            additionalInfo:
              options.serviceAdditionalInfo ??
              JSON.stringify({
                ProviderType: "decentralized",
                TargetSeparated: true,
                TargetTeeAddress: TARGET_SIGNER,
              }),
            teeSignerAddress: SIGNER,
            teeSignerAcknowledged: options.serviceAcknowledged ?? true,
          },
      ])),
  };
  const served = options.inference ?? inferenceResponse();
  let postedRequest = new Uint8Array();
  const request = vi.fn(async (httpRequest: ComputeHttpRequest): Promise<ComputeHttpResponse> => {
    if (httpRequest.method === "POST") {
      postedRequest = new Uint8Array(httpRequest.body ?? []);
      return served;
    }
    const text = options.signatureText ?? signedText(postedRequest, served.body);
    return inferenceResponse(
      {
        text,
        signature: SIGNATURE,
        signing_address: options.responseSigner ?? TARGET_SIGNER,
      },
      { headers: [["content-type", "application/json"]] },
    );
  });
  const verifySignature = vi.fn(() => options.signatureValid ?? true);
  const dependencies: StrictComputeDependencies = {
    sdk,
    transport: { request },
    signatureVerifier: { verifySignature },
    receiptStore: options.receiptStore ?? new MemoryReceiptClaimStore(),
  };
  return { sdk, dependencies, processResponse, request, verifySignature };
}

describe("strict 0G Compute", () => {
  it("binds the provider signature to exact request and raw response bytes", async () => {
    const { dependencies, processResponse, verifySignature } = harness();
    const result = await runStrictCompute(input(), dependencies);

    expect(result.proof).toMatchObject({
      provider: PROVIDER,
      model: MODEL,
      chatId: "header-chat-id",
      processResponseVerified: true,
      proofClass: "DECENTRALIZED_MODEL_TEE",
      signatureScheme: "EIP191",
      expectedSigner: TARGET_SIGNER,
      receiptSource: "ZG-Res-Key",
    });
    expect(result.contentBinding).toMatchObject({
      expectedSigner: TARGET_SIGNER,
      signatureVerified: true,
      requestSha256: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      responseSha256: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect(result.proof).toMatchObject({
      signature: SIGNATURE,
      signedTextSha256: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      requestSha256: result.contentBinding.requestSha256,
      rawResponseSha256: result.contentBinding.responseSha256,
      responseHeadersSha256: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect(verifySignature).toHaveBeenCalledWith(
      result.contentBinding.signedText,
      SIGNATURE,
      TARGET_SIGNER,
    );
    expect(processResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: PROVIDER,
        chatId: "header-chat-id",
        usage: JSON.stringify({
          prompt_tokens: 8,
          completion_tokens: 4,
          total_tokens: 12,
        }),
      }),
      expect.any(AbortSignal),
    );
  });

  it("kills a supervised SDK child and rejects only after confirmed exit", async () => {
    const child = new EventEmitter() as ChildProcess;
    const killed: NodeJS.Signals[] = [];
    child.send = vi.fn(() => true);
    child.kill = vi.fn((signal = "SIGTERM") => {
      killed.push(signal as NodeJS.Signals);
      queueMicrotask(() => child.emit("close", null, signal));
      return true;
    });
    const sdk = new SubprocessComputeSdk({
      privateKey: `0x${"11".repeat(32)}`,
      rpcUrl: "https://rpc.example",
      workerLauncher: () => child,
    });
    const controller = new AbortController();
    const pending = sdk.getServiceMetadata(PROVIDER, MODEL, controller.signal);
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    expect(killed).toEqual(["SIGKILL"]);
  });

  it.each([
    ["malformed signed text", "not-two-sha256-hashes", "COMPUTE_SIGNED_TEXT_INVALID"],
    [
      "request hash mismatch",
      `${"0".repeat(64)}:${"1".repeat(64)}`,
      "COMPUTE_REQUEST_BINDING_FAILED",
    ],
  ] as const)("rejects %s", async (_label, signatureText, code) => {
    const { dependencies } = harness({ signatureText });
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({ code });
  });

  it("rejects response hash mismatch even when the signature is valid", async () => {
    let exactRequest = new Uint8Array();
    const served = inferenceResponse();
    const h = harness({ inference: served });
    const transport = {
      request: vi.fn(async (request: ComputeHttpRequest) => {
        if (request.method === "POST") {
          exactRequest = new Uint8Array(request.body ?? []);
          return served;
        }
        return inferenceResponse(
          {
            text: `${hash(exactRequest)}:${"0".repeat(64)}`,
            signature: SIGNATURE,
          },
          { headers: [["content-type", "application/json"]] },
        );
      }),
    };
    const dependencies = { ...h.dependencies, transport };
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({
      code: "COMPUTE_RESPONSE_BINDING_FAILED",
    });
  });

  it("rejects a cryptographic signer mismatch", async () => {
    const { dependencies } = harness({ signatureValid: false });
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({
      code: "COMPUTE_SIGNATURE_INVALID",
    });
  });

  it("rejects a signature response that names a different signer", async () => {
    const { dependencies } = harness({ responseSigner: OTHER_PROVIDER });
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({
      code: "COMPUTE_SIGNER_MISMATCH",
    });
  });

  it("uses TargetTeeAddress for a separated decentralized provider", async () => {
    const { dependencies, verifySignature } = harness({
      serviceAdditionalInfo: JSON.stringify({
        ProviderType: "decentralized",
        TargetSeparated: true,
        TargetTeeAddress: TARGET_SIGNER,
      }),
      responseSigner: TARGET_SIGNER,
    });
    await runStrictCompute(input(), dependencies);
    expect(verifySignature).toHaveBeenCalledWith(expect.any(String), SIGNATURE, TARGET_SIGNER);
  });

  it("rejects a centralized router receipt as an unsupported proof class", async () => {
    const { dependencies } = harness({
      serviceAdditionalInfo: JSON.stringify({
        ProviderType: "centralized",
        TargetSeparated: true,
        TargetTeeAddress: TARGET_SIGNER,
      }),
      signatureText: `${"0".repeat(64)}:${"1".repeat(64)}:1:2:3`,
    });
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({
      code: "COMPUTE_PROOF_CLASS_UNSUPPORTED",
    });
  });

  it.each(["standard", "unknown", undefined] as const)(
    "rejects ProviderType %s instead of defaulting to decentralized",
    async (providerType) => {
      const additionalInfo = {
        ...(providerType === undefined ? {} : { ProviderType: providerType }),
        TargetSeparated: true,
        TargetTeeAddress: TARGET_SIGNER,
      };
      await expect(
        runStrictCompute(
          input(),
          harness({ serviceAdditionalInfo: JSON.stringify(additionalInfo) }).dependencies,
        ),
      ).rejects.toMatchObject({ code: "COMPUTE_PROOF_CLASS_UNSUPPORTED" });
    },
  );

  it("rejects an unacknowledged signer from the immutable service detail", async () => {
    const { dependencies } = harness({ serviceAcknowledged: false });
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({
      code: "COMPUTE_SIGNER_UNACKNOWLEDGED",
    });
  });

  it("requires an exact separated target TEE signer", async () => {
    for (const additionalInfo of [
      { ProviderType: "decentralized", TargetSeparated: false },
      { ProviderType: "decentralized", TargetSeparated: true },
      {
        ProviderType: "decentralized",
        TargetSeparated: true,
        TargetTeeAddress: "0x0000000000000000000000000000000000000000",
      },
    ]) {
      await expect(
        runStrictCompute(
          input(),
          harness({ serviceAdditionalInfo: JSON.stringify(additionalInfo) }).dependencies,
        ),
      ).rejects.toMatchObject({ code: "COMPUTE_PROOF_CLASS_UNSUPPORTED" });
    }
  });

  it("normalizes an ethers Result-shaped service tuple before validation", async () => {
    const tuple = [
      PROVIDER,
      "inference",
      "https://compute.example",
      1n,
      1n,
      1n,
      MODEL,
      "TEE",
      JSON.stringify({
        ProviderType: "decentralized",
        TargetSeparated: true,
        TargetTeeAddress: TARGET_SIGNER,
      }),
      SIGNER,
      true,
    ] as unknown[] & Record<string, unknown>;
    Object.assign(tuple, {
      provider: tuple[0],
      url: tuple[2],
      model: tuple[6],
      additionalInfo: tuple[8],
      teeSignerAddress: tuple[9],
      teeSignerAcknowledged: tuple[10],
    });
    await expect(
      runStrictCompute(input(), harness({ serviceValue: tuple }).dependencies),
    ).resolves.toBeDefined();
  });

  it("requires an explicit spend authorization before requesting a voucher", async () => {
    const h = harness();
    const unauthorized = {
      ...input(),
      spendAuthorized: false,
    } as unknown as StrictComputeInput;
    await expect(runStrictCompute(unauthorized, h.dependencies)).rejects.toMatchObject({
      code: "COMPUTE_SPEND_NOT_AUTHORIZED",
    });
    expect(h.sdk.getRequestHeaders).not.toHaveBeenCalled();
  });

  it("pins the configured model through metadata and response", async () => {
    const h = harness();
    await runStrictCompute(input(), h.dependencies);
    expect(h.sdk.getServiceMetadata).toHaveBeenCalledWith(PROVIDER, MODEL, expect.any(AbortSignal));
  });

  it("rejects an on-chain service snapshot change after SDK verification", async () => {
    const receiptStore: ReceiptClaimStore = {
      claim: vi.fn(async () => "claim-token"),
      renew: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const changed = {
      provider: PROVIDER,
      url: "https://compute.example",
      model: MODEL,
      additionalInfo: JSON.stringify({
        ProviderType: "decentralized",
        TargetSeparated: true,
        TargetTeeAddress: TARGET_SIGNER,
        ImageDigest: "changed",
      }),
      teeSignerAddress: SIGNER,
      teeSignerAcknowledged: true,
    };
    await expect(
      runStrictCompute(
        input(),
        harness({ receiptStore, serviceAfterProcess: changed }).dependencies,
      ),
    ).rejects.toMatchObject({ code: "COMPUTE_SERVICE_UNAVAILABLE" });
    expect(receiptStore.commit).not.toHaveBeenCalled();
  });

  it("never replaces the main process global fetch during SDK verification", async () => {
    const original = globalThis.fetch;
    await runStrictCompute(input(), harness().dependencies);
    expect(globalThis.fetch).toBe(original);
  });

  it("rejects a metadata model mismatch", async () => {
    const { dependencies } = harness({ metadataModel: "other-model" });
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({
      code: "COMPUTE_MODEL_MISMATCH",
    });
  });

  it("rejects a response model mismatch", async () => {
    const { dependencies } = harness({
      inference: inferenceResponse(body({ model: "other-model" })),
    });
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({
      code: "COMPUTE_MODEL_MISMATCH",
    });
  });

  it.each([[false], [null]] as const)("rejects processResponse %s", async (verification) => {
    const { dependencies } = harness({ verification });
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({
      code: "COMPUTE_VERIFICATION_FAILED",
    });
  });

  it("rejects thrown processResponse verification", async () => {
    const { dependencies } = harness({
      processError: new Error("verification unavailable"),
    });
    await expect(runStrictCompute(input(), dependencies)).rejects.toMatchObject({
      code: "COMPUTE_VERIFICATION_ERROR",
    });
  });

  it("requires an injected receipt claim store", async () => {
    const { dependencies } = harness();
    const withoutStore = {
      ...dependencies,
      receiptStore: undefined,
    } as unknown as StrictComputeDependencies;
    await expect(runStrictCompute(input(), withoutStore)).rejects.toMatchObject({
      code: "COMPUTE_REPLAY_STORE_REQUIRED",
    });
  });

  it("rejects replay across two runner instances sharing an atomic store", async () => {
    const receiptStore = new MemoryReceiptClaimStore();
    await runStrictCompute(input(), harness({ receiptStore }).dependencies);
    await expect(
      runStrictCompute(input(), harness({ receiptStore }).dependencies),
    ).rejects.toMatchObject({
      code: "COMPUTE_RECEIPT_REPLAY",
    });
  });

  it("keys replay claims by chain, provider, and chat ID with transcript metadata", async () => {
    const receiptStore: ReceiptClaimStore = {
      claim: vi.fn(async () => "claim-token"),
      renew: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    await runStrictCompute(input(), harness({ receiptStore }).dependencies);
    const [key, metadata] = vi.mocked(receiptStore.claim).mock.calls[0];
    expect(JSON.parse(key)).toEqual([16661, PROVIDER, "header-chat-id"]);
    expect(metadata).toEqual({
      model: MODEL,
      requestSha256: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      responseSha256: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("rejects the same receipt with a different separately valid signed response", async () => {
    const receiptStore = new MemoryReceiptClaimStore();
    await runStrictCompute(input(), harness({ receiptStore }).dependencies);
    const equivocated = inferenceResponse(
      body({
        choices: [{ message: { content: '{"riskScore":99,"label":"FLAGGED"}' } }],
      }),
    );
    await expect(
      runStrictCompute(input(), harness({ receiptStore, inference: equivocated }).dependencies),
    ).rejects.toMatchObject({ code: "COMPUTE_RECEIPT_REPLAY" });
  });

  it("releases a failed claim so the same shared store can retry", async () => {
    const receiptStore = new MemoryReceiptClaimStore();
    await expect(
      runStrictCompute(input(), harness({ receiptStore, verification: false }).dependencies),
    ).rejects.toBeInstanceOf(StrictComputeError);
    await expect(
      runStrictCompute(input(), harness({ receiptStore }).dependencies),
    ).resolves.toBeDefined();
  });

  it.each(["metadata", "headers", "service", "process"] as const)(
    "terminates and settles a hung %s SDK worker within the deadline",
    async (hang) => {
      const { dependencies } = harness({ hang });
      await expect(runStrictCompute(input({ timeoutMs: 10 }), dependencies)).rejects.toMatchObject({
        code: "COMPUTE_TIMEOUT",
      });
    },
  );

  it("does not commit a receipt when processResponse resolves after timeout", async () => {
    const receiptStore: ReceiptClaimStore = {
      claim: vi.fn(async () => "late-claim"),
      renew: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const h = harness({ receiptStore, hang: "process" });
    await expect(runStrictCompute(input({ timeoutMs: 10 }), h.dependencies)).rejects.toMatchObject({
      code: "COMPUTE_TIMEOUT",
    });
    await vi.waitFor(() => expect(receiptStore.release).toHaveBeenCalled());
    expect(receiptStore.commit).not.toHaveBeenCalled();
  });

  it("preserves headers and keeps router verification and billing separate", async () => {
    const result = await runStrictCompute(input(), harness().dependencies);
    expect(result.rawResponseHeaders).toContainEqual(["x-custom-proof-header", "preserve-me"]);
    expect(result.routerVerification).toEqual({ reportedTeeVerified: true });
    expect(result.billingMetadata).toEqual({ charged: "0.00001", unit: "0G" });
    expect(result).not.toHaveProperty("settled");
  });

  it("hashes deterministic response headers without sensitive authorization", async () => {
    const first = inferenceResponse(body(), {
      headers: [
        ["ZG-Res-Key", "header-chat-id"],
        ["Authorization", "secret-one"],
        ["X-Proof", " value "],
      ],
    });
    const second = inferenceResponse(body(), {
      headers: [
        ["x-proof", "value"],
        ["authorization", "secret-two"],
        ["zg-res-key", "header-chat-id"],
      ],
    });
    const left = await runStrictCompute(input(), harness({ inference: first }).dependencies);
    const right = await runStrictCompute(input(), harness({ inference: second }).dependencies);
    expect(left.proof.responseHeadersSha256).toBe(right.proof.responseHeadersSha256);
  });

  it("uses body ID only when ZG-Res-Key is absent", async () => {
    const served = inferenceResponse(body(), {
      headers: [["content-type", "application/json"]],
    });
    const result = await runStrictCompute(input(), harness({ inference: served }).dependencies);
    expect(result.receiptSource).toBe("body-id-fallback");
    expect(result.proof.chatId).toBe("body-chat-id");
  });

  it("rejects a response without either receipt ID source", async () => {
    const value = body();
    delete (value as { id?: string }).id;
    const served = inferenceResponse(value, {
      headers: [["content-type", "application/json"]],
    });
    await expect(
      runStrictCompute(input(), harness({ inference: served }).dependencies),
    ).rejects.toMatchObject({ code: "COMPUTE_CHAT_ID_MISSING" });
  });

  it("rejects malformed router verification and provider HTTP errors", async () => {
    const trace = harness({
      inference: inferenceResponse(
        body({
          x_0g_trace: { provider: PROVIDER, tee_verified: "true" },
        }),
      ),
    });
    await expect(runStrictCompute(input(), trace.dependencies)).rejects.toMatchObject({
      code: "COMPUTE_RESPONSE_INVALID",
    });
    const http = harness({
      inference: inferenceResponse(body(), { status: 503 }),
    });
    await expect(runStrictCompute(input(), http.dependencies)).rejects.toMatchObject({
      code: "COMPUTE_PROVIDER_HTTP_ERROR",
    });
  });

  it("rejects provider response mismatch and malformed response", async () => {
    const mismatch = harness({
      inference: inferenceResponse(
        body({
          x_0g_trace: { provider: OTHER_PROVIDER, tee_verified: true },
        }),
      ),
    });
    await expect(runStrictCompute(input(), mismatch.dependencies)).rejects.toMatchObject({
      code: "COMPUTE_PROVIDER_MISMATCH",
    });
    const malformed = harness({ inference: inferenceResponse("not-json") });
    await expect(runStrictCompute(input(), malformed.dependencies)).rejects.toMatchObject({
      code: "COMPUTE_RESPONSE_INVALID",
    });
  });

  it("rejects non-HTTPS or ambiguous provider endpoints before sending vouchers", async () => {
    for (const endpoint of [
      "http://compute.example/v1/proxy",
      "https://user:pass@compute.example/v1/proxy",
      "https://compute.example/v1/proxy?target=other",
      "https://compute.example/v1/proxy#fragment",
    ]) {
      const h = harness();
      vi.mocked(h.sdk.getServiceMetadata).mockResolvedValueOnce({
        endpoint,
        model: MODEL,
      });
      await expect(runStrictCompute(input(), h.dependencies)).rejects.toMatchObject({
        code: "COMPUTE_METADATA_INVALID",
      });
      expect(h.sdk.getRequestHeaders).not.toHaveBeenCalled();
    }
  });

  it("uses controlled transport for inference and signature without forwarding authorization", async () => {
    const { dependencies, request } = harness();
    await runStrictCompute(input(), dependencies);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toMatchObject({
      method: "POST",
      allowRedirects: false,
    });
    expect(request.mock.calls[1][0]).toMatchObject({
      method: "GET",
      allowRedirects: false,
    });
    expect(new Headers(request.mock.calls[1][0].headers).has("authorization")).toBe(false);
  });

  it("bounds the test-only memory store rather than evicting replay history", async () => {
    const store = new MemoryReceiptClaimStore(1);
    const metadata = {
      model: MODEL,
      requestSha256: `0x${"1".repeat(64)}` as const,
      responseSha256: `0x${"2".repeat(64)}` as const,
    };
    const first = await store.claim("one", metadata, 1_000);
    await store.commit("one", first!, 7 * 24 * 60 * 60 * 1_000);
    await expect(store.claim("two", metadata, 1_000)).rejects.toMatchObject({
      code: "COMPUTE_REPLAY_STORE_FULL",
    });
    await expect(store.claim("one", metadata, 1_000)).resolves.toBeNull();
  });

  it("persists committed replay and equivocation rejection across file-store restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sentinel-receipts-"));
    let now = 1_000_000;
    const options = { stateDirectory: directory, clock: () => now };
    try {
      const metadata = {
        model: MODEL,
        requestSha256: `0x${"1".repeat(64)}` as const,
        responseSha256: `0x${"2".repeat(64)}` as const,
      };
      const first = new FileReceiptClaimStore(options);
      const token = await first.claim("receipt", metadata, 60_000);
      await first.commit("receipt", token!, 7 * 24 * 60 * 60 * 1_000);
      const restarted = new FileReceiptClaimStore(options);
      await expect(restarted.claim("receipt", metadata, 60_000)).resolves.toBeNull();
      await expect(
        restarted.claim(
          "receipt",
          { ...metadata, responseSha256: `0x${"3".repeat(64)}` },
          60_000,
        ),
      ).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recovers an expired pending file lease after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sentinel-receipts-"));
    let now = 1_000_000;
    const options = { stateDirectory: directory, clock: () => now };
    try {
      const metadata = {
        model: MODEL,
        requestSha256: `0x${"1".repeat(64)}` as const,
        responseSha256: `0x${"2".repeat(64)}` as const,
      };
      await new FileReceiptClaimStore(options).claim("receipt", metadata, 1_000);
      now += 1_001;
      await expect(
        new FileReceiptClaimStore(options).claim("receipt", metadata, 1_000),
      ).resolves.toMatch(/^0x[0-9a-f]+$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("enforces durable file-store capacity without evicting proof history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sentinel-receipts-"));
    const now = 1_000_000;
    const store = new FileReceiptClaimStore({
      stateDirectory: directory,
      clock: () => now,
      maximumRecords: 1,
    });
    const metadata = {
      model: MODEL,
      requestSha256: `0x${"1".repeat(64)}` as const,
      responseSha256: `0x${"2".repeat(64)}` as const,
    };
    try {
      await store.claim("one", metadata, 1_000);
      await expect(store.claim("two", metadata, 1_000)).rejects.toMatchObject({
        code: "COMPUTE_REPLAY_STORE_FULL",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("coordinates capacity atomically across file-store instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sentinel-receipts-"));
    const metadata = {
      model: MODEL,
      requestSha256: `0x${"1".repeat(64)}` as const,
      responseSha256: `0x${"2".repeat(64)}` as const,
    };
    const options = { stateDirectory: directory, maximumRecords: 1 };
    try {
      const outcomes = await Promise.allSettled([
        new FileReceiptClaimStore(options).claim("one", metadata, 60_000),
        new FileReceiptClaimStore(options).claim("two", metadata, 60_000),
      ]);
      expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("garbage-collects expired records before enforcing global capacity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sentinel-receipts-"));
    let now = 1_000_000;
    const options = { stateDirectory: directory, maximumRecords: 1, clock: () => now };
    const metadata = {
      model: MODEL,
      requestSha256: `0x${"1".repeat(64)}` as const,
      responseSha256: `0x${"2".repeat(64)}` as const,
    };
    try {
      await new FileReceiptClaimStore(options).claim("expired", metadata, 1_000);
      now += 1_001;
      await expect(
        new FileReceiptClaimStore(options).claim("replacement", metadata, 1_000),
      ).resolves.toMatch(/^0x[0-9a-f]+$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recovers a crashed stale global store lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sentinel-receipts-"));
    const lock = join(directory, ".store.lock");
    const metadata = {
      model: MODEL,
      requestSha256: `0x${"1".repeat(64)}` as const,
      responseSha256: `0x${"2".repeat(64)}` as const,
    };
    try {
      await mkdir(lock, { mode: 0o700 });
      const stale = new Date(Date.now() - 31_000);
      await utimes(lock, stale, stale);
      await expect(
        new FileReceiptClaimStore({ stateDirectory: directory }).claim(
          "after-crash",
          metadata,
          1_000,
        ),
      ).resolves.toMatch(/^0x[0-9a-f]+$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects private literal endpoints before opening a socket", async () => {
    const controller = new AbortController();
    await expect(
      safeComputeTransport.request({
        url: "https://127.0.0.1/v1/proxy/chat/completions",
        method: "POST",
        signal: controller.signal,
        maxResponseBytes: 512,
        allowRedirects: false,
      }),
    ).rejects.toMatchObject({ reason: "PRIVATE_NETWORK" });
  });

  it("rejects unsafe URL authority and query ambiguity", () => {
    for (const url of [
      "http://example.com",
      "https://user:secret@example.com",
      "https://example.com?redirect=internal",
      "https://example.com#fragment",
      "https://localhost",
    ]) {
      expect(() => validateComputeUrl(url)).toThrow(SafeComputeHttpError);
    }
  });

  it("destroys an oversized transport body immediately", async () => {
    let destroyed = false;
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array(400);
        yield new Uint8Array(400);
      },
      destroy() {
        destroyed = true;
      },
    };
    await expect(collectBody(stream, 512)).rejects.toMatchObject({
      reason: "TOO_LARGE",
    });
    expect(destroyed).toBe(true);
  });
});
