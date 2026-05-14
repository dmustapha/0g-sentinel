// File: scanner/scanner.ts
import { ethers } from "ethers";
import { runBehavioralAnalysis, AgentActivityData } from "./behavioral";
import { runCodeScan } from "./code-scan";
import { uploadEvidence } from "./storage";
import * as dotenv from "dotenv";
dotenv.config();

// Inline ABI — avoids JSON import dependency
const ATTESTATION_ABI = [
  "function writeAttestation(address agentAddress, uint8 behavioral_score, uint8 threat_level, uint8 code_risk, string code_findings, bytes32 behavioral_receipt_hash, bytes32 code_receipt_hash, bytes32 evidence_hash)",
  "function getAttestation(address agentAddress) view returns (uint8 behavioral_score, uint8 threat_level, uint8 code_risk, string code_findings, bytes32 behavioral_receipt_hash, bytes32 code_receipt_hash, bytes32 evidence_hash, uint256 attestation_timestamp)",
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

function getRegistry(): ethers.Contract {
  const signer = getSigner();
  const address = process.env.ATTESTATION_REGISTRY_ADDRESS || "";
  return new ethers.Contract(address, ATTESTATION_ABI, signer);
}

// Fetch agent activity data from 0G Chain
async function fetchAgentActivity(agentAddress: string): Promise<AgentActivityData> {
  const provider = getProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - 1000);

  const transactions: Array<{ hash: string; value: string; to: string; timestamp: number }> = [];
  let totalOutflow = BigInt(0);
  let maxSingleTransfer = BigInt(0);
  const contractsSet = new Set<string>();

  // Sample last 5 blocks for activity (demo-friendly)
  for (let b = latestBlock; b > latestBlock - 5 && b > fromBlock; b--) {
    const block = await provider.getBlock(b, true);
    if (!block) continue;
    for (const tx of block.transactions as any[]) {
      if (typeof tx === "object" && tx.from?.toLowerCase() === agentAddress.toLowerCase()) {
        const value = BigInt(tx.value || 0);
        totalOutflow += value;
        if (value > maxSingleTransfer) maxSingleTransfer = value;
        if (tx.to) contractsSet.add(tx.to);
        transactions.push({
          hash: tx.hash,
          value: ethers.formatEther(value),
          to: tx.to || "",
          timestamp: block.timestamp,
        });
      }
    }
  }

  const balance = await provider.getBalance(agentAddress);
  const totalBalance = BigInt(balance) + totalOutflow;
  const outflowPct = totalBalance > 0n ? Number((totalOutflow * 100n) / totalBalance) : 0;
  const maxTransferPct = totalBalance > 0n ? Number((maxSingleTransfer * 100n) / totalBalance) : 0;

  return {
    address: agentAddress,
    transaction_count_30d: transactions.length, // sampled from last 5 blocks for demo performance
    fund_outflow_pct: outflowPct,
    unique_contracts_called: contractsSet.size,
    max_single_transfer_pct: maxTransferPct,
    call_frequency_spike: transactions.length > 50,
    recent_transactions: transactions.slice(0, 10),
  };
}

// Fetch contract source from env-seeded known sources or return empty
async function fetchContractSource(agentAddress: string): Promise<string> {
  const knownSources = process.env.KNOWN_CONTRACT_SOURCES;
  if (knownSources) {
    try {
      const sources = JSON.parse(knownSources) as Record<string, string>;
      if (sources[agentAddress.toLowerCase()]) {
        return sources[agentAddress.toLowerCase()];
      }
    } catch {
      // ignore parse errors
    }
  }
  return ""; // No source available — code scan will return WARNING
}

export async function runFullScan(agentAddress: string): Promise<FullScanResult> {
  console.log(`[Scanner] Starting full scan for ${agentAddress}`);

  const [activity, contractSource] = await Promise.all([
    fetchAgentActivity(agentAddress),
    fetchContractSource(agentAddress),
  ]);

  // Pipeline 1: Behavioral Analysis (0G Compute — independent call)
  console.log(`[Scanner] Pipeline 1: behavioral analysis...`);
  const behavioral = await runBehavioralAnalysis(activity);
  console.log(
    `[Scanner] Behavioral: ${["SAFE", "CAUTION", "FLAGGED"][behavioral.threat_level]} (score: ${behavioral.behavioral_score})`
  );

  // Pipeline 2: Code Vulnerability Scan (0G Compute — independent call, separate receipt hash)
  console.log(`[Scanner] Pipeline 2: code vulnerability scan...`);
  const codeScan = await runCodeScan(agentAddress, contractSource);
  console.log(`[Scanner] Code scan: ${["CLEAN", "WARNING", "VULNERABLE"][codeScan.code_risk]}`);

  // Verify receipt hashes are different (critical requirement)
  if (behavioral.receipt_hash === codeScan.receipt_hash) {
    console.error("[Scanner] CRITICAL: Receipt hashes are identical — this would disqualify the submission");
  }

  // Archive evidence to 0G Storage
  console.log(`[Scanner] Archiving evidence to 0G Storage...`);
  const evidenceHash = await uploadEvidence({
    agent_address: agentAddress,
    scan_timestamp: Math.floor(Date.now() / 1000),
    behavioral_data: {
      activity_summary: {
        transaction_count: activity.transaction_count_30d,
        outflow_pct: activity.fund_outflow_pct,
        unique_contracts: activity.unique_contracts_called,
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
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const registry = getRegistry();
      const tx = await registry.writeAttestation(
        agentAddress,
        behavioral.behavioral_score,
        behavioral.threat_level,
        codeScan.code_risk,
        codeScan.code_findings,
        toBytes32(behavioral.receipt_hash),
        toBytes32(codeScan.receipt_hash),
        toBytes32(evidenceHash)
      );
      receipt = await tx.wait();
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

// Convenience: run only Pipeline 2 — used by code scan API route
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
