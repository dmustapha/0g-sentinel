"use client";
// File: frontend/components/ShareCard.tsx
// D2 — share affordances on the agent report. "Share on X" opens a prefilled tweet whose link
// unfurls into the dynamic OG verdict card (opengraph-image.tsx); "Download card" saves that
// same card as a PNG. The report link itself carries the card, so any share is the viral unit.
import { useState } from "react";

interface Props {
  address: string;
  verdict: string; // SAFE / CAUTION / FLAGGED
  score: number;
  reason: string;
}

const EMOJI: Record<string, string> = { FLAGGED: "🚨", CAUTION: "⚠️", SAFE: "✅" };

export function ShareCard({ address, verdict, score, reason }: Props) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  function shareOnX() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const emoji = EMOJI[verdict] ?? "🔍";
    const oneLiner = reason ? ` ${reason}` : "";
    const text = `${emoji} ${verdict} (${score}/100): ${short}.${oneLiner} Verified on 0G with two independent audits. Scan any agent on 0G Agent Watch:`;
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      <div className="sg-label" style={{ marginBottom: "0.125rem" }}>Share this verdict</div>

      <button
        type="button"
        onClick={shareOnX}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          fontFamily: "var(--font-syne, sans-serif)",
          fontSize: "0.8125rem",
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: BG_TEXT,
          background: "#06b6d4",
          border: "none",
          borderRadius: 8,
          padding: "0.625rem 1rem",
          cursor: "pointer",
        }}
      >
        Share verdict on 𝕏
      </button>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <a
          href={`/agents/${address}/opengraph-image`}
          download={`0g-agent-watch-${short}.png`}
          style={{
            flex: 1,
            textAlign: "center",
            fontFamily: "var(--font-syne, sans-serif)",
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "#06b6d4",
            background: "rgba(6,182,212,0.06)",
            border: "1px solid rgba(6,182,212,0.3)",
            borderRadius: 8,
            padding: "0.5rem 0.5rem",
            textDecoration: "none",
          }}
        >
          Download card
        </a>
        <button
          type="button"
          onClick={copyLink}
          style={{
            flex: 1,
            fontFamily: "var(--font-syne, sans-serif)",
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: copied ? "#10b981" : "rgba(255,255,255,0.6)",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 8,
            padding: "0.5rem 0.5rem",
            cursor: "pointer",
          }}
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

const BG_TEXT = "#08010e";
