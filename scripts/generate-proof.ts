// File: scripts/generate-proof.ts
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

async function main() {
  const rpcUrl = process.env.ZERO_G_RPC || "https://evmrpc.0g.ai";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const registryAddr = process.env.ATTESTATION_REGISTRY_ADDRESS || "";
  const agentRegistryAddr = process.env.AGENT_REGISTRY_ADDRESS || "";
  const gateAddr = process.env.AGENT_GATE_ADDRESS || "";

  if (!registryAddr || !agentRegistryAddr || !gateAddr) {
    console.error("Missing contract addresses in .env — set ATTESTATION_REGISTRY_ADDRESS, AGENT_REGISTRY_ADDRESS, AGENT_GATE_ADDRESS");
    process.exit(1);
  }

  // Verify contracts are live (code != 0x means contract exists)
  const [registryCode, agentCode, gateCode] = await Promise.all([
    provider.getCode(registryAddr),
    provider.getCode(agentRegistryAddr),
    provider.getCode(gateAddr),
  ]);

  // Read agent count from registry
  const agentRegistryABI = ["function getAllAgents() view returns (address[])"];
  const agentRegistry = new ethers.Contract(agentRegistryAddr, agentRegistryABI, provider);
  const allAgents: string[] = await agentRegistry.getAllAgents().catch(() => []);

  // Read attestations directly from AttestationRegistry (getAllAttestedAgents is the correct source)
  const attestationABI = [
    "function getAllAttestedAgents() view returns (address[])",
    "function hasAttestation(address agentAddress) view returns (bool)",
    "function getAttestation(address agentAddress) view returns (tuple(uint8 behavioral_score, uint8 threat_level, uint8 code_risk, string code_findings, string reasoning, bytes32 behavioral_receipt_hash, bytes32 code_receipt_hash, bytes32 evidence_hash, uint256 attestation_timestamp))",
  ];
  const attestationRegistry = new ethers.Contract(registryAddr, attestationABI, provider);

  const attestedAgents: string[] = await attestationRegistry.getAllAttestedAgents().catch(() => []);

  const attestedRows: string[] = [];
  for (const addr of attestedAgents.slice(0, 10)) {
    const att = await attestationRegistry.getAttestation(addr).catch(() => null);
    if (att) {
      attestedRows.push(`| ${addr} | ${["SAFE","CAUTION","FLAGGED"][Number(att.threat_level)]} | ${["CLEAN","WARNING","VULNERABLE"][Number(att.code_risk)]} | ${String(att.behavioral_receipt_hash).slice(0,20)}... |`);
    }
  }

  const explorerBase = "https://chainscan.0g.ai/address";
  const txExplorer = "https://chainscan.0g.ai/tx";
  const networkName = "0G Aristotle Mainnet (Chain ID: 16661)";

  const proof = `# 0G Sentinel — Submission Proof

Generated: ${new Date().toISOString()}
Network: ${networkName}
RPC: ${rpcUrl}

## Deployed Contracts

| Contract | Address | Explorer | Live |
|----------|---------|----------|------|
| AttestationRegistry | \`${registryAddr}\` | [View](${explorerBase}/${registryAddr}) | ${registryCode !== "0x" ? "✅" : "❌ NOT DEPLOYED"} |
| AgentRegistry | \`${agentRegistryAddr}\` | [View](${explorerBase}/${agentRegistryAddr}) | ${agentCode !== "0x" ? "✅" : "❌ NOT DEPLOYED"} |
| AgentGate | \`${gateAddr}\` | [View](${explorerBase}/${gateAddr}) | ${gateCode !== "0x" ? "✅" : "❌ NOT DEPLOYED"} |

## Agents in Registry

Total agents registered: ${allAgents.length}
Total agents with attestations: ${attestedAgents.length}

## Attestations Written On-Chain

${attestedRows.length === 0 ? "No attestations found — run seed-demo.ts first." : ""}
${attestedRows.length > 0 ? `| Agent Address | Behavioral | Code Risk | Behavioral Receipt Hash (truncated) |\n|--------------|------------|-----------|-------------------------------------|\n${attestedRows.join("\n")}` : ""}

## 0G Integration Summary

- **0G Compute**: Two independent AI inference pipelines via \`https://router-api.0g.ai/v1\` — behavioral analysis (Pipeline 1) + code vulnerability scan (Pipeline 2). Each produces a unique receipt hash stored on-chain in the attestation struct.
- **0G Storage**: Evidence JSON archived via \`@0glabs/0g-ts-sdk\`. Root hash stored in \`attestation.evidenceHash\`.
- **0G Chain**: All attestations written to \`AttestationRegistry\` on ${networkName}. Immutable, 8-field struct, verifiable by any dApp.
- **AgentGate**: Composability primitive — gates agent execution based on attestation verdict. Reads directly from \`AttestationRegistry\`.

## Dashboard

URL: ${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}
`;

  const outDir = path.resolve("submission");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "proof.md");
  fs.writeFileSync(outPath, proof);
  console.log(`\nsubmission/proof.md written to: ${outPath}`);
  console.log(proof);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
