"use client";
// File: frontend/components/StreamingScanPanel.tsx
// D1 — Live-streamed audit. Consumes POST /api/scan/stream (SSE) and renders each
// stage as it lands: discover → behavioral (0G Compute) → code audit (0G Compute) →
// archive (0G Storage) → settle (0G Chain). Kills the ~30s dead air and surfaces the
// C1 "verified on 0G" stamp + C3 two-audit outputs live. On completion, navigates to
// the full report. On transport failure, falls back to the blocking /api/scan/behavioral.
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type StepKey = "discover" | "behavioral" | "code" | "evidence" | "attest";
type StepStatus = "pending" | "active" | "done" | "skip";
type Tone = "good" | "warn" | "bad" | "info";

interface StepState {
  status: StepStatus;
  detail?: string;
  tone?: Tone;
}

const STEPS: { key: StepKey; label: string }[] = [
  { key: "discover", label: "Discover on-chain activity" },
  { key: "behavioral", label: "Behavioral inference · 0G Compute" },
  { key: "code", label: "Code audit · 0G Compute" },
  { key: "evidence", label: "Archive evidence · 0G Storage" },
  { key: "attest", label: "Settle attestation · 0G Chain" },
];

const THREAT = ["SAFE", "CAUTION", "FLAGGED"] as const;
const CODE = ["CLEAN", "WARNING", "VULNERABLE"] as const;
const TONE_BY_LEVEL: Tone[] = ["good", "warn", "bad"];

const TONE_COLOR: Record<Tone, string> = {
  good: "#10b981",
  warn: "#fbbf24",
  bad: "#f43f5e",
  info: "#06b6d4",
};

const INITIAL: Record<StepKey, StepState> = {
  discover: { status: "pending" },
  behavioral: { status: "pending" },
  code: { status: "pending" },
  evidence: { status: "pending" },
  attest: { status: "pending" },
};

interface CompleteResult {
  threat_level: 0 | 1 | 2;
  behavioral_score: number;
  inference_verified: boolean;
  attestation_tx_hash: string;
}

