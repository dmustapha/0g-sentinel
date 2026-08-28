import { promises as dns } from "node:dns";
import https from "node:https";
import { isIP } from "node:net";

import { IdentityError } from "../errors";
import type { AgentIdentity, RegistrationCard } from "../types";

export const REGISTRATION_V1_TYPE =
  "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const;
const DEFAULT_MAX_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_NODES = 10_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export type CardHttpResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
}>;

export type CardRequest = Readonly<{
  url: URL;
  pinnedAddress: string;
  family: 4 | 6;
  timeoutMs: number;
  maxBytes: number;
}>;

export type CardLoaderOptions = Readonly<{
  ipfsGateway?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolveDns?: (hostname: string) => Promise<readonly string[]>;
  requestHttps?: (request: CardRequest) => Promise<CardHttpResponse>;
}>;

export type LoadedRegistrationCard = Readonly<{
  bytes: Uint8Array;
  card: RegistrationCard;
}>;

type DestroyableAsyncBytes = AsyncIterable<Uint8Array> & {
  destroy?: (error?: Error) => void;
};

export async function loadRegistrationCard(
  uri: string,
  identity: AgentIdentity,
  options: CardLoaderOptions = {},
): Promise<LoadedRegistrationCard> {
  const maxBytes = boundedOption(options.maxBytes, DEFAULT_MAX_BYTES, 1, DEFAULT_MAX_BYTES);
  const bytes = uri.startsWith("data:")
    ? decodeDataUri(uri, maxBytes)
    : await loadRemoteCard(resolveRemoteUri(uri, options.ipfsGateway), options, maxBytes);
  const parsed = parseJson(bytes);
  return Object.freeze({ bytes, card: validateRegistrationCard(parsed, identity) });
}

export function validateRegistrationCard(
  value: unknown,
  identity: AgentIdentity,
): RegistrationCard {
  assertBoundedJson(value);
  if (!isRecord(value) || value.type !== REGISTRATION_V1_TYPE) malformed();
  if (value.active === false) fail("CARD_INACTIVE", false);
  if (value.active !== undefined && typeof value.active !== "boolean") malformed();
  if (!Array.isArray(value.registrations)) malformed();
  const matches = value.registrations.filter((entry) => matchesIdentity(entry, identity));
  if (matches.length !== 1) fail("CARD_BACKLINK_MISMATCH", false);
  return deepFreeze(value) as RegistrationCard;
}

async function loadRemoteCard(
  initial: URL,
  options: CardLoaderOptions,
  maxBytes: number,
): Promise<Uint8Array> {
  const redirects = boundedOption(options.maxRedirects, 3, 0, 3);
  const visited = new Set<string>();
  let current = initial;
  for (let count = 0; count <= redirects; count += 1) {
    validateHttpsUrl(current);
    if (visited.has(current.href)) fail("CARD_REDIRECT_LOOP", false);
    visited.add(current.href);
    const response = await requestValidated(current, options, maxBytes);
    if (!REDIRECTS.has(response.status)) return validateResponse(response, maxBytes);
    const location = response.headers.location;
    if (!location || count === redirects) fail("CARD_REDIRECT_LOOP", false);
    current = redirectUrl(location, current);
  }
  fail("CARD_REDIRECT_LOOP", false);
}

async function requestValidated(
  url: URL,
  options: CardLoaderOptions,
  maxBytes: number,
): Promise<CardHttpResponse> {
  const hostname = cleanHostname(url.hostname);
  const addresses = isIP(hostname)
    ? [hostname]
    : await (options.resolveDns ?? defaultResolveDns)(hostname).catch(() => fail("AGENT_URI_UNAVAILABLE", true));
  if (addresses.length === 0 || addresses.some((address) => !isPublicIp(address))) {
    fail("CARD_PRIVATE_NETWORK", false);
  }
  const timeoutMs = boundedOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 30_000);
  const request = options.requestHttps ?? defaultHttpsRequest;
  const pinnedAddress = addresses[0];
  return withTimeout(
    request({ url, pinnedAddress, family: isIP(pinnedAddress) as 4 | 6, timeoutMs, maxBytes }),
    timeoutMs,
  );
}

function validateResponse(response: CardHttpResponse, maxBytes: number): Uint8Array {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) fail("CARD_TOO_LARGE", false);
  if (response.body.byteLength > maxBytes) fail("CARD_TOO_LARGE", false);
  if (response.status < 200 || response.status >= 300) fail("AGENT_URI_UNAVAILABLE", true);
  const contentType = response.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    fail("CARD_CONTENT_TYPE", false);
  }
  return response.body;
}

function resolveRemoteUri(uri: string, gateway = "https://ipfs.io"): URL {
  if (uri.startsWith("ipfs://")) {
    const cidPath = uri.slice("ipfs://".length);
    if (!cidPath || cidPath.includes("#") || cidPath.startsWith("/")) unsupported();
    const base = parseUrl(gateway);
    validateHttpsUrl(base);
    return new URL(`/ipfs/${cidPath}`, `${base.origin}/`);
  }
  const url = parseUrl(uri);
  if (url.protocol !== "https:") unsupported();
  return url;
}

