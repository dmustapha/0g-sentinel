import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ProofLock operator",
  description: "Authorized ProofLock sealing, drift checks, resealing, and commitment-bound write recovery.",
};

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
