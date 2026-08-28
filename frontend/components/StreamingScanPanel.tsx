import type { RunnerStage } from "@/lib/prooflock-types";

export const PROOFLOCK_STAGES: readonly RunnerStage[] = [
  "VALIDATING_IDENTITY", "CLASSIFYING_SUBJECT", "RUNNING_DETERMINISTIC_CHECKS",
  "RUNNING_COMPUTE", "CANONICALIZING_EVIDENCE", "UPLOADING_STORAGE",
  "VERIFYING_STORAGE", "WRITING_CHAIN", "READING_CHAIN_BACK", "SEALED",
];

const LABELS: Record<RunnerStage, string> = {
  VALIDATING_IDENTITY: "Resolve ERC-8004 identity", CLASSIFYING_SUBJECT: "Classify current agent wallet",
  RUNNING_DETERMINISTIC_CHECKS: "Run typed deterministic checks", RUNNING_COMPUTE: "Verify 0G Compute inference",
  CANONICALIZING_EVIDENCE: "Canonicalize evidence envelope", UPLOADING_STORAGE: "Upload exact bytes to 0G Storage",
  VERIFYING_STORAGE: "Retrieve and root-match evidence", WRITING_CHAIN: "Issue versioned admission lease",
  READING_CHAIN_BACK: "Read current lease back from chain", SEALED: "Evaluate AgentGateV2",
};

export function StreamingScanPanel({ stages, failed }: Readonly<{
  stages: readonly RunnerStage[]; failed?: Readonly<{ stage: RunnerStage; code: string }>;
}>) {
  const current = failed ? failed.stage : stages.at(-1);
  return <section className="proof-ceremony" aria-label="ProofLock ceremony" aria-live="polite">
    <div className="rail-line" aria-hidden="true" />
    {PROOFLOCK_STAGES.map((stage, index) => {
      const reached = stages.includes(stage); const isFailed = failed?.stage === stage;
      const complete = reached && current !== stage || stage === "SEALED" && reached && !failed;
      const state = isFailed ? "failed" : complete ? "complete" : reached ? "running" : "pending";
      return <div className={`rail-stage ${state}`} key={stage} style={{ "--step": index } as React.CSSProperties}>
        <span className="rail-node" aria-hidden="true">{isFailed ? "×" : complete ? "✓" : reached ? "•" : index + 1}</span>
        <div><span className="stage-code">{stage}</span><b>{LABELS[stage]}</b>{isFailed && <small>{failed.code}</small>}</div>
      </div>;
    })}
    {failed && <div className="lease-stop state-bad"><b>No lease issued.</b> Mandatory stage failed with <span className="mono">{failed.code}</span>.</div>}
    {!failed && stages.includes("SEALED") && <div className="lease-stop state-good"><b>Policy-scoped admission active.</b> Chain read-back and Gate decision govern current access.</div>}
  </section>;
}
