// File: frontend/lib/contracts.ts
import { ethers } from "ethers";

const ATTESTATION_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS ?? "";
const AGENT_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ?? "";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";

const ATTESTATION_ABI = [
  "function getAttestation(address agentAddress) view returns (tuple(uint8 behavioral_score, uint8 threat_level, uint8 code_risk, string code_findings, string reasoning, bytes32 behavioral_receipt_hash, bytes32 code_receipt_hash, bytes32 evidence_hash, uint256 attestation_timestamp))",
  "function hasAttestation(address agentAddress) view returns (bool)",
  "function getAllAttestedAgents() view returns (address[])",
  "function getAttestedAgentsPaged(uint256 offset, uint256 limit) view returns (address[])",
  "function getAttestedCount() view returns (uint256)",
  "function getAttestationHistory(address agentAddress, uint256 limit) view returns (tuple(uint8 behavioral_score, uint8 threat_level, uint8 code_risk, string code_findings, string reasoning, bytes32 behavioral_receipt_hash, bytes32 code_receipt_hash, bytes32 evidence_hash, uint256 attestation_timestamp)[])",
  "function getAttestationHistoryCount(address agentAddress) view returns (uint256)",
  "event AttestationWritten(address indexed agentAddress, uint8 behavioral_score, uint8 threat_level, uint8 code_risk, bytes32 behavioral_receipt_hash, bytes32 code_receipt_hash, bytes32 evidence_hash, uint256 timestamp)",
];

const AGENT_REGISTRY_ABI = [
  "function getAllAgents() view returns (address[])",
  "function getAgentCount() view returns (uint256)",
];

// Module-level singleton — avoids creating a new HTTP connection per RPC call
// (previously a new JsonRpcProvider was created on every getAttestationRegistry() call).
let _provider: ethers.JsonRpcProvider | null = null;
export function getProvider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(RPC_URL);
  return _provider;
}

export function getAttestationRegistry(signerOrProvider?: ethers.Signer | ethers.Provider) {
  const p = signerOrProvider ?? getProvider();
  return new ethers.Contract(ATTESTATION_REGISTRY_ADDRESS, ATTESTATION_ABI, p);
}

export function getAgentRegistry(signerOrProvider?: ethers.Signer | ethers.Provider) {
  const p = signerOrProvider ?? getProvider();
  return new ethers.Contract(AGENT_REGISTRY_ADDRESS, AGENT_REGISTRY_ABI, p);
}
