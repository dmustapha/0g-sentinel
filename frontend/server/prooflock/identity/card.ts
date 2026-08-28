import { promises as dns } from "node:dns";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { keccak256 } from "ethers";
import {
  isLosslessNumber,
  parse as parseLosslessJson,
  parseNumberAndBigInt,
} from "lossless-json";

import { IdentityError } from "../errors";
import type { AgentIdentity, Bytes32, RegistrationCard } from "../types";

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
  signal: AbortSignal;
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
  card: RegistrationCard;
  registrationDigest: Bytes32;
  byteLength: number;
}>;

type DestroyableAsyncBytes = AsyncIterable<Uint8Array> & {
  destroy?: (error?: Error) => void;
};

type DestroyableTransport = { destroy(error?: Error): unknown };

export async function loadRegistrationCard(
  uri: string,
  identity: AgentIdentity,
  options: CardLoaderOptions = {},
): Promise<LoadedRegistrationCard> {
  const maxBytes = boundedOption(options.maxBytes, DEFAULT_MAX_BYTES, 1, DEFAULT_MAX_BYTES);
  const timeoutMs = boundedOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 30_000);
  const deadline = Date.now() + timeoutMs;
  const bytes = uri.startsWith("data:")
    ? decodeDataUri(uri, maxBytes)
    : await loadRemoteWithDeadline(
      resolveRemoteUri(uri, options.ipfsGateway),
      options,
      maxBytes,
      deadline,
      timeoutMs,
    );
  const { value, shadow } = parseJson(bytes);
  return Object.freeze({
    card: validateRegistrationCard(value, identity, shadow),
    registrationDigest: keccak256(bytes) as Bytes32,
    byteLength: bytes.byteLength,
  });
}

export function validateRegistrationCard(
  value: unknown,
  identity: AgentIdentity,
  losslessShadow: unknown = value,
): RegistrationCard {
  assertBoundedJson(value);
  if (!isRecord(value) || value.type !== REGISTRATION_V1_TYPE) malformed();
  if (value.active === false) fail("CARD_INACTIVE", false);
  if (value.active !== undefined && typeof value.active !== "boolean") malformed();
  if (!Array.isArray(value.registrations)) malformed();
  const shadowRegistrations = isRecord(losslessShadow)
    && Array.isArray(losslessShadow.registrations)
    ? losslessShadow.registrations
    : [];
  const normalized = normalizeRegistrationCard(value, shadowRegistrations);
  const backlink = `eip155:16661:${identity.registryAddress.toLowerCase()}`;
  const matches = normalized.registrations.filter((entry) =>
    entry.agentId === identity.agentId && entry.agentRegistry === backlink);
  if (matches.length !== 1) fail("CARD_BACKLINK_MISMATCH", false);
  return deepFreeze(normalized);
}

