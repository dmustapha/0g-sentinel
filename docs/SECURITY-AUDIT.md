# 0G Sentinel ProofLock — Security & Quality Audit (WS10)

Full read-only audit across every surface of the app, run before the 0G team
presentation. Three independent passes: (1) security of the TypeScript
seal/compute/identity/analysis layers, (2) code review of the deep-risk
pipeline and read path, (3) security of the Solidity contracts, admin
endpoints, and 0G Storage path.

**Verdict: no BLOCKER, no CRITICAL, no HIGH.** Gates green: `tsc --noEmit`
clean, 1501/1501 tests passing across 59 files. Two mechanical fixes landed
(commit `32cd29b`). Two open items remain, both requiring a product/infra
decision — neither is a vulnerability.

## Surfaces confirmed sound

| Surface | Result |
| --- | --- |
| TEE request/response binding (compute) | SOUND — response is exact-byte bound + EIP-191 verified against on-chain signer; request-hash relaxation is transparency-only, cannot forge/replay/substitute a model |
| Identity resolution (ERC-8004, on-chain-bound mode) | SOUND — `allowUnverifiedCard` only weakens the off-chain card; `ownerOf`+`getAgentWallet`+`tokenURI` are always mandatory; a non-agent wallet cannot masquerade |
| Public endpoints (`/scan/stream`, `/resolve-address`) | SOUND — no secret in/out, strict input validation, no SSRF (pinned hosts), generic errors, constant-time auth |
| Guarded live-seal / key custody | SOUND — `PROOFLOCK_SPEND_AUTHORIZED` gated at composition and per-call; keys never serialized; 4 distinct custody roles; spend is balance-bounded, fails closed |
| SSRF egress guard | SOUND — HTTPS+443 only, DNS-pinned (defeats rebinding), full private-range blocklist, redirects rejected, size-bounded |
| Score combination (`combineBehavioralScore`) | SOUND — `max(llm, heuristic)` can only raise the deterministic floor; hard signals clamp ≥90; LLM bounded 0..100; cannot be gamed to force SAFE |
| Deep-risk pipeline (heuristics/threat/contract) | SOUND — PUSH-aware opcode walker correct, graceful degradation is honest, deterministic (BigInt-canonicalized), no path crashes a seal |
| `SentinelRegistryV2` / `AgentGateV2` / consumer | SOUND — `seal`/`reseal` are `SCANNER_ROLE`, `revoke`/`markDrift` are `GUARDIAN_ROLE`; no reentrancy/delegatecall/selfdestruct; version monotonic (CAS); coverage invariant enforced twice; gate binds subject to live ERC-8004 wallet |
| Admin endpoints (`/api/admin/prooflocks/**`) | SOUND — `authenticateOperator` (constant-time, 32–256B token) before any work; strict param validation; no secret leakage; GET → 405 |
| 0G Storage evidence path | SOUND — retrieved blob keccak-checked against on-chain digest + Merkle-root re-verified (swap-resistant); size-bounded 1 MiB pre-materialization; indexer/RPC URLs exact-pinned; Flow-event provenance byte-checked |

## Fixed (commit `32cd29b`)

- **`batch-seal.ts` (WARNING):** the SEAL/RESEAL auto-detect wrapped the lease
  read and proof-id computation in one bare `catch`, so a transient RPC failure
  could downgrade a RESEAL to a spurious SEAL (which reverts on-chain and logs a
  false FAIL). Now distinguishes an empty lease (`version === 0n`) from a read
  failure (skip, never downgrade).
- **`contract-analysis.ts` (NIT):** the PUSH4 selector walker used
  `i + 4 < length`, dropping a selector whose 4 immediate bytes end exactly at
  the last byte. Corrected to `i + 5 <= length`. Harmless in practice; fixed for
  correctness.

## Resolved

### M-01 (MEDIUM) — Degraded deep-risk coverage could present as SAFE — FIXED

