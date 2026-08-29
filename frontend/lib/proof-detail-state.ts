import { assertComputeCapability, assertObservation, observationStatusAt } from "./prooflock-observations";
import { safeDisplayText } from "./safe-display";
import type { LinkedHistoricalProof } from "./prooflock-routes";
import type {
  CurrentAccessV1, ObservationReasonCode, ObservationStatus, ProofLockDetailResponse,
  ProofLockObservation, VerifiedProof,
} from "./prooflock-types";

type HistoricalTerminal = LinkedHistoricalProof["status"];
type HistoricalObservation = Extract<ProofLockObservation, { scope: "HISTORICAL" }>;
type CurrentObservation = Extract<ProofLockObservation, { scope: "CURRENT" }>;
export type HistoricalPlaneView = Readonly<{
  status: HistoricalTerminal;
  observations: readonly HistoricalObservation[];
}> & ({ status: "MATCH"; proof: VerifiedProof } | { status: Exclude<HistoricalTerminal, "MATCH"> });

export type CurrentDecisionView = Readonly<{
  status: ObservationStatus;
  reason: string;
  observationBlockNumber: string;
  observedAt: string;
  freshnessExpiresAt: string;
  serverIssuedAt: string;
  ttlMs: number;
}>;

export type CurrentPlaneView = Readonly<{
  access: CurrentAccessV1;
  observations: readonly CurrentObservation[];
  decision: CurrentDecisionView;
}>;

type PendingHistorical = Readonly<{ status: "LOADING"; observations: readonly [] }>;
export type ProofDetailState = Readonly<{
  key: string;
  generation: number;
  route: Readonly<{ status: "LOADING" }> | Readonly<{
    status: "READY"; base: ProofLockDetailResponse;
  }> | Readonly<{ status: "ERROR"; message: string }>;
  historical: PendingHistorical | HistoricalPlaneView;
  current: Readonly<{
    snapshot: CurrentPlaneView | null;
    refresh: "IDLE" | "LOADING" | "REFRESHING" | "FAILED";
    error?: string;
  }>;
  nowMs: number;
}>;

export type ProofDetailAction =
  | Readonly<{ type: "START"; key: string; generation: number; nowMs: number }>
  | Readonly<{ type: "BASE_READY"; key: string; generation: number; base: ProofLockDetailResponse }>
  | Readonly<{ type: "ROUTE_FAILED"; key: string; generation: number; message: string }>
  | Readonly<{ type: "HISTORICAL_SETTLED"; key: string; generation: number; historical: HistoricalPlaneView }>
  | Readonly<{ type: "CURRENT_STARTED"; key: string; generation: number }>
  | Readonly<{ type: "CURRENT_SUCCEEDED"; key: string; generation: number; current: CurrentPlaneView; nowMs: number }>
  | Readonly<{ type: "CURRENT_FAILED"; key: string; generation: number; message: string }>
  | Readonly<{ type: "CLOCK_TICK"; nowMs: number }>;

const HISTORICAL_SUBSYSTEMS = ["identity", "checks", "compute", "storage", "registry"] as const;

export function mapHistoricalPlane(result: LinkedHistoricalProof, observedAt: string | null): HistoricalPlaneView {
  if (observedAt === null) return result.status === "MATCH"
    ? Object.freeze({ status: "MATCH", proof: result.proof, observations: Object.freeze([]) })
    : Object.freeze({ status: result.status, observations: Object.freeze([]) }) as HistoricalPlaneView;
  if (result.status !== "MATCH") return Object.freeze({ status: result.status,
    observations: historicalFailure(result.status, observedAt) }) as HistoricalPlaneView;
  const observations = [
    historicalVerified("identity", observedAt), historicalVerified("checks", observedAt),
    computeObservation(result.proof, observedAt), storageObservation(result.proof, observedAt),
    registryObservation(result.proof, observedAt),
  ];
  return Object.freeze({ status: "MATCH", proof: result.proof,
    observations: Object.freeze(observations) }) as HistoricalPlaneView;
}

export function mapCurrentPlane(access: CurrentAccessV1, nowMs: number): CurrentPlaneView {
  const entries = [access.observations.identity, access.observations.lease,
    access.observations.gate, access.observations.consumer];
  const observations = Object.freeze(entries.map(({ observation }) =>
    assertObservation(observation) as CurrentObservation));
  assertCurrentCoordinate(access, observations);
  return Object.freeze({ access, observations, decision: currentDecision(access, observations, entries, nowMs) });
}

