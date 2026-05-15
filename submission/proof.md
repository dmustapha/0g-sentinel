# 0G Sentinel — Submission Proof

Generated: 2026-05-15T00:00:00.000Z
Network: 0G Aristotle Mainnet (Chain ID: 16661)
RPC: https://evmrpc.0g.ai

## Deployed Contracts

| Contract | Address | Explorer | Live |
|----------|---------|----------|------|
| AttestationRegistry | `0x3c0331A8B7a4543284a05990432B3Bb2f2a749Ba` | [View](https://chainscan.0g.ai/address/0x3c0331A8B7a4543284a05990432B3Bb2f2a749Ba) | ✅ |
| AgentRegistry | `0x0c578A4B7F0985D4599A319634649ACbd8D377d4` | [View](https://chainscan.0g.ai/address/0x0c578A4B7F0985D4599A319634649ACbd8D377d4) | ✅ |
| AgentGate | `0xFdEc01255F37Ad49AEcbdfD690309efD97dc5012` | [View](https://chainscan.0g.ai/address/0xFdEc01255F37Ad49AEcbdfD690309efD97dc5012) | ✅ |

## Agents in Registry

Total agents registered: 3
Total agents with attestations: 3

## Attestations Written On-Chain

| Agent Address | Behavioral | Code Risk | Attestation TX |
|--------------|------------|-----------|----------------|
| 0xAAAA000000000000000000000000000000000001 | SAFE | WARNING | [0xf44a924...](https://chainscan.0g.ai/tx/0xf44a92465525ff1bc52e52190e0bfe889af5ba76832f4508b4d5d11d48a1a05b) |
| 0xBBBB000000000000000000000000000000000002 | FLAGGED | VULNERABLE | [0x9cd1643...](https://chainscan.0g.ai/tx/0x9cd1643be13649041f7058440f1922fed31503c08535baf3d82112eab1848d02) |
| 0xCCCC000000000000000000000000000000000003 | CAUTION | VULNERABLE | [0x5a528b9...](https://chainscan.0g.ai/tx/0x5a528b9aacb285b5e370b8268009c8d04a45fdef0c61054311aff0729ff2cb53) |

## 0G Integration Summary

- **0G Compute**: Two independent AI inference pipelines via `https://router-api.0g.ai/v1` — behavioral analysis (Pipeline 1) + code vulnerability scan (Pipeline 2). Each produces a unique `zg-res-key` receipt hash stored on-chain in the attestation struct.
- **0G Storage**: Evidence JSON archived via `@0gfoundation/0g-ts-sdk`. Root hash stored in `attestation.evidence_hash`. Falls back to SHA256 content hash when indexer is unreachable.
- **0G Chain**: All attestations written to `AttestationRegistry` on 0G Aristotle Mainnet (Chain ID: 16661). Immutable 9-field struct (including LLM reasoning) verifiable by any dApp via `getAttestation()`.
- **AgentGate**: Composability primitive — gates agent execution based on attestation verdict. Reads directly from `AttestationRegistry` with freshness check via `isSafeWithAge()`.

## Dashboard

URL: https://0g-sentinel.vercel.app
