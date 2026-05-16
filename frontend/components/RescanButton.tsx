"use client";
// File: frontend/components/RescanButton.tsx
// Isolated client component for per-row rescan on the agents dashboard.
// Kept separate so agents/page.tsx can be a server component with ISR.
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
      setError("Scan failed — check network connection");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
      {error && (
        <div style={{
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontSize: "0.5625rem",
          color: "#ef4444",
          maxWidth: 120,
          textAlign: "right",
          lineHeight: 1.3,
        }}>
          {error}
        </div>
      )}
      {result && !scanning && (
        <div style={{
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontSize: "0.5625rem",
          color: result.label === "FLAGGED" ? "#ef4444" : result.label === "CAUTION" ? "#f59e0b" : "#10b981",
          maxWidth: 120,
          textAlign: "right",
          lineHeight: 1.3,
        }}>
          ✓ {result.label} ({result.score})
        </div>
      )}
      <button
        className="sg-btn-refresh"
        disabled={scanning}
        onClick={handleRescan}
        style={{ fontSize: "0.625rem", padding: "0.25rem 0.625rem" }}
        aria-label={`Rescan ${address.slice(0, 6)}…${address.slice(-4)}`}
      >
        {scanning ? `Scanning… ${elapsed}s` : "Rescan"}
      </button>
    </div>
  );
}
