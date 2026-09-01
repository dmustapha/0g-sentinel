// Cloudflare Turnstile server-side verification for the public seal front door. This raises the cost
// of automated fan-out against the funded ceremony (see the rate-limiter note in docs/SECURITY-AUDIT.md).
//
// Config-gated by design: when TURNSTILE_SECRET_KEY is unset, createTurnstileVerifier returns
// undefined and the public seal path runs exactly as before (staged rollout, no regression). When the
// secret is set, the handler requires a valid Turnstile token before any funded work runs. Activate by
// setting TURNSTILE_SECRET_KEY (server) + NEXT_PUBLIC_TURNSTILE_SITE_KEY (client).
//
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048; // Cloudflare tokens are well under this; reject anything larger cheaply.

export type TurnstileVerifier = (token: string | undefined, remoteIp?: string) => Promise<boolean>;

// Returns a verifier only when a secret is configured; otherwise undefined (caller runs unprotected).
export function createTurnstileVerifier(
  secret: string | undefined,
  fetchImpl: typeof fetch = fetch,
): TurnstileVerifier | undefined {
  if (!secret || secret.trim().length === 0) return undefined;
  return async (token, remoteIp) => {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
    try {
      const form = new URLSearchParams({ secret, response: token });
      if (remoteIp && remoteIp.length <= 64) form.set("remoteip", remoteIp);
      const response = await fetchImpl(SITEVERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { success?: unknown };
      return data.success === true;
    } catch {
      return false; // Fail closed on any transport/parse error: an unverifiable token is not a pass.
    }
  };
}

// Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). Used only as a Turnstile
// remoteip hint; never trusted for authorization.
export function clientIpFromHeaders(headers: Headers): string | undefined {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  return real?.trim() || undefined;
}