export function initialProofDetailState(key: string, nowMs: number, generation = 0): ProofDetailState {
  return freezeState({ key, generation, route: { status: "LOADING" },
    historical: { status: "LOADING", observations: [] },
    current: { snapshot: null, refresh: "LOADING" }, nowMs });
}

export function proofDetailReducer(state: ProofDetailState, action: ProofDetailAction): ProofDetailState {
  if (action.type === "START") return initialProofDetailState(action.key, action.nowMs, action.generation);
  if (action.type === "CLOCK_TICK") return tickClock(state, action.nowMs);
  if (action.key !== state.key || action.generation !== state.generation) return state;
  if (action.type === "BASE_READY") return freezeState({ ...state, route: { status: "READY", base: action.base } });
  if (action.type === "ROUTE_FAILED") return freezeState({ ...state,
    route: { status: "ERROR", message: boundedError(action.message) } });
  if (action.type === "HISTORICAL_SETTLED") return freezeState({ ...state, historical: action.historical });
  if (action.type === "CURRENT_STARTED") return startCurrent(state);
  if (action.type === "CURRENT_SUCCEEDED") return freezeState({ ...state,
    current: { snapshot: action.current, refresh: "IDLE" }, nowMs: action.nowMs });
  return freezeState({ ...state, current: { ...state.current, refresh: "FAILED",
    error: boundedError(action.message) } });
}

export function currentRefreshDelay(access: CurrentAccessV1 | null, nowMs: number): number | null {
  if (!access) return null;
  const expiry = Date.parse(access.freshnessExpiresAt);
  return Number.isFinite(expiry) ? Math.min(2_147_483_647, Math.max(0, expiry - nowMs)) : 0;
}

export function safeSealedObservedAt(issuedAt: string): string | null {
  const date = new Date(Number(issuedAt) * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function historicalFailure(status: Exclude<HistoricalTerminal, "MATCH">, observedAt: string) {
  const mismatch = status === "MISMATCH";
  return Object.freeze(HISTORICAL_SUBSYSTEMS.map((subsystem) => assertObservation({
    scope: "HISTORICAL", subsystem, status: mismatch ? "MISMATCH" : "UNAVAILABLE",
    observedAt, reasonCode: mismatch ? "EVIDENCE_MISMATCH" : "EVIDENCE_UNAVAILABLE",
  }) as HistoricalObservation));
}

function historicalVerified(subsystem: "identity" | "checks", observedAt: string) {
  return assertObservation({ scope: "HISTORICAL", subsystem, status: "VERIFIED", observedAt }) as HistoricalObservation;
}

function computeObservation(proof: VerifiedProof, observedAt: string): ProofLockObservation {
  const candidates = proof.storage.computeVerification ?? [];
  for (const candidate of candidates) {
    try {
      const capability = assertComputeCapability(candidate);
      if (capability.boundHashes.artifactHash.toLowerCase() !== proof.proofLock.artifactHash.toLowerCase()) continue;
      if (!computeCapabilityMatchesEnvelope(capability, proof.storage.envelope)) continue;
      return assertObservation({ scope: "HISTORICAL", subsystem: "compute", status: "VERIFIED",
        observedAt, capability });
    } catch { /* try the next independently verified capability */ }
  }
  return historicalUnavailable("compute", observedAt, "COMPUTE_UNVERIFIED");
}

function computeCapabilityMatchesEnvelope(capability: ReturnType<typeof assertComputeCapability>,
  envelope: Readonly<Record<string, unknown>>): boolean {
  const candidates = envelope.computeProofs;
  if (!Array.isArray(candidates)) return false;
  const hashes = capability.boundHashes as Readonly<Record<string, string>>;
  return candidates.some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const proof = candidate as Readonly<Record<string, unknown>>;
    if (!sameText(proof.provider, capability.provider, true) ||
      !sameText(proof.model, capability.model, false) || proof.processResponseVerified !== true) return false;
    return ["receiptDigest", "requestDigest", "responseDigest", "signedTextSha256", "requestSha256",
      "rawResponseSha256", "responseHeadersSha256"].every((key) => sameText(proof[key], hashes[key], true));
  });
}

