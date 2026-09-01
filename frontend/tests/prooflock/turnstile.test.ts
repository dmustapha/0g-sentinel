import { describe, expect, it, vi } from "vitest";

import { clientIpFromHeaders, createTurnstileVerifier } from "../../server/prooflock/turnstile";

describe("createTurnstileVerifier (config-gated Cloudflare challenge)", () => {
  it("returns undefined when no secret is configured (staged rollout, no gate)", () => {
    expect(createTurnstileVerifier(undefined)).toBeUndefined();
    expect(createTurnstileVerifier("")).toBeUndefined();
    expect(createTurnstileVerifier("   ")).toBeUndefined();
  });

  it("passes a token Cloudflare confirms, sending secret + response + remoteip", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ success: true }), { status: 200 }));
    const verify = createTurnstileVerifier("secret-key", fetchImpl as unknown as typeof fetch)!;
    expect(await verify("good-token", "203.0.113.7")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = fetchImpl.mock.calls[0][1].body as string;
    expect(body).toContain("secret=secret-key");
    expect(body).toContain("response=good-token");
    expect(body).toContain("remoteip=203.0.113.7");
  });

  it("rejects when Cloudflare reports success:false", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    const verify = createTurnstileVerifier("secret-key", fetchImpl as unknown as typeof fetch)!;
    expect(await verify("bad-token")).toBe(false);
  });

  it("rejects a missing, empty, or oversized token without calling Cloudflare", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const verify = createTurnstileVerifier("secret-key", fetchImpl as unknown as typeof fetch)!;
    expect(await verify(undefined)).toBe(false);
    expect(await verify("")).toBe(false);
    expect(await verify("x".repeat(2049))).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on a non-200 response or a transport error", async () => {
    const http500 = createTurnstileVerifier("secret-key",
      (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch)!;
    expect(await http500("token")).toBe(false);
    const throws = createTurnstileVerifier("secret-key",
      (async () => { throw new Error("network"); }) as unknown as typeof fetch)!;
    expect(await throws("token")).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers the first x-forwarded-for entry", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip and returns undefined when absent", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFromHeaders(new Headers())).toBeUndefined();
  });
});
