import { AbiCoder, keccak256 } from "ethers";
import type { Page, Route } from "@playwright/test";
import { computeProofId } from "../../lib/prooflock-client";
import type { CanonicalIdentity, HealthSnapshot, ProofLockDetail, ProofLockDiscoveryResponse,
  ProofLockRecord, VerifiedProof } from "../../lib/prooflock-types";

const hex32 = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const registryAddress = `0x${"88".repeat(20)}` as `0x${string}`;
const identityRegistryAddress = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" as const;
const subject = `0x${"33".repeat(20)}` as `0x${string}`;
const consumerAddress = `0x${"99".repeat(20)}` as `0x${string}`;
const agentId = "7";
const fixtureEpochMs = Date.now();
const leaseEpochSeconds = 1_788_134_400;
const identityKey = keccak256(AbiCoder.defaultAbiCoder().encode(
  ["uint256", "address", "uint256"], [16661, identityRegistryAddress, 7n],
)) as `0x${string}`;
const baseRecord = proofLockRecord();

export const fixtureIds = Object.freeze({
  agentId, registryAddress, identityRegistryAddress, subject, consumerAddress, identityKey,
  proofId: computeProofId(registryAddress, baseRecord),
  transactionHash: hex32("c"), recoveryId: "rec_1234567890abcdef",
});

export const primaryRoutes = Object.freeze([
  { name: "landing", path: "/", heading: "Is this agent safe to trust" },
  { name: "inventory", path: "/agents", heading: "Recent ProofLocks" },
  { name: "agent-detail", path: `/agents/${agentId}`, heading: `Agent #${agentId}` },
  { name: "verifier-entry", path: "/proof", heading: "Public evidence verifier" },
  { name: "proof-detail", path: `/proof/${fixtureIds.proofId}?identityKey=${identityKey}`, heading: "Proof verification" },
  { name: "operator", path: "/operator", heading: "Resolve first. Mutate second." },
] as const);

export const gateReasonCodes = Object.freeze([
  "ALLOWED", "NO_PROOF", "REVOKED", "DRIFTED", "EXPIRED", "SUBJECT_CHANGED",
  "RUNTIME_CODE_DRIFT", "POLICY_TOO_OLD", "COVERAGE_INCOMPLETE", "COMPUTE_UNVERIFIED",
  "STORAGE_UNVERIFIED", "BEHAVIORAL_RISK", "CODE_RISK", "IDENTITY_UNAVAILABLE",
  "AGENT_NOT_FOUND", "AGENT_WALLET_UNSET", "IDENTITY_MISMATCH",
] as const);

export type FixtureScenario =
  | "full" | "loading" | "empty" | "partial" | "unavailable" | "maximum"
  | "health-matrix" | "proof-match" | "proof-mismatch" | "proof-timeout"
  | "canceled" | "stale" | "operator-uncertain" | "recovery";

export function canonicalIdentity(id = agentId): CanonicalIdentity {
  return { identity: { namespace: "eip155", chainId: 16661, registryAddress: identityRegistryAddress,
    agentId: id },
    owner: subject, agentWallet: subject, agentURI: "ipfs://prooflock-fixture",
    registrationDigest: hex32("a"), sourceBlockNumber: "120", sourceBlockHash: hex32("b"),
    card: { name: "Deterministic ProofLock fixture" } };
}

export function proofLockRecord(overrides: Partial<ProofLockRecord> = {}): ProofLockRecord {
  return { identityKey, subject, envelopeDigest: hex32("4"), storageRoot: hex32("5"),
    computeRoot: hex32("6"), artifactHash: hex32("7"), runtimeCodeHash: hex32("8"),
    version: "2", issuedAt: String(leaseEpochSeconds - 24 * 60 * 60),
    validUntil: String(leaseEpochSeconds + 6 * 24 * 60 * 60), policyVersion: 1,
    behavioralScore: 10, codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0, ...overrides };
}

export function proofLockDetail(overrides: Partial<ProofLockRecord> = {}, stale = false) {
  const record = proofLockRecord(overrides); const detail = verifiedDetail(record);
  const proofId = computeProofId(registryAddress, record);
  return { identityKey: record.identityKey, proofLock: record, detail, responseVersion: 2 as const,
    proofId, registryAddress, locator: { identityKey: record.identityKey, proofId, registryAddress },
    sealedEvidence: { schema: "sentinel.prooflock/sealed-evidence-v1" as const, version: 1 as const,
      proofLock: record, detail }, currentAccess: currentAccess(record, stale) };
}

