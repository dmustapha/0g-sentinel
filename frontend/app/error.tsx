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
    <div className="centered-state">
      <span className="eyebrow" style={{ color: "var(--bad)" }}>Error</span>
      <h2 style={{ fontSize: "var(--fs-h3)" }}>Something went wrong</h2>
      <p className="mini-note" style={{ maxWidth: 420 }}>
        {error.message || "An unexpected error occurred."}
      </p>
      <div className="cta-row" style={{ justifyContent: "center" }}>
        <button onClick={reset} className="btn btn-primary">Try again</button>
        <Link href="/agents" className="btn btn-ghost">Dashboard →</Link>
      </div>
    </div>
  );
}