export function StreamingScanPanel({
  address,
  onError,
}: {
  address: string;
  onError: (msg: string) => void;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<Record<StepKey, StepState>>(INITIAL);
  const [verdict, setVerdict] = useState<CompleteResult | null>(null);
  // startedRef: run the scan exactly once (survives React 18 StrictMode double-invoke).
  // mountedRef: gate navigation/terminal callbacks; reset true on every effect run so the
  // single surviving scan keeps updating after StrictMode's fake unmount/remount.
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  const setStep = useCallback((key: StepKey, patch: StepState) => {
    setSteps((prev) => ({ ...prev, [key]: patch }));
  }, []);

  const applyProgress = useCallback(
    (ev: { stage: StepKey; status: "start" | "done" | "skip"; data?: Record<string, unknown> }) => {
      const d = ev.data ?? {};
      if (ev.status === "start") {
        setStep(ev.stage, { status: "active" });
        return;
      }
      if (ev.status === "skip") {
        setStep(ev.stage, { status: "skip", detail: "EOA · no contract to audit", tone: "info" });
        return;
      }
      // done
      switch (ev.stage) {
        case "discover": {
          const n = Number(d.tx_count ?? 0);
          const detail = n > 0 ? `${n} txs · ${String(d.data_source ?? "").replace(/_/g, " ")}` : "no on-chain history";
          setStep("discover", { status: "done", detail, tone: "info" });
          break;
        }
        case "behavioral": {
          const lvl = Number(d.threat_level ?? 0) as 0 | 1 | 2;
          const v = d.verified === true ? " · verified ✓" : "";
          setStep("behavioral", {
            status: "done",
            detail: `${THREAT[lvl]} · score ${Number(d.score ?? 0)}${v}`,
            tone: TONE_BY_LEVEL[lvl],
          });
          break;
        }
        case "code": {
          const risk = Number(d.code_risk ?? 0) as 0 | 1 | 2;
          const v = d.verified === true ? " · verified ✓" : "";
          setStep("code", { status: "done", detail: `${CODE[risk]}${v}`, tone: TONE_BY_LEVEL[risk] });
          break;
        }
        case "evidence": {
          const on = d.on_0g_storage === true;
          setStep("evidence", {
            status: "done",
            detail: on ? "stored on 0G Storage" : "local hash (0G Storage unavailable)",
            tone: on ? "info" : "warn",
          });
          break;
        }
        case "attest": {
          const tx = String(d.tx_hash ?? "");
          setStep("attest", { status: "done", detail: `SETTLED · ${tx.slice(0, 10)}…`, tone: "good" });
          break;
        }
      }
    },
    [setStep]
  );

  useEffect(() => {
    mountedRef.current = true;
    if (startedRef.current) return () => { mountedRef.current = false; };
    startedRef.current = true;

    // The scan runs to completion server-side regardless of client state, so we never abort
    // the fetch (that would only strand an in-flight on-chain write). We gate UI transitions
    // on mountedRef instead.
    async function fallbackBlocking() {
      try {
        const res = await fetch("/api/scan/behavioral", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentAddress: address }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          onError(data.error || `Scan failed (HTTP ${res.status})`);
          return;
        }
        if (mountedRef.current) router.push(`/agents/${address}`);
      } catch {
        onError("Scan failed. Check network connection.");
      }
    }

    async function run() {
      let res: Response;
      try {
        res = await fetch("/api/scan/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentAddress: address }),
        });
      } catch {
        // Transport-level failure before any frame — fall back to the blocking path.
        await fallbackBlocking();
        return;
      }

      const ct = res.headers.get("content-type") || "";
      if (!res.ok || !ct.includes("text/event-stream") || !res.body) {
        // Rate-limit or validation error returns JSON; surface it (no fallback — it would 429 too).
        const data = await res.json().catch(() => ({}));
        onError(data.error || `Scan failed (HTTP ${res.status})`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            let msg: { type: string; [k: string]: unknown };
            try {
              msg = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (msg.type === "progress") {
              applyProgress(msg as never);
            } else if (msg.type === "complete") {
              const r = (msg.result ?? {}) as CompleteResult;
              setVerdict(r);
              setTimeout(() => {
                if (mountedRef.current) router.push(`/agents/${address}`);
              }, 1600);
            } else if (msg.type === "error") {
              onError(String(msg.error || "Scan failed."));
            }
          }
        }
      } catch {
        onError("Stream interrupted. Retry in a few seconds.");
      }
    }

    run();
    return () => { mountedRef.current = false; };
  }, [address, applyProgress, onError, router]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "1rem 1.1rem",
        background: "linear-gradient(180deg, var(--ink-2), var(--ink-1))",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-3)",
        boxShadow: "0 0 60px -30px var(--cy-55), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {STEPS.map(({ key, label }) => {
        const s = steps[key];
        const color = s.tone ? TONE_COLOR[s.tone] : "var(--tx-mid)";
        return (
          <div key={key} style={{ display: "flex", alignItems: "baseline", gap: "0.625rem" }}>
            <span
              aria-hidden
              style={{
                width: 16,
                flexShrink: 0,
                textAlign: "center",
                fontFamily: "var(--font-dm-mono, monospace)",
                fontSize: "0.8rem",
                color:
                  s.status === "done"
                    ? TONE_COLOR[s.tone ?? "good"]
                    : s.status === "skip"
                    ? "var(--tx-lo)"
                    : s.status === "active"
                    ? "#06b6d4"
                    : "rgba(255,255,255,0.18)",
              }}
            >
              {s.status === "done" ? "✓" : s.status === "skip" ? "–" : s.status === "active" ? "◇" : "○"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-syne, sans-serif)",
                fontSize: "0.8125rem",
                fontWeight: 500,
                letterSpacing: "0.01em",
                color:
                  s.status === "pending"
                    ? "var(--tx-lo)"
                    : s.status === "active"
                    ? "var(--tx-hi)"
                    : "var(--tx-mid)",
                transition: "color 0.25s ease-out",
              }}
            >
              {label}
              {s.status === "active" && <span className="sg-pulse-dots"> …</span>}
            </span>
            {s.detail && (
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-dm-mono, monospace)",
                  fontSize: "0.6875rem",
                  color,
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {s.detail}
              </span>
            )}
          </div>
        );
      })}

      {verdict && (
        <div
          style={{
            marginTop: "0.375rem",
            paddingTop: "0.625rem",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-syne, sans-serif)",
              fontSize: "0.9375rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: TONE_COLOR[TONE_BY_LEVEL[verdict.threat_level]],
            }}
          >
            {THREAT[verdict.threat_level]}
            {verdict.inference_verified && (
              <span
                style={{
                  marginLeft: "0.5rem",
                  fontFamily: "var(--font-dm-mono, monospace)",
                  fontSize: "0.6875rem",
                  fontWeight: 500,
                  color: "#06b6d4",
                  letterSpacing: "0.02em",
                }}
              >
                verified on 0G ✓
              </span>
            )}
          </span>
          <a
            href={`/agents/${address}`}
            style={{
              fontFamily: "var(--font-syne, sans-serif)",
              fontSize: "0.75rem",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#06b6d4",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            View report →
          </a>
        </div>
      )}
    </div>
  );
}
