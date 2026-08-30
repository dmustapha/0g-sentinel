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
    console.error("Proof surface unavailable", error.digest ?? "no-digest");
  }, [error]);

  return (
    <div className="centered-state">
      <span className="eyebrow">Fail-closed interface</span>
      <h1>Proof surface unavailable</h1>
      <p>The requested proof data could not be rendered. No admission state has been inferred.</p>
      <div className="action-row" role="group" aria-label="Recovery actions">
        <button type="button" onClick={reset} className="button primary">Retry read</button>
        <Link href="/agents" className="button">ProofLocks →</Link>
      </div>
    </div>
  );
}
