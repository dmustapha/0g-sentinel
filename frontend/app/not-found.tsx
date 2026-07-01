import Link from "next/link";

export default function NotFound() {
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
        color: "var(--tx-dim)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}>
        404
      </div>
      <div style={{
        fontFamily: "var(--font-heading)",
        fontSize: "1.25rem",
        fontWeight: 600,
        color: "var(--tx-hi)",
        textAlign: "center",
      }}>
        Page not found
      </div>
      <div style={{
        fontFamily: "var(--font-dm-mono, monospace)",
        fontSize: "0.75rem",
        color: "var(--tx-dim)",
        textAlign: "center",
      }}>
        The route you requested doesn&apos;t exist.
      </div>
      <Link href="/agents" className="sg-btn-fill" style={{ textDecoration: "none" }}>
        Go to Dashboard →
      </Link>
    </div>
  );
}
