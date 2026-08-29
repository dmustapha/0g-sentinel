import { coverageItems } from "@/lib/prooflock-status";
import { StatusBadge } from "@/components/ui/StatusBadge";

export function ProofCoverageGrid({ basis = "current", coverage }: { basis?: "current" | "registry"; coverage?: number | null }) {
  if (coverage == null) return <section className="evidence-card coverage-card" aria-labelledby="coverage-title">
    <div className="card-row"><h3 id="coverage-title">Current coverage unavailable</h3>
      <StatusBadge status="UNAVAILABLE" surface="paper" /></div></section>;
  const items = coverageItems(coverage);
  return <section className="evidence-card coverage-card" aria-labelledby="coverage-title">
    <div className="card-row"><div><span className="card-kicker">{basis === "current" ? "Pinned current typed coverage" : "Registry coverage fallback · current unavailable"}</span><h3 id="coverage-title">Proof coverage</h3></div>
      <span className="coverage-total"><StatusBadge status={coverage === 0x7f ? "VERIFIED" : "UNAVAILABLE"} surface="paper" /> 0x{coverage.toString(16).padStart(2, "0")} / 0x7f</span></div>
    <div className="coverage-grid">{items.map((item) => <div className={`coverage-item ${item.covered ? "covered" : "missing"}`} key={item.bit}>
      <span aria-hidden="true">{item.covered ? "✓" : "—"}</span><div><b>{item.label}</b><small>{item.covered ? "Covered" : "Missing"} · 0x{item.bit.toString(16).padStart(2, "0")}</small></div>
    </div>)}</div>
    <p className="trust-note">Typed deterministic and AI-assisted coverage. Coverage is policy evidence, not a universal safety guarantee.</p>
  </section>;
}
