import { z } from "zod";

// Human-readable risk analysis extracted from the enclave-SIGNED compute response content. Because
// the reasoning lives inside the signed inference output (bound by the compute proof signature and
// re-verified offline), surfacing it is tamper-proof, not a display-time fabrication. This restores
// v1's plain-English "what we found and why" while keeping v2's exact-binding guarantees.

const boundedSentence = z.string().trim().min(1).max(400);
const analysisSchema = z
  .object({
    riskScore: z.number().int().min(0).max(100),
    summary: boundedSentence.optional(),
    factors: z.array(z.string().trim().min(1).max(160)).max(32).optional(),
  })
  .passthrough();

export type ComputeAnalysis = Readonly<{
  riskScore: number;
  summary: string | null;
  factors: readonly string[];
}>;

// Parses the inner JSON verdict the model returns (e.g. {"riskScore":12,"summary":"…","factors":[…]}).
// Tolerates a missing summary/factors so an older or terse response still yields the score.
export function parseComputeAnalysis(content: string): ComputeAnalysis {
  let value: unknown;
  try { value = JSON.parse(content); }
  catch { throw new Error("compute analysis content is not JSON"); }
  const parsed = analysisSchema.parse(value);
  return Object.freeze({
    riskScore: parsed.riskScore,
    summary: parsed.summary ?? null,
    factors: Object.freeze((parsed.factors ?? []).slice(0, 6)),
  });
}

// Best-effort variant for the read/display layer: never throws, so a malformed historical response
// degrades to "no narrative" rather than breaking the detail page.
export function safeComputeAnalysis(content: string | undefined | null): ComputeAnalysis | null {
  if (!content) return null;
  try { return parseComputeAnalysis(content); }
  catch { return null; }
}

// Pulls the model's content string out of a stored raw chat-completions response body.
export function contentFromResponseBytes(base64Body: string | undefined | null): string | null {
  if (!base64Body) return null;
  try {
    const json = JSON.parse(Buffer.from(base64Body, "base64").toString("utf8"));
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : null;
  } catch { return null; }
}

// The structured risk EVIDENCE the model reasoned over: threat-intel source results, contract
// bytecode flags, and per-signal evidence. This is already sealed inside the compute REQUEST body
// (the canonicalized context the enclave signed over), so surfacing it is tamper-evident, not a
// display fabrication. buildRiskAnalysis discarded it before; this recovers it for the UI.
const evidenceSourceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  status: z.enum(["HIT", "CLEAR", "UNAVAILABLE"]),
  detail: z.string().trim().max(240).optional(),
});
const evidenceSignalSchema = z.object({
  id: z.string().trim().max(60).optional(),
  label: z.string().trim().min(1).max(160),
  strength: z.number().min(0).max(1).optional(),
  hard: z.boolean().optional(),
  detail: z.string().trim().max(240).optional(),
});
// Mirrors bundleForLlm() (risk-bundle.ts): threat.{sanctioned,scamFlagged,sources}, contract.
// {bytecodeFlags,sourceFindings}, riskSignals[]. Everything optional so a terse/legacy seal degrades.
const riskEvidenceSchema = z.object({
  threat: z.object({
    sanctioned: z.boolean().optional(),
    scamFlagged: z.boolean().optional(),
    sources: z.array(evidenceSourceSchema).max(12).optional(),
  }).optional(),
  contract: z.object({
    bytecodeFlags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
    sourceFindings: z.array(z.string().trim().min(1).max(240)).max(24).optional(),
  }).optional(),
  riskSignals: z.array(evidenceSignalSchema).max(32).optional(),
}).passthrough();

export type RiskEvidenceSource = Readonly<{ name: string; status: "HIT" | "CLEAR" | "UNAVAILABLE"; detail?: string }>;
export type RiskEvidenceSignal = Readonly<{ label: string; strength: number; hard: boolean; detail?: string }>;
export type RiskEvidence = Readonly<{
  sanctioned: boolean;
  scamFlagged: boolean;
  sources: readonly RiskEvidenceSource[];
  bytecodeFlags: readonly string[];
  sourceFindings: readonly string[];
  signals: readonly RiskEvidenceSignal[];
}>;

// Best-effort: decode the sealed compute REQUEST body -> user message -> canonical context ->
// riskEvidence. Never throws; returns null when the field is absent (e.g. a legacy seal) so the UI
// degrades to the collapsed score/summary view.
export function safeRiskEvidence(base64Body: string | undefined | null): RiskEvidence | null {
  if (!base64Body) return null;
  try {
    const request = JSON.parse(Buffer.from(base64Body, "base64").toString("utf8"));
    const messages: unknown = request?.messages;
    const userMessage = Array.isArray(messages)
      ? messages.find((message) => (message as { role?: string })?.role === "user") : null;
    const content = (userMessage as { content?: unknown })?.content;
    if (typeof content !== "string") return null;
    const context = JSON.parse(content);
    const evidence = context?.riskEvidence;
    if (!evidence || typeof evidence !== "object") return null;
    const parsed = riskEvidenceSchema.parse(evidence);
    const signals = (parsed.riskSignals ?? []).map((signal) => Object.freeze({
      label: signal.label,
      strength: signal.strength ?? 0,
      hard: signal.hard ?? false,
      ...(signal.detail ? { detail: signal.detail } : {}),
    }));
    return Object.freeze({
      sanctioned: parsed.threat?.sanctioned ?? false,
      scamFlagged: parsed.threat?.scamFlagged ?? false,
      sources: Object.freeze((parsed.threat?.sources ?? []).map((source) => Object.freeze({
        name: source.name, status: source.status,
        ...(source.detail ? { detail: source.detail } : {}),
      }))),
      bytecodeFlags: Object.freeze([...(parsed.contract?.bytecodeFlags ?? [])]),
      sourceFindings: Object.freeze([...(parsed.contract?.sourceFindings ?? [])]),
      signals: Object.freeze(signals),
    });
  } catch { return null; }
}
