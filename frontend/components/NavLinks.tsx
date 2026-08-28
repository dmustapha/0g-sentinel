"use client";
// File: frontend/components/NavLinks.tsx
import { usePathname } from "next/navigation";
import Link from "next/link";

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Primary">
      <Link href="/" className={pathname === "/" ? "active" : ""}>
        Evaluate
      </Link>
      <Link href="/agents" className={pathname.startsWith("/agents") ? "active" : ""}>
        ProofLocks
      </Link>
      <Link href="/proof" className={pathname.startsWith("/proof") ? "active" : ""}>
        Verify
      </Link>
    </nav>
  );
}
