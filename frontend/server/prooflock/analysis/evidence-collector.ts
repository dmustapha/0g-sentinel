// Phase 0 of the agent-risk pipeline: collect real on-chain evidence about a subject address on 0G
// (chainId 16661). It fuses two independent sources so a single outage never blinds the scanner:
//   - the 0G explorer (Etherscan-compatible open API) for tx / token-transfer / internal history and
//     verified contract source, and
//   - the 0G EVM RPC for the always-available activity floor (nonce, code, balance).
// The explorer is treated as best-effort: if it is down we still return a valid AddressEvidence built
// from RPC alone, marking coverage.explorer = "UNAVAILABLE". We only throw when the RPC itself cannot
// even give us a nonce and code, because without those there is nothing to reason over.

import { JsonRpcProvider, getAddress } from "ethers";

import type {
  AddressEvidence,
  ChainTx,
  EvmAddress,
  InternalTx,
  TokenTransfer,
} from "./types";

const DEFAULT_RPC_URL = "https://evmrpc.0g.ai";
const DEFAULT_EXPLORER_BASE = "https://chainscan.0g.ai/open/api";
const CHAIN_ID = 16661;

const DEFAULT_MAX_TXNS = 100;
const EXPLORER_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 4_000_000; // bound the explorer payload so a hostile endpoint cannot OOM us.

const NOT_VERIFIED_MESSAGE = "Contract source code not verified";

// The injectable seam. Every network touch goes through this so tests can run fully offline.
export type EvidenceCollectorDeps = Readonly<{
  fetchJson(url: string, timeoutMs: number): Promise<any>; // explorer GET, parsed JSON
  getCode(address: string): Promise<string>;
  getNonce(address: string): Promise<number>;
  getBalance(address: string): Promise<string>; // wei, decimal string
  latestBlock(): Promise<number>;
}>;

type ExplorerEnvelope = Readonly<{
  status?: string;
  message?: string;
  result?: unknown;
}>;

// Collect the full seal-time evidence bundle for one subject address. Never throws for explorer
// failures; only throws if the RPC cannot supply the nonce/code activity floor.
export async function collectAddressEvidence(
  address: string,
  deps: EvidenceCollectorDeps,
  opts?: { maxTxns?: number },
): Promise<AddressEvidence> {
  const normalized = normalizeAddress(address);
  const maxTxns = boundedLimit(opts?.maxTxns);

  const { nonce, code, balanceWei } = await collectRpcFloor(normalized, deps);
  const isContract = code !== "0x" && code.length > 2;
  const observedAtBlock = await safeLatestBlock(deps);

  const explorer = await collectExplorerEvidence(normalized, deps, maxTxns, isContract);

  return {
    address: normalized,
    observedAtBlock,
    nonce,
    balanceWei,
    isContract,
    code,
    transactions: explorer.transactions,
    tokenTransfers: explorer.tokenTransfers,
    internalTxns: explorer.internalTxns,
    sourceVerified: explorer.sourceVerified,
    source: explorer.source,
    coverage: { explorer: explorer.coverage, rpc: "OK" },
  };
}

// ---------- RPC floor (mandatory) ----------

async function collectRpcFloor(
  address: EvmAddress,
  deps: EvidenceCollectorDeps,
): Promise<{ nonce: number; code: string; balanceWei: string }> {
  let nonce: number;
  let code: string;
  try {
    [nonce, code] = await Promise.all([deps.getNonce(address), deps.getCode(address)]);
  } catch (error) {
    throw new Error(`RPC unavailable: cannot read nonce/code for ${address}: ${describe(error)}`);
  }
  const balanceWei = await safeBalance(address, deps);
  return { nonce, code, balanceWei };
}

async function safeBalance(address: EvmAddress, deps: EvidenceCollectorDeps): Promise<string> {
  try {
    return await deps.getBalance(address);
  } catch {
    return "0";
  }
}

async function safeLatestBlock(deps: EvidenceCollectorDeps): Promise<number> {
  try {
    const block = await deps.latestBlock();
    return Number.isFinite(block) && block >= 0 ? Math.floor(block) : 0;
  } catch {
    return 0;
  }
}

// ---------- Explorer evidence (best-effort) ----------

type SourceCall = { verified: boolean; source: string | null };

