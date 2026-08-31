"use client";
// File: frontend/components/NavLinks.tsx
import { usePathname } from "next/navigation";
import Link from "next/link";

export function NavLinks() {
  const pathname = usePathname();
  const scanActive = withinRoute(pathname, "/scan");
  const agentsActive = withinRoute(pathname, "/agents");
  const proofActive = withinRoute(pathname, "/proof");
  const operatorActive = withinRoute(pathname, "/operator");
  const current = scanActive ? "Scan"
    : agentsActive ? "ProofLocks"
    : proofActive ? "Verify"
    : operatorActive ? "Operator"
    : pathname === "/" ? "Overview" : null;
  return (
    <nav className="nav" aria-label={current ? `Primary, current page: ${current}` : "Primary"}>
      <Link href="/" className={pathname === "/" ? "active" : ""}
        aria-current={pathname === "/" ? "page" : undefined}>
        Overview
      </Link>
      <Link href="/scan" className={scanActive ? "active" : ""}
        aria-current={scanActive ? "page" : undefined}>
        Scan
      </Link>
      <Link href="/agents" className={agentsActive ? "active" : ""}
        aria-current={agentsActive ? "page" : undefined}>
        ProofLocks
      </Link>
      <Link href="/proof" className={proofActive ? "active" : ""}
        aria-current={proofActive ? "page" : undefined}>
        Verify
      </Link>
      <Link href="/operator" className={operatorActive ? "active" : ""}
        aria-current={operatorActive ? "page" : undefined}>Operator</Link>
    </nav>
  );
}

function withinRoute(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
