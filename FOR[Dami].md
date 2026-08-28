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

A contract, a plain EOA, and an EIP-7702 delegated EOA do not have the same security behavior. ProofLock classifies the live bytecode first, then runs only checks that make sense for that subject. Contract analysis follows confirmed proxy implementations; a conventional EIP-1967 storage slot alone is only a candidate, because any contract can write a benign address there. Delegated EOAs must point to live code and include the delegation target's code hash in drift monitoring. Plain EOAs use nonce, balance, and bounded transaction history; no history becomes caution, never evidence of safety.

### What Storage verification really proves

The current 0G Storage TypeScript SDK accepts `proof=true` on download but does not yet validate the network Merkle proof internally. ProofLock states that limitation explicitly. It still verifies a strong chain of facts: the exact canonical bytes produce a locally computed 0G root; the mainnet Flow transaction and `Submit` event bind that submission; the retrieved bytes are identical; and recomputing the 0G root after retrieval yields the same value. The evidence records network-proof validation as unavailable instead of upgrading an SDK capability that does not exist.

### What verified Compute means

ProofLock accepts only the decentralized model-TEE proof class. It does not turn an ordinary hosted-model response into a convincing-looking receipt. The verifier binds the exact raw request and response to the provider's onchain signer, model, service metadata, usage record, signature, and the two SHA-256 transcript halves signed by that provider. The official 0G SDK must independently return `true` before the result is eligible for sealing.

Some SDK operations cannot be cancelled from inside the library. ProofLock therefore runs them in disposable child processes. A deadline kills and reaps the child, so a hung SDK cannot freeze the application or leave a process-wide networking override behind.

Paid inference also creates a replay risk: the same valid receipt must not be reused for a different lease. ProofLock stores claims in a transactional SQLite ledger. The replay check, expiry cleanup, capacity check, and state change happen in one serialized transaction, eliminating the stale-lock races that a hand-rolled file lease would create. This operator path requires Node 24 and a persistent writable volume; the public read-only frontend does not need that authority.