type ExplorerResult = {
  transactions: readonly ChainTx[];
  tokenTransfers: readonly TokenTransfer[];
  internalTxns: readonly InternalTx[];
  sourceVerified: boolean;
  source: string | null;
  coverage: "OK" | "PARTIAL" | "UNAVAILABLE";
};

async function collectExplorerEvidence(
  address: EvmAddress,
  deps: EvidenceCollectorDeps,
  maxTxns: number,
  isContract: boolean,
): Promise<ExplorerResult> {
  const [txns, tokentx, internal, source] = await Promise.all([
    fetchArray(deps, txlistUrl(address, maxTxns)),
    fetchArray(deps, tokentxUrl(address, maxTxns)),
    fetchArray(deps, internalUrl(address, maxTxns)),
    isContract ? fetchSource(deps, address) : Promise.resolve(ok<SourceCall>({ verified: false, source: null })),
  ]);

  const failures = [txns, tokentx, internal, source].filter((call) => !call.ok).length;
  const total = 4;

  return {
    transactions: mapTransactions(txns.value, maxTxns),
    tokenTransfers: mapTokenTransfers(tokentx.value, maxTxns),
    internalTxns: mapInternalTxns(internal.value, maxTxns),
    sourceVerified: source.ok && source.value.verified,
    source: source.ok ? source.value.source : null,
    coverage: coverageFrom(failures, total),
  };
}

function coverageFrom(failures: number, total: number): "OK" | "PARTIAL" | "UNAVAILABLE" {
  if (failures === 0) return "OK";
  if (failures >= total) return "UNAVAILABLE";
  return "PARTIAL";
}

// ---------- Explorer request helpers ----------

type Call<T> = Readonly<{ ok: boolean; value: T }>;

function ok<T>(value: T): Call<T> {
  return { ok: true, value };
}

function failed<T>(value: T): Call<T> {
  return { ok: false, value };
}

async function fetchArray(deps: EvidenceCollectorDeps, url: string): Promise<Call<unknown[]>> {
  try {
    const json = (await deps.fetchJson(url, EXPLORER_TIMEOUT_MS)) as ExplorerEnvelope;
    if (json.status !== "1" || !Array.isArray(json.result)) return failed([]);
    return ok(json.result);
  } catch {
    return failed([]);
  }
}

async function fetchSource(deps: EvidenceCollectorDeps, address: EvmAddress): Promise<Call<SourceCall>> {
  try {
    const json = (await deps.fetchJson(getsourceUrl(address), EXPLORER_TIMEOUT_MS)) as ExplorerEnvelope;
    const entry = Array.isArray(json.result) ? json.result[0] : undefined;
    const raw = readString(entry, "SourceCode");
    const verified = raw.length > 0 && raw !== NOT_VERIFIED_MESSAGE;
    return ok({ verified, source: verified ? raw : null });
  } catch {
    return failed({ verified: false, source: null });
  }
}

// ---------- Row mappers ----------

function mapTransactions(rows: unknown[], maxTxns: number): readonly ChainTx[] {
  return sortByBlockDesc(rows)
    .slice(0, maxTxns)
    .map((row) => ({
      hash: readString(row, "hash"),
      blockNumber: readNumber(row, "blockNumber"),
      timestamp: readNumber(row, "timeStamp"),
      from: readString(row, "from"),
      to: readAddressOrNull(row, "to"),
      value: readString(row, "value"),
      methodId: extractMethodId(readString(row, "input")),
      input: readString(row, "input"),
      isError: readTxError(row),
      gasUsed: readString(row, "gasUsed"),
    }));
}

function mapTokenTransfers(rows: unknown[], maxTxns: number): readonly TokenTransfer[] {
  return sortByBlockDesc(rows)
    .slice(0, maxTxns)
    .map((row) => ({
      hash: readString(row, "hash"),
      blockNumber: readNumber(row, "blockNumber"),
      from: readString(row, "from"),
      to: readString(row, "to"),
      contractAddress: readString(row, "contractAddress"),
      value: readString(row, "value"),
      tokenSymbol: readString(row, "tokenSymbol"),
      tokenDecimal: readString(row, "tokenDecimal"),
    }));
}

function mapInternalTxns(rows: unknown[], maxTxns: number): readonly InternalTx[] {
  return sortByBlockDesc(rows)
    .slice(0, maxTxns)
    .map((row) => ({
      from: readString(row, "from"),
      to: readString(row, "to"),
      value: readString(row, "value"),
      type: readString(row, "type"),
      isError: readString(row, "isError") === "1",
    }));
}

