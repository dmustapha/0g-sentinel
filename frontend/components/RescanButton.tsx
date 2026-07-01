"use client";
// File: frontend/components/RescanButton.tsx
// Isolated client component for per-row rescan on the risk board.
// Kept separate so the pages can stay server components with ISR.
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { THREAT_LABELS } from "@/lib/types";

interface Props {
  address: string;
}

export function RescanButton({ address }: Props) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; score: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (scanning) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [scanning]);

  async function handleRescan() {
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scan/behavioral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentAddress: address }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Scan failed (HTTP ${res.status})`);
      } else {
        const data = await res.json();
        const label = THREAT_LABELS[data.threat_level as 0 | 1 | 2] ?? "UNKNOWN";
        setResult({ label, score: data.behavioral_score ?? 0 });
        router.refresh();
      }
    } catch {
      setError("Scan failed. Check network connection.");
    } finally {
      setScanning(false);
    }
  }

  const resultColor =
    result?.label === "FLAGGED" ? "var(--bad)" : result?.label === "CAUTION" ? "var(--warn)" : "var(--good)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
      {error && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--bad)", maxWidth: 130, textAlign: "right", lineHeight: 1.3 }}>
          {error}
        </span>
      )}
      {result && !scanning && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: resultColor, textAlign: "right", lineHeight: 1.3 }}>
          ✓ {result.label} ({result.score})
        </span>
      )}
      <button
        className="rescan"
        disabled={scanning}
        onClick={handleRescan}
        aria-label={`Rescan ${address.slice(0, 6)}…${address.slice(-4)}`}
      >
        {scanning ? `Scanning… ${elapsed}s` : "Rescan"}
      </button>
    </div>
  );
}
