"use client";
// File: components/QueueBanner.tsx
// Polls /api/scan/queue every 5s and shows live auto-scan progress.
// Disappears when the queue is empty and all scans are complete.
import { useState, useEffect } from "react";

interface QueueStatus {
  queued: number;
  inFlight: string | null;
  completed: number;
  failed: number;
  total: number;
  active: boolean;
}

export function QueueBanner() {
  const [status, setStatus] = useState<QueueStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/scan/queue");
        if (!cancelled && res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch {
        // silently ignore — banner just won't appear
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Don't show if queue hasn't started or nothing is happening
  if (!status || (!status.active && status.queued === 0 && status.completed === 0)) return null;
  // Hide when fully done and no failures
  if (!status.active && status.queued === 0 && status.failed === 0 && status.completed > 0) return null;

  const pct = status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;
  const done = !status.active && status.queued === 0;

  return (
    <div style={{
      background: done
        ? "rgba(16,185,129,0.06)"
        : "rgba(0,212,255,0.04)",
      border: `1px solid ${done ? "rgba(16,185,129,0.25)" : "rgba(0,212,255,0.15)"}`,
      borderRadius: "4px",
      padding: "0.75rem 1rem",
      marginBottom: "1.25rem",
      display: "flex",
      alignItems: "center",
      gap: "1rem",
      flexWrap: "wrap",
    }}>
      {/* Progress bar */}
      <div style={{ flex: "1 1 160px", minWidth: 120 }}>
        <div style={{
          height: 3,
          background: "rgba(0,212,255,0.1)",
          borderRadius: 2,
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            background: done ? "#10b981" : "#00d4ff",
            borderRadius: 2,
            transition: "width 0.6s ease",
          }} />
        </div>
      </div>

      {/* Status text */}
      <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.5625rem", color: "#64748b" }}>
        {done ? (
          <span style={{ color: "#10b981" }}>
            ✓ Auto-scan complete. {status.completed} agents attested.
            {status.failed > 0 && <span style={{ color: "#f59e0b" }}> · {status.failed} failed</span>}
          </span>
        ) : (
          <>
            <span style={{ color: "#00d4ff" }}>Auto-scanning</span>
            {" · "}{status.completed}/{status.total} done
            {status.queued > 0 && <> · {status.queued} queued</>}
            {status.inFlight && (
              <span style={{ color: "#475569" }}>
                {" · scanning "}{status.inFlight.slice(0, 8)}…{status.inFlight.slice(-4)}
              </span>
            )}
          </>
        )}
      </div>

      <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.5rem", color: "#334155" }}>
        {done ? "" : "New attestations appear on refresh"}
      </div>
    </div>
  );
}
