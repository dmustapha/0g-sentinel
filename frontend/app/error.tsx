"use client";
import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{
      minHeight: "calc(100vh - 44px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      gap: "1.5rem",
    }}>
      <div style={{
        fontFamily: "var(--font-jetbrains-mono, monospace)",
        fontSize: "0.6875rem",
        color: "#ef4444",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}>
        Error
      </div>
      <div style={{
        fontFamily: "Space Grotesk, sans-serif",
        fontSize: "1.25rem",
        fontWeight: 600,
        color: "#e2e8f0",
        textAlign: "center",
      }}>
        Something went wrong
      </div>
      <div style={{
        fontFamily: "var(--font-jetbrains-mono, monospace)",
        fontSize: "0.75rem",
        color: "#334155",
        textAlign: "center",
        maxWidth: 400,
      }}>
        {error.message || "An unexpected error occurred."}
      </div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
        <button
          onClick={reset}
          className="sg-btn-fill"
          style={{ cursor: "pointer", border: "none" }}
        >
          Try again
        </button>
        <Link href="/agents" className="sg-btn-outline" style={{ textDecoration: "none" }}>
          Dashboard →
        </Link>
      </div>
    </div>
  );
}
