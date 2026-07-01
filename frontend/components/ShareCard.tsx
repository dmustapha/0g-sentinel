"use client";
// File: frontend/components/ShareCard.tsx
// D2 — share affordances on the agent report. "Share on X" opens a prefilled tweet whose link
// unfurls into the dynamic OG verdict card (opengraph-image.tsx); "Download card" saves that
// same card as a PNG. The report link itself carries the card, so any share is the viral unit.
// Rendered as the prototype `.share-btn` set (the page wraps these + explorer link in .share-row).
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
    <>
      <button type="button" className="share-btn" onClick={shareOnX}>
        Share verdict on 𝕏
      </button>
      <a
        className="share-btn"
        href={`/agents/${address}/opengraph-image`}
        download={`0g-agent-watch-${short}.png`}
      >
        Download card
      </a>
      <button
        type="button"
        className="share-btn"
        onClick={copyLink}
        style={copied ? { color: "var(--good)", borderColor: "rgba(16,185,129,0.4)" } : undefined}
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </>
  );
}
