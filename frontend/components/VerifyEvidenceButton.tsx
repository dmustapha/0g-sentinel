"use client";
import { useState } from "react";

export function VerifyEvidenceButton({ evidenceHash }: { evidenceHash: string }) {
  const [state, setState] = useState<"idle" | "loading" | "verified" | "failed">("idle");
  const [detail, setDetail] = useState("");

  async function verify() {
    setState("loading");
    try {
      const res = await fetch("/api/verify-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidenceHash }),
      });
      const data = await res.json();
      if (data.verified) { setState("verified"); setDetail(`${data.contentSize} bytes`); }
      else { setState("failed"); setDetail(data.reason || "Unknown error"); }
    } catch { setState("failed"); setDetail("Network error"); }
  }

  if (state === "verified") return (
    <span style={{ color: "var(--good)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)" }}>
      MERKLE VERIFIED ({detail})
    </span>
  );
  if (state === "failed") return (
    <span style={{ color: "var(--bad)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)" }}>
      VERIFY FAILED: {detail}
    </span>
  );

  return (
    <button className="mini-action" onClick={verify} disabled={state === "loading"}>
      {state === "loading" ? "VERIFYING…" : "VERIFY EVIDENCE"}
    </button>
  );
}
