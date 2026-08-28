# Sentinel ProofLock Build Report

## Status

In progress on `feature/sentinel-prooflock`.

## Baseline

- Hardhat: 89 passing.
- Root TypeScript: passing after Hardhat generated TypeChain bindings.
- Frontend TypeScript: passing.
- Source tree: clean before ProofLock initialization.

## Phase Ledger

| Phase | Status | Evidence |
|---|---|---|
| Scope and isolation | Complete | Approved scope, global worktree, green baseline |
| V2 contracts | Complete | 45 focused and 134 full Hardhat tests; spec and security reviews approved |
| Canonical evidence | Complete | 106 tests; spec and code-quality reviews approved |
| ERC-8004 identity | Complete | 116 focused and 222 full ProofLock tests; spec and code-quality reviews approved |
| Compute and Storage | Pending | Pending |
| Runner and APIs | Pending | Pending |
| Frontend | Pending | Pending |
| Mainnet and package | Pending | Pending |

## Contract Phase

- Commits: `f85345b`, `056ceab`, `2604b3b`.
- RED cycles: 32 missing-feature failures; 4 boundary/ABI failures; 8 quality-invariant failures.
- Final GREEN: 45 focused tests, 134 full tests, root typecheck, and diff check.
- Reviews: specification compliant; no open Critical or Important code-quality findings.
- Deferred minors: shared registry interface extraction and nuanced ERC-8004 `ownerOf` revert classification.

## Canonical Evidence Phase

- Commits: `230c7f6`, `f4216ec`, `ad8e9f7`, `2cab8f9`.
- Strict evidence-v1 and StorageCommitment schemas, JCS bytes, Keccak hashes, and receipt binding.
- RED cycles exposed 63 cumulative missing invariants across coverage, provenance, hostile inputs, and cross-field joins.
- Final GREEN: 106 tests, frontend typecheck, production build, diff check.
- Reviews: specification compliant; no open Critical or Important code-quality findings.

## ERC-8004 Identity Phase

- Commits: `1c9d91e`, `ed035f5`, `0761b58`, `17a23a3`.
- Resolves `ownerOf`, `tokenURI`, and `getAgentWallet` at one stable finalized block, then revalidates the block after registration-card loading to reject reorg split-brain.
- Loads only strict HTTPS, IPFS, or bounded data URIs with DNS pinning, SSRF defenses, cumulative deadlines, transport cancellation, redirect limits, byte limits, and lossless `uint256` agent IDs.
- Verifies the registration-v1 type and exact agent-ID backlink, hashes the retrieved bytes, and returns a normalized immutable card rather than mutable source bytes.
- Final GREEN: 116 identity tests, 222 full ProofLock tests, frontend typecheck, and diff check.
- Reviews: specification compliant; no open Critical or Important code-quality findings.