export function verifiedProof(requestedProofId = fixtureIds.proofId,
  overrides: Partial<ProofLockRecord> = {}): VerifiedProof {
  const record = proofLockRecord(overrides);
  return { proofId: requestedProofId as `0x${string}`, identityKey: record.identityKey,
    source: { kind: "ProofLocked", registryAddress, transactionHash: fixtureIds.transactionHash,
      blockNumber: 120, blockHash: hex32("b"), logIndex: 1 }, proofLock: record,
    storage: { retrievalVerified: true, networkProofVerified: false,
      envelope: { schema: "sentinel.prooflock/evidence-v1", computeProofs: [{
        provider: consumerAddress, model: "fixture-model", proofClass: "DECENTRALIZED_MODEL_TEE",
      }] }, storageCommitment: { uploadTxHash: hex32("d") } } };
}

export function healthSnapshot(mixed = false): HealthSnapshot {
  const probe = (status: "HEALTHY" | "UNHEALTHY" | "UNKNOWN", detail?: Record<string, unknown>) => ({
    status, latencyMs: 12, observedAt: fixtureIso(), ...(detail ? { detail } : {}),
  });
  return { status: mixed ? "DEGRADED" : "HEALTHY", dependencies: {
    rpc: probe("HEALTHY"), identity: probe(mixed ? "UNHEALTHY" : "HEALTHY"),
    registry: probe("HEALTHY"), gate: probe(mixed ? "UNKNOWN" : "HEALTHY"),
    compute: probe("HEALTHY", { observation: "SERVICE_DISCOVERY", inferenceExecuted: false }),
    storage: probe(mixed ? "UNHEALTHY" : "HEALTHY",
      { observation: "RETRIEVAL_CANARY", networkProofVerified: false }),
  } };
}

export function discoveryResponse(kind: "full" | "empty" | "partial" | "maximum" = "full"):
ProofLockDiscoveryResponse {
  const full = inventoryItem(7);
  const identities = kind === "empty" ? [] : kind === "partial" ? [full, unavailableItem(8)]
    : kind === "maximum" ? Array.from({ length: 100 }, (_, index) => inventoryItem(index + 1)) : [full];
  return { identities, latestBlock: 130, fromBlock: 1, toBlock: 121, confirmations: 10,
    observedAt: new Date(leaseEpochSeconds * 1000).toISOString(), cap: 100,
    returned: identities.length, complete: false };
}

export async function installFixture(page: Page, scenario: FixtureScenario = "full"): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (scenario === "loading") return pendingResponse();
    if (scenario === "unavailable") return delayedApiError(route, "DEPENDENCY_UNAVAILABLE", 503);
    if (url.pathname === "/api/discover" || url.pathname === "/api/agents") return serveDiscovery(route, scenario);
    if (url.pathname === "/api/health") return json(route, healthSnapshot(scenario === "health-matrix"));
    if (url.pathname === "/api/v1/identities/resolve") return json(route,
      { identity: canonicalIdentity(), identityKey });
    if (url.pathname.startsWith("/api/v1/prooflocks/")) return json(route,
      proofLockDetail({}, scenario === "stale"));
    if (url.pathname.startsWith("/api/v1/proofs/")) return serveProof(route, url, scenario);
    if (url.pathname === "/api/admin/prooflocks/stream") return serveOperator(route, scenario);
    if (url.pathname === "/api/admin/prooflocks/recovery") return serveRecovery(route, scenario);
    return unexpectedApi(route, url);
  });
}

export default async function prewarmE2ERoutes(): Promise<void> {
  if (process.env.PROOFLOCK_E2E_SERVER === "standalone") return;
  const host = process.env.PROOFLOCK_E2E_HOST ?? "127.0.0.1";
  const origin = `http://${host}:4317`;
  for (const path of ["/", "/agents", "/agents/7", "/proof", `/proof/${hex32("1")}`, "/operator"])
    await fetch(`${origin}${path}`).then((response) => response.arrayBuffer());
}

