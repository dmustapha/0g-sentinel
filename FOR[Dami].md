# FOR[Dami]: Sentinel ProofLock

## The Product in Plain English

Sentinel used to publish security scores. ProofLock turns a verified score into a temporary permission another smart contract can enforce.

An agent first proves which ERC-8004 identity and wallet it currently controls. Sentinel runs deterministic checks and a 0G Compute analysis, stores the exact evidence on 0G Storage, retrieves it to prove it is really there, and seals a seven-day lease on 0G Chain. AgentGateV2 then answers one question for any consumer: “May this agent act right now?”

The important upgrade is not another dashboard. It is the fail-closed chain connecting evidence to action.

## Why the Lease Expires

Security evidence becomes stale. A seven-day lease forces periodic re-evaluation, while a 30-day contract maximum prevents a scanner from accidentally issuing effectively permanent approval.

## What the Product Does Not Claim

One authorized wallet still issues and can revoke leases in this hackathon release. ProofLock discloses that trust boundary. It guarantees explicit provenance, reproducible evidence, freshness, drift checks, and contract enforcement—not decentralized consensus among auditors.

## Build Notes

### The three-contract core

- `SentinelRegistryV2` stores the latest compact lease. Scanner and guardian permissions are separate, every lease has complete proof commitments, and old versions are reconstructible from events.
- `AgentGateV2` resolves the current ERC-8004 agent wallet and returns a stable reason code. A wallet change, expired lease, stale policy, missing coverage, risk failure, revocation, drift, or direct runtime-code change fails closed.
- `ProofLockConsumerDemo` proves enforcement. The admitted agent must be the caller; knowing a safe agent ID is not enough to borrow its permission.

The tests cover the full demo lifecycle: admitted action, drift block, expiry block, and resealed admission. They also exercise malformed registry data, hostile constructor settings, caller spoofing, state-transition conflicts, and exact timestamp boundaries.

### Why canonical evidence matters

JSON objects can look identical to a person while producing different bytes because keys, address casing, numbers, or malformed Unicode differ. ProofLock validates one strict evidence-v1 schema, normalizes addresses, serializes with JCS, and Keccak-hashes the exact UTF-8 bytes. The same facts therefore create the same commitment; different facts create a different one.

The pre-upload envelope explicitly says Storage is still pending. Only a separate `StorageCommitment`—with a real root, upload transaction, and retrieved digest equal to the envelope digest—can advance coverage from `0x5f` to the sealed `0x7f`. This prevents a content hash or failed retrieval from masquerading as verified 0G Storage.

### Why ERC-8004 resolution is a security boundary

ProofLock does not trust a wallet address typed into a form. It resolves the agent owner, metadata URI, and active agent wallet from the canonical 0G ERC-8004 registry at one finalized block. After downloading and validating the registration card, it reads that block again; if the block hash changed, the scan is rejected and retried instead of joining facts from two chain histories.

Registration-card retrieval is intentionally hostile-input code. It rejects private-network destinations and mixed DNS answers, pins the validated public IP to the HTTPS request, disables connection reuse, follows only bounded safe redirects, enforces one absolute deadline and byte limit, and preserves very large agent IDs without JavaScript rounding. The returned card is normalized and immutable, and its digest commits to the exact bytes fetched.

### Why subject type changes the audit

A contract, a plain EOA, and an EIP-7702 delegated EOA do not have the same security behavior. ProofLock classifies the live bytecode first, then runs only checks that make sense for that subject. Contract analysis follows confirmed proxy implementations; a conventional EIP-1967 storage slot alone is only a candidate, because any contract can write a benign address there. Delegated EOAs must point to live code and include the delegation target's code hash in drift monitoring. Plain EOAs use nonce, balance, and bounded transaction history; no history becomes caution, never evidence of safety. V2 analyzes nested executables but refuses to seal them because AgentGateV2 cannot yet recheck their target code on every action.

### What Storage verification really proves

The current 0G Storage TypeScript SDK accepts `proof=true` on download but does not yet validate the network Merkle proof internally. ProofLock states that limitation explicitly. It still verifies a strong chain of facts: the exact canonical bytes produce a locally computed 0G root; the mainnet Flow transaction and `Submit` event bind that submission; the retrieved bytes are identical; and recomputing the 0G root after retrieval yields the same value. The evidence records network-proof validation as unavailable instead of upgrading an SDK capability that does not exist.

