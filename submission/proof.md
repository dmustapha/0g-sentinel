# 0G Sentinel — Submission Proof

Generated: 2026-05-16T00:00:00.000Z
Network: 0G Aristotle Mainnet (Chain ID: 16661)
RPC: https://evmrpc.0g.ai

## Deployed Contracts

| Contract | Address | Explorer | Live |
|----------|---------|----------|------|
| AttestationRegistry | `0xB3E7048cef229fF5043CD2dBba296bF278d3F88d` | [View](https://chainscan.0g.ai/address/0xB3E7048cef229fF5043CD2dBba296bF278d3F88d) | ✅ |
| AgentRegistry | `0xcc1cd4550ec98DDcB19F9200331f3E96cab97fAc` | [View](https://chainscan.0g.ai/address/0xcc1cd4550ec98DDcB19F9200331f3E96cab97fAc) | ✅ |
| AgentGate | `0xCA3338Af9A1E0Df0539c3C8967597A56044D9360` | [View](https://chainscan.0g.ai/address/0xCA3338Af9A1E0Df0539c3C8967597A56044D9360) | ✅ |

## Agents in Registry

Total agents registered: 3
Total agents with attestations: 3
Threats detected (FLAGGED or VULNERABLE): 3 (all agents have at least one risk signal)

## Attestations Written On-Chain

| Agent Address | Behavioral | Code Risk | Attestation TX | Storage TX |
|--------------|------------|-----------|----------------|------------|
| 0xAAAA000000000000000000000000000000000001 | SAFE (5) | WARNING | [0x28a3c87...](https://chainscan.0g.ai/tx/0x28a3c87ae9fb8534c663f10d126f38e65ece68f04f2a762ce53010f0a9206c79) | [0xf99e5d9...](https://chainscan.0g.ai/tx/0xf99e5d92133ea96671037989d8691904d3167daed3635f255c28ab16a9477179) |
| 0xBBBB000000000000000000000000000000000002 | FLAGGED (98) | VULNERABLE | [0x3265878...](https://chainscan.0g.ai/tx/0x3265878611f65a2b3509efd2eab0a909fd81d675f3a6cb415eeadfab63342796) | [0x6e8f5b6...](https://chainscan.0g.ai/tx/0x6e8f5b6799f42eb5d0595292bfa76f015dd7fe569dd1ad222e87227365e2e2ba) |
| 0xCCCC000000000000000000000000000000000003 | FLAGGED (65) | VULNERABLE | [0xce23f15...](https://chainscan.0g.ai/tx/0xce23f1542efb6caa78be5de20fa34453040398f85b0271a8f08527df65e37ba7) | [0xb517b1e...](https://chainscan.0g.ai/tx/0xb517b1e2af49b97cc6667a2cb5d52811a2cf5e58237423af9e6665c4579a73ec) |

## 0G Integration Summary

- **0G Compute**: Two independent AI inference pipelines via `https://router-api.0g.ai/v1` — behavioral analysis (Pipeline 1) + code vulnerability scan (Pipeline 2). Each produces a unique `zg-res-key` receipt hash (bytes32 encoding a TEE chatID) stored on-chain. UI decodes receipts back to UUIDs, linkable to hardware-attested executions on Intel TDX + H100/H200 at pc.0g.ai.
- **0G Storage**: Evidence JSON uploaded to 0G distributed storage via `@0gfoundation/0g-ts-sdk`. Content-addressed root hash stored in `attestation.evidence_hash`. Merkle proof verification available via `POST /api/verify-evidence` (Indexer.download with proof=true).
- **0G Chain**: All attestations written to `AttestationRegistry` on 0G Aristotle Mainnet (Chain ID: 16661). Registry v2 adds append-only history (`getAttestationHistory`, `getAttestationHistoryCount`) — rescans preserve prior verdicts. Public REST API at `/api/v1/attestation/:address`.
- **AgentGate**: Composability primitive — gates agent execution based on attestation verdict. Emits `SentinelChecked(agent, safe, score, timestamp)` on every call for downstream monitoring.
- **ERC-7857**: Generic iNFT interface detection via `supportsInterface(0x4f694152)` + `dataHashesOf()` fallback — works for any ERC-7857 compliant contract, not just a specific deployment.
- **Fine-Tuning**: Attestation data packaged as `distilbert-base-uncased` training dataset, uploaded to 0G Storage, CLI command returned for `0g-compute-cli fine-tuning create-task`.

## Dashboard

URL: https://0g-sentinel.vercel.app
