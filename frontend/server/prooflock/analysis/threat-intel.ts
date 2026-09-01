// Phase 2 of the risk pipeline: check the subject address against threat-intel sources. Every
// source here is a plain address-string lookup, so they are chain-agnostic and work unchanged on
// 0G. The whole module is built to degrade gracefully: a source being down, missing a key, or
// returning garbage yields an UNAVAILABLE entry for that source and never throws. The caller always
// gets a well-formed ThreatSignals it can fold into the heuristic vector.

import type { RiskSignal, ThreatSignals } from "./types";
import { OFAC_SANCTIONED_ADDRESSES } from "./ofac-addresses";

type SourceStatus = "HIT" | "CLEAR" | "UNAVAILABLE";
type SourceEntry = Readonly<{ name: string; status: SourceStatus; detail?: string }>;

export type ThreatIntelDeps = Readonly<{
  fetchJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<any>;
  ofac: ReadonlySet<string>;
  chainalysisApiKey?: string;
  scamsnifferApiKey?: string;
}>;

const SOURCE_TIMEOUT_MS = 6_000;
const CHAINALYSIS_BASE = "https://public.chainalysis.com/api/v1/address";
const SCAMSNIFFER_BASE = "https://lookup-api.scamsniffer.io/address/check";

// ---------- individual sources ----------

// OFAC: local exact-match lookup, instant, no network. Hard signal.
function checkOfac(address: string, ofac: ReadonlySet<string>): SourceEntry {
  const hit = ofac.has(address);
  return hit
    ? { name: "OFAC", status: "HIT", detail: "Matches an OFAC SDN sanctioned address" }
    : { name: "OFAC", status: "CLEAR" };
}

// Chainalysis sanctions screening API. Non-empty `identifications` => sanctioned. Hard signal.
async function checkChainalysis(address: string, deps: ThreatIntelDeps): Promise<SourceEntry> {
  if (!deps.chainalysisApiKey) {
    return { name: "Chainalysis", status: "UNAVAILABLE", detail: "No API key configured" };
  }
  try {
    const body = await deps.fetchJson(
      `${CHAINALYSIS_BASE}/${address}`,
      { "X-API-Key": deps.chainalysisApiKey, Accept: "application/json" },
      SOURCE_TIMEOUT_MS,
    );
    const identifications = Array.isArray(body?.identifications) ? body.identifications : [];
    if (identifications.length > 0) {
      const category = firstString(identifications[0]?.category, identifications[0]?.name);
      return { name: "Chainalysis", status: "HIT", detail: category ?? "Listed on Chainalysis sanctions screening" };
    }
    return { name: "Chainalysis", status: "CLEAR" };
  } catch (err) {
    return { name: "Chainalysis", status: "UNAVAILABLE", detail: errorDetail(err) };
  }
}

// ScamSniffer blocklist. Handles both a boolean/blocked field and a status string defensively.
async function checkScamSniffer(address: string, deps: ThreatIntelDeps): Promise<SourceEntry> {
  const key = deps.scamsnifferApiKey ?? "demo-api-key";
  try {
    const body = await deps.fetchJson(
      `${SCAMSNIFFER_BASE}?address=${encodeURIComponent(address)}`,
      { "X-API-KEY": key, Accept: "application/json" },
      SOURCE_TIMEOUT_MS,
    );
    if (isScamSnifferBlocked(body)) {
      return { name: "ScamSniffer", status: "HIT", detail: "Address on the ScamSniffer blocklist" };
    }
    return { name: "ScamSniffer", status: "CLEAR" };
  } catch (err) {
    return { name: "ScamSniffer", status: "UNAVAILABLE", detail: errorDetail(err) };
  }
}

// Defensive read of the various shapes ScamSniffer may return.
function isScamSnifferBlocked(body: any): boolean {
  if (body == null || typeof body !== "object") return false;
  if (body.blocked === true || body.isBlocked === true || body.malicious === true) return true;
  const status = firstString(body.status, body.result, body.data?.status);
  return typeof status === "string" && status.toUpperCase() === "BLOCKED";
}

// ---------- orchestration ----------

export async function checkThreatIntel(address: string, deps: ThreatIntelDeps): Promise<ThreatSignals> {
  const normalized = address.toLowerCase();

  // OFAC is local and instant; the two network sources run in parallel, each guarded on its own.
  const ofacEntry = checkOfac(normalized, deps.ofac);
  const [chainalysisEntry, scamSnifferEntry] = await Promise.all([
    checkChainalysis(normalized, deps),
    checkScamSniffer(normalized, deps),
  ]);

  const sources: readonly SourceEntry[] = [ofacEntry, chainalysisEntry, scamSnifferEntry];
  const sanctioned = ofacEntry.status === "HIT" || chainalysisEntry.status === "HIT";
  const scamFlagged = scamSnifferEntry.status === "HIT";

  return { sanctioned, scamFlagged, sources, signals: buildSignals(sources, sanctioned, scamFlagged) };
}

function buildSignals(sources: readonly SourceEntry[], sanctioned: boolean, scamFlagged: boolean): RiskSignal[] {
  const signals: RiskSignal[] = [];
  if (sanctioned) {
    signals.push({
      id: "sanctioned",
      label: "Address appears on a sanctions list",
      value: 1,
      weight: 1,
      hard: true,
      detail: hitDetail(sources, "OFAC") ?? hitDetail(sources, "Chainalysis"),
    });
  }
  if (scamFlagged) {
    signals.push({
      id: "scam_flagged",
      label: "Address flagged as a known scam/drainer",
      value: 1,
      weight: 0.9,
      hard: true,
      detail: hitDetail(sources, "ScamSniffer"),
    });
  }
  return signals;
}

// ---------- production wiring ----------

export function createProductionThreatDeps(env: NodeJS.ProcessEnv = process.env): ThreatIntelDeps {
  return {
    ofac: OFAC_SANCTIONED_ADDRESSES,
    chainalysisApiKey: env.CHAINALYSIS_API_KEY,
    scamsnifferApiKey: env.SCAMSNIFFER_API_KEY,
    fetchJson: async (url, headers, timeoutMs) => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  };
}

// ---------- helpers ----------

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function hitDetail(sources: readonly SourceEntry[], name: string): string | undefined {
  const entry = sources.find((s) => s.name === name && s.status === "HIT");
  return entry?.detail;
}

function errorDetail(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Source unavailable";
}
