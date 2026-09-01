import { gateReasonMeta, leaseStatus } from "@/lib/prooflock-status";
import type { GateReasonCode, LeaseStatus, ProofLockRecord } from "@/lib/prooflock-types";
import type { CurrentDecisionView, HistoricalPlaneView } from "@/lib/proof-detail-state";

// Plain-English translation layer. Turns reason codes, risk numbers, and coverage masks into
// sentences a non-technical reader can act on. Every phrase avoids em-dashes by contract.

export type VerdictTone = "good" | "caution" | "blocked" | "neutral";

export type AgentVerdict = Readonly<{
  tone: VerdictTone;
  // One short line rendered as the page verdict, e.g. "Admitted" or "No live access session".
  headline: string;
  // A plain sentence explaining the headline in everyday language.
  plain: string;
  // The stable reason code shown small, for developers. Empty when there is no code to show.
  technicalDetail: string;
}>;

// Friendly, non-alarming sentences per gate reason code. A benign "no live session" is neutral,
// never a scary red failure.
const GATE_PLAIN: Readonly<Record<GateReasonCode, string>> = {
  ALLOWED: "This agent currently holds an active, verified pass and is admitted.",
  NO_PROOF: "This agent has no admission pass on record yet.",
  REVOKED: "This agent's pass was withdrawn, so it is not admitted right now.",
  DRIFTED: "The agent changed since it was last checked, so its pass no longer applies.",
  EXPIRED: "The agent's time-limited pass has run out and needs to be renewed.",
  SUBJECT_CHANGED: "The agent's wallet changed, so the old pass no longer matches it.",
  RUNTIME_CODE_DRIFT: "The agent's running code changed since it was checked.",
  POLICY_TOO_OLD: "This pass was issued under an older safety policy and needs a fresh check.",
  COVERAGE_INCOMPLETE: "Not every safety check finished, so admission is on hold.",
  COMPUTE_UNVERIFIED: "The behavioral analysis could not be independently confirmed.",
  STORAGE_UNVERIFIED: "The saved evidence could not be independently confirmed.",
  BEHAVIORAL_RISK: "The agent's behavior scored too high on risk for the current policy.",
  CODE_RISK: "The agent's code scored too high on risk for the current policy.",
  IDENTITY_UNAVAILABLE: "The agent's identity could not be read at this moment.",
  AGENT_NOT_FOUND: "No agent was found for this identity.",
  AGENT_WALLET_UNSET: "This agent has not published a wallet to check against.",
  IDENTITY_MISMATCH: "The identity on file did not match the one being checked.",
  UNKNOWN_REASON: "The reason for this decision could not be read.",
};

// The neutral, reassuring copy used when no live access session is present at all.
const NO_SESSION: AgentVerdict = Object.freeze({
  tone: "neutral",
  headline: "No live access session right now",
  plain: "This is normal. No one is currently requesting live access for this agent. The agent's sealed evidence is shown below.",
  technicalDetail: "",
});

export function gatePlainSentence(reason: number): string {
  return GATE_PLAIN[gateReasonMeta(reason).code];
}

export type GateVerdictInput =
  | Readonly<{ status: "VERIFIED"; allowed: boolean; reason: number }>
  | Readonly<{ status: "UNKNOWN"; allowed: false; reason: null }>;

// Builds the single verdict banner. The AUTHORITATIVE admission answer is the AgentGateV2 decision
// (`gate`), which is exactly what a consumer contract gets from requireAgent. A missing live consumer
// session is benign and must NOT read as "not admitted": if the gate admits, the agent is admitted.
export function agentVerdict(input: Readonly<{
  agentId: string;
  gate?: GateVerdictInput;
  current: CurrentDecisionView | undefined;
  record: ProofLockRecord;
  nowSeconds?: number;
}>): AgentVerdict {
  const { gate, current, record } = input;
  const lease = safeLease(record, input.nowSeconds);
  // Prefer the gate decision when we have it.
  if (gate && gate.status === "VERIFIED") {
    if (gate.allowed) {
      return Object.freeze({
        tone: "good",
        headline: `Agent #${input.agentId} is admitted`,
        plain: "The gate admits this agent right now. Behavioral and code checks passed and its time-limited pass is still valid.",
        technicalDetail: "Gate reason ALLOWED",
      });
    }
    return Object.freeze({
      tone: "blocked",
      headline: `Agent #${input.agentId} is not admitted`,
      plain: gatePlainSentence(gate.reason),
      technicalDetail: `Gate reason ${gateReasonMeta(gate.reason).code}`,
    });
  }
  // No authoritative gate reading. A missing/unavailable live session is the reassuring neutral state,
  // not a denial (the sealed pass may be perfectly valid; nobody is requesting live access).
  if (!current || current.status === "UNAVAILABLE" || current.status === "BLOCKED") return NO_SESSION;
  if (current.status === "VERIFIED") {
    return Object.freeze({
      tone: "good",
      headline: `Agent #${input.agentId} is admitted`,
      plain: "This agent currently holds an active, verified pass. Behavioral and code checks passed and its time-limited pass is still valid.",
      technicalDetail: "Gate reason ALLOWED",
    });
  }
  const tone: VerdictTone = current.status === "STALE" ? "caution" : "blocked";
  return Object.freeze({
    tone,
    headline: tone === "caution"
      ? `Agent #${input.agentId}: reading is out of date`
      : `Agent #${input.agentId} is not admitted right now`,
    plain: currentReasonPlain(current.reason, lease),
    technicalDetail: `Status ${current.status}, reason ${safeReason(current.reason)}`,
  });
}

