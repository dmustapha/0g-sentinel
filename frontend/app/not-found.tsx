import Link from "next/link";

export default function NotFound() {
  return (
    <div className="centered-state">
      <span className="eyebrow">404</span>
      <h2 style={{ fontSize: "var(--fs-h3)" }}>Page not found</h2>
      <p className="mini-note">The route you requested doesn&apos;t exist.</p>
      <Link href="/agents" className="btn btn-primary">Go to Dashboard →</Link>
    </div>
  );
}