Resolved via **option A (label guard)**, implemented as a score floor to keep the
strict score<->label policy intact. When `bundle.coverage.explorer !== "OK"` (or
the bundle failed to collect entirely), `floorScoreForCoverage` raises the
behavioral score to the CAUTION threshold (30), so a degraded seal derives to
CAUTION and can never present as SAFE. Flooring the score (not the label)
preserves the invariant that `runner.ts` `assertCompute` re-checks (label is
derived strictly from score). Covered by 3 unit tests in
`tests/prooflock/production-operator.test.ts`. See commit below.

## Open items (need a decision — not vulnerabilities)

### (historical) M-01 original write-up — Degraded deep-risk coverage is not surfaced on-chain

When the 0G explorer or a threat-intel source is unavailable at seal time, the
deep-risk pipeline degrades gracefully (partial/empty bundle) and the behavioral
score can drift lower, but the sealed attestation gives no signal that coverage
was incomplete.

**Important:** the on-chain `coverage` byte is NOT the right place to encode
this. `chain.ts:331` and the Solidity `seal`/`reseal` both enforce
`(coverage & 0x7f) == 0x7f`; those 7 bits are the *deterministic-pipeline*
dimensions (identity validated, subject classified, checks run, behavioral+code
compute, storage, policy), all genuinely satisfied on every seal. Writing a
partial bitmask there (the naive fix) would hard-reject every degraded seal.

**Real options (product decision):**
1. **Label guard (lowest risk):** force `CAUTION` (never `SAFE`) when
   `bundle.coverage.explorer !== "OK"`. Honest, off the on-chain critical path.
2. **Off-chain evidence flag:** record deep-risk coverage in the evidence-v1
   envelope (already 0G-Storage-stored + digest-bound) so verifiers can see it.
   Changes the canonical digest schema.
3. **Fail-closed:** refuse to seal at all when behavioral evidence is
   unavailable (strongest, but blocks sealing during any explorer outage).

Note: all 13 currently-sealed leaderboard agents had real explorer data, so
their coverage is genuinely full — no reseal is required for this.

### Rate limiter (MEDIUM/LOW) — public scan cost-griefing — MITIGATED (Option 3)

The public `/scan/stream` handler runs the funded ceremony behind an in-memory
per-instance rate limit (default 6/60s); on multi-instance serverless this
becomes `6 × instances`. Bounded by the pre-funded role-key balance (fails
closed — no fund theft), so the exposure is cost-griefing, not compromise.

**Shipped — Cloudflare Turnstile (config-gated) + read hardening:**
- `createPublicScanStreamHandler` now verifies a Cloudflare Turnstile token
  (`server/prooflock/turnstile.ts`) before any funded work, killing naive
  automated fan-out. It is config-gated: inert until `TURNSTILE_SECRET_KEY`
  (server) + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (client) are set, so there is no
  regression before activation. `/scan` renders the widget and requires a fresh,
  single-use token per scan.
- The lease read in the public handler was hardened the same way as
  `batch-seal`: a transient read error now fails closed (503) instead of
  silently downgrading a RESEAL to a spurious SEAL.

**Operational — bound the float (recommended):** fund public sealing from a
dedicated small sub-wallet so worst-case griefing loss is a known, capped number
(the balance already fails closed when empty). The daily ceremony/cost ceilings
(`DAILY_CEREMONY_LIMIT`/`DAILY_COST_LIMIT`) provide a second bound.

**Durable follow-up (Option 2, if the seal stays public post-event):** back the
limiter + daily ceilings with a shared store (Upstash Redis / Vercel KV) for a
true global cap across serverless instances, and add a short-TTL cache keyed on
`(storageRoot, version)` to the public detail route. Deferred: needs an infra
choice; not required while the balance + Turnstile bound the risk.

## Scope

Audited: compute TEE binding, identity resolution, public + admin endpoints,
guarded live-seal spend path, deep-risk analysis pipeline, the V2 Solidity
contracts, and the full storage upload/retrieval/recovery/verification path.
Trusted at their boundary (out of scope): 0G's TEE attestation itself, the
ERC-8004 identity registry contract, and the `@0gfoundation` SDK internals
(the app verifies storage independently of the SDK's unvalidated proof).
