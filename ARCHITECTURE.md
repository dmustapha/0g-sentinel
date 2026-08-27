# Sentinel ProofLock Architecture

## Trust Boundary

ProofLock is not a trustless auditor. A disclosed scanner/guardian EOA produces evidence. The system makes that evidence provenance-explicit, retrievable, time-bounded, drift-aware, and enforceable by a consumer contract.

## Joined Proof Path

`ERC-8004 agent → finalized identity resolution → subject classification → deterministic checks → verified 0G Compute → canonical envelope → 0G Storage upload/retrieval comparison → SentinelRegistryV2 lease → AgentGateV2 → consumer action`

Every stage fails closed. A hosted fallback, synthetic receipt, content hash masquerading as a Storage root, stale health timestamp, or unset agent wallet cannot produce an active lease.

## Contract Layer

`SentinelRegistryV2` stores the latest compact ProofLock record, version, coverage, provenance commitments, TTL, runtime code hash, and lifecycle state. It append-preserves transitions through events.

`AgentGateV2` resolves the current ERC-8004 agent wallet and returns a stable reason code. It rejects identity mismatch, changed subjects, runtime drift, expiry, stale policy, incomplete coverage, and risk threshold failures.

`ProofLockConsumerDemo` changes one visible state value only after `requireAgent` succeeds.

## Evidence Layer

Canonical JSON is JCS-compatible and Keccak-256 hashed. The envelope binds identity, finalized block, registration card, subject, deterministic checks, verified Compute provenance, verdict, omissions, validator, and prior proof. Storage root and upload transaction form a separate onchain commitment because they only exist after upload.

## Application Layer

Public routes only read indexed/onchain proof. Admin-authenticated endpoints create or reseal proofs. Health checks probe Chain, Compute, and Storage independently and report degraded states without converting them into success.

## Frozen Domain Constants

- Identity key: `keccak256(abi.encode(16661, identityRegistry, agentId))`.
- Required coverage mask: `0x7f`.
- Subject kinds: `EOA`, `EIP7702_DELEGATED_EOA`, `CONTRACT`.
- Product TTL: seven days; registry maximum: 30 days.
- Stable reasons: `ALLOWED`, `NO_PROOF`, `REVOKED`, `DRIFTED`, `EXPIRED`, `SUBJECT_CHANGED`, `RUNTIME_CODE_DRIFT`, `POLICY_TOO_OLD`, `COVERAGE_INCOMPLETE`, `COMPUTE_UNVERIFIED`, `STORAGE_UNVERIFIED`, `BEHAVIORAL_RISK`, `CODE_RISK`, `IDENTITY_UNAVAILABLE`, `AGENT_NOT_FOUND`, `AGENT_WALLET_UNSET`, `IDENTITY_MISMATCH`.
