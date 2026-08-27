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
| Legacy separation | Old deployments labeled legacy and excluded from current proof |

The primary demo must show `allowed → drifted/blocked → resealed/allowed` without hidden mutations or fabricated records.
