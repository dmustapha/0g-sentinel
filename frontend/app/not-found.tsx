import Link from "next/link";

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
