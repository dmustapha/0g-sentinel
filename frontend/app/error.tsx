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
        fontFamily: "var(--font-dm-mono, monospace)",
        fontSize: "0.6875rem",
        color: "#f43f5e",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}>
        Error
      </div>
      <div style={{
        fontFamily: "Syne, sans-serif",
        fontSize: "1.25rem",
        fontWeight: 600,
        color: "rgba(255,255,255,0.9)",
        textAlign: "center",
      }}>
        Something went wrong
      </div>
      <div style={{
        fontFamily: "var(--font-dm-mono, monospace)",
        fontSize: "0.75rem",
        color: "rgba(255,255,255,0.15)",
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
