// Composes the four analysis modules into one RiskEvidenceBundle for an address, and combines their
// signals into a final behavioral score + code risk. This is the seal-time deep-risk pipeline: real
// 0G on-chain evidence -> self-computed heuristics + threat intel + contract analysis -> a bundle the
// risk LLM reasons over. Everything is a seal-time snapshot, captured once and hashed into the proof.
import { collectAddressEvidence, createProductionEvidenceDeps, type EvidenceCollectorDeps } from "./evidence-collector";
import { computeHeuristics } from "./risk-heuristics";
import { checkThreatIntel, createProductionThreatDeps, type ThreatIntelDeps } from "./threat-intel";
import { analyzeContract } from "./contract-analysis";
import type { HeuristicSignals, RiskEvidenceBundle } from "./types";

export type RiskBundleDeps = Readonly<{
  evidence: EvidenceCollectorDeps;
  threat: ThreatIntelDeps;
  maxTxns?: number;
}>;

// Folds threat-intel signals into the heuristic vector and recomputes the behavioral score, so a
// hard signal (sanctioned / known scam) clamps the score to maximum regardless of activity shape.
export function foldThreatIntoHeuristics(heuristics: HeuristicSignals, threatSignals: HeuristicSignals["signals"]): HeuristicSignals {
  if (threatSignals.length === 0) return heuristics;
  const signals = [...heuristics.signals, ...threatSignals];
  const hard = signals.some((signal) => signal.hard);
  const score = hard ? 100
    : Math.round(100 * (1 - signals.reduce((acc, signal) => acc * (1 - signal.weight * signal.value), 1)));
  const factors = threatSignals.map((signal) => signal.label).concat(heuristics.factors);
  return Object.freeze({ signals, behavioralScore: Math.min(100, Math.max(0, score)),
    factors: Object.freeze(factors.slice(0, 6)) });
}

export async function collectRiskBundle(address: string, deps: RiskBundleDeps): Promise<RiskEvidenceBundle> {
  const evidence = await collectAddressEvidence(address, deps.evidence, { maxTxns: deps.maxTxns ?? 100 });
  const heuristics0 = computeHeuristics(evidence);
  const threat = await checkThreatIntel(address, deps.threat);
  const contract = analyzeContract({ isContract: evidence.isContract, code: evidence.code,
    source: evidence.source, sourceVerified: evidence.sourceVerified });
  const heuristics = foldThreatIntoHeuristics(heuristics0, threat.signals);
  return Object.freeze({
    address: evidence.address,
    isContract: evidence.isContract,
    nonce: evidence.nonce,
    observedAtBlock: evidence.observedAtBlock,
    heuristics,
    threat,
    contract,
    coverage: evidence.coverage,
  });
}

export function createProductionRiskBundleDeps(rpcUrl?: string, env: NodeJS.ProcessEnv = process.env): RiskBundleDeps {
  return { evidence: createProductionEvidenceDeps(rpcUrl), threat: createProductionThreatDeps(env) };
}

// The combined final scores from the bundle plus the LLM's own reading of it. The LLM reasons over
// the full evidence, but computed evidence must not be undercounted: take the MAX of the LLM score
// and the computed heuristic score, and a hard signal (sanctioned/scam/honeypot) clamps high.
export function combineBehavioralScore(bundle: RiskEvidenceBundle, llmScore: number): number {
  const hard = bundle.heuristics.signals.some((signal) => signal.hard)
    || bundle.contract.signals.some((signal) => signal.hard);
  let score = Math.max(llmScore, bundle.heuristics.behavioralScore);
  if (hard) score = Math.max(score, 90);
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function combineCodeRisk(bundle: RiskEvidenceBundle, deterministicCodeRisk: number, llmCodeRisk: number): number {
  return Math.min(2, Math.max(deterministicCodeRisk, bundle.contract.codeRisk, llmCodeRisk));
}

// A compact, LLM-friendly view of the bundle for the compute context (drops verbose raw arrays; keeps
// the computed signals + factors the model should reason over).
export function bundleForLlm(bundle: RiskEvidenceBundle) {
  return {
    address: bundle.address,
    isContract: bundle.isContract,
    nonce: bundle.nonce,
    heuristicScore: bundle.heuristics.behavioralScore,
    riskSignals: bundle.heuristics.signals.map((signal) => ({ id: signal.id, label: signal.label,
      strength: Number(signal.value.toFixed(2)), hard: signal.hard, detail: signal.detail })),
    threat: { sanctioned: bundle.threat.sanctioned, scamFlagged: bundle.threat.scamFlagged,
      sources: bundle.threat.sources },
    contract: { bytecodeFlags: bundle.contract.bytecodeFlags, sourceFindings: bundle.contract.sourceFindings,
      codeRisk: bundle.contract.codeRisk },
    evidenceCoverage: bundle.coverage,
  };
}
