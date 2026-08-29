import { parseNonZeroBytes32 } from "@/lib/prooflock-validation";
import { apiErrorResponse, type ProofLockDetail } from "./api";
import { computeProofLockId, REGISTRY_V2_INTERFACE, type RegistryProofLockRecord } from "./chain";

const TIMEOUT_MS = 10_000;
const MAX_TTL_SECONDS = 30n * 24n * 60n * 60n;

export type DiscoveryLog = Readonly<{
  address: string; topics: readonly string[]; data: string; transactionHash: string;
  blockNumber: number; blockHash: string; index: number; removed?: boolean;
}>;

export type DiscoveryDependencies = Readonly<{
  assertChain(signal: AbortSignal): Promise<void>;
  getLatestBlock(signal: AbortSignal): Promise<number>;
  getBlock(blockNumber: number, signal: AbortSignal): Promise<Readonly<{ number: number; hash: string | null }> | null>;
  getLogs(filter: Readonly<{ address: string; topics: readonly string[]; fromBlock: number; toBlock: number }>,
    signal: AbortSignal): Promise<readonly DiscoveryLog[]>;
  readProofLock(identityKey: string, blockNumber: number, signal: AbortSignal): Promise<RegistryProofLockRecord>;
  readProofLockDetail(record: RegistryProofLockRecord, blockNumber: number, signal: AbortSignal): Promise<ProofLockDetail>;
  now(): Date;
}>;

export type DiscoveryOptions = Readonly<{
  registryAddress: string; confirmations: number; window: number; cap: number; concurrency: number;
}>;

export function createDiscoveryHandler(dependencies: DiscoveryDependencies, options: DiscoveryOptions) {
  const config = validateOptions(options);
  return async (request: Request): Promise<Response> => {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    try {
      await dependencies.assertChain(signal);
      const latestBlock = await dependencies.getLatestBlock(signal);
      const toBlock = finalizedBlock(latestBlock, config.confirmations);
      const fromBlock = Math.max(0, toBlock - config.window + 1);
      const boundary = await stableBoundary(dependencies, toBlock, signal);
      const logs = await dependencies.getLogs({ address: config.registryAddress,
        topics: [REGISTRY_V2_INTERFACE.getEvent("ProofLocked")!.topicHash], fromBlock, toBlock }, signal);
      const candidates = uniqueProofLocks(logs, config.registryAddress, fromBlock, toBlock).slice(0, config.cap);
      await assertSameBoundary(dependencies, boundary, signal);
      const identities = await boundedMap(candidates, config.concurrency,
        (candidate) => enrich(candidate, toBlock, dependencies, signal), signal);
      await assertSameBoundary(dependencies, boundary, signal);
      const observedAt = validObservationTime(dependencies.now());
      return response({ identities, latestBlock, fromBlock, toBlock, confirmations: config.confirmations,
        observedAt, cap: config.cap, returned: identities.length, complete: false });
    } catch (error) { return unavailable(error); }
  };
}

type Candidate = Readonly<{ identityKey: `0x${string}`; proofId: `0x${string}`;
  transactionHash: `0x${string}`; blockNumber: number; eventRecord: RegistryProofLockRecord }>;

function uniqueProofLocks(logs: readonly DiscoveryLog[], registry: string, fromBlock: number, toBlock: number): readonly Candidate[] {
  const ordered = logs.map((log) => validLog(log, registry, fromBlock, toBlock)).sort((left, right) =>
    right.blockNumber - left.blockNumber || right.index - left.index
    || left.transactionHash.localeCompare(right.transactionHash));
  const records = new Map<string, Candidate>();
  for (const log of ordered) if (!records.has(log.identityKey)) records.set(log.identityKey, log);
  return [...records.values()];
}

