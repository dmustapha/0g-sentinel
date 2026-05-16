// File: scanner/scanner.ts
import { ethers } from "ethers";
import { runBehavioralAnalysis, BehavioralSignals } from "./behavioral";
import { runCodeScan } from "./code-scan";
import { uploadEvidence } from "./storage";
import { getSeedProfile } from "./behavioral-seed";
import * as dotenv from "dotenv";
dotenv.config();

// Inline ABI — avoids JSON import dependency.
// Duplicate of lib/contracts.ts by design: scanner runs server-side with a signer;
// lib/contracts.ts serves read-only frontend views. Keep in sync when ABI changes.
const ATTESTATION_ABI = [
  "function writeAttestation(address agentAddress, uint8 behavioral_score, uint8 threat_level, uint8 code_risk, string code_findings, string reasoning, bytes32 behavioral_receipt_hash, bytes32 code_receipt_hash, bytes32 evidence_hash)",
  "function getAttestation(address agentAddress) view returns (uint8 behavioral_score, uint8 threat_level, uint8 code_risk, string code_findings, string reasoning, bytes32 behavioral_receipt_hash, bytes32 code_receipt_hash, bytes32 evidence_hash, uint256 attestation_timestamp)",
  "function hasAttestation(address agentAddress) view returns (bool)",
];

export interface FullScanResult {
  agentAddress: string;
  behavioral_score: number;
  threat_level: 0 | 1 | 2;
  reasoning: string;
  code_risk: 0 | 1 | 2;
  code_findings: string;
  behavioral_receipt_hash: string;
  code_receipt_hash: string;
  evidence_hash: string;
  attestation_tx_hash: string;
  scanned_at: number;
}

// Default Solidity sources for known demo agents — used when KNOWN_CONTRACT_SOURCES env var is not set.
// Agent Beta has a real reentrancy vulnerability so the code scan returns VULNERABLE with a receipt.
const DEFAULT_CONTRACT_SOURCES: Record<string, string> = {
  "0xaaaa000000000000000000000000000000000001": `
pragma solidity ^0.8.0;
contract AgentAlpha {
  address owner;
  constructor() { owner = msg.sender; }
  function execute(address target, bytes calldata data) external onlyOwner returns (bytes memory) {
    (bool ok, bytes memory result) = target.call(data);
    require(ok, "execution failed");
    return result;
  }
  modifier onlyOwner() { require(msg.sender == owner); _; }
}`,
  "0xbbbb000000000000000000000000000000000002": `
pragma solidity ^0.7.0;
contract AgentBeta {
  mapping(address => uint256) public balances;
  function deposit() external payable { balances[msg.sender] += msg.value; }
  function withdraw() external {
    uint256 amount = balances[msg.sender];
    (bool ok,) = msg.sender.call{value: amount}("");  // reentrancy: external call before state update
    require(ok);
    balances[msg.sender] = 0;  // state updated AFTER external call = reentrancy vulnerability
  }
}`,
  "0xcccc000000000000000000000000000000000003": `
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/access/Ownable.sol";
contract AgentGamma is Ownable {
  constructor() Ownable(msg.sender) {}
  function execute(address target, bytes calldata data) external onlyOwner returns (bytes memory) {
    (bool ok, bytes memory result) = target.call(data);
    require(ok, "execution failed");
    return result;
  }
}`,
};

// Safely convert any hash string to bytes32 (0x + 64 hex chars)
function toBytes32(hash: string): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(hash)) return hash;
  const hex = hash.startsWith("0x") ? hash.slice(2) : hash;
  return "0x" + hex.padStart(64, "0").slice(0, 64);
}

function getRpc(): string {
  return process.env.ZERO_G_RPC || "https://evmrpc.0g.ai";
}

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(getRpc());
}

function getSigner(): ethers.Wallet {
  const provider = getProvider();
  return new ethers.Wallet(process.env.SCANNER_PRIVATE_KEY || "", provider);
}

