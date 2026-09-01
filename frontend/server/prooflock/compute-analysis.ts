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
