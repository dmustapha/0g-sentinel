# ProofLock Feature Observables

| Feature | User-visible proof |
|---|---|
| ERC-8004 identity | Agent ID, current agent wallet, registry, resolution block |
| Verified Compute | Provider/model plus explicit `verified` state; no fallback receipt |
| Verified Storage | Root, upload transaction, retrieval match, independent health |
| Admission lease | Version, issue/expiry times, policy, coverage, lifecycle state |
| Gate decision | Allowed/blocked status with stable reason code |
| Drift | Before/after runtime commitment and blocked consumer action |
| Reseal | New version, superseded event, restored consumer action |
| Honest trust model | Scanner/guardian address and centralization disclosure |
| Bounded discovery | Signed block range and result cap; complete inventory remains explicitly deferred |
| Legacy separation | Old deployments labeled legacy and excluded from current proof |

Every observation is scoped as `HISTORICAL` or `CURRENT` and uses one explicit status: `VERIFIED`, `BLOCKED`, `UNAVAILABLE`, `STALE`, `MISMATCH`, or `NOT_APPLICABLE`. Historical verification covers checks, Compute, Storage, and Registry provenance. Current verification covers lease, Gate, consumer policy, and an explicit Registry current-record read; identity can be observed in either plane. `BLOCKED` is current policy only. Current observations carry strict server-issued block/time metadata, a TTL, and `freshnessExpiresAt` bound to `observedAt + ttlMs`, so serialization cannot reset freshness. Historical proof validity remains independent of current provider access.

Compute claims name the SDK version and method, provider/model, `DECENTRALIZED_MODEL_TEE`, `processResponseVerified: true`, and the canonical bound receipt/transcript/artifact hashes. Storage claims bind a complete verified observation, remain `ROOT_MATCHED_NO_NETWORK_PROOF`, keep `networkProofVerified: false` visible, and use `storageUploadTxHash` separately from Registry provenance in `registrySourceTxHash`. Admission claims require successful lease, Gate, and consumer observations at one freshness coordinate; chain-history and authority claims bind their named source transactions. Public copy is default-denied unless produced from a typed claim-registry key with validated per-key evidence context or the validated Compute capability formatter; it cannot claim universal safety, continuous monitoring, an offline verifier, an immutable verdict, complete discovery, unsupported TEE attestation, or verified Storage network proof.

The primary demo must show `allowed → drifted/blocked → resealed/allowed` without hidden mutations or fabricated records.
