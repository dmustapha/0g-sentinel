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

const STATUS_STYLE: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0,
};

export function StreamingScanPanel({ stages, failed }: Readonly<{
  stages: readonly RunnerStage[]; failed?: Readonly<{ stage: RunnerStage; code: string }>;
}>) {
  const current = failed ? failed.stage : stages.at(-1);
  const announcement = current ? `Current stage: ${LABELS[current]}${failed ? ` failed with ${failed.code}` : ""}.` : "";
  const writingChain = !failed && current === "WRITING_CHAIN";
  const total = PROOFLOCK_STAGES.length;
  const reachedCount = PROOFLOCK_STAGES.filter((stage) => stages.includes(stage)).length;
  const progress = total > 1 ? Math.max(0, reachedCount - 1) / (total - 1) : 0;
  return <section className="proof-ceremony bp-bracket" aria-label="ProofLock ceremony" data-writing={writingChain || undefined}>
    <span className="bp-corners" aria-hidden="true" />
    <div className="proof-ceremony-rail" aria-hidden="true"><div className="rail-line" />
      <div className="rail-advance" style={{ transform: `scaleY(${progress})` }} />
    {PROOFLOCK_STAGES.map((stage, index) => {
      const reached = stages.includes(stage); const isFailed = failed?.stage === stage;
      const complete = reached && current !== stage || stage === "SEALED" && reached && !failed;
      const state = isFailed ? "failed" : complete ? "complete" : reached ? "running" : "pending";
      const stageClass = state === "running" && stage === "WRITING_CHAIN" ? " stage-writing" : "";
      return <div className={`rail-stage ${state}${stageClass}`} key={stage} style={{ "--step": index } as React.CSSProperties}>
        <span className="rail-node" aria-hidden="true">{isFailed ? "×" : complete ? "✓" : reached ? "•" : index + 1}</span>
        <div><span className="stage-code">{stage}</span><b>{LABELS[stage]}</b>{isFailed && <small>{failed.code}</small>}</div>
      </div>;
    })}
    </div>
    <p role="status" style={STATUS_STYLE}>{announcement}</p>
    {failed && <div className="lease-stop state-bad"><b>Ceremony stopped.</b>{" "}
      Stage failed with <span className="mono">{failed.code}</span>. See the write outcome before retrying.</div>}
    {!failed && stages.includes("SEALED") && <div className="lease-stop state-good"><b>Policy-scoped admission active.</b> Chain read-back and Gate decision govern current access.</div>}
  </section>;
}
