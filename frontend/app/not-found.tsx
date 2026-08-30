import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Proof route not found",
  description: "The requested ProofLock route does not exist; no approximate identity or legacy record was substituted.",
};

export default function NotFound() {
  return (
    <div className="centered-state">
      <span className="eyebrow">404</span>
      <h1>Proof route not found</h1>
      <p>No legacy record or approximate identity was substituted.</p>
      <Link href="/agents" className="button primary">Open ProofLocks →</Link>
    </div>
  );
}