function validLog(log: DiscoveryLog, registry: string, fromBlock: number, toBlock: number) {
  const transactionHash = parseNonZeroBytes32(log.transactionHash);
  if (log.removed === true || log.address.toLowerCase() !== registry.toLowerCase()
    || !transactionHash || !parseNonZeroBytes32(log.blockHash)
    || !Number.isSafeInteger(log.blockNumber) || log.blockNumber < fromBlock || log.blockNumber > toBlock
    || !Number.isSafeInteger(log.index) || log.index < 0) throw new Error("Registry discovery log is invalid or removed");
  const eventRecord = decodeProofLocked(log);
  return { identityKey: eventRecord.identityKey, proofId: computeProofLockId(registry, eventRecord),
    transactionHash, blockNumber: log.blockNumber, index: log.index, eventRecord };
}

function decodeProofLocked(log: DiscoveryLog): RegistryProofLockRecord {
  const event = REGISTRY_V2_INTERFACE.getEvent("ProofLocked")!;
  if (log.topics.length !== 4 || log.topics[0]?.toLowerCase() !== event.topicHash.toLowerCase()) invalidLog();
  const parsed = REGISTRY_V2_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
  if (!parsed || parsed.name !== "ProofLocked") invalidLog();
  const encoded = REGISTRY_V2_INTERFACE.encodeEventLog(event, parsed.args);
  if (encoded.data.toLowerCase() !== log.data.toLowerCase() || encoded.topics.length !== log.topics.length
    || encoded.topics.some((topic, index) => topic.toLowerCase() !== log.topics[index]?.toLowerCase())) invalidLog();
  return validateEventRecord(eventRecord(parsed.args as unknown as Record<string, unknown>));
}

function eventRecord(args: Record<string, unknown>): RegistryProofLockRecord {
  return Object.freeze({
    identityKey: String(args.identityKey).toLowerCase() as `0x${string}`,
    subject: String(args.subject).toLowerCase() as `0x${string}`,
    envelopeDigest: String(args.envelopeDigest).toLowerCase() as `0x${string}`,
    storageRoot: String(args.storageRoot).toLowerCase() as `0x${string}`,
    computeRoot: String(args.computeRoot).toLowerCase() as `0x${string}`,
    artifactHash: String(args.artifactHash).toLowerCase() as `0x${string}`,
    runtimeCodeHash: String(args.runtimeCodeHash).toLowerCase() as `0x${string}`,
    version: BigInt(String(args.version)), issuedAt: BigInt(String(args.issuedAt)),
    validUntil: BigInt(String(args.validUntil)), policyVersion: Number(args.policyVersion),
    behavioralScore: Number(args.behavioralScore), codeRisk: Number(args.codeRisk),
    coverage: Number(args.coverage), state: 1, stateReason: 0,
  });
}

function validateEventRecord(record: RegistryProofLockRecord): RegistryProofLockRecord {
  const commitments = [record.identityKey, record.envelopeDigest, record.storageRoot,
    record.computeRoot, record.artifactHash];
  if (commitments.some((value) => !parseNonZeroBytes32(value))
    || !/^0x[0-9a-f]{40}$/.test(record.subject) || /^0x0{40}$/.test(record.subject)
    || !/^0x[0-9a-f]{64}$/.test(record.runtimeCodeHash) || record.version < 1n
    || record.issuedAt < 1n || record.validUntil <= record.issuedAt
    || record.validUntil - record.issuedAt > MAX_TTL_SECONDS
    || !Number.isInteger(record.behavioralScore) || record.behavioralScore < 0 || record.behavioralScore > 100
    || !Number.isInteger(record.codeRisk) || record.codeRisk < 0 || record.codeRisk > 2
    || !Number.isInteger(record.coverage) || (record.coverage & 0x7f) !== 0x7f) invalidLog();
  return record;
}

