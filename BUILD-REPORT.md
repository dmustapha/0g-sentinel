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
| Subject analysis | Complete | 67 focused tests; spec and code-quality reviews approved |
| Strict Storage | Complete | 42 focused tests; corrective security review approved |
| Strict Compute | Complete | 53 focused tests; transactional replay store; corrective security review approved |
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

## Subject Analysis Phase

- Commits: `2a076cf`, `7b87bef`, `422e60e`, `03ba0e7`.
- Classifies plain EOAs, exact EIP-7702 delegated EOAs, and contracts at one block number and hash; the source block is rechecked after analysis.
- Uses subject-appropriate checks: bounded EOA history snapshots, live delegation targets, exact EIP-1167 clones, candidate-only EIP-1967 slots, and resolver-bound proxy/source metadata.
- Converts analysis into the exact canonical evidence shape through one tested adapter; dead targets, malformed RPC values, unbound sources, and reorg splits fail closed.
- Final GREEN: 67 focused tests; independent review found no open Critical or Important issues.

## Strict Storage Phase

- Commits: `66985de`, `0b872bb`.
- Uses exact `@0gfoundation/0g-storage-ts-sdk@1.2.11` canonical bytes and independently recomputes the SDK's 0G root before upload and after retrieval.
- Binds chain ID 16661, expected Flow contract, submit calldata, receipt, and exactly one matching `Submit` event to the locally computed submission.
- Persists upload state before broadcast and reconciles submitted transactions after interruption; no SHA/content-hash fallback exists.
- The SDK's `proof=true` path does not yet validate network Merkle proofs, so evidence records `networkProofVerified: false` and never claims otherwise. `retrievalVerified` means exact bytes, digest, and independently recomputed 0G root all match.
- Final GREEN: 42 focused tests; independent review found no open Critical or Important issues.

## Strict Compute Phase

- Commits: `f494f5c`, `3c42d79`, `134a727`, `347b8b8`, `a446518`, `8bbba41`, `1499a2c`.
- Accepts only decentralized model-TEE proofs and rejects hosted-router or unsupported proof classes; no receipt-like fallback can become ProofLock evidence.
- Binds provider, model, signer, signature, raw request, raw response, usage, response headers, and the provider-signed SHA-256 transcript before the official SDK result is accepted.
- Runs non-cancellable official SDK operations in disposable child processes. Deadline expiry kills and reaps the child; main-process `fetch` is never replaced.
- Prevents replay and equivocation with a Node 24 transactional SQLite ledger. Claim, renewal, commit, release, expiry GC, and byte/record capacity checks serialize under `BEGIN IMMEDIATE` with WAL and `synchronous=FULL`.
- RED cycles exposed wrong SDK response arguments, response replay, global-fetch mutation, unbounded SDK work, a retention clock race, unfenced filesystem locks, and capacity bypasses before the transactional design replaced the lease-file store.
- Final GREEN: 53 focused Compute tests, 394 full ProofLock tests, 134 Hardhat tests, both TypeScript checks, and the Next production build.
- Reviews: independent corrective security review found no open Critical or Important issues.
- Runtime constraint: paid mutation paths require Node 24 and persistent writable storage for the SQLite replay ledger. Public read-only surfaces may be deployed separately.
