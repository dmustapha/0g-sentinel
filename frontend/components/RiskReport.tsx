"use client";

// The one shared risk verdict surface, used by /scan and the agent detail page (and anywhere a seal's
// risk needs to be shown). It renders WHAT we found and WHY at a glance: the verdict + score, the
// plain-English summary, the threat-intelligence sources (OFAC / Chainalysis / ScamSniffer), the
// contract bytecode-safety flags, the key factors, and an expandable per-signal evidence breakdown.
// Everything past the summary is driven by evidence recovered from the sealed compute request, so a
// legacy seal without it degrades gracefully to the score + summary + factors.
import { useState } from "react";
import { safeDisplayText } from "@/lib/safe-display";
import { bytecodeFlagGloss, riskTone, toneMark } from "@/lib/risk-tone";
import type {
  ProofLockRiskAnalysis, ProofLockRiskEvidence, ProofLockRiskEvidenceSignal,
} from "@/lib/prooflock-types";

export function RiskReport({ analysis, density = "full" }: Readonly<{
  analysis: ProofLockRiskAnalysis;
  density?: "full" | "compact";
}>) {
  const tone = riskTone(analysis.label);
  const evidence = analysis.evidence ?? null;
  const factorLimit = density === "compact" ? 4 : 8;
  return (
    <section className="risk-report" data-tone={tone} data-density={density} aria-label="Risk report">
      <header className="risk-report__verdict">
        <span className="risk-report__mark" aria-hidden="true">{toneMark(tone)}</span>
        <span className="risk-report__label">{safeDisplayText(analysis.label, { maxGraphemes: 24 })}</span>
        <span className="risk-report__score">Risk {analysis.behavioralScore}<span className="risk-report__score-max">/100</span></span>
      </header>

      {analysis.behavioralSummary ? (
        <p className="risk-report__summary">{safeDisplayText(analysis.behavioralSummary, { maxGraphemes: 400 })}</p>
      ) : null}

      {evidence && evidence.sources.length ? <ThreatIntelRow evidence={evidence} /> : null}
      {evidence && (evidence.bytecodeFlags.length || evidence.sourceFindings.length)
        ? <ContractSafetyRow evidence={evidence} /> : null}

      {analysis.behavioralFactors.length ? (
        <ul className="risk-report__factors" aria-label="Key factors">
          {analysis.behavioralFactors.slice(0, factorLimit).map((factor, index) => (
            <li key={index}><bdi>{safeDisplayText(factor, { maxGraphemes: 200 })}</bdi></li>
          ))}
        </ul>
      ) : null}

      {evidence && evidence.signals.length ? <EvidenceSignals signals={evidence.signals} /> : null}

      {density === "full" && analysis.codeSummary ? (
        <div className="risk-report__code">
          <h4 className="risk-report__section-title">Contract code</h4>
          <p className="risk-report__summary">{safeDisplayText(analysis.codeSummary, { maxGraphemes: 400 })}</p>
          {analysis.codeFactors.length ? (
            <ul className="risk-report__factors">
              {analysis.codeFactors.slice(0, 6).map((factor, index) => (
                <li key={index}><bdi>{safeDisplayText(factor, { maxGraphemes: 200 })}</bdi></li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// OFAC / Chainalysis / ScamSniffer results as status badges. A red HIT is the visceral proof that the
// scanner is wired to real intelligence sources, not a toy scorer.
function ThreatIntelRow({ evidence }: Readonly<{ evidence: ProofLockRiskEvidence }>) {
  return (
    <div className="risk-report__block">
      <h4 className="risk-report__section-title">Threat intelligence</h4>
      <ul className="risk-badges">
        {evidence.sources.map((source, index) => {
          const badgeTone = source.status === "HIT" ? "blocked" : source.status === "CLEAR" ? "good" : "neutral";
          const statusText = source.status === "HIT" ? "✗ HIT" : source.status === "CLEAR" ? "✓ CLEAR" : "— n/a";
          return (
            <li key={index} className="risk-badge" data-tone={badgeTone}>
              <span className="risk-badge__name">{safeDisplayText(source.name, { maxGraphemes: 40 })}</span>
              <span className="risk-badge__status">{statusText}</span>
              {source.detail && source.status === "HIT"
                ? <span className="risk-badge__detail">{safeDisplayText(source.detail, { maxGraphemes: 120 })}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Contract bytecode flags (from the PUSH-aware opcode walker) + verified-source findings, as chips.
function ContractSafetyRow({ evidence }: Readonly<{ evidence: ProofLockRiskEvidence }>) {
  return (
    <div className="risk-report__block">
      <h4 className="risk-report__section-title">Contract safety</h4>
      {evidence.bytecodeFlags.length ? (
        <ul className="risk-chips">
          {evidence.bytecodeFlags.map((flag, index) => (
            <li key={index} className="risk-chip" data-tone="caution">
              {safeDisplayText(bytecodeFlagGloss(flag), { maxGraphemes: 80 })}
            </li>
          ))}
        </ul>
      ) : null}
      {evidence.sourceFindings.length ? (
        <ul className="risk-report__factors">
          {evidence.sourceFindings.slice(0, 6).map((finding, index) => (
            <li key={index}><bdi>{safeDisplayText(finding, { maxGraphemes: 200 })}</bdi></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// The auditable breakdown: every weighted signal behind the score, hard signals pinned first, each
// with its evidence detail. Turns "Risk 72/100" from an opaque number into a defensible list.
function EvidenceSignals({ signals }: Readonly<{ signals: readonly ProofLockRiskEvidenceSignal[] }>) {
  const [open, setOpen] = useState(false);
  const ordered = [...signals].sort((left, right) =>
    Number(right.hard) - Number(left.hard) || right.strength - left.strength);
  return (
    <div className="risk-report__signals">
      <button type="button" className="risk-report__toggle" onClick={() => setOpen((value) => !value)}
        aria-expanded={open}>
        {open ? "Hide" : "Show"} evidence ({signals.length} {signals.length === 1 ? "signal" : "signals"})
      </button>
      {open ? (
        <ul className="risk-signal-list">
          {ordered.map((signal, index) => (
            <li key={index} className="risk-signal" data-hard={signal.hard ? "true" : "false"}>
              <span className="risk-signal__label">{safeDisplayText(signal.label, { maxGraphemes: 120 })}</span>
              <span className="risk-signal__bar" aria-hidden="true">
                <span className="risk-signal__fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, signal.strength)) * 100)}%` }} />
              </span>
              {signal.detail
                ? <span className="risk-signal__detail">{safeDisplayText(signal.detail, { maxGraphemes: 120 })}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
