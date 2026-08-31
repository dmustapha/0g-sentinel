import { ScanConsole } from "@/components/ScanConsole";

export default function ScanPage() {
  return (
    <section className="workspace-section scan-page">
      <div className="wrap">
        <div className="section-heading">
          <span className="eyebrow">Scan any 0G agent</span>
          <h1>Scan an agent. Seal the proof.</h1>
          <p>
            Scanning an agent runs behavioral and code risk through 0G Compute and seals a gated,
            drift-aware admission attestation on chain. The ceremony resolves the ERC-8004 identity,
            verifies exact 0G Storage evidence, issues a versioned lease, and reads the AgentGateV2
            decision back from chain.
          </p>
        </div>

        <section className="trust-disclosure" aria-labelledby="scan-architecture-heading">
          <span className="eyebrow" id="scan-architecture-heading">Architecture / process</span>
          <p>Illustrative sequence. Only a current lease plus Gate ALLOWED means admitted.</p>
          <div className="principle-strip" aria-label="Identity, Checks, Compute, Storage, Lease, Gate">
            <span>Identity</span><span>Checks</span><span>Compute</span>
            <span>Storage</span><span>Lease</span><span>Gate</span>
          </div>
        </section>

        <ScanConsole />
      </div>
    </section>
  );
}
