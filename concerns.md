# 0G Sentinel — Project Concerns
**Source:** Warroom V3 + universal concerns (severity-tagged)
**Scope mode:** EMERGENCY (2 days to deadline)

---

## CRITICAL [C] — Violation = eliminated

- [C] **0G Compute pipelines must produce verifiable receipt hashes.** Both pipelines must run on mainnet 0G Compute. Mock inference = disqualified. Each pipeline must return a receipt hash stored in the attestation.
- [C] **Mainnet deployment required.** Testnet-only = disqualified per PULSE Active Facts. Contracts must deploy to 0G Aristotle mainnet. Get mainnet tokens before Day 1 starts.
- [C] **Two independent 0G Compute calls.** One call shared between pipelines is not "two pipelines." Each pipeline is a separate 0G Compute inference call with a separate receipt hash.
- [C] **ERC-7857 attestation fields must be on-chain.** All 8 fields must be written to chain and visible in the explorer: behavioral_score, threat_level, code_risk, code_findings, behavioral_receipt_hash, code_receipt_hash, evidence_hash, attestation_timestamp.
- [C] **Demo must not fail live.** Pre-compute all scores 24h before demo. Cache everything. Live rescan is ONE agent only. Fallback: show cached attestations with receipt hashes if live call fails.

---

## IMPORTANT [I] — Score penalty if unaddressed

- [I] **AgentMesh differentiation must be explicit in README.** Judges will find AgentMesh. The README must contain the verbatim comparison: "AgentMesh audits developer code. 0G Sentinel audits live agents on mainnet and writes ERC-7857 on-chain identity attestations."
- [I] **Pre-seeded agents must exist before demo.** Agents A-H deployed to mainnet, scanned, attestations written. Dashboard must not appear empty.
- [I] **AgentGate.sol composability must be demonstrated.** Not optional — it proves the attestation is queryable infrastructure, not a dashboard feature. Agent B (VULNERABLE) transaction must revert.
- [I] **0G Storage evidence archive must work.** Evidence hash must resolve to retrievable data on 0G Storage. Even if not shown in demo, the hash in the attestation must be valid.
- [I] **README in English AND Chinese.** Required by hackathon rules.

---

## ADVISORY [A]

- [A] Dashboard polish is nice but secondary to working contracts and pipelines.
- [A] Architecture diagram for submission is good-to-have but not blocking.
- [A] X post with hashtags required for submission (#0GHackathon #BuildOn0G) — schedule this on Day 3.
