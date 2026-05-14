# 0G Sentinel — Submission Proof

Generated: 2026-05-14T05:31:05.591Z
Network: 0G Aristotle Mainnet (Chain ID: 16661)
RPC: https://evmrpc.0g.ai

## Deployed Contracts

| Contract | Address | Explorer | Live |
|----------|---------|----------|------|
| AttestationRegistry | `0xB9431b3be9a56a1eeA8E728326332f8B4dD51382` | [View](https://chainscan.0g.ai/address/0xB9431b3be9a56a1eeA8E728326332f8B4dD51382) | ✅ |
| AgentRegistry | `0x5F6a3AbC97E421f7B3930fc504D6a0CE4eE41e06` | [View](https://chainscan.0g.ai/address/0x5F6a3AbC97E421f7B3930fc504D6a0CE4eE41e06) | ✅ |
| AgentGate | `0x8E107bAC6f430aecB8Aa11B383E9690e9a5214bE` | [View](https://chainscan.0g.ai/address/0x8E107bAC6f430aecB8Aa11B383E9690e9a5214bE) | ✅ |

## Agents in Registry

Total agents registered: 3
Total agents with attestations: 3

## Attestations Written On-Chain


| Agent Address | Behavioral | Code Risk | Behavioral Receipt Hash (truncated) |
|--------------|------------|-----------|-------------------------------------|
| 0xAAaA000000000000000000000000000000000001 | CAUTION | WARNING | 0xbb4f17f527044a3390... |
| 0xBbbb000000000000000000000000000000000002 | CAUTION | VULNERABLE | 0xab77e35cd1ab46f494... |
| 0xccCc000000000000000000000000000000000003 | CAUTION | WARNING | 0x3be82a4697f8410c98... |

## 0G Integration Summary

- **0G Compute**: Two independent AI inference pipelines via `https://router-api.0g.ai/v1` — behavioral analysis (Pipeline 1) + code vulnerability scan (Pipeline 2). Each produces a unique receipt hash stored on-chain in the attestation struct.
- **0G Storage**: Evidence JSON archived via `@0glabs/0g-ts-sdk`. Root hash stored in `attestation.evidenceHash`.
- **0G Chain**: All attestations written to `AttestationRegistry` on 0G Aristotle Mainnet (Chain ID: 16661). Immutable, 8-field struct, verifiable by any dApp.
- **AgentGate**: Composability primitive — gates agent execution based on attestation verdict. Reads directly from `AttestationRegistry`.

## Dashboard

URL: https://frontend-alpha-seven-62.vercel.app