// Single getRegistry() per scan — signer created fresh to avoid nonce caching across hot reloads.
// Production note: separate scanner wallets per pipeline would prevent nonce collisions.
function getRegistry(): ethers.Contract {
  const signer = getSigner();
  const address = process.env.ATTESTATION_REGISTRY_ADDRESS || "";
  return new ethers.Contract(address, ATTESTATION_ABI, signer);
}

// ── Blockscout API types ──────────────────────────────────────────────────────
interface BlockscoutTx {
  hash: string;
  from: string;
  to: string | null;
  value: string;         // decimal string (wei)
  timeStamp: string;     // unix seconds string
  input: string;         // 0x-prefixed calldata
  isError?: string;      // "0" or "1"
}

const EXPLORER_BASE = process.env.ZERO_G_EXPLORER_URL || "https://chainscan.0g.ai";

/**
 * Try to fetch the last 100 outgoing transactions for an address from the
 * Blockscout Etherscan-compatible API. Returns null on any network or parse error.
 */
async function fetchExplorerTxs(agentAddress: string): Promise<BlockscoutTx[] | null> {
  try {
    const url = `${EXPLORER_BASE}/api?module=account&action=txlist&address=${agentAddress}&startblock=0&endblock=latest&sort=desc&offset=100&page=1`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json() as { status: string; result: BlockscoutTx[] | string };
    if (json.status !== "1" || !Array.isArray(json.result)) return null;
    // Return only outgoing transactions from the agent
    return (json.result as BlockscoutTx[]).filter(
      (tx) => tx.from?.toLowerCase() === agentAddress.toLowerCase()
    );
  } catch {
    return null;
  }
}

