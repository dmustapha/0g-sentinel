import { coverageItems } from "@/lib/prooflock-status";

export function ProofCoverageGrid({ coverage }: { coverage: number }) {
  const items = coverageItems(coverage);
  return <section className="evidence-card coverage-card" aria-labelledby="coverage-title">
    <div className="card-row"><div><span className="card-kicker">Typed coverage</span><h3 id="coverage-title">Proof coverage</h3></div>
      <span className={`coverage-total ${coverage === 0x7f ? "state-good" : "state-warn"}`}>0x{coverage.toString(16).padStart(2, "0")} / 0x7f</span></div>
    <div className="coverage-grid">{items.map((item) => <div className={`coverage-item ${item.covered ? "covered" : "missing"}`} key={item.bit}>
      <span aria-hidden="true">{item.covered ? "✓" : "—"}</span><div><b>{item.label}</b><small>{item.covered ? "Covered" : "Missing"} · 0x{item.bit.toString(16).padStart(2, "0")}</small></div>
    </div>)}</div>
    <p className="trust-note">Typed deterministic and AI-assisted coverage. Coverage is policy evidence, not a universal safety guarantee.</p>
  </section>;
}
