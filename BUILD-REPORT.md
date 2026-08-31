# Sentinel ProofLock Build Report

## Status

Local release candidate complete on `feature/sentinel-prooflock`. Mainnet deployment is credential-gated.

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
| Runner and APIs | Complete | Runner/drift and API/auth/health corrective reviews approved |
| Frontend | Complete | Proof-ledger UI, historical verifier, trust/provenance surfaces, guarded consumer |
| Production operator | Complete | Built-in server composition, signer binding, durable state, standalone artifact smoke |
| Mainnet and package | Blocked externally | Requires funded scanner/guardian/deployer keys and acknowledged Compute provider/model |

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
- Nested executables are analyzed but are not lease-eligible in V2 because AgentGateV2 cannot recheck their target code on every consumer action.
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

## Controlled Runner and Drift Phase

- Commits: `d398080`, `d9c758d`, `9d2cc62`.
- Executes the ten ProofLock stages synchronously in fixed order and proves that a failure at any stage produces no later-stage side effect.
- Recomputes canonical evidence and commitments inside the runner; progress callbacks and injected digest values cannot control proof truth.
- Atomically binds the analyzed runtime hash and expected prior version inside `SentinelRegistryV2`, closing the mining-window and competing-reseal races before state or events change.
- Requires exact behavioral score, verdict risk, and policy-label agreement before Storage or Chain can run.
- Derives a domain-separated predecessor proof ID from the current onchain record and verifies it before reseal.
- On-demand drift writes are expected-version-bound and verify chain, code, calldata, receipt, finality, exactly one event, and drifted readback before reporting success.
- Final GREEN: 58 focused runner tests, 452 full ProofLock tests, 140 Hardhat tests, both TypeScript checks, and the Next production build.
- Reviews: contract/runtime and runner corrective reviews found no open Critical or Important issues.

## API, Auth, and Health Phase

- Commits: `ddfc61c`, `b4e5be4`.
- Public routes are read-only; authenticated admin SSE and drift routes use a 32–256 byte server-only bearer token with constant-time digest comparison.
- SSE request abort and response-body cancellation share one signal that stops the synchronous runner before later paid stages; admin bodies are streamed with a hard 16 KiB cutoff.
- Six legacy public mutation routes return structured `410 GONE`; discovery reads ProofLock events and has no queue, `waitUntil`, or background scan behavior.
- Every contract read first performs a bounded raw `eth_chainId` check for 16661; static-network assumptions are removed.
- Public proof verification rechecks exact Compute transcript bytes, EIP-191 signature, signer/provider/model, live decentralized separated model-TEE service state, retrieved Storage bytes/root, finalized Flow transaction/event/calldata, and the canonical Storage commitment against onchain `artifactHash` without paid inference.
- Health reports six independent timed probes and returns `503` when a required dependency is failed or unknown. Compute health uses the read-only broker and never loads a wallet, funds a ledger, or performs inference.
- Legacy evidence remains parseable but fails strict public verification when the bounded provenance extension is absent; it is never silently upgraded.
- Final GREEN: 42 focused API/health tests, 502 combined ProofLock/API tests, 140 Hardhat tests, both TypeScript checks, and the Next production build.
- Reviews: independent corrective security review found no open Critical or Important issues.
- Operational note: set `PROOFLOCK_STORAGE_FLOW_FROM_BLOCK` near deployment to bound public Flow event recovery cost.

## Frontend and Release Hardening Phase

- Commits: `8195e61`, `182867a`, `be45702`, `416b863`, `30afeee`, `8e15fec`, `677140a`, `7b37b7b`.
- Replaced the legacy score dashboard with ERC-8004 resolution, current ProofLock inventory, agent detail,
  historical proof verification, six independent health observations, explicit mismatch taxonomy, and a
  caller-bound guarded-consumer result.
- Historical pages display the emitting RegistryV2 address, transaction, block, log index, predecessor proof,
  evidence commitments, and the distinction between historical artifact validity and current admission.
- Browser mutations send only identity, mode, expected prior version, and predecessor proof. Policy, scanner,
  registry, software version, and TTL are injected by the server.
