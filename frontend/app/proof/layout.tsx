import type { Metadata } from "next";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Historical proof verifier",
  description: "Reproduce one exact historical ProofLock from its proof ID, identity key, and optional Registry source transaction.",
};

export default function ProofLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (process.env.PROOFLOCK_E2E_ERROR_TRIGGER === "enabled"
    && headers().get("x-prooflock-e2e-error") === "1") {
    throw new Error("Deterministic ProofLock E2E error boundary trigger");
  }
  return children;
}