### What verified Compute means

ProofLock accepts only the decentralized model-TEE proof class. It does not turn an ordinary hosted-model response into a convincing-looking receipt. The verifier binds the exact raw request and response to the provider's onchain signer, model, service metadata, usage record, signature, and the two SHA-256 transcript halves signed by that provider. The official 0G SDK must independently return `true` before the result is eligible for sealing.

Some SDK operations cannot be cancelled from inside the library. ProofLock therefore runs them in disposable child processes. A deadline kills and reaps the child, so a hung SDK cannot freeze the application or leave a process-wide networking override behind.

Paid inference also creates a replay risk: the same valid receipt must not be reused for a different lease. ProofLock stores claims in a transactional SQLite ledger. The replay check, expiry cleanup, capacity check, and state change happen in one serialized transaction, eliminating the stale-lock races that a hand-rolled file lease would create. This operator path requires Node 24 and a persistent writable volume; the public read-only frontend does not need that authority.

### Why the runner is more than orchestration

The runner is the transaction boundary for the whole product. It executes identity, classification, deterministic checks, Compute, canonicalization, Storage, Chain write, and Chain readback in one fixed sequence. If any stage fails, no later stage is called. A progress listener may describe what is happening, but it cannot change the evidence or make a failed scan appear sealed.

The contract also checks the analyzed runtime hash at the exact moment the lease is mined. This matters because code could change after the runner's preflight but before transaction execution. Without the contract check, the runner could notice the mismatch only after an ACTIVE lease had already been created. Reseals similarly include the exact prior version, so two competing updates cannot both advance from the same proof.

Drift detection is intentionally on demand, not continuous monitoring. The operator recomputes the identity, card, subject, runtime, proxy or delegation target, implementation hash, and policy fingerprint. If it changed, the drift transaction names the version being invalidated and is accepted only after its calldata, finalized receipt, event, and onchain readback all agree.

### Why the public verifier is trustworthy

The public proof endpoint does not rerun paid inference and does not trust a stored `verified: true` flag. It retrieves the exact evidence and checks the provider's EIP-191 signature, signed request/response transcript, expected signer, provider, model, and current decentralized model-TEE service metadata. It then retrieves the Storage artifact, recomputes its 0G root, recovers the finalized Flow submission transaction and event, reconstructs the canonical Storage commitment, and requires that commitment to match the Registry's `artifactHash`.

Older Sentinel records remain visible as history, but they cannot pass this stricter verifier if they lack the new provenance extension. That is deliberate: backward readability is not backward trust.

### Public reads and operator authority

Public endpoints can resolve identities, read current ProofLocks, discover emitted locks, verify proofs, and inspect health. They cannot start inference, upload Storage, fund ledgers, write leases, or enqueue background scans. Operator mutations require a strong server-only bearer token, and disconnecting from the progress stream aborts the synchronous runner so paid work does not silently continue.

Health is evidence, not theater. It independently checks 0G chain ID, ERC-8004, RegistryV2, AgentGateV2, strict Compute service metadata, and a previously sealed Storage canary. Missing configuration is `UNKNOWN`, required failures return `503`, and Compute health performs no paid inference.

### Why the production operator is part of the trust model

The server no longer loads an operator implementation from an environment-selected file. The production composition
is compiled with the application, and both the HTTP path and maintenance CLIs use it. That matters because otherwise
the public UI could look strict while an entirely different runtime module issued the real leases.

The Compute SDK receives a separate payer key with no Registry role. The scanner key signs Storage and Registry operations. ProofLock compares that configured scanner with the
key-derived address, its live Registry role, the submitted transaction sender, and the finalized transaction sender.
The guardian key is distinct and only marks drift. Browser callers cannot choose either role, the registry, the policy,
the scanner software label, or lease duration.

Behavioral risk and code risk both live inside the canonical evidence verdict. The public verifier compares both values
with the Registry record, so an authorized writer cannot present valid evidence while quietly weakening a Gate-driving score.

The Compute SDK worker is a self-contained file inside the production standalone artifact. The ESM source and its
runtime dependencies are bundled into a Node CommonJS child so transitive dynamic requires remain valid without a
development `node_modules` tree. Deadline cancellation still kills the process.
