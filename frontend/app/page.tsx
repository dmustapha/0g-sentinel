import Link from "next/link";
import type { Metadata } from "next";
import { FeaturedProofLink } from "@/components/FeaturedProofLink";

export const metadata: Metadata = {
  title: "Overview",
  description: "Inspect recent ProofLocks or reproduce one historical proof without operator credentials.",
};

export default function OverviewPage({ searchParams = {} }: Readonly<{
  searchParams?: Readonly<{ __prooflock_e2e_error?: string | readonly string[] }>;
}>) {
  if (process.env.PROOFLOCK_E2E_ERROR_TRIGGER === "enabled"
    && searchParams.__prooflock_e2e_error === "1") {
    throw new Error("Deterministic ProofLock E2E error boundary trigger");
  }
  return <><section className="ledger-hero"><div className="ledger-grid" aria-hidden="true" /><div className="wrap hero-ledger">
    <div><span className="eyebrow">ProofLock · Network configuration · Chain ID 16661</span><h1>Admission should be <em>provable.</em></h1>
      <p className="hero-lede">Sentinel resolves an ERC-8004 identity, binds its current wallet to typed checks and verified 0G evidence, then issues a seven-day lease that AgentGateV2 can enforce.</p>
      <div className="action-row"><FeaturedProofLink />
        <Link href="/proof" className="button">Verify another proof</Link></div>
      <p className="hero-lede">Dependency configuration is not service health: ERC-8004 identity, 0G Compute, 0G Storage, RegistryV2, and AgentGateV2 are observed independently.</p></div>
    <aside className="guarantee-sheet"><span className="sheet-index">Architecture / process</span><h2>The admission chain</h2><ol><li>Identity</li><li>Checks</li><li>Compute</li><li>Storage</li><li>Lease</li><li>Gate</li></ol>
      <p>Illustrative sequence. Not live progress or service health. Only a current lease plus Gate <b>ALLOWED</b> means admitted.</p></aside>
  </div></section><section className="workspace-section"><div className="wrap"><div className="section-heading"><span className="eyebrow">Public Proof Ledger</span><h2>Inspect before you trust.</h2>
    <p>Browse recent finalized ProofLocks or reproduce one historical proof without an operator credential or paid inference.</p></div>
    <div className="principle-strip"><span>Identity-bound</span><span>Exact evidence</span><span>Fail closed</span></div></div></section>
  <section className="trust-section"><div className="wrap trust-grid"><div><span className="eyebrow">Trust boundary</span><h2>Honest by construction.</h2></div><div className="trust-copy">
    <p>ProofLock is policy-scoped admission, not a universal safety verdict. One disclosed validator controls writes. Deterministic and AI-assisted checks can miss semantic risks.</p>
    <p>History is versioned and append-preserved. Drift checks are on-demand. Legacy V1 attestations remain separately labeled and never satisfy current V2 admission.</p>
    <Link href="/proof" className="text-link">Verify a historical proof →</Link></div></div></section></>;
}
