# ProofLock Domain Guide

## Language Rules

- Say **verified Compute response** only after broker verification returns `true`.
- Say **Storage root** only after upload finalization and byte-for-byte retrieval verification.
- Say **onchain lease** or **onchain attestation record**, not universally “onchain-settled.”
- Say **scanner-issued and contract-enforced**, not “trustless” or “no centralized oracle.”
- Say **two analysis paths** only when both required coverage bits and nonzero commitments exist.
- A contract is analyzed as code/runtime state; an EOA is analyzed behaviorally. Do not describe contracts as originating normal top-level transactions.
- Seeded fictional cases must be visibly labeled `DEMO / FICTIONAL` everywhere.

## Invariants

- `proofComplete` means the lease reached `SEALED` after identity, deterministic, Compute, and Storage verification.
- No fallback can create a proof-shaped success value.
- The current record is versioned and replaceable; historical events/evidence are append-preserved.
- The public frontend cannot trigger paid infrastructure work.
