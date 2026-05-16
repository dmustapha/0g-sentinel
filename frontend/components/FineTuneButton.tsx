"use client";
import { useState } from "react";

export function FineTuneButton({ agentAddress }: { agentAddress: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const [result, setResult] = useState<{ datasetHash: string; command: string } | null>(null);
  const [error, setError] = useState("");

  async function prepare() {
    setState("loading");
    try {
      const res = await fetch("/api/fine-tuning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentAddress }),
      });
      const data = await res.json();
      if (data.success) { setState("done"); setResult({ datasetHash: data.datasetHash, command: data.command }); }
      else { setState("failed"); setError(data.error || "Unknown error"); }
    } catch { setState("failed"); setError("Network error"); }
  }

  if (state === "done" && result) return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <span style={{ color: "#10b981", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.625rem" }}>
        DATASET UPLOADED
      </span>
      <span style={{ color: "#64748b", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.5625rem" }}>
        {result.datasetHash.slice(0, 14)}…{result.datasetHash.slice(-8)}
      </span>
    </div>
  );
  if (state === "failed") return (
    <span style={{ color: "#ef4444", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.625rem" }}>
      FAILED: {error}
    </span>
  );

  return (
    <button onClick={prepare} disabled={state === "loading"}
      style={{ background: "transparent", border: "1px solid rgba(0,212,255,0.3)", color: "#00d4ff",
        fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.5625rem", padding: "0.3rem 0.6rem",
        borderRadius: "4px", cursor: "pointer", letterSpacing: "0.05em" }}>
      {state === "loading" ? "PREPARING..." : "PREPARE FINE-TUNING DATASET"}
    </button>
  );
}