- Responsive browser verification passed at 390 px and 320 px for all five primary and historical routes with
  no horizontal overflow, console errors, or missing keyboard focus indicators.

## Production Operator and Final Local Gates

- Commit: `e812197`.
- Ships one built-in production composition; runtime-selected executable modules are removed from the API and CLIs.
- Startup enforces Node 24, 0G mainnet chain `16661`, canonical Chain/Storage dependencies, explicit paid-operation
  consent, durable absolute state, key-to-address equality, distinct scanner/guardian custody, and live RegistryV2 roles.
- The scanner transaction sender is checked on submission, finalized transaction recovery, and runner readback.
- A separate Compute payer key has no Registry authority; the separated admin/scanner/guardian role matrix is rechecked before every mutation.
- The Compute worker and its runtime dependencies are bundled into one isolated Node artifact and output-traced into the standalone release.
- Final local evidence: 622/622 frontend tests, 151/151 Hardhat contract/deployment tests, root and frontend
  TypeScript checks, clean Next production build, standalone home `200`, independent health `503 DEGRADED` without
  canaries, unauthenticated operator `401`, and authenticated operator fail-closed dependency response without secrets.
- Not yet provable locally: paid mainnet Compute, Storage upload/retrieval, V2 deployment receipts, restart replay,
  and seal → consumer → drift → reseal. These require the real funded deployment profile and cannot be fabricated.
- Production dependency audit still reports upstream advisories in the pinned official 0G Compute/Storage SDK trees
  and in the Next 14 line. Compatible fixes were applied and Next moved to 14.2.35; clearing the remainder requires
  upstream SDK releases and a separately tested Next major migration, not an unreviewed forced upgrade.
- Both Gate-driving risk fields are canonical evidence: public verification requires the stored behavioral and code
  risks to equal the onchain record, and every mutation proves the Compute payer holds no Registry authority.

## Mainnet Release Evidence (2026-08-31)

Everything previously marked "not yet provable locally" is now proven on 0G Aristotle mainnet
(chainId 16661). Full transaction/root/block evidence is in `submission/proof.md`.

- V2 deployment receipts: SentinelRegistryV2 `0x1d802114cfAFFd179f49E2F6fa8e11207c118944` (block 43090189),
  AgentGateV2 `0x32Ae81B1150AA7E91d8341E59b3810950e7A1171`, ProofLockConsumerDemo `0x71823afFA086f6a4Be64B67142480Fa889Cd0773`.
- ERC-8004 agent `3527152` registered on the canonical registry, agentWallet == subject `0xDaA09b710cDB279AF411e4a9C4C79D00bfDB282f`.
- Paid mainnet Compute: real TeeML (Intel TDX/dstack) inference on provider `0xd9966e13…C471C`, enclave signer
  `0x4c1b546f…17ee8`, response bound to exact bytes, offline re-verify passed.
- Storage upload/retrieval: evidence uploaded to 0G Storage (roots `0xade600cc…` v1, `0x1891d590…` v2) and
  independently re-downloaded with merkle proof by the public verifier.
- Full seal → consumer → drift → recover → reseal → verify lifecycle sealed on-chain (identity key
  `0xf89c3979…56d78`): SEAL v1 ALLOWED → consumer accepted → drift marked → DENIED → fresh-process recover →
  RESEAL v2 ALLOWED → consumer accepted → public verifier reproduced proofId `0xa4c3bf5c…28e7c2`.
- Live dashboard deployed (not localhost): https://sentinel-prooflock.vercel.app, health `200 HEALTHY`
  (rpc/identity/registry/gate/compute/storage), CSP + HSTS + nosniff + X-Frame DENY, no secrets in the client bundle.
- Release-run test counts: frontend 1416/1416 passing; root Hardhat contract/deployment suite and both
  TypeScript checks clean. Six live-only bugs were found and fixed by running the real ceremony (BigInt
  canonicalization, transient Compute retry, EOA code-risk invariant, null-content prompt, storage from-block
  scan bound, and multi-subtree Flow-commitment root folding).
