# 0G Sentinel: V1 revival on top of ProofLock + live seal + design system

Date: 2026-08-31. Deadline: 2026-09-01 15:00 UTC (~24h). Scope: Core-deep (not breadth).

## Problem

The audit relegated the former 0G Sentinel V1 features (agent scanning, risk ranking, queue,
fine-tuning, iNFT detection, attestation registry) to `410 GONE` and shipped only the V2 ProofLock
admission core. The intended product is 0G Sentinel WITH ProofLock added on top, not ProofLock
replacing it. Additionally the deployed site is read-only: a judge cannot trigger a real seal from
the UI because no signing keys are on the host.

## Goals

1. A judge can run a real, on-chain seal from the public site (bounded risk).
2. The former V1 identity (scan an agent for behavioral + code risk, rank agents, view attestation
   history) is revived honestly, backed by the proven V2 ceremony, not a re-faked parallel system.
3. New UI is consistent and production-grade via a formalized design system + a real logo.
4. Everything remains provable and honestly scoped; no fabricated data or overclaims.

## Key insight (the unification)

The V1 "scan an agent for behavioral + code risk" IS what a ProofLock seal already does: the V2
ceremony runs behavioral + code risk through 0G Compute and seals the verdict. So we do NOT build a
parallel scanner. "Scan" becomes the public front door that runs the real ceremony and outputs a
sealed, gated, drift-aware attestation. Scanning, attestation, and ranking become honest views over
the sealed proofs.

## Components

### P0. Guarded public live seal (backend/config)
- Enable the existing operator ceremony (`/api/admin/prooflocks/stream` and the recovery/drift
  routes) on the deployed site by placing ONLY the low-value role keys (scanner, guardian, compute)
  + operator token + `PROOFLOCK_SPEND_AUTHORIZED=true` on Vercel. Deployer and subject keys never
  leave the local machine.
- Expose it publicly with NO token via a thin public `/api/scan` (or a public wrapper that injects
  the token server-side). Public, strictly capped.
- Safety model (Vercel is stateless, so counters cannot be the hard cap):
  - HARD ceiling = pre-funded balance. Fund scanner + guardian with ~0.4 OG total and leave the
    compute ledger at its capped locked amount. When spent, seals fail gracefully ("demo allowance
    exhausted"). Max loss = exactly what is funded; refund/rotate keys after the event.
  - SOFT limits: best-effort per-instance rate limit + the operator's existing
    concurrency/idempotency/durable-journal guards. Occasional retryable failures acceptable.
  - UI discloses "live demo: capped allowance, keys rotated post-event."

### P1a. `/scan` front door
- Input: an ERC-8004 agentId (validated). Runs the real ceremony, streams stages
  (identity → checks → 0G Compute → storage → lease → gate), lands on the sealed attestation + gate
  decision with explorer links. Reuses the existing stream ceremony; no new ceremony code.

### P1b. Risk-ranking dashboard (`/agents`)
- Beef up the existing lease inventory into a leaderboard ranking sealed agents by behavioral / code
  risk, reusing surviving `frontend/lib/ranking.ts`. Data already exists in sealed proofs
  (behavioralScore, codeRisk). Empty-state handled.

### P1c. Attestation-history timeline (per agent)
- Surface the append-only version history already in `SentinelRegistryV2` (v1 → drift → v2 reseal) as
  a per-agent timeline. This is the honest revived "attestation registry."

### Design system (design-forge)
- Extract the current aesthetic into `DESIGN_SYSTEM.md` + `brand.json`, generate a real logo/brand
  mark, so P1 pages are built to a spec. After P1, run the craft audit + persona critique across the
  full old+new surface and apply polish.

### P2 (only if time)
- ERC-7857 iNFT detection as a badge on the scan result.
- Batch-scan queue (`frontend/scanner/queue.ts`).

### Out of scope (roadmap-labeled, stated plainly)
- Fine-tuning: its honest form is a CLI-command return, not a 24h build. Documented as roadmap, not
  faked.

## Pipeline + deploy
- TDD for new routes (`/api/scan` input validation, cap-exhaustion → graceful 402/429, secret-free
  responses) and ranking (sort correctness, empty-state).
- Re-run gates debug → wire → verify → stress → livetest against the new surface. Redeploy to Vercel,
  re-audit the live URL, recapture screenshots.
- Regenerate proof.md / pitch-deck / README so the revived surface is described honestly; drop the
  "Legacy V1 excluded" language for the parts brought back; keep the honest limitation notes.

## Non-negotiables (carried from the proven core)
- Response bytes stay exact-byte bound; request commitment stays the enclave-attested hash.
- No secrets in tracked files or the client bundle; deployer + subject keys never on the host.
- Fail-closed on missing/mismatched/stale/wrong-chain evidence.
- No fabricated addresses, transactions, stats, or URLs. Every claim maps to real evidence.