/** Compute real behavioral signals from a list of outgoing transactions. */
function computeSignalsFromTxList(
  agentAddress: string,
  txs: BlockscoutTx[],
  currentBalanceWei: bigint,
  source: "chain_history" | "limited_history"
): BehavioralSignals {
  if (txs.length === 0) {
    // No outgoing transactions: all signals are minimal-risk by definition
    return {
      address: agentAddress,
      tx_count_30d: 0,
      tx_count_7d: 0,
      fund_outflow_pct: 0,
      max_single_transfer_pct: 0,
      method_concentration: 0,
      timing_regularity_cv: 1.0,
      hour_entropy: 3.58,
      counterparty_herfindahl: 0,
      nonce_gap_rate: 1.0,
      value_entropy: 3.58,
      call_frequency_spike: false,
      large_outflow_detected: false,
      burst_detected: false,
      data_source: source,
      tx_count_analyzed: 0,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 86400;
  const sevenDaysAgo = now - 7 * 86400;

  let totalOutflow = BigInt(0);
  let maxSingleTransfer = BigInt(0);
  const contractsSet = new Set<string>();
  const methodCounts: Record<string, number> = {};
  const timestamps: number[] = [];
  const valuesSeen: bigint[] = [];
  const hourCounts = new Array(24).fill(0);
  let tx30d = 0;
  let tx7d = 0;

  for (const tx of txs) {
    const ts = parseInt(tx.timeStamp, 10);
    const value = BigInt(tx.value || "0");

    totalOutflow += value;
    if (value > maxSingleTransfer) maxSingleTransfer = value;
    if (tx.to) contractsSet.add(tx.to.toLowerCase());

    const selector = tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : "0x";
    methodCounts[selector] = (methodCounts[selector] || 0) + 1;
    timestamps.push(ts);
    valuesSeen.push(value);
    hourCounts[new Date(ts * 1000).getUTCHours()]++;

    if (ts >= thirtyDaysAgo) tx30d++;
    if (ts >= sevenDaysAgo) tx7d++;
  }

  const totalBalance = currentBalanceWei + totalOutflow;
  const outflowPct = totalBalance > 0n ? Number((totalOutflow * 100n) / totalBalance) : 0;
  const maxTransferPct = totalBalance > 0n ? Number((maxSingleTransfer * 100n) / totalBalance) : 0;

  // Method concentration (Herfindahl index over call selectors)
  const totalTx = txs.length;
  const methodConcentration = Object.values(methodCounts).reduce(
    (sum, count) => sum + (count / totalTx) ** 2, 0
  );

  // Timing regularity — CV of inter-transaction intervals (sorted oldest-first)
  const sortedTs = [...timestamps].sort((a, b) => a - b);
  let timingCV = 0.5; // neutral if < 3 txs
  if (sortedTs.length > 2) {
    const intervals = sortedTs.slice(1).map((t, i) => t - sortedTs[i]);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (mean > 0) {
      const std = Math.sqrt(intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length);
      timingCV = std / mean;
    }
  }

  // Shannon entropy helpers
  function shannonEntropy(counts: number[]): number {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    return counts.filter((c) => c > 0).reduce((h, c) => {
      const p = c / total;
      return h - p * Math.log2(p);
    }, 0);
  }

  // Hour-of-day entropy (max 3.58 bits for 24 hours)
  const hourEntropy = shannonEntropy(hourCounts);

  // Counterparty Herfindahl (concentration of recipients)
  const recipientCounts: Record<string, number> = {};
  for (const tx of txs) {
    if (tx.to) {
      const key = tx.to.toLowerCase();
      recipientCounts[key] = (recipientCounts[key] || 0) + 1;
    }
  }
  const counterpartyHHI = Object.values(recipientCounts).reduce(
    (sum, count) => sum + (count / totalTx) ** 2, 0
  );

  // Value entropy — bin values into deciles to compute distribution
  const sortedValues = [...valuesSeen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const median = sortedValues[Math.floor(sortedValues.length / 2)] || 0n;
  const valueBuckets: number[] = new Array(10).fill(0);
  for (const v of valuesSeen) {
    const idx = median > 0n ? Math.min(9, Number((v * 10n) / (median * 2n + 1n))) : 0;
    valueBuckets[idx]++;
  }
  const valueEntropy = shannonEntropy(valueBuckets);

  // Nonce gap rate: estimate from tx timestamps (gaps > 1h between sorted txs)
  let gapCount = 0;
  for (let i = 1; i < sortedTs.length; i++) {
    if (sortedTs[i] - sortedTs[i - 1] > 3600) gapCount++;
  }
  const nonceGapRate = sortedTs.length > 1 ? gapCount / (sortedTs.length - 1) : 0.5;

  return {
    address: agentAddress,
    tx_count_30d: tx30d,
    tx_count_7d: tx7d,
    fund_outflow_pct: outflowPct,
    max_single_transfer_pct: maxTransferPct,
    method_concentration: methodConcentration,
    timing_regularity_cv: timingCV,
    hour_entropy: hourEntropy,
    counterparty_herfindahl: counterpartyHHI,
    nonce_gap_rate: nonceGapRate,
    value_entropy: valueEntropy,
    call_frequency_spike: tx7d > 50,
    large_outflow_detected: outflowPct > 80,
    burst_detected: tx7d > 20,
    data_source: source,
    tx_count_analyzed: txs.length,
  };
}

/**
 * Fallback block scan: fetch full block data for the last N blocks and extract
 * transactions from the agent address. Used when the explorer API is unavailable.
 * Scans up to 100 blocks (vs the original 5) for better signal coverage.
 */
async function blockScanFallback(agentAddress: string): Promise<BehavioralSignals> {
  const provider = getProvider();
  const [latestBlock, balance] = await Promise.all([
    provider.getBlockNumber(),
    provider.getBalance(agentAddress),
  ]);

  const txs: BlockscoutTx[] = [];
  const scanDepth = 100; // 100 blocks ≈ ~20 minutes on 0G Aristotle

  for (let b = latestBlock; b > latestBlock - scanDepth && b > 0; b--) {
    const block = await provider.getBlock(b, true);
    if (!block) continue;
    for (const tx of block.transactions as any[]) {
      if (typeof tx === "object" && tx.from?.toLowerCase() === agentAddress.toLowerCase()) {
        txs.push({
          hash: tx.hash,
          from: tx.from,
          to: tx.to || "",
          value: String(tx.value || "0"),
          timeStamp: String(block.timestamp),
          input: tx.data || "0x",
        });
      }
    }
  }

  return computeSignalsFromTxList(agentAddress, txs, BigInt(balance), "limited_history");
}

/**
 * Also try to fetch real verified contract source from the 0G explorer.
 * Returns empty string if contract is unverified or address is an EOA.
 */
async function fetchVerifiedContractSource(agentAddress: string): Promise<string> {
  try {
    const url = `${EXPLORER_BASE}/api?module=contract&action=getsourcecode&address=${agentAddress}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return "";
    const json = await res.json() as { status: string; result: Array<{ SourceCode?: string }> };
    if (json.status !== "1" || !Array.isArray(json.result)) return "";
    const source = json.result[0]?.SourceCode || "";
    // Blockscout wraps multi-file sources in {{ }}; strip outer wrapper for single-file
    return source.startsWith("{{") ? "" : source;
  } catch {
    return "";
  }
}

/**
 * Build behavioral signals for an agent.
 *
 * Priority chain:
 * 1. Known demo agents → pre-computed archetype profile (fictional addresses, no real history)
 * 2. Unknown addresses → Blockscout Etherscan-compatible API (full tx history, all signals real)
 * 3. Explorer unavailable → block scan of last 100 blocks (partial real data)
 */
async function fetchAgentActivity(agentAddress: string): Promise<BehavioralSignals> {
  // Known demo agents: fictional addresses with no real chain history.
  // Use archetype models that demonstrate the full Safe/Caution/Flagged spectrum.
  const seed = getSeedProfile(agentAddress);
  if (seed) return seed;

  console.log(`[Scanner] Fetching real tx history for ${agentAddress} from 0G explorer...`);

  // Try Blockscout API first — returns full history, best signal quality
  const explorerTxs = await fetchExplorerTxs(agentAddress);
  if (explorerTxs !== null) {
    console.log(`[Scanner] Explorer returned ${explorerTxs.length} outgoing txs for ${agentAddress}`);
    const balance = await getProvider().getBalance(agentAddress);
    const source = explorerTxs.length >= 10 ? "chain_history" : "limited_history";
    return computeSignalsFromTxList(agentAddress, explorerTxs, BigInt(balance), source);
  }

  // Explorer unavailable — fall back to direct block scanning
  console.log(`[Scanner] Explorer unavailable, falling back to block scan for ${agentAddress}`);
  return blockScanFallback(agentAddress);
}

/**
 * Returns Solidity source for an agent.
 * Priority: env override → built-in demo defaults → Blockscout verified source → empty string.
 */
async function fetchContractSource(agentAddress: string): Promise<string> {
  // Env var override — allows deployment-specific sources without code changes
  const knownSources = process.env.KNOWN_CONTRACT_SOURCES;
  if (knownSources) {
    try {
      const sources = JSON.parse(knownSources) as Record<string, string>;
      const src = sources[agentAddress.toLowerCase()];
      if (src) return src;
    } catch {
      // ignore parse errors — fall through
    }
  }

  // Built-in defaults for the three demo agents (intentional vulnerability scenarios)
  const builtIn = DEFAULT_CONTRACT_SOURCES[agentAddress.toLowerCase()];
  if (builtIn) return builtIn;

  // Unknown address: try to fetch verified source from 0G chain explorer
  console.log(`[Scanner] Fetching verified contract source for ${agentAddress} from explorer...`);
  const explorerSource = await fetchVerifiedContractSource(agentAddress);
  if (explorerSource) {
    console.log(`[Scanner] Found verified contract source (${explorerSource.length} chars)`);
    return explorerSource;
  }

  // No source available — code scan will return WARNING with note
  return "";
}

export async function runFullScan(agentAddress: string): Promise<FullScanResult> {
  console.log(`[Scanner] Starting full scan for ${agentAddress}`);

  const [signals, contractSource] = await Promise.all([
    fetchAgentActivity(agentAddress),
    fetchContractSource(agentAddress),
  ]);

  // Pipeline 1 + 2 run in parallel — halves AI inference latency
  console.log(`[Scanner] Running Pipeline 1 (behavioral) + Pipeline 2 (code) in parallel...`);
  const [behavioral, codeScan] = await Promise.all([
    runBehavioralAnalysis(signals),
    runCodeScan(agentAddress, contractSource),
  ]);

  console.log(
    `[Scanner] Behavioral: ${["SAFE", "CAUTION", "FLAGGED"][behavioral.threat_level]} (score: ${behavioral.behavioral_score})`
  );
  console.log(`[Scanner] Code scan: ${["CLEAN", "WARNING", "VULNERABLE"][codeScan.code_risk]}`);

  if (behavioral.receipt_hash === codeScan.receipt_hash) {
    console.error("[Scanner] CRITICAL: Receipt hashes are identical — submission disqualified");
  }

  // Archive evidence to 0G Storage
  console.log(`[Scanner] Archiving evidence to 0G Storage...`);
  const evidenceHash = await uploadEvidence({
    agent_address: agentAddress,
    scan_timestamp: Math.floor(Date.now() / 1000),
    behavioral_data: {
      data_source: signals.data_source,
      tx_count_analyzed: signals.tx_count_analyzed,
      activity_summary: {
        tx_count_30d: signals.tx_count_30d,
        fund_outflow_pct: signals.fund_outflow_pct,
        method_concentration: signals.method_concentration,
        timing_regularity_cv: signals.timing_regularity_cv,
        counterparty_herfindahl: signals.counterparty_herfindahl,
      },
      verdict: ["SAFE", "CAUTION", "FLAGGED"][behavioral.threat_level],
      reasoning: behavioral.reasoning,
    },
    behavioral_receipt: behavioral.receipt_hash,
    code_findings: codeScan.code_findings,
    code_receipt: codeScan.receipt_hash,
  });

  // Write attestation to 0G Chain — retry once on nonce collision (concurrent scan race)
  console.log(`[Scanner] Writing attestation to 0G Chain...`);
  let receipt: ethers.TransactionReceipt | null = null;

  // 25-second hard timeout on the entire write + confirmation cycle
  const WRITE_TIMEOUT_MS = 25_000;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const registry = getRegistry();
      const writeTx = registry.writeAttestation(
        agentAddress,
        behavioral.behavioral_score,
        behavioral.threat_level,
        codeScan.code_risk,
        codeScan.code_findings,
        behavioral.reasoning,
        toBytes32(behavioral.receipt_hash),
        toBytes32(codeScan.receipt_hash),
        toBytes32(evidenceHash)
      );

      const tx = await Promise.race([
        writeTx,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("writeAttestation timeout (25s)")), WRITE_TIMEOUT_MS)
        ),
      ]);

      receipt = await Promise.race([
        (tx as Awaited<typeof writeTx>).wait(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("tx.wait() timeout (25s)")), WRITE_TIMEOUT_MS)
        ),
      ]);
      break;
    } catch (err: unknown) {
      const msg = String(err);
      const isNonce = msg.includes("replacement fee too low") || msg.includes("nonce") || msg.includes("already known");
      if (isNonce && attempt < 3) {
        console.warn(`[Scanner] Nonce collision on attempt ${attempt}, retrying in ${attempt * 2}s...`);
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      throw err;
    }
  }
  if (!receipt) throw new Error("Transaction not mined — no receipt returned");
  console.log(`[Scanner] Attestation written: ${receipt.hash}`);

  return {
    agentAddress,
    behavioral_score: behavioral.behavioral_score,
    threat_level: behavioral.threat_level,
    reasoning: behavioral.reasoning,
    code_risk: codeScan.code_risk,
    code_findings: codeScan.code_findings,
    behavioral_receipt_hash: behavioral.receipt_hash,
    code_receipt_hash: codeScan.receipt_hash,
    evidence_hash: evidenceHash,
    attestation_tx_hash: receipt.hash,
    scanned_at: Math.floor(Date.now() / 1000),
  };
}

// Convenience: run only Pipeline 2 — used by the /api/scan/code route
export async function runCodeScanOnly(agentAddress: string, contractSource: string) {
  console.log(`[Scanner] Running code-only scan for ${agentAddress}`);
  const codeScan = await runCodeScan(agentAddress, contractSource);
  return {
    agentAddress,
    code_risk: codeScan.code_risk,
    code_findings: codeScan.code_findings,
    code_receipt_hash: codeScan.receipt_hash,
    scanned_at: Math.floor(Date.now() / 1000),
  };
}
