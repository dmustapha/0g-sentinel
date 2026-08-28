export type ProcessResponseVerification = Readonly<{
  provider: string;
  chatId: string;
  usage: string;
  signatureUrl: string;
  signatureBody: Uint8Array;
}>;

export type ProcessResponseVerifier = Readonly<{
  verify(input: ProcessResponseVerification): Promise<boolean | null>;
}>;

type SdkBroker = Readonly<{
  inference: Readonly<{
    processResponse(provider: string, chatId?: string, usage?: string): Promise<boolean | null>;
  }>;
}>;

let sdkFetchTail: Promise<void> = Promise.resolve();

export function createPinnedSdkProcessResponseVerifier(broker: SdkBroker): ProcessResponseVerifier {
  return {
    verify: async (input) =>
      withPinnedFetch(input, () =>
        broker.inference.processResponse(input.provider, input.chatId, input.usage),
      ),
  };
}

async function withPinnedFetch<T>(
  input: ProcessResponseVerification,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireFetchLock();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = pinnedFetch(input);
  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
    lock.release();
  }
}

async function acquireFetchLock() {
  let release!: () => void;
  const predecessor = sdkFetchTail;
  sdkFetchTail = new Promise<void>((resolve) => (release = resolve));
  await predecessor;
  return { release };
}

function pinnedFetch(input: ProcessResponseVerification): typeof globalThis.fetch {
  return async (resource, init) => {
    const request = new Request(resource, init);
    assertPinnedRequest(request, input.signatureUrl);
    return new Response(Uint8Array.from(input.signatureBody).buffer, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function assertPinnedRequest(request: Request, expectedUrl: string): void {
  if (
    request.method !== "GET" ||
    request.url !== expectedUrl ||
    request.headers.has("authorization") ||
    request.headers.has("proxy-authorization")
  ) {
    throw new TypeError("SDK fetch blocked outside pinned signature endpoint");
  }
}
