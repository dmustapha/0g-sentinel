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
    <span style={{ color: "#10b981", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.625rem" }}>
      MERKLE VERIFIED ({detail})
    </span>
  );
  if (state === "failed") return (
    <span style={{ color: "#ef4444", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.625rem" }}>
      VERIFY FAILED: {detail}
    </span>
  );

  return (
    <button onClick={verify} disabled={state === "loading"}
      style={{ background: "transparent", border: "1px solid rgba(0,212,255,0.3)", color: "#00d4ff",
        fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.5625rem", padding: "0.3rem 0.6rem",
        borderRadius: "4px", cursor: "pointer", letterSpacing: "0.05em" }}>
      {state === "loading" ? "VERIFYING..." : "VERIFY EVIDENCE"}
    </button>
  );
}
