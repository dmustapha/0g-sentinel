"use client";
// File: frontend/components/StreamingScanPanel.tsx
// D1 — Live-streamed audit. Consumes POST /api/scan/stream (SSE) and renders each
// stage as it lands: discover → behavioral (0G Compute) → code audit (0G Compute) →
// archive (0G Storage) → settle (0G Chain). Kills the ~30s dead air and surfaces the
// C1 "verified on 0G" stamp + C3 two-audit outputs live. On completion, navigates to
// the full report. On transport failure, falls back to the blocking /api/scan/behavioral.
//
// Presentation is the approved prototype's `.stream` markup (stream-head lamps,
// five `.stage` rows, `.verdict-footer`). The SSE/transport logic below is unchanged.
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { agentDisplayName } from "@/lib/constants";

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

const GLYPH: Record<StepStatus, string> = {
  pending: "○",
  active: "◇",
  done: "✓",
  skip: "–",
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

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const agentName = agentDisplayName(address);

  return (
    <div className="stream scale-in" aria-live="polite">
      <div className="stream-head">
        <span className="lamps">
          <span className="lamp" />
          <span className="lamp" />
          <span className="lamp" />
        </span>
        <span>
          agent · <span className="mono">{short}</span> · {agentName}
        </span>
      </div>

      {STEPS.map(({ key, label }) => {
        const s = steps[key];
        const toneColor = s.tone ? TONE_COLOR[s.tone] : undefined;
        const stageStyle =
          (s.status === "done" || s.status === "skip") && toneColor
            ? ({ "--tone": toneColor } as React.CSSProperties)
            : undefined;
        return (
          <div key={key} className={`stage ${s.status}`} style={stageStyle}>
            <span className="glyph">{GLYPH[s.status]}</span>
            <span className="label">{label}</span>
            <span className="detail">
              {s.status === "active" ? (
                <>
                  auditing
                  <span className="pulse-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                </>
              ) : (
                s.detail ?? ""
              )}
            </span>
          </div>
        );
      })}

      <div className={`verdict-footer${verdict ? " show" : ""}`}>
        {verdict && (
          <>
            <span
              className="verdict-word"
              style={{ color: TONE_COLOR[TONE_BY_LEVEL[verdict.threat_level]] }}
            >
              {THREAT[verdict.threat_level]}
            </span>
            {verdict.inference_verified && <span className="verified-tag">verified on 0G ✓</span>}
            <a href={`/agents/${address}`} className="view-link">
              View report →
            </a>
          </>
        )}
      </div>
    </div>
  );
}