function sameText(left: unknown, right: unknown, caseInsensitive: boolean): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function storageObservation(proof: VerifiedProof, observedAt: string): ProofLockObservation {
  const uploadTxHash = proof.storage.storageCommitment?.uploadTxHash;
  try {
    return assertObservation({ scope: "HISTORICAL", subsystem: "storage", status: "VERIFIED", observedAt,
      storageRoot: proof.proofLock.storageRoot, artifactHash: proof.proofLock.artifactHash,
      storageUploadTxHash: uploadTxHash, registrySourceTxHash: proof.source.transactionHash,
      capability: { proofClass: "ROOT_MATCHED_NO_NETWORK_PROOF", retrievalVerified: true,
        networkProofVerified: proof.storage.networkProofVerified } });
  } catch { return historicalUnavailable("storage", observedAt, "STORAGE_UNVERIFIED"); }
}

function registryObservation(proof: VerifiedProof, observedAt: string): ProofLockObservation {
  try { return assertObservation({ scope: "HISTORICAL", subsystem: "registry", status: "VERIFIED",
    observedAt, registrySourceTxHash: proof.source.transactionHash }); }
  catch { return historicalUnavailable("registry", observedAt, "EVIDENCE_UNAVAILABLE"); }
}

function historicalUnavailable(subsystem: "compute" | "storage" | "registry", observedAt: string,
  reasonCode: ObservationReasonCode) {
  return assertObservation({ scope: "HISTORICAL", subsystem, status: "UNAVAILABLE", observedAt, reasonCode });
}

function currentDecision(access: CurrentAccessV1, observations: readonly CurrentObservation[],
  entries: readonly CurrentAccessV1["observations"][keyof CurrentAccessV1["observations"]][], nowMs: number) {
  const effective = observations.map((item) => observationStatusAt(item, nowMs));
  const precedence: ObservationStatus[] = ["MISMATCH", "STALE", "BLOCKED", "NOT_APPLICABLE", "UNAVAILABLE"];
  const status = precedence.find((candidate) => effective.includes(candidate)) ??
    (effective.every((candidate) => candidate === "VERIFIED") ? "VERIFIED" : "UNAVAILABLE");
  const index = effective.findIndex((candidate) => candidate === status);
  const reason = status === "VERIFIED" ? "ALLOWED" : status === "STALE" ? "OBSERVATION_EXPIRED"
    : String(entries[index]?.reason ?? status);
  return Object.freeze({ status, reason, observationBlockNumber: access.observationBlock.number,
    observedAt: access.observedAt, freshnessExpiresAt: access.freshnessExpiresAt,
    serverIssuedAt: observations[0]!.serverIssuedAt, ttlMs: observations[0]!.ttlMs });
}

function tickClock(state: ProofDetailState, nowMs: number): ProofDetailState {
  const snapshot = state.current.snapshot;
  return freezeState({ ...state, nowMs, current: snapshot ? {
    ...state.current, snapshot: mapCurrentPlane(snapshot.access, nowMs),
  } : state.current });
}

function assertCurrentCoordinate(access: CurrentAccessV1, observations: readonly CurrentObservation[]) {
  const serverIssuedAt = observations[0]?.serverIssuedAt;
  const expected = JSON.stringify([access.observationBlock.number, access.observationBlock.hash,
    access.observedAt, serverIssuedAt, access.freshnessExpiresAt]);
  for (const observation of observations) {
    const actual = JSON.stringify([observation.observationBlockNumber, observation.observationBlockHash,
      observation.observedAt, observation.serverIssuedAt, observation.freshnessExpiresAt]);
    if (actual !== expected) throw new TypeError("CURRENT observations must match the pinned access coordinate");
  }
}

function startCurrent(state: ProofDetailState): ProofDetailState {
  return freezeState({ ...state, current: { snapshot: state.current.snapshot,
    refresh: state.current.snapshot ? "REFRESHING" : "LOADING" } });
}

function boundedError(message: string): string {
  return safeDisplayText(message, { maxGraphemes: 256 });
}

function freezeState(state: ProofDetailState): ProofDetailState {
  return Object.freeze(state);
}