// A caption for the lease/pass fact in plain words.
export function leasePlain(status: LeaseStatus): Readonly<{ label: string; tone: VerdictTone; detail: string }> {
  switch (status) {
    case "ACTIVE": return { label: "Active pass", tone: "good", detail: "Its time-limited pass is valid." };
    case "EXPIRING": return { label: "Pass expiring soon", tone: "caution", detail: "Its pass is valid but runs out within a day." };
    case "EXPIRED": return { label: "Pass expired", tone: "blocked", detail: "Its time-limited pass has run out." };
    case "REVOKED": return { label: "Pass withdrawn", tone: "blocked", detail: "Its pass was revoked." };
    case "DRIFTED": return { label: "Agent changed", tone: "blocked", detail: "The agent changed after it was checked." };
    default: return { label: "Checks incomplete", tone: "caution", detail: "Not every safety check finished." };
  }
}

// Turns a 0-100 risk number into a band with plain wording. Higher means riskier.
export function riskBand(score: number, kind: "behavioral" | "code"): Readonly<{
  label: string; tone: VerdictTone; detail: string;
}> {
  const noun = kind === "behavioral" ? "behavioral risk" : "code risk";
  const clamped = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : null;
  if (clamped === null) return { label: `${cap(noun)} unknown`, tone: "neutral", detail: "No score was returned." };
  if (clamped <= 20) return { label: `Low ${noun}`, tone: "good", detail: `Score ${clamped} of 100.` };
  if (clamped <= 50) return { label: `Moderate ${noun}`, tone: "caution", detail: `Score ${clamped} of 100.` };
  if (clamped <= 75) return { label: `Elevated ${noun}`, tone: "caution", detail: `Score ${clamped} of 100.` };
  return { label: `High ${noun}`, tone: "blocked", detail: `Score ${clamped} of 100.` };
}

// Plain gloss of the coverage mask: how many of the 7 safety checks ran.
export function coverageGloss(coverage: number | null | undefined): Readonly<{ ran: number; total: number; complete: boolean }> {
  const total = 7;
  if (coverage == null || !Number.isFinite(coverage)) return { ran: 0, total, complete: false };
  let ran = 0;
  for (let bit = 0; bit < total; bit += 1) if ((coverage & (1 << bit)) !== 0) ran += 1;
  return { ran, total, complete: coverage === 0x7f };
}

function currentReasonPlain(reason: string, lease: LeaseStatus): string {
  const asNumber = Number(reason);
  if (Number.isInteger(asNumber) && String(asNumber) === reason) return gatePlainSentence(asNumber);
  if (reason === "OBSERVATION_EXPIRED") return "The last live reading has aged out. Refresh to check again.";
  return leasePlain(lease).detail;
}

function safeLease(record: ProofLockRecord, nowSeconds?: number): LeaseStatus {
  try { return leaseStatus(record, nowSeconds); } catch { return "INCOMPLETE"; }
}

function safeReason(reason: string): string {
  return reason.length > 0 && reason.length <= 40 ? reason : "unavailable";
}

function cap(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }

// Whether the historical sealed evidence verified cleanly, in plain words.
export function historicalPlain(historical: HistoricalPlaneView | null): Readonly<{ label: string; tone: VerdictTone }> {
  if (!historical) return { label: "Checking sealed evidence", tone: "neutral" };
  if (historical.status === "MATCH") return { label: "Sealed evidence verified", tone: "good" };
  return { label: "Sealed evidence not confirmed", tone: "caution" };
}
