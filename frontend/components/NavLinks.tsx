"use client";
// File: frontend/components/NavLinks.tsx
import { usePathname } from "next/navigation";
import Link from "next/link";

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="sg-topbar-nav">
      <Link
        href="/agents"
        className={`sg-topbar-link${pathname.startsWith("/agents") ? " active" : ""}`}
      >
        Dashboard
      </Link>
      <Link
        href="/proof"
        className={`sg-topbar-link${pathname === "/proof" ? " active" : ""}`}
      >
        Proof
      </Link>
    </nav>
  );
}