function verifiedDetail(record: ProofLockRecord, gateReason = 0): Extract<ProofLockDetail, { status: "VERIFIED" }> {
  return { status: "VERIFIED", identity: { identityKey: record.identityKey, namespace: "eip155",
    chainId: 16661, registryAddress: identityRegistryAddress, agentId, owner: subject, agentWallet: subject,
    registrationUri: "ipfs://prooflock-fixture", registrationDigest: hex32("a"),
    sourceBlockNumber: "120", sourceBlockHash: hex32("b") }, resolution: { owner: subject,
    agentWallet: subject, agentURI: "ipfs://prooflock-fixture", registrationDigest: hex32("a"),
    sourceBlockNumber: "120", sourceBlockHash: hex32("b") }, gate: { status: "VERIFIED",
    allowed: gateReason === 0, reason: gateReason, subject, version: record.version }, consumer: { status: "VERIFIED",
    accepted: gateReason === 0, address: consumerAddress, subject, version: record.version } };
}

function currentAccess(record: ProofLockRecord, stale: boolean) {
  const observedAt = fixtureIso(stale ? -2 * 60 * 60_000 : 0);
  const freshnessExpiresAt = fixtureIso(stale ? -60 * 60_000 : 60 * 60_000);
  const ttlMs = Date.parse(freshnessExpiresAt) - Date.parse(observedAt);
  const observation = (subsystem: "identity" | "lease" | "gate" | "consumer") => ({
    scope: "CURRENT" as const, subsystem, status: "VERIFIED" as const, observedAt,
    observationBlockNumber: "120", observationBlockHash: hex32("b"), serverIssuedAt: observedAt,
    ttlMs, freshnessExpiresAt, ...(subsystem === "gate" ? { allowed: true, reasonCode: "ALLOWED" } : {}),
    ...(subsystem === "consumer" ? { accepted: true } : {}),
  });
  return { schema: "sentinel.prooflock/current-access-v1" as const, version: 1 as const, agentId,
    identityKey: record.identityKey, observationBlock: { number: "120", hash: hex32("b"),
      timestamp: "1788048000" }, observedAt, freshnessExpiresAt, observations: {
      identity: { capability: "ERC8004_IDENTITY_AT_FINALIZED_BLOCK" as const, reason: "OBSERVED" as const,
        observation: observation("identity"), value: identityValue() },
      lease: { capability: "REGISTRY_V2_LEASE_AT_FINALIZED_BLOCK" as const, reason: "OBSERVED" as const,
        observation: observation("lease"), value: record },
      gate: { capability: "AGENT_GATE_V2_AT_FINALIZED_BLOCK" as const, reason: "ALLOWED" as const,
        observation: observation("gate"), value: { allowed: true, reason: 0, subject, version: record.version } },
      consumer: { capability: "GUARDED_CONSUMER_AT_FINALIZED_BLOCK" as const, reason: "OBSERVED" as const,
        observation: observation("consumer"), value: { accepted: true, address: consumerAddress,
          subject, version: record.version } },
    } };
}

function identityValue() {
  const value = canonicalIdentity();
  return { identity: value.identity, owner: value.owner, agentWallet: value.agentWallet,
    agentURI: value.agentURI, registrationDigest: value.registrationDigest,
    sourceBlockNumber: value.sourceBlockNumber, sourceBlockHash: value.sourceBlockHash };
}

function inventoryItem(id: number) {
  const key = id === 7 ? identityKey : numberedHex32(id);
  const record = proofLockRecord({ identityKey: key, ...leaseVariant(id) });
  const detail = verifiedDetail(record, id === 7 ? 0 : (id - 1) % 17);
  const proofId = computeProofId(registryAddress, record);
  const transactionHash = numberedHex32(id + 1_000); const blockNumber = 121 - id;
  return { status: "VERIFIED" as const, identityKey: key, proofId, registryAddress,
    transactionHash, blockNumber,
    locator: { identityKey: key, proofId, registryAddress, transactionHash, blockNumber },
    proofLock: record, detail: { ...detail, identity: { ...detail.identity, agentId: String(id), identityKey: key } } };
}

