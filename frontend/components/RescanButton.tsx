"use client";
// File: frontend/components/RescanButton.tsx
// Isolated client component for per-row rescan on the agents dashboard.
// Kept separate so agents/page.tsx can be a server component with ISR.
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  address: string;
}

export function RescanButton({ address }: Props) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRescan() {
    setScanning(true);
    setError(null);
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
      <button
        className="sg-btn-refresh"
        disabled={scanning}
        onClick={handleRescan}
        style={{ fontSize: "0.625rem", padding: "0.25rem 0.625rem" }}
        aria-label={`Rescan ${address.slice(0, 6)}…${address.slice(-4)}`}
      >
        {scanning ? "Scanning…" : "Rescan"}
      </button>
    </div>
  );
}
