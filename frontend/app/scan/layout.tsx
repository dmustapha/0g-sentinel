import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scan an agent",
  description: "Run behavioral and code risk through 0G Compute and seal a gated, drift-aware admission attestation on chain for any ERC-8004 agent.",
};

export default function ScanLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
