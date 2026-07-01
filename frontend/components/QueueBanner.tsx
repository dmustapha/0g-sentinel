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
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (!status || (!status.active && status.queued === 0 && status.completed === 0)) return null;
  if (!status.active && status.queued === 0 && status.failed === 0 && status.completed > 0) return null;

  const pct = status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;
  const done = !status.active && status.queued === 0;

  return (
    <div
      style={{
        background: done ? "var(--good-12)" : "var(--cy-06)",
        border: `1px solid ${done ? "rgba(16,185,129,0.25)" : "var(--cy-12)"}`,
        borderRadius: "var(--r-2)",
        padding: "13px 16px",
        marginBottom: 20,
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 160px", minWidth: 120 }}>
        <div style={{ height: 3, background: "var(--cy-12)", borderRadius: 2, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: done ? "var(--good)" : "var(--cy)",
              borderRadius: 2,
              transition: "width 0.6s ease",
            }}
          />
        </div>
      </div>

      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)", color: "var(--tx-lo)" }}>
        {done ? (
          <span style={{ color: "var(--good)" }}>
            ✓ Auto-scan complete. {status.completed} agents attested.
            {status.failed > 0 && <span style={{ color: "var(--warn)" }}> · {status.failed} failed</span>}
          </span>
        ) : (
          <>
            <span style={{ color: "var(--cy)" }}>Auto-scanning</span>
            {" · "}{status.completed}/{status.total} done
            {status.queued > 0 && <> · {status.queued} queued</>}
            {status.inFlight && (
              <span style={{ color: "var(--tx-lo)" }}>
                {" · scanning "}{status.inFlight.slice(0, 8)}…{status.inFlight.slice(-4)}
              </span>
            )}
          </>
        )}
      </div>

      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--tx-dim)" }}>
        {done ? "" : "New attestations appear on refresh"}
      </div>
    </div>
  );
}