function leaseVariant(id: number): Partial<ProofLockRecord> {
  const variants = [
    { state: 1, coverage: 0x7f, validUntil: String(leaseEpochSeconds + 29 * 24 * 60 * 60) },
    { state: 1, coverage: 0x7f, validUntil: String(leaseEpochSeconds + 12 * 60 * 60) },
    { state: 1, coverage: 0x7f, issuedAt: String(leaseEpochSeconds - 2 * 24 * 60 * 60),
      validUntil: String(leaseEpochSeconds - 1) },
    { state: 2, coverage: 0x7f }, { state: 3, coverage: 0x7f }, { state: 0, coverage: 0x3f },
  ];
  return variants[(id - 1) % variants.length];
}

function unavailableItem(id: number) {
  const key = hex32("e"); const proofId = numberedHex32(id + 3_000);
  const transactionHash = hex32("f"); const blockNumber = 120 - id;
  return { status: "ENRICHMENT_UNAVAILABLE" as const, identityKey: key,
    proofId, registryAddress, transactionHash, blockNumber,
    locator: { identityKey: key, proofId, registryAddress, transactionHash, blockNumber },
    code: "DEPENDENCY_UNAVAILABLE" as const };
}

function numberedHex32(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function fixtureIso(offsetMs = 0): string { return new Date(fixtureEpochMs + offsetMs).toISOString(); }

async function serveDiscovery(route: Route, scenario: FixtureScenario): Promise<void> {
  const kind = scenario === "empty" || scenario === "partial" || scenario === "maximum" ? scenario : "full";
  await json(route, discoveryResponse(kind));
}

async function serveProof(route: Route, url: URL, scenario: FixtureScenario): Promise<void> {
  if (scenario === "proof-timeout" || scenario === "canceled") return pendingResponse();
  if (scenario === "proof-mismatch") return apiError(route, "MISMATCH", 409);
  if (scenario === "stale") return apiError(route, "NOT_FOUND", 404);
  const requested = (url.pathname.split("/").at(-2) ?? fixtureIds.proofId) as `0x${string}`;
  await json(route, verifiedProof(requested));
}

async function serveOperator(route: Route, scenario: FixtureScenario): Promise<void> {
  if (scenario !== "operator-uncertain") return sse(route, [{ type: "error", error: apiShape(
    "NOT_BROADCAST", "RUNNING_COMPUTE"), writeOutcome: { status: "NOT_BROADCAST",
      recoveryId: fixtureIds.recoveryId } }]);
  await sse(route, [{ type: "progress", progress: { type: "admission", state: "ACCEPTED",
    recoveryId: fixtureIds.recoveryId, idempotencyKey: "fixture-idempotency" } },
  { type: "error", error: apiShape("SUBMISSION_OUTCOME_UNKNOWN", "WRITING_CHAIN"),
    writeOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: fixtureIds.recoveryId,
      transactionHash: fixtureIds.transactionHash } }]);
}

async function serveRecovery(route: Route, scenario: FixtureScenario): Promise<void> {
  const result = scenario === "recovery" ? { status: "SEALED", recoveryId: fixtureIds.recoveryId,
    transactionHash: fixtureIds.transactionHash, identityKey, version: "2" }
    : { status: "NOT_BROADCAST", recoveryId: fixtureIds.recoveryId };
  await json(route, { result });
}

function apiShape(code: string, stage: string) {
  return { code, message: code.replaceAll("_", " "), stage, retryable: true, requestId: "e2e-fixture" };
}

async function apiError(route: Route, code: string, status: number): Promise<void> {
  await json(route, { error: apiShape(code, code === "DEPENDENCY_UNAVAILABLE" ? "HEALTH_CHECK" : "VERIFYING_PROOF") }, status);
}

async function delayedApiError(route: Route, code: string, status: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
  await apiError(route, code, status);
}

async function unexpectedApi(route: Route, url: URL): Promise<void> {
  await json(route, { error: { ...apiShape("INTERNAL_ERROR", "VALIDATING_IDENTITY"),
    message: `Unexpected fixture API request: ${route.request().method()} ${url.pathname}` } }, 599);
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function sse(route: Route, frames: readonly unknown[]): Promise<void> {
  await route.fulfill({ status: 200, contentType: "text/event-stream",
    body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") });
}

function pendingResponse(): Promise<never> { return new Promise(() => {}); }
