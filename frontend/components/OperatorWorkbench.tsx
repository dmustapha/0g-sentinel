"use client";

import { RescanButton } from "./RescanButton";
import { ScanInput } from "./ScanInput";

export function OperatorWorkbench({ initialAgentId = "" }: Readonly<{ initialAgentId?: string }>) {
  return <section className="workspace-section"><div className="wrap">
    <div className="section-heading"><span className="eyebrow">Operator workbench</span>
      <h1>Resolve first. Mutate second.</h1>
      <p><b>Named operator authority.</b> Sealing, drift marking, resealing, and recovery require the configured validator.</p>
      <p><b>Paid 0G Compute and Storage work.</b> Starting a seal or reseal can reserve budget and create durable operation state before a Registry transaction exists.</p>
      <p>Recovery is commitment-bound and read-only. Recover an uncertain operation before starting another paid attempt.</p>
    </div>
    <div className="evaluate-workbench">
      <section className="trust-disclosure bp-bracket" aria-labelledby="operator-architecture-heading">
        <span className="bp-corners" aria-hidden="true" />
        <span className="eyebrow" id="operator-architecture-heading">Architecture / process</span>
        <p>Illustrative sequence. Not live progress or service health.</p>
        <div className="principle-strip" aria-label="Identity, Checks, Compute, Storage, Lease, Gate">
          <span>Identity</span><span>Checks</span><span>Compute</span>
          <span>Storage</span><span>Lease</span><span>Gate</span>
        </div>
      </section>
      <ScanInput key={initialAgentId || "operator-empty"} initialAgentId={initialAgentId}
        renderExisting={({ identity, record, previousProofId, refresh }) =>
        <RescanButton identity={identity} record={record} previousProofId={previousProofId} onComplete={refresh} />} />
    </div>
  </div></section>;
}
