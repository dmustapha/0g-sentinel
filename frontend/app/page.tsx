import Link from "next/link";
import type { Metadata } from "next";
import { FeaturedProofLink } from "@/components/FeaturedProofLink";
import { HeroSchematic } from "@/components/HeroSchematic";

export const metadata: Metadata = {
  title: "0G Sentinel — Is this agent safe to trust?",
  description: "Scan any AI agent on 0G against sanctions and scam-blocklist intelligence, check its contract code, and seal the verdict on-chain so anyone can verify it.",
};

export default function OverviewPage({ searchParams = {} }: Readonly<{
  searchParams?: Readonly<{ __prooflock_e2e_error?: string | readonly string[] }>;
}>) {
  if (process.env.PROOFLOCK_E2E_ERROR_TRIGGER === "enabled"
    && searchParams.__prooflock_e2e_error === "1") {
    throw new Error("Deterministic ProofLock E2E error boundary trigger");
  }
  return <><section className="ledger-hero"><div className="ledger-grid" aria-hidden="true" /><div className="wrap hero-ledger">
    <div><span className="eyebrow hero-enter" style={{ animationDelay: "0ms" }}>0G agent trust · Chain ID 16661</span><h1 className="hero-enter" style={{ animationDelay: "70ms" }}>Is this agent safe to <em>trust?</em></h1>
      <p className="hero-lede hero-enter" style={{ animationDelay: "140ms" }}>Scan any AI agent on 0G. Sentinel checks it against real sanctions and scam-blocklist intelligence, reads its contract code, and seals the verdict on-chain so anyone can check your work.</p>
      <div className="action-row hero-enter" style={{ animationDelay: "210ms" }}><Link href="/scan" className="button">Scan an agent</Link><FeaturedProofLink />
        <Link href="/proof" className="button">Verify another proof</Link></div>
      <p className="hero-lede hero-enter" style={{ animationDelay: "210ms" }}>Every scan screens OFAC sanctions, Chainalysis, and ScamSniffer, and disassembles the agent's contract bytecode, then seals the full evidence on 0G Storage. A verdict you can check, not a vibe you have to trust.</p></div>
    <aside className="guarantee-sheet bp-bracket hero-enter" style={{ animationDelay: "280ms" }}><span className="bp-corners" aria-hidden="true" /><span className="sheet-index">Architecture / process</span><h2>The admission chain</h2>
      <HeroSchematic />
      <ol className="sr-only"><li>Identity</li><li>Checks</li><li>Compute</li><li>Storage</li><li>Lease</li><li>Gate</li></ol>
      <p>Illustrative sequence. Not live progress or service health. Only a current lease plus Gate <b>ALLOWED</b> means admitted.</p></aside>
  </div></section><section className="workspace-section"><div className="wrap"><div className="section-heading"><span className="eyebrow">Public proof ledger</span><h2>Check the work yourself.</h2>
    <p>Every verdict is sealed on 0G with its full evidence. Browse recent scans, or re-open any past proof and reproduce it yourself — no login, no paid inference.</p></div>
    <div className="principle-strip"><span>Bound to a real identity</span><span>Evidence you can re-check</span><span>Fails safe, never silent</span></div></div></section>
  <section className="trust-section"><div className="wrap trust-grid"><div><span className="eyebrow">What this is (and isn't)</span><h2>Honest about its limits.</h2></div><div className="trust-copy">
    <p>Sentinel scores how risky an agent looks right now — it is not a guarantee of safety. It ties the verdict to the agent's real on-chain identity and wallet, and both the automated and AI checks can still miss things.</p>
    <p>Every verdict is versioned and kept, so history can't be quietly rewritten. Older V1 records stay clearly labeled and never count as a current pass.</p>
    <Link href="/proof" className="text-link">Verify a past proof yourself →</Link></div></div></section></>;
}
