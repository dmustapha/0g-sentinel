"use client";

// Cloudflare Turnstile widget for the public seal front door. Config-gated: renders only when
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so the demo is unchanged until the keys are provisioned.
// Uses the explicit-render JS API so the SPA can capture the token and reset it after each scan
// (Turnstile tokens are single-use). See docs/SECURITY-AUDIT.md (rate-limiter hardening).
import { useCallback, useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

// True when Turnstile is configured. Callers use this to require a token before enabling the scan.
export function turnstileConfigured(): boolean {
  return typeof SITE_KEY === "string" && SITE_KEY.length > 0;
}

type TurnstileApi = {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};

function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

async function ensureScript(): Promise<void> {
  if (turnstileApi()) return;
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  if (existing) {
    if (turnstileApi()) return;
    await new Promise<void>((resolve) => existing.addEventListener("load", () => resolve(), { once: true }));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile script failed to load"));
    document.head.appendChild(script);
  });
}

// resetSignal: bump this number to force a fresh challenge (a token is single-use after a scan).
export function TurnstileWidget({ onToken, resetSignal }: {
  onToken: (token: string | null) => void;
  resetSignal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const emit = useCallback((token: string | null) => onTokenRef.current(token), []);

  useEffect(() => {
    if (!turnstileConfigured()) return;
    let cancelled = false;
    ensureScript()
      .then(() => {
        const api = turnstileApi();
        if (cancelled || !api || !containerRef.current || widgetIdRef.current) return;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme: "dark",
          callback: (token: string) => emit(token),
          "expired-callback": () => emit(null),
          "error-callback": () => emit(null),
        });
      })
      .catch(() => emit(null));
    return () => {
      cancelled = true;
      const api = turnstileApi();
      if (api && widgetIdRef.current) {
        try { api.remove(widgetIdRef.current); } catch { /* already gone */ }
        widgetIdRef.current = null;
      }
    };
  }, [emit]);

  // Reset the widget (and clear the parent token) when the reset signal changes.
  useEffect(() => {
    if (resetSignal === 0) return;
    const api = turnstileApi();
    if (api && widgetIdRef.current) {
      try { api.reset(widgetIdRef.current); } catch { /* not ready */ }
      emit(null);
    }
  }, [resetSignal, emit]);

  if (!turnstileConfigured()) return null;
  return <div ref={containerRef} className="turnstile-widget" />;
}
