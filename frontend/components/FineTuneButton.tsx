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
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ color: "var(--good)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)" }}>
        DATASET UPLOADED
      </span>
      <span style={{ color: "var(--tx-lo)", fontFamily: "var(--font-mono)", fontSize: "0.66rem", wordBreak: "break-all" }}>
        {result.datasetHash.slice(0, 14)}…{result.datasetHash.slice(-8)}
      </span>
      {result.command && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ color: "var(--tx-lo)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            CLI Command
          </span>
          <pre className="mini-cli">{result.command}</pre>
        </div>
      )}
    </div>
  );
  if (state === "failed") return (
    <span style={{ color: "var(--bad)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)" }}>
      FAILED: {error}
    </span>
  );

  return (
    <button className="mini-action" onClick={prepare} disabled={state === "loading"}>
      {state === "loading" ? "PREPARING…" : "PREPARE FINE-TUNING DATASET"}
    </button>
  );
}
