"use client";
// File: frontend/components/NavLinks.tsx
import { usePathname } from "next/navigation";
import Link from "next/link";

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Primary">
      <Link href="/" className={pathname === "/" ? "active" : ""}>
        Home
      </Link>
      <Link href="/agents" className={pathname.startsWith("/agents") ? "active" : ""}>
        Dashboard
      </Link>
      <Link href="/proof" className={pathname === "/proof" ? "active" : ""}>
        Proof
      </Link>
    </nav>
  );
}
