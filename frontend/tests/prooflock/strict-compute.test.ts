import { keccak256, toUtf8Bytes } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  ReceiptReplayGuard,
  StrictComputeError,
  runStrictCompute,
  type StrictComputeBroker,
  type StrictComputeInput,
} from "../../server/prooflock/compute/strict-broker";

const PROVIDER = "0x1111111111111111111111111111111111111111";
const OTHER_PROVIDER = "0x2222222222222222222222222222222222222222";
const MODEL = "0GM-1.0-35B-A3B";
const CONTENT = '{"riskScore":8,"label":"SAFE"}';

function input(
  overrides: Partial<StrictComputeInput> = {}
): StrictComputeInput {
  return {
    purpose: "behavioral-risk",
    provider: PROVIDER,
    model: MODEL,
    systemPrompt: "Return a risk verdict as JSON.",
    userMessage: "Inspect this bounded subject profile.",
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

function response(value: unknown = body(), init: ResponseInit = {}): Response {
  const suppliedHeaders = Object.fromEntries(
    new Headers(init.headers).entries()
  );
  return new Response(JSON.stringify(value), {
    ...init,
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      "x-custom-proof-header": "preserve-me",
      "ZG-Res-Key": "header-chat-id",
      ...suppliedHeaders,
    },
  });
}

function harness(
  options: {
    verification?: true | false | null;
    processError?: Error;
    fetchResponse?: Response;
    fetchImpl?: typeof fetch;
    endpoint?: string;
    providerModel?: string;
  } = {}
) {
  const processResponse = vi.fn(
    async (
      _provider: string,
      _chatId?: string,
      _content?: string
    ): Promise<boolean | null> => {
      if (options.processError) throw options.processError;
      return options.verification === undefined ? true : options.verification;
    }
  );
  const broker: StrictComputeBroker = {
    inference: {
      getServiceMetadata: vi.fn(async () => ({
        endpoint: options.endpoint ?? "https://compute.example",
        model: options.providerModel ?? MODEL,
      })),
      getRequestHeaders: vi.fn(async () => ({
        Authorization: "signed-voucher",
      })),
      processResponse,
    },
  };
  const fetchImpl =
    options.fetchImpl ?? vi.fn(async () => options.fetchResponse ?? response());
  return { broker, fetchImpl, processResponse };
}

describe("strict 0G Compute", () => {
  it("returns a proof only after exact true independent verification", async () => {
    const { broker, fetchImpl, processResponse } = harness();
    const result = await runStrictCompute(input(), {
      broker,
      fetch: fetchImpl,
      replayGuard: new ReceiptReplayGuard(),
    });

    expect(result.proof).toMatchObject({
      purpose: "behavioral-risk",
      provider: PROVIDER,
      model: MODEL,
      chatId: "header-chat-id",
      receiptDigest: keccak256(toUtf8Bytes("header-chat-id")),
      responseDigest: keccak256(toUtf8Bytes(CONTENT)),
      processResponseVerified: true,
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
    });
    expect(result.proof.requestDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(processResponse).toHaveBeenCalledWith(
      PROVIDER,
      "header-chat-id",
      CONTENT
    );
    expect(result.receiptSource).toBe("ZG-Res-Key");
  });

  it("preserves provider response headers and keeps router verification separate", async () => {
    const { broker, fetchImpl } = harness();
    const result = await runStrictCompute(input(), {
      broker,
      fetch: fetchImpl,
      replayGuard: new ReceiptReplayGuard(),
    });

    expect(result.rawResponseHeaders).toContainEqual([
      "x-custom-proof-header",
      "preserve-me",
    ]);
    expect(result.routerVerification).toEqual({ reportedTeeVerified: true });
    expect(result.billingMetadata).toEqual({ charged: "0.00001", unit: "0G" });
    expect(result).not.toHaveProperty("settled");
    expect(JSON.stringify(result)).not.toMatch(/onchain.settl/i);
  });

  it("sends signed broker headers without a hosted fallback", async () => {
    const { broker, fetchImpl } = harness();
    await runStrictCompute(input(), {
      broker,
      fetch: fetchImpl,
      replayGuard: new ReceiptReplayGuard(),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe("https://compute.example/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "signed-voucher"
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: MODEL,
      messages: [
        { role: "system", content: input().systemPrompt },
        { role: "user", content: input().userMessage },
      ],
    });
  });

  it.each([
    ["false", false],
    ["null", null],
  ] as const)(
    "rejects a %s verification result",
    async (_label, verification) => {
      const { broker, fetchImpl } = harness({ verification });
      await expect(
        runStrictCompute(input(), {
          broker,
          fetch: fetchImpl,
          replayGuard: new ReceiptReplayGuard(),
        })
      ).rejects.toMatchObject({ code: "COMPUTE_VERIFICATION_FAILED" });
    }
  );

  it("rejects a thrown verification", async () => {
    const { broker, fetchImpl } = harness({
      processError: new Error("signature service down"),
    });
    await expect(
      runStrictCompute(input(), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_VERIFICATION_ERROR" });
  });

  it("uses the documented body ID fallback only when ZG-Res-Key is absent", async () => {
    const fallbackResponse = response(body(), {
      headers: { "content-type": "application/json" },
    });
    fallbackResponse.headers.delete("ZG-Res-Key");
    const { broker, fetchImpl, processResponse } = harness({
      fetchResponse: fallbackResponse,
    });
    const result = await runStrictCompute(input(), {
      broker,
      fetch: fetchImpl,
      replayGuard: new ReceiptReplayGuard(),
    });

    expect(result.receiptSource).toBe("body-id-fallback");
    expect(result.proof.chatId).toBe("body-chat-id");
    expect(processResponse).toHaveBeenCalledWith(
      PROVIDER,
      "body-chat-id",
      CONTENT
    );
  });

  it("rejects a response with neither ZG-Res-Key nor body ID", async () => {
    const { id: _id, ...withoutId } = body();
    const noHeader = response(withoutId);
    noHeader.headers.delete("ZG-Res-Key");
    const { broker, fetchImpl } = harness({ fetchResponse: noHeader });
    await expect(
      runStrictCompute(input(), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_CHAT_ID_MISSING" });
  });

  it("rejects a configured-versus-returned provider mismatch", async () => {
    const mismatched = response(
      body({
        x_0g_trace: { provider: OTHER_PROVIDER, tee_verified: true },
      })
    );
    const { broker, fetchImpl } = harness({ fetchResponse: mismatched });
    await expect(
      runStrictCompute(input(), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_PROVIDER_MISMATCH" });
  });

  it("rejects replay of an already accepted provider receipt", async () => {
    const guard = new ReceiptReplayGuard();
    const first = harness();
    await runStrictCompute(input(), {
      broker: first.broker,
      fetch: first.fetchImpl,
      replayGuard: guard,
    });
    const second = harness();
    await expect(
      runStrictCompute(input(), {
        broker: second.broker,
        fetch: second.fetchImpl,
        replayGuard: guard,
      })
    ).rejects.toMatchObject({ code: "COMPUTE_RECEIPT_REPLAY" });
    expect(second.processResponse).not.toHaveBeenCalled();
  });

  it("rejects concurrent use of the same receipt", async () => {
    let release!: (value: true) => void;
    const pending = new Promise<true>((resolve) => {
      release = resolve;
    });
    const first = harness();
    first.processResponse.mockImplementationOnce(() => pending);
    const guard = new ReceiptReplayGuard();
    const firstRun = runStrictCompute(input(), {
      broker: first.broker,
      fetch: first.fetchImpl,
      replayGuard: guard,
    });
    await vi.waitFor(() => expect(first.processResponse).toHaveBeenCalled());
    const second = harness();
    await expect(
      runStrictCompute(input(), {
        broker: second.broker,
        fetch: second.fetchImpl,
        replayGuard: guard,
      })
    ).rejects.toMatchObject({ code: "COMPUTE_RECEIPT_REPLAY" });
    release(true);
    await firstRun;
  });

  it("releases a failed receipt claim so an operator can retry", async () => {
    const guard = new ReceiptReplayGuard();
    const failed = harness({ verification: false });
    await expect(
      runStrictCompute(input(), {
        broker: failed.broker,
        fetch: failed.fetchImpl,
        replayGuard: guard,
      })
    ).rejects.toBeInstanceOf(StrictComputeError);
    const retried = harness();
    await expect(
      runStrictCompute(input(), {
        broker: retried.broker,
        fetch: retried.fetchImpl,
        replayGuard: guard,
      })
    ).resolves.toBeDefined();
  });

  it("rejects response-content mismatch through independent verification", async () => {
    const { broker, fetchImpl, processResponse } = harness();
    processResponse.mockImplementation(
      async (_provider, _chatId, verifiedContent) =>
        verifiedContent === "different signed content"
    );
    await expect(
      runStrictCompute(input(), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_VERIFICATION_FAILED" });
    expect(processResponse).toHaveBeenCalledWith(
      PROVIDER,
      "header-chat-id",
      CONTENT
    );
  });

  it.each([
    ["empty provider", { provider: "" }],
    ["zero provider", { provider: `0x${"0".repeat(40)}` }],
    ["empty model", { model: "" }],
    ["empty prompt", { systemPrompt: "" }],
    ["empty message", { userMessage: "" }],
  ] as const)("rejects %s", async (_label, override) => {
    const { broker, fetchImpl } = harness();
    await expect(
      runStrictCompute(input(override), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_INPUT_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-2xx provider responses without retrying or falling back", async () => {
    const { broker, fetchImpl } = harness({
      fetchResponse: new Response("provider unavailable", { status: 503 }),
    });
    await expect(
      runStrictCompute(input(), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_PROVIDER_HTTP_ERROR" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed JSON and malformed response shape", async () => {
    for (const fetchResponse of [
      new Response("not-json", { status: 200 }),
      response({ id: "chat", model: MODEL, choices: [], usage: {} }),
    ]) {
      const { broker, fetchImpl } = harness({ fetchResponse });
      await expect(
        runStrictCompute(input(), {
          broker,
          fetch: fetchImpl,
          replayGuard: new ReceiptReplayGuard(),
        })
      ).rejects.toMatchObject({ code: "COMPUTE_RESPONSE_INVALID" });
    }
  });

  it("rejects an oversized response before JSON parsing", async () => {
    const oversized = response(body({ padding: "x".repeat(2_000) }));
    const { broker, fetchImpl } = harness({ fetchResponse: oversized });
    await expect(
      runStrictCompute(input({ maxResponseBytes: 512 }), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_RESPONSE_TOO_LARGE" });
  });

  it("cancels an oversized response stream as soon as the byte limit is crossed", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(400));
        controller.enqueue(new Uint8Array(400));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { broker, fetchImpl } = harness({
      fetchResponse: new Response(stream, { status: 200 }),
    });
    await expect(
      runStrictCompute(input({ maxResponseBytes: 512 }), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_RESPONSE_TOO_LARGE" });
    expect(cancelled).toBe(true);
  });

  it("rejects a request that exceeds the total deadline", async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
    ) as typeof fetch;
    const { broker } = harness();
    await expect(
      runStrictCompute(input({ timeoutMs: 10 }), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_TIMEOUT" });
  });

  it("rejects invalid router tee_verified instead of upgrading it to true", async () => {
    const invalidTrace = response(
      body({
        x_0g_trace: { provider: PROVIDER, tee_verified: "true" },
      })
    );
    const { broker, fetchImpl } = harness({ fetchResponse: invalidTrace });
    await expect(
      runStrictCompute(input(), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_RESPONSE_INVALID" });
  });

  it("records absent router verification and billing metadata as null", async () => {
    const withoutTrace = response(body({ x_0g_trace: undefined }));
    const { broker, fetchImpl } = harness({ fetchResponse: withoutTrace });
    const result = await runStrictCompute(input(), {
      broker,
      fetch: fetchImpl,
      replayGuard: new ReceiptReplayGuard(),
    });
    expect(result.routerVerification).toEqual({ reportedTeeVerified: null });
    expect(result.billingMetadata).toBeNull();
  });

  it("rejects non-HTTPS provider metadata", async () => {
    const { broker, fetchImpl } = harness({
      endpoint: "http://compute.example",
    });
    await expect(
      runStrictCompute(input(), {
        broker,
        fetch: fetchImpl,
        replayGuard: new ReceiptReplayGuard(),
      })
    ).rejects.toMatchObject({ code: "COMPUTE_METADATA_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
