"use client";
// File: frontend/components/ScanInput.tsx
// Allows any user to scan an arbitrary agent address — not just pre-registered ones.
// Triggers a full scan and navigates to the agent report on completion.
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export function ScanInput({ defaultAddress }: { defaultAddress?: string } = {}) {
  const router = useRouter();
  const [address, setAddress] = useState(defaultAddress ?? "");
  const [scanning, setScanning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isValid = /^0x[0-9a-fA-F]{40}$/.test(address.trim());

  useEffect(() => {
    if (scanning) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [scanning]);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const addr = address.trim();
    if (!isValid) return;
    setError(null);
    setScanning(true);

    try {
      const res = await fetch("/api/scan/behavioral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentAddress: addr }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Scan failed (HTTP ${res.status})`);
        return;
      }

      router.push(`/agents/${addr}`);
    } catch {
      setError("Scan failed. Check network connection.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <form onSubmit={handleScan} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
        <input
          ref={inputRef}
          type="text"
          value={address}
          onChange={(e) => { setAddress(e.target.value); setError(null); }}
          placeholder="0x… paste any agent address"
          disabled={scanning}
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-dm-mono, monospace)",
            fontSize: "1rem",
            color: "rgba(255,255,255,0.8)",
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${error ? "rgba(244,63,94,0.4)" : address && !isValid ? "rgba(251,191,36,0.35)" : "rgba(255,255,255,0.12)"}`,
            borderRadius: 8,
            padding: "0.5rem 0.875rem",
            outline: "none",
            transition: "border-color 0.2s ease-out",
          }}
        />
        <button
          type="submit"
          disabled={scanning || !isValid}
          style={{
            fontFamily: "var(--font-syne, sans-serif)",
            fontSize: "0.875rem",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: scanning || !isValid ? "rgba(255,255,255,0.15)" : "#06b6d4",
            background: "transparent",
            border: `1px solid ${scanning || !isValid ? "rgba(255,255,255,0.08)" : "rgba(6,182,212,0.35)"}`,
            borderRadius: 8,
            padding: "0.5rem 1.25rem",
            minHeight: 44,
            cursor: scanning || !isValid ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            transition: "background 0.2s ease-out, border-color 0.2s ease-out",
          }}
        >
          {scanning ? `Scanning… ${elapsed}s` : "Scan →"}
        </button>
      </div>
      {error && (
        <div style={{
          fontFamily: "var(--font-dm-mono, monospace)",
          fontSize: "0.75rem",
          color: "#f43f5e",
          lineHeight: 1.4,
        }}>
          {error}
        </div>
      )}
      {address && !isValid && !scanning && (
        <div style={{
          fontFamily: "var(--font-dm-mono, monospace)",
          fontSize: "0.75rem",
          color: "#fbbf24",
        }}>
          Must be a valid 0x address (42 chars)
        </div>
      )}
    </form>
  );
}