function decodeDataUri(uri: string, maxBytes: number): Uint8Array {
  const match = /^data:application\/json(;base64)?,(.*)$/s.exec(uri);
  if (!match) unsupported();
  let bytes: Uint8Array;
  try {
    bytes = match[1]
      ? decodeBase64(match[2])
      : new TextEncoder().encode(decodeURIComponent(match[2]));
  } catch {
    malformed();
  }
  if (bytes.byteLength > maxBytes) fail("CARD_TOO_LARGE", false);
  return bytes;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    malformed();
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    malformed();
  }
}

function assertBoundedJson(root: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > MAX_NODES || depth > 16) malformed();
    if (typeof value === "string" && value.length > 16_384) malformed();
    if (Array.isArray(value)) {
      if (value.length > 256) malformed();
      value.forEach((child) => stack.push({ value: child, depth: depth + 1 }));
    } else if (isRecord(value)) {
      const entries = Object.entries(value);
      if (entries.length > 256) malformed();
      for (const [key, child] of entries) {
        if (key.length > 256 || ["__proto__", "prototype", "constructor"].includes(key)) malformed();
        stack.push({ value: child, depth: depth + 1 });
      }
    } else if (value !== null && !["string", "number", "boolean"].includes(typeof value)) malformed();
  }
}

function matchesIdentity(entry: unknown, identity: AgentIdentity): boolean {
  if (!isRecord(entry)) return false;
  if (!Number.isSafeInteger(entry.agentId) || entry.agentId !== Number(identity.agentId)) return false;
  const backlink = `eip155:16661:${identity.registryAddress.toLowerCase()}`;
  return entry.agentRegistry === backlink;
}

function validateHttpsUrl(url: URL): void {
  if (url.protocol !== "https:" || url.username || url.password || url.hash) unsupported();
  if (url.port && url.port !== "443") unsupported();
  const hostname = cleanHostname(url.hostname).toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    fail("CARD_PRIVATE_NETWORK", false);
  }
}

function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicV4(address);
  if (family === 6) return isPublicV6(address);
  return false;
}

function isPublicV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const value = parts.reduce((total, part) => total * 256 + part, 0) >>> 0;
  const blocked: Array<[number, number]> = [
    [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
    [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
    [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
    [0xe0000000, 4], [0xf0000000, 4],
  ];
  return !blocked.some(([network, prefix]) => inV4Range(value, network, prefix));
}

function inV4Range(value: number, network: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

function isPublicV6(address: string): boolean {
  const value = parseV6(address);
  if (value === null || value === 0n || value === 1n) return false;
  const mapped = value >> 32n === 0xffffn;
  if (mapped) return isPublicV4([24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join("."));
  return !inV6Range(value, 0xfc00n << 112n, 7)
    && !inV6Range(value, 0xfe80n << 112n, 10)
    && !inV6Range(value, 0xff00n << 112n, 8)
    && !inV6Range(value, 0x20010db8n << 96n, 32);
}

function parseV6(address: string): bigint | null {
  if (address.includes("%")) return null;
  let source = address.toLowerCase();
  if (source.includes(".")) {
    const index = source.lastIndexOf(":");
    const ipv4 = source.slice(index + 1).split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some((part) => part < 0 || part > 255)) return null;
    source = `${source.slice(0, index)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return groups.reduce((total, part) => (total << 16n) | BigInt(`0x${part}`), 0n);
}

function inV6Range(value: bigint, network: bigint, prefix: number): boolean {
  return value >> BigInt(128 - prefix) === network >> BigInt(128 - prefix);
}

async function defaultResolveDns(hostname: string): Promise<readonly string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function defaultHttpsRequest(request: CardRequest): Promise<CardHttpResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(request.url, {
      method: "GET",
      timeout: request.timeoutMs,
      lookup: (_host, _options, callback) => callback(null, request.pinnedAddress, request.family),
      headers: { accept: "application/json" },
    }, async (response) => {
      const length = Number(response.headers["content-length"]);
      if (Number.isFinite(length) && length > request.maxBytes) {
        response.destroy();
        reject(new IdentityError("CARD_TOO_LARGE", "card", false));
        return;
      }
      try {
        const body = await collectBoundedBody(response, request.maxBytes);
        resolve({
          status: response.statusCode ?? 0,
          headers: normalizeHeaders(response.headers),
          body,
        });
      } catch (error) {
        reject(error);
      }
    });
    req.on("timeout", () => req.destroy(new IdentityError("CARD_TIMEOUT", "card", true)));
    req.on("error", reject);
    req.end();
  });
}

export async function collectBoundedBody(
  stream: DestroyableAsyncBytes,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      const error = new IdentityError("CARD_TOO_LARGE", "card", false);
      stream.destroy?.(error);
      throw error;
    }
    chunks.push(Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value]));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IdentityError("CARD_TIMEOUT", "card", true)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    return fail("AGENT_URI_UNAVAILABLE", true);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function redirectUrl(location: string, current: URL): URL {
  try {
    return new URL(location, current);
  } catch {
    unsupported();
  }
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    unsupported();
  }
}

function cleanHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function boundedOption(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) malformed();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function malformed(): never {
  throw new IdentityError("CARD_MALFORMED", "card", false);
}

function unsupported(): never {
  throw new IdentityError("CARD_URI_UNSUPPORTED", "card", false);
}

function fail(code: ConstructorParameters<typeof IdentityError>[0], retryable: boolean): never {
  throw new IdentityError(code, "card", retryable);
}