async function loadRemoteWithDeadline(
  initial: URL,
  options: CardLoaderOptions,
  maxBytes: number,
  deadline: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const error = new IdentityError("CARD_TIMEOUT", "card", true);
  const timer = setTimeout(() => controller.abort(error), remainingTime(deadline));
  try {
    return await raceAbort(
      loadRemoteCard(initial, options, maxBytes, deadline, controller.signal),
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function loadRemoteCard(
  initial: URL,
  options: CardLoaderOptions,
  maxBytes: number,
  deadline: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const redirects = boundedOption(options.maxRedirects, 3, 0, 3);
  const visited = new Set<string>();
  let current = initial;
  for (let count = 0; count <= redirects; count += 1) {
    validateHttpsUrl(current);
    if (visited.has(current.href)) fail("CARD_REDIRECT_LOOP", false);
    visited.add(current.href);
    const response = await requestValidated(
      current,
      options,
      maxBytes,
      deadline,
      signal,
    );
    if (!REDIRECTS.has(response.status)) return validateResponse(response, maxBytes);
    const location = response.headers.location;
    if (!location) fail("CARD_REDIRECT_INVALID", false);
    const next = redirectUrl(location, current);
    if (visited.has(next.href)) fail("CARD_REDIRECT_LOOP", false);
    if (count === redirects) fail("CARD_REDIRECT_LIMIT", false);
    current = next;
  }
  fail("CARD_REDIRECT_LIMIT", false);
}

async function requestValidated(
  url: URL,
  options: CardLoaderOptions,
  maxBytes: number,
  deadline: number,
  signal: AbortSignal,
): Promise<CardHttpResponse> {
  const hostname = cleanHostname(url.hostname);
  const addresses = isIP(hostname) ? [hostname] : await resolveAddresses(
    hostname,
    options.resolveDns ?? defaultResolveDns,
    deadline,
    signal,
  );
  if (addresses.length === 0 || addresses.some((address) => !isPublicIp(address))) {
    fail("CARD_PRIVATE_NETWORK", false);
  }
  const timeoutMs = remainingTime(deadline);
  const request = options.requestHttps ?? defaultHttpsRequest;
  const pinnedAddress = addresses[0];
  try {
    return await raceAbort(request({
      url,
      pinnedAddress,
      family: isIP(pinnedAddress) as 4 | 6,
      timeoutMs,
      maxBytes,
      signal,
    }), signal);
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    return fail("AGENT_URI_UNAVAILABLE", true);
  }
}

async function resolveAddresses(
  hostname: string,
  resolver: (hostname: string) => Promise<readonly string[]>,
  deadline: number,
  signal: AbortSignal,
): Promise<readonly string[]> {
  try {
    remainingTime(deadline);
    return await raceAbort(resolver(hostname), signal);
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    return fail("AGENT_URI_UNAVAILABLE", true);
  }
}

function validateResponse(response: CardHttpResponse, maxBytes: number): Uint8Array {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) fail("CARD_TOO_LARGE", false);
  if (response.body.byteLength > maxBytes) fail("CARD_TOO_LARGE", false);
  if (response.status < 200 || response.status >= 300) {
    const specialRetry = response.status === 408
      || response.status === 429
      || response.status >= 500;
    const ordinaryClientError = response.status >= 400 && response.status < 500;
    const retryable = specialRetry || !ordinaryClientError;
    fail("AGENT_URI_UNAVAILABLE", retryable);
  }
  const contentType = response.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    fail("CARD_CONTENT_TYPE", false);
  }
  return response.body;
}

function resolveRemoteUri(uri: string, gateway = "https://ipfs.io"): URL {
  if (uri.startsWith("ipfs:")) return resolveIpfsUri(uri, gateway);
  const url = parseUrl(uri);
  if (url.protocol !== "https:") unsupported();
  return url;
}

function resolveIpfsUri(uri: string, gateway: string): URL {
  const { cid, segments } = parseIpfsUri(uri);
  const base = parseGateway(gateway);
  const prefix = `/ipfs/${cid}`;
  const suffix = segments.length
    ? `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`
    : "";
  const target = new URL(`${prefix}${suffix}`, base.origin);
  if (target.origin !== base.origin || !isUnderPrefix(target.pathname, prefix)) unsupported();
  return target;
}

function parseIpfsUri(uri: string): Readonly<{ cid: string; segments: string[] }> {
  if (uri.length > 4096 || !uri.startsWith("ipfs://") || /[\\?#]/.test(uri)) unsupported();
  const remainder = uri.slice("ipfs://".length);
  const slash = remainder.indexOf("/");
  const cid = slash === -1 ? remainder : remainder.slice(0, slash);
  const rawPath = slash === -1 ? "" : remainder.slice(slash + 1);
  if (!cid || cid.includes("@") || !isSupportedCid(cid)) unsupported();
  const segments = rawPath ? rawPath.split("/").map(decodePathSegment) : [];
  if (segments.some((segment) => segment.length === 0)) unsupported();
  return { cid, segments };
}

function decodePathSegment(raw: string): string {
  let current = raw;
  for (let depth = 0; depth < 4; depth += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      unsupported();
    }
    assertSafeDecodedSegment(decoded);
    if (decoded === current) return decoded;
    current = decoded;
  }
  if (/%[0-9a-f]{2}/i.test(current)) unsupported();
  return current;
}

function assertSafeDecodedSegment(value: string): void {
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value)) unsupported();
  if (/%(?:2e|2f|5c|00)/i.test(value)) unsupported();
}

