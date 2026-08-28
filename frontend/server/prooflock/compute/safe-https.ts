import { promises as dns } from "node:dns";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

export type ComputeHttpRequest = Readonly<{
  url: string;
  method: "GET" | "POST";
  headers?: HeadersInit;
  body?: Uint8Array;
  signal: AbortSignal;
  maxResponseBytes: number;
  allowRedirects: false;
}>;

export type ComputeHttpResponse = Readonly<{
  status: number;
  headers: readonly (readonly [string, string])[];
  body: Uint8Array;
}>;

export type ComputeHttpTransport = Readonly<{
  request(request: ComputeHttpRequest): Promise<ComputeHttpResponse>;
}>;

export class SafeComputeHttpError extends Error {
  constructor(
    public readonly reason:
      | "INVALID_URL"
      | "PRIVATE_NETWORK"
      | "REDIRECT"
      | "TOO_LARGE"
      | "TRANSPORT"
  ) {
    super(`safe 0G Compute transport rejected ${reason.toLowerCase()}`);
  }
}

export const safeComputeTransport: ComputeHttpTransport = {
  request: requestSafeHttps,
};

export function validateComputeUrl(raw: string, allowQuery = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeComputeHttpError("INVALID_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    invalid();
  if (url.port && url.port !== "443") invalid();
  if (!allowQuery && url.search) invalid();
  const hostname = cleanHostname(url.hostname).toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new SafeComputeHttpError("PRIVATE_NETWORK");
  }
  return url;
}

async function requestSafeHttps(
  request: ComputeHttpRequest
): Promise<ComputeHttpResponse> {
  const url = validateComputeUrl(request.url, true);
  request.signal.throwIfAborted();
  const hostname = cleanHostname(url.hostname);
  const addresses = isIP(hostname) ? [hostname] : await resolveDns(hostname);
  request.signal.throwIfAborted();
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicIp(address))
  ) {
    throw new SafeComputeHttpError("PRIVATE_NETWORK");
  }
  return requestPinned(url, addresses[0], isIP(addresses[0]) as 4 | 6, request);
}

async function resolveDns(hostname: string): Promise<readonly string[]> {
  try {
    return (await dns.lookup(hostname, { all: true, verbatim: true })).map(
      (record) => record.address
    );
  } catch {
    throw new SafeComputeHttpError("TRANSPORT");
  }
}

function requestPinned(
  url: URL,
  pinnedAddress: string,
  family: 4 | 6,
  request: ComputeHttpRequest
): Promise<ComputeHttpResponse> {
  return new Promise((resolve, reject) => {
    let activeResponse: IncomingMessage | undefined;
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const req = https.request(
      url,
      {
        method: request.method,
        headers: headersObject(request.headers),
        lookup: pinnedLookup(pinnedAddress, family),
        agent: false,
        signal: request.signal,
      },
      async (response) => {
        activeResponse = response;
        try {
          const result = await consumeResponse(
            response,
            request.maxResponseBytes
          );
          finish(() => resolve(result));
        } catch (error) {
          finish(() => reject(error));
        }
      }
    );
    const abort = () => {
      const reason =
        request.signal.reason instanceof Error
          ? request.signal.reason
          : new SafeComputeHttpError("TRANSPORT");
      req.destroy(reason);
      activeResponse?.destroy(reason);
    };
    const cleanup = () => request.signal.removeEventListener("abort", abort);
    request.signal.addEventListener("abort", abort, { once: true });
    req.on("error", (error) => finish(() => reject(error)));
    if (request.body) req.write(request.body);
    req.end();
  });
}

async function consumeResponse(
  response: IncomingMessage,
  maximum: number
): Promise<ComputeHttpResponse> {
  const status = response.statusCode ?? 0;
  if (status >= 300 && status < 400) {
    response.destroy();
    throw new SafeComputeHttpError("REDIRECT");
  }
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maximum) {
    response.destroy();
    throw new SafeComputeHttpError("TOO_LARGE");
  }
  return {
    status,
    headers: rawHeaderPairs(response.rawHeaders),
    body: await collectBody(response, maximum),
  };
}

export async function collectBody(
  stream: AsyncIterable<Uint8Array> & { destroy(error?: Error): unknown },
  maximum: number
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > maximum) {
      const error = new SafeComputeHttpError("TOO_LARGE");
      stream.destroy(error);
      throw error;
    }
    chunks.push(Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function headersObject(headers?: HeadersInit): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

function rawHeaderPairs(
  raw: readonly string[]
): readonly (readonly [string, string])[] {
  const pairs: [string, string][] = [];
  for (let index = 0; index < raw.length; index += 2) {
    pairs.push([raw[index].toLowerCase(), raw[index + 1]]);
  }
  return pairs;
}

function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, _options, callback) => callback(null, address, family);
}

function invalid(): never {
  throw new SafeComputeHttpError("INVALID_URL");
}

function cleanHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicV4(address);
  if (family === 6) return isPublicV6(address);
  return false;
}

function isPublicV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const value = parts.reduce((total, part) => total * 256 + part, 0) >>> 0;
  const blocked: Array<[number, number]> = [
    [0x00000000, 8],
    [0x0a000000, 8],
    [0x64400000, 10],
    [0x7f000000, 8],
    [0xa9fe0000, 16],
    [0xac100000, 12],
    [0xc0000000, 24],
    [0xc0000200, 24],
    [0xc0a80000, 16],
    [0xc6120000, 15],
    [0xc6336400, 24],
    [0xcb007100, 24],
    [0xe0000000, 4],
    [0xf0000000, 4],
  ];
  return !blocked.some(([network, prefix]) =>
    inV4Range(value, network, prefix)
  );
}

function inV4Range(value: number, network: number, prefix: number): boolean {
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

function isPublicV6(address: string): boolean {
  const value = parseV6(address);
  if (value === null || value === 0n || value === 1n) return false;
  const mapped = value >> 32n === 0xffffn;
  if (mapped) {
    const v4 = [24n, 16n, 8n, 0n]
      .map((shift) => Number((value >> shift) & 255n))
      .join(".");
    return isPublicV4(v4);
  }
  if (!inV6Range(value, 0x2000n << 112n, 3)) return false;
  const blocked: Array<[bigint, number]> = [
    [0x20010000n << 96n, 32],
    [0x20010002n << 96n, 48],
    [0x20010010n << 96n, 28],
    [0x20010020n << 96n, 28],
    [0x20010db8n << 96n, 32],
    [0x2002n << 112n, 16],
    [0x3fffn << 112n, 20],
  ];
  return !blocked.some(([network, prefix]) =>
    inV6Range(value, network, prefix)
  );
}

function parseV6(address: string): bigint | null {
  if (address.includes("%")) return null;
  let source = address.toLowerCase();
  if (source.includes(".")) source = replaceEmbeddedV4(source);
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (
    groups.length !== 8 ||
    groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  )
    return null;
  return groups.reduce(
    (total, part) => (total << 16n) | BigInt(`0x${part}`),
    0n
  );
}

function replaceEmbeddedV4(source: string): string {
  const index = source.lastIndexOf(":");
  const parts = source
    .slice(index + 1)
    .split(".")
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255))
    return "invalid";
  return `${source.slice(0, index)}:${((parts[0] << 8) | parts[1]).toString(
    16
  )}:${((parts[2] << 8) | parts[3]).toString(16)}`;
}

function inV6Range(value: bigint, network: bigint, prefix: number): boolean {
  return value >> BigInt(128 - prefix) === network >> BigInt(128 - prefix);
}
