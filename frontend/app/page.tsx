import Link from "next/link";
import { ScanInput } from "@/components/ScanInput";

export default function EvaluatePage() {
  return <><section className="ledger-hero"><div className="ledger-grid" aria-hidden="true" /><div className="wrap hero-ledger">
    <div><span className="eyebrow">ProofLock · 0G Mainnet · 16661</span><h1>Admission should be <em>provable.</em></h1>
      <p className="hero-lede">Sentinel resolves an ERC-8004 identity, binds its current wallet to typed checks and verified 0G evidence, then issues a seven-day lease that AgentGateV2 can enforce.</p>
      <div className="principle-strip"><span>Identity-bound</span><span>Exact evidence</span><span>Fail closed</span></div></div>
    <aside className="guarantee-sheet"><span className="sheet-index">PL / 01</span><h2>The admission chain</h2><ol><li>ERC-8004 identity</li><li>Deterministic evidence</li><li>Verified 0G Compute</li><li>Root-matched 0G Storage</li><li>Versioned on-chain lease</li><li>Stable Gate decision</li></ol>
      <p>Only a current lease plus Gate <b>ALLOWED</b> means admitted.</p></aside>
  </div></section><section className="workspace-section"><div className="wrap"><div className="section-heading"><span className="eyebrow">Operator workbench</span><h2>Resolve first. Evaluate second.</h2>
    <p>Public reads are open. Evaluation is a named, operator-authorized mutation with no fallback receipt and no hidden queue.</p></div><ScanInput /></div></section>
  <section className="trust-section"><div className="wrap trust-grid"><div><span className="eyebrow">Trust boundary</span><h2>Honest by construction.</h2></div><div className="trust-copy">
    <p>ProofLock is policy-scoped admission, not a universal safety verdict. One disclosed validator controls writes. Deterministic and AI-assisted checks can miss semantic risks.</p>
    <p>History is versioned and append-preserved. Drift checks are on-demand. Legacy V1 attestations remain separately labeled and never satisfy current V2 admission.</p>
    <Link href="/proof" className="text-link">Verify a historical proof →</Link></div></div></section></>;
}