function isSupportedCid(cid: string): boolean {
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)
    || /^b[a-z2-7]{9,119}$/.test(cid)
    || /^k[0-9a-z]{9,119}$/.test(cid);
}

function parseGateway(gateway: string): URL {
  if (gateway.includes("\\")) unsupported();
  const base = parseUrl(gateway);
  validateHttpsUrl(base);
  if (base.search || base.pathname !== "/") unsupported();
  return base;
}

function isUnderPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
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

function parseJson(bytes: Uint8Array): Readonly<{ value: unknown; shadow: unknown }> {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { value: JSON.parse(text), shadow: parseLosslessJson(text) };
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

function normalizeRegistrationCard(
  value: Record<string, unknown>,
  shadows: readonly unknown[],
): RegistrationCard {
  const registrations = (value.registrations as unknown[]).map((entry, index) => {
    const shadow = shadows[index];
    if (!isRecord(entry) || !isRecord(shadow)) malformed();
    if (typeof entry.agentRegistry !== "string") malformed();
    const agentId = canonicalAgentId(entry.agentId, shadow.agentId);
    if (!agentId) fail("CARD_BACKLINK_MISMATCH", false);
    return { ...structuredClone(entry), agentId };
  });
  return { ...structuredClone(value), registrations } as unknown as RegistrationCard;
}

function canonicalAgentId(value: unknown, shadow: unknown): string | null {
  if (isLosslessNumber(shadow)) {
    if (!/^(0|[1-9]\d*)$/.test(shadow.value)) return null;
    const parsed = parseNumberAndBigInt(shadow.value);
    return typeof parsed === "bigint" && parsed <= (1n << 256n) - 1n
      ? parsed.toString()
      : null;
  }
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0
    ? BigInt(value).toString()
    : null;
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
  return !blocked.some(([network, prefix]) => inV6Range(value, network, prefix));
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
    let activeResponse: (DestroyableAsyncBytes & DestroyableTransport) | undefined;
    let settled = false;
    let cleanupAbort: () => void = () => {};
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      action();
    };
    const req = https.request(
      request.url,
      createPinnedRequestOptions(request),
      async (response) => {
        activeResponse = response;
        const length = Number(response.headers["content-length"]);
        if (Number.isFinite(length) && length > request.maxBytes) {
          response.destroy();
          finish(() => reject(new IdentityError("CARD_TOO_LARGE", "card", false)));
          return;
        }
        try {
          const body = await collectBoundedBody(response, request.maxBytes);
          finish(() => resolve({
            status: response.statusCode ?? 0,
            headers: normalizeHeaders(response.headers),
            body,
          }));
        } catch (error) {
          finish(() => reject(error));
        }
      },
    );
    cleanupAbort = bindAbortToTransport(request.signal, req, () => activeResponse);
    req.on("timeout", () => {
      const error = new IdentityError("CARD_TIMEOUT", "card", true);
      req.destroy(error);
      activeResponse?.destroy?.(error);
    });
    req.on("error", (error) => finish(() => reject(error)));
    req.end();
  });
}

export function createPinnedRequestOptions(
  request: CardRequest,
): https.RequestOptions {
  return {
    method: "GET",
    timeout: request.timeoutMs,
    lookup: createPinnedLookup(request.pinnedAddress, request.family),
    headers: { accept: "application/json" },
    signal: request.signal,
    agent: false,
  };
}

export function bindAbortToTransport(
  signal: AbortSignal,
  request: DestroyableTransport,
  getResponse: () => DestroyableTransport | undefined,
): () => void {
  const abort = () => {
    const error = signal.reason instanceof Error
      ? signal.reason
      : new IdentityError("CARD_TIMEOUT", "card", true);
    request.destroy(error);
    getResponse()?.destroy(error);
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export function createPinnedLookup(
  pinnedAddress: string,
  family: 4 | 6,
): LookupFunction {
  return (_hostname, _options, callback) => callback(null, pinnedAddress, family);
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

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new IdentityError("CARD_TIMEOUT", "card", true);
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) fail("CARD_TIMEOUT", true);
  return remaining;
}

function redirectUrl(location: string, current: URL): URL {
  try {
    return new URL(location, current);
  } catch {
    return fail("CARD_REDIRECT_INVALID", false);
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
