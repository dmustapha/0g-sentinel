import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ProofLock ledger",
  description: "Browse bounded recent finalized ProofLocks and open their identity-bound evidence dossiers.",
};

export default function AgentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