async function enrich(candidate: Candidate, toBlock: number,
  dependencies: DiscoveryDependencies, signal: AbortSignal) {
  try {
    signal.throwIfAborted();
    const proofLock = await dependencies.readProofLock(candidate.identityKey, toBlock, signal);
    signal.throwIfAborted();
    assertEventBinding(candidate.eventRecord, proofLock);
    const detail = await dependencies.readProofLockDetail(proofLock, toBlock, signal);
    signal.throwIfAborted();
    const { eventRecord: _eventRecord, ...source } = candidate;
    return Object.freeze({ status: "VERIFIED" as const, ...source, proofLock, detail });
  } catch (error) {
    if (signal.aborted) throw error;
    return Object.freeze({ status: "ENRICHMENT_UNAVAILABLE" as const,
      identityKey: candidate.identityKey, transactionHash: candidate.transactionHash, blockNumber: candidate.blockNumber,
      code: "DEPENDENCY_UNAVAILABLE" as const });
  }
}

function assertEventBinding(event: RegistryProofLockRecord, pinned: RegistryProofLockRecord): void {
  const fields = ["identityKey", "subject", "envelopeDigest", "storageRoot", "computeRoot", "artifactHash",
    "runtimeCodeHash", "version", "issuedAt", "validUntil", "policyVersion", "behavioralScore", "codeRisk", "coverage"] as const;
  if (fields.some((field) => String(event[field]).toLowerCase() !== String(pinned[field]).toLowerCase())) {
    throw new Error("Pinned Registry record does not match its finalized ProofLocked event");
  }
  const active = pinned.state === 1 && pinned.stateReason === 0;
  const stopped = (pinned.state === 2 || pinned.state === 3)
    && pinned.stateReason >= 1 && pinned.stateReason <= 16;
  if (!active && !stopped) throw new Error("Pinned Registry state is impossible");
}

function invalidLog(): never { throw new Error("ProofLocked log is malformed or impossible"); }

async function boundedMap<T, R>(items: readonly T[], concurrency: number,
  worker: (item: T) => Promise<R>, signal: AbortSignal): Promise<readonly R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      signal.throwIfAborted();
      const index = next;
      if (index >= items.length) return;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function stableBoundary(dependencies: DiscoveryDependencies, toBlock: number, signal: AbortSignal) {
  const block = await dependencies.getBlock(toBlock, signal);
  if (!block || block.number !== toBlock || !parseNonZeroBytes32(block.hash ?? "")) {
    throw new Error("Finalized discovery boundary is unavailable");
  }
  return Object.freeze({ number: block.number, hash: block.hash!.toLowerCase() });
}

async function assertSameBoundary(dependencies: DiscoveryDependencies,
  expected: Readonly<{ number: number; hash: string }>, signal: AbortSignal): Promise<void> {
  const actual = await stableBoundary(dependencies, expected.number, signal);
  if (actual.hash !== expected.hash) throw new Error("Finalized discovery boundary was reorganized");
}

function finalizedBlock(latestBlock: number, confirmations: number): number {
  if (!Number.isSafeInteger(latestBlock) || latestBlock < confirmations - 1) throw new Error("Registry finality is unavailable");
  return latestBlock - confirmations + 1;
}

function validateOptions(options: DiscoveryOptions): DiscoveryOptions {
  requiredAddress(options.registryAddress);
  const values = [options.confirmations, options.window, options.cap, options.concurrency];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)
    || options.confirmations > 128 || options.window > 1_000_000 || options.cap > 1_000 || options.concurrency > 32) {
    throw new Error("Discovery configuration is invalid");
  }
  return Object.freeze({ ...options, registryAddress: options.registryAddress.toLowerCase() });
}

function requiredAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new Error("Registry is invalid");
  return value;
}

function validObservationTime(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Observation time is invalid");
  return value.toISOString();
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item), { headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=15, stale-while-revalidate=45",
    "x-content-type-options": "nosniff",
  } });
}

function unavailable(error: unknown): Response {
  return apiErrorResponse(error, { code: "DEPENDENCY_UNAVAILABLE", message: "ProofLock discovery is unavailable",
    stage: "READING_PROOF", retryable: true, status: 503 });
}
