import { leaseStatus } from "@/lib/prooflock-status";
import { safeDisplayText } from "@/lib/safe-display";
import {
  agentVerdict, coverageGloss, historicalPlain, leasePlain, riskBand,
} from "@/lib/prooflock-verdict";
import type { CurrentDecisionView, HistoricalPlaneView } from "@/lib/proof-detail-state";
import type { LeaseStatus, ProofLockRecord, ProofLockRiskAnalysis } from "@/lib/prooflock-types";

// The plain-English verdict banner. Replaces the old raw status token as the visual hero: a
// non-technical reader learns "is this agent safe / can I trust it" in one line.
export function SummaryVerdict({ agentId, current, record, historical, nowSeconds }: Readonly<{
  agentId: string;
  current: CurrentDecisionView | undefined;
  record: ProofLockRecord;
  historical: HistoricalPlaneView | null;
  nowSeconds?: number;
}>) {
  const verdict = agentVerdict({ agentId, current, record, nowSeconds });
  const sealed = historicalPlain(historical);
  return (
    <section className="summary-verdict" data-tone={verdict.tone} aria-labelledby="agent-verdict">
      <div className="summary-verdict__head">
        <span className="summary-verdict__eyebrow">Trust summary</span>
        <span className="summary-verdict__chip" data-tone={sealed.tone}>{sealed.label}</span>
      </div>
      <h1 id="agent-verdict" className="summary-verdict__headline">
        <span className="summary-verdict__mark" aria-hidden="true">{toneMark(verdict.tone)}</span>
        <span aria-label={`Agent #${agentId}, ${verdict.headline}`}>{verdict.headline}</span>
      </h1>
      <p className="summary-verdict__plain">{verdict.plain}</p>
      {verdict.technicalDetail ? (
        <p className="summary-verdict__detail">
          <span className="summary-verdict__detail-label">Technical detail:</span>{" "}
          <bdi>{verdict.technicalDetail}</bdi>
        </p>
      ) : null}
    </section>
  );
}

// Three plain facts plus the restored plain-English reasoning. This is the single most important
// user-facing block: what we found and why, in words, before any hash appears.
export function AgentSummaryCard({ record, current, analysis, nowSeconds }: Readonly<{
  record: ProofLockRecord;
  current: CurrentDecisionView | undefined;
  analysis: ProofLockRiskAnalysis | undefined;
  nowSeconds?: number;
}>) {
  const lease = safeLease(record, nowSeconds);
  const leaseFact = leasePlain(lease);
  const behavioral = riskBand(analysis?.behavioralScore ?? record.behavioralScore, "behavioral");
  const code = riskBand(analysis?.codeRisk ?? record.codeRisk, "code");
  const coverage = coverageGloss(current ? currentCoverage(current, record) : record.coverage);
  return (
    <section className="summary-card" aria-labelledby="summary-card-title">
      <h2 id="summary-card-title" className="summary-card__title">What we found</h2>
      <ul className="summary-facts">
        <SummaryFact tone={behavioral.tone} label={behavioral.label} detail={behavioral.detail} />
        <SummaryFact tone={code.tone} label={code.label} detail={code.detail} />
        <SummaryFact tone={leaseFact.tone} label={leaseFact.label} detail={leaseFact.detail} />
        <SummaryFact tone={coverage.complete ? "good" : "caution"}
          label={`Safety checks: ${coverage.ran} of ${coverage.total}`}
          detail={coverage.complete ? "Every check ran." : "Some checks did not run."} />
      </ul>
      <ReasoningBlock analysis={analysis} />
    </section>
  );
}

function ReasoningBlock({ analysis }: Readonly<{ analysis: ProofLockRiskAnalysis | undefined }>) {
  if (!analysis) {
    return <p className="summary-card__fallback">Detailed reasoning is not available for this seal.</p>;
  }
  return (
    <div className="summary-reasoning">
      <ReasoningColumn title="Behavior"
        summary={analysis.behavioralSummary} factors={analysis.behavioralFactors} />
      <ReasoningColumn title="Code"
        summary={analysis.codeSummary} factors={analysis.codeFactors} />
    </div>
  );
}

function ReasoningColumn({ title, summary, factors }: Readonly<{
  title: string; summary: string | null; factors: readonly string[];
}>) {
  return (
    <div className="summary-reasoning__col">
      <h3 className="summary-reasoning__title">{title}</h3>
      <p className="summary-reasoning__summary">
        {summary ? safeDisplayText(summary, { maxGraphemes: 400 }) : "No summary was provided."}
      </p>
      {factors.length ? (
        <ul className="summary-reasoning__factors">
          {factors.slice(0, 12).map((factor, index) => (
            <li key={index}><bdi>{safeDisplayText(factor, { maxGraphemes: 200 })}</bdi></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SummaryFact({ tone, label, detail }: Readonly<{ tone: string; label: string; detail: string }>) {
  return (
    <li className="summary-fact" data-tone={tone}>
      <span className="summary-fact__mark" aria-hidden="true">{toneMark(tone)}</span>
      <span className="summary-fact__body">
        <b className="summary-fact__label">{label}</b>
        <span className="summary-fact__detail">{detail}</span>
      </span>
    </li>
  );
}

function toneMark(tone: string): string {
  if (tone === "good") return "✓";
  if (tone === "blocked") return "×";
  if (tone === "caution") return "!";
  return "•";
}

function currentCoverage(_current: CurrentDecisionView, record: ProofLockRecord): number {
  return record.coverage;
}

function safeLease(record: ProofLockRecord, nowSeconds?: number): LeaseStatus {
  try { return leaseStatus(record, nowSeconds); } catch { return "INCOMPLETE"; }
}
