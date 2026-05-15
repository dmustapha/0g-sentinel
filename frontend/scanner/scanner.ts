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

/**
 * Build behavioral signals for an agent.
 * Known demo agents use pre-computed seed profiles (differentiated, meaningful).
 * Unknown addresses fall back to a live on-chain fetch of the last 5 blocks.
 */
async function fetchAgentActivity(agentAddress: string): Promise<BehavioralSignals> {
  // Use seeded profile for known demo agents — avoids the 5-block/30-day mismatch
  const seed = getSeedProfile(agentAddress);
  if (seed) return seed;

  // Unknown address: fetch on-chain and compute basic signals
  const provider = getProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - 1000);

  const transactions: Array<{ hash: string; value: bigint; to: string; timestamp: number }> = [];
  let totalOutflow = BigInt(0);
  let maxSingleTransfer = BigInt(0);
  const contractsSet = new Set<string>();
  const methodCounts: Record<string, number> = {};
  const timestamps: number[] = [];

  for (let b = latestBlock; b > latestBlock - 5 && b > fromBlock; b--) {
    const block = await provider.getBlock(b, true);
    if (!block) continue;
    for (const tx of block.transactions as any[]) {
      if (typeof tx === "object" && tx.from?.toLowerCase() === agentAddress.toLowerCase()) {
        const value = BigInt(tx.value || 0);
        totalOutflow += value;
        if (value > maxSingleTransfer) maxSingleTransfer = value;
        if (tx.to) contractsSet.add(tx.to);
        const selector = tx.data?.length >= 10 ? tx.data.slice(0, 10) : "0x";
        methodCounts[selector] = (methodCounts[selector] || 0) + 1;
        timestamps.push(block.timestamp);
        transactions.push({ hash: tx.hash, value, to: tx.to || "", timestamp: block.timestamp });
      }
    }
  }

  const balance = await provider.getBalance(agentAddress);
  const totalBalance = BigInt(balance) + totalOutflow;
  const outflowPct = totalBalance > 0n ? Number((totalOutflow * 100n) / totalBalance) : 0;
  const maxTransferPct = totalBalance > 0n ? Number((maxSingleTransfer * 100n) / totalBalance) : 0;

  // Method concentration: Herfindahl index over observed selectors
  const totalTx = transactions.length || 1;
  const methodConcentration = Object.values(methodCounts).reduce(
    (sum, count) => sum + (count / totalTx) ** 2, 0
  );

  // Timing regularity CV (inter-block variance — coarse proxy for demo)
  let timingCV = 0.5;
  if (timestamps.length > 2) {
    const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (mean > 0) {
      const std = Math.sqrt(intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length);
      timingCV = std / mean;
    }
  }

  return {
    address: agentAddress,
    tx_count_30d: transactions.length,
    tx_count_7d: Math.floor(transactions.length * 0.5),
    fund_outflow_pct: outflowPct,
    max_single_transfer_pct: maxTransferPct,
    method_concentration: methodConcentration,
    timing_regularity_cv: timingCV,
    hour_entropy: 2.0,   // neutral — can't compute from 5 blocks
    counterparty_herfindahl: contractsSet.size > 0 ? 1 / contractsSet.size : 0.5,
    nonce_gap_rate: 0.1, // neutral default
    value_entropy: 2.0,  // neutral default
    call_frequency_spike: transactions.length > 50,
    large_outflow_detected: outflowPct > 80,
    burst_detected: transactions.length > 20,
  };
}

/** Returns Solidity source for an agent from env override or built-in defaults. */
async function fetchContractSource(agentAddress: string): Promise<string> {
  // Env var override — allows deployment-specific sources without code changes
  const knownSources = process.env.KNOWN_CONTRACT_SOURCES;
  if (knownSources) {
    try {
      const sources = JSON.parse(knownSources) as Record<string, string>;
      const src = sources[agentAddress.toLowerCase()];
      if (src) return src;
    } catch {
      // ignore parse errors — fall through to defaults
    }
  }
  // Built-in defaults for the three demo agents
  return DEFAULT_CONTRACT_SOURCES[agentAddress.toLowerCase()] || "";
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