// Newest-first. Explorer already sorts desc for txlist, but token/internal endpoints do not accept
// sort, so we enforce ordering ourselves to keep the bundle deterministic.
function sortByBlockDesc(rows: unknown[]): unknown[] {
  return [...rows].sort((a, b) => readNumber(b, "blockNumber") - readNumber(a, "blockNumber"));
}

// ---------- Field extraction (defensive: explorer rows are untrusted) ----------

// methodId is the first 4 bytes of calldata as a "0x" + 8 hex string. Plain transfers ("0x" / empty
// input) collapse to "0x".
function extractMethodId(input: string): string {
  if (!input || input === "0x") return "0x";
  return input.slice(0, 10);
}

function readTxError(row: unknown): boolean {
  return readString(row, "txreceipt_status") === "0" || readString(row, "isError") === "1";
}

function readString(row: unknown, key: string): string {
  const value = asRecord(row)[key];
  return typeof value === "string" ? value : "";
}

function readNumber(row: unknown, key: string): number {
  const value = asRecord(row)[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readAddressOrNull(row: unknown, key: string): string | null {
  const value = readString(row, key);
  return value.length > 0 ? value : null;
}

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

// ---------- Input validation ----------

function normalizeAddress(address: string): EvmAddress {
  try {
    return getAddress(address) as EvmAddress;
  } catch {
    throw new Error(`Invalid EVM address: ${String(address)}`);
  }
}

function boundedLimit(maxTxns: number | undefined): number {
  if (typeof maxTxns !== "number" || !Number.isFinite(maxTxns) || maxTxns <= 0) return DEFAULT_MAX_TXNS;
  return Math.min(Math.floor(maxTxns), DEFAULT_MAX_TXNS * 10);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------- Explorer URL builders ----------

function txlistUrl(address: EvmAddress, offset: number): string {
  return explorerUrl(EXPLORER_BASE_HOLDER.base, {
    module: "account",
    action: "txlist",
    address,
    startblock: "0",
    endblock: "99999999",
    page: "1",
    offset: String(offset),
    sort: "desc",
  });
}

function tokentxUrl(address: EvmAddress, offset: number): string {
  return explorerUrl(EXPLORER_BASE_HOLDER.base, {
    module: "account",
    action: "tokentx",
    address,
    page: "1",
    offset: String(offset),
  });
}

function internalUrl(address: EvmAddress, offset: number): string {
  return explorerUrl(EXPLORER_BASE_HOLDER.base, {
    module: "account",
    action: "txlistinternal",
    address,
    page: "1",
    offset: String(offset),
  });
}

function getsourceUrl(address: EvmAddress): string {
  return explorerUrl(EXPLORER_BASE_HOLDER.base, {
    module: "contract",
    action: "getsourcecode",
    address,
  });
}

// The explorer base is a per-collector value in production but the URL builders are pure module
// functions, so we thread it through a single holder set by createProductionEvidenceDeps. Tests
// inject fetchJson directly and never read these URLs, so the default base is correct for them.
const EXPLORER_BASE_HOLDER = { base: DEFAULT_EXPLORER_BASE };

function explorerUrl(base: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}?${query}`;
}

// ---------- Production deps ----------

// Wire the real 0G RPC (ethers) and explorer (fetch) into an EvidenceCollectorDeps. The RPC provider
// is pinned to chain 16661 with a static network so ethers does not probe eth_chainId on every call.
export function createProductionEvidenceDeps(
  rpcUrl: string = DEFAULT_RPC_URL,
  explorerBase: string = DEFAULT_EXPLORER_BASE,
): EvidenceCollectorDeps {
  EXPLORER_BASE_HOLDER.base = explorerBase;
  const provider = new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true });
  return {
    fetchJson: productionFetchJson,
    getCode: (address) => provider.getCode(address),
    getNonce: (address) => provider.getTransactionCount(address, "latest"),
    getBalance: async (address) => (await provider.getBalance(address)).toString(),
    latestBlock: () => provider.getBlockNumber(),
  };
}

async function productionFetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Explorer HTTP ${response.status}`);
  const text = await readBoundedText(response);
  return JSON.parse(text);
}

// Read the response body while enforcing a hard byte ceiling, so a runaway or hostile explorer cannot
// exhaust memory. Falls back to a plain text read if the stream reader is unavailable.
async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("Explorer response too large");
  }
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Explorer response too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
