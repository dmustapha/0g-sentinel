// File: frontend/lib/contracts.ts
import { ethers } from "ethers";

const ATTESTATION_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS ?? "";
const AGENT_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ?? "";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";

if (!ATTESTATION_REGISTRY_ADDRESS) {
  console.warn("[contracts] NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS is not set");
}
if (!AGENT_REGISTRY_ADDRESS) {
  console.warn("[contracts] NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS is not set");
}

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

export const PROOFLOCK_REGISTRY_V2_ABI = [
  "function getProofLock(bytes32 identityKey) view returns ((bytes32 identityKey,address subject,bytes32 envelopeDigest,bytes32 storageRoot,bytes32 computeRoot,bytes32 artifactHash,bytes32 runtimeCodeHash,uint64 version,uint48 issuedAt,uint48 validUntil,uint32 policyVersion,uint8 behavioralScore,uint8 codeRisk,uint8 coverage,uint8 state,uint8 stateReason))",
] as const;

export const AGENT_GATE_V2_ABI = [
  "function checkAgent(uint256 agentId) view returns (bool allowed,uint8 reason,address subject,uint64 version)",
] as const;

export async function readGateDecision(agentId: string) {
  if (!/^(0|[1-9]\d*)$/.test(agentId)) throw new Error("Invalid ERC-8004 agent ID");
  const address = process.env.NEXT_PUBLIC_AGENT_GATE_V2_ADDRESS ?? process.env.NEXT_PUBLIC_AGENT_GATE_ADDRESS;
  if (!address || !ethers.isAddress(address)) throw new Error("AgentGateV2 is not configured");
  const result = await new ethers.Contract(address, AGENT_GATE_V2_ABI, getProvider()).checkAgent(BigInt(agentId));
  return Object.freeze({ allowed: result.allowed === true, reason: Number(result.reason),
    subject: String(result.subject).toLowerCase(), version: BigInt(result.version).toString() });
}

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
