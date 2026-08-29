# Sentinel Proof Ledger — World-Class Product and System Design

**Date:** 2026-08-28
**Status:** Approved direction, refined from the previously approved Industrial Proof Ledger recommendation
**Supersedes:** The presentation and execution assumptions in `2026-08-28-prooflock-frontend-design.md`; its trust-boundary decisions remain valid
**Responsive state specification:** [`../design/2026-08-28-sentinel-proof-ledger-state-spec.md`](../design/2026-08-28-sentinel-proof-ledger-state-spec.md) — **Approved by user at 2026-08-29T12:29:53Z**

## Objective

Make Sentinel's exact guarantee understandable, operable, and independently verifiable without making any state look fresher, broader, or more decentralized than it is.

A cold reviewer must be able to answer these questions without narration:

1. What identity was evaluated?
2. Which evidence was sealed, by whom, at what block, and with what verification capability?
3. Does that historical artifact still match?
4. Is the agent admitted now, and exactly why or why not?
5. Which actions are public reads and which require the named operator?

## Design decision history

Three directions were considered in the approved frontend design:

1. **Industrial Proof Ledger — selected.** Distinctive, proof-first, and judge-readable.
2. **Generic crypto dashboard — rejected.** Familiar but collapses Sentinel into a risk leaderboard.
3. **Cinematic scanner — rejected.** Dramatic but implies continuous monitoring and overstates guarantees.

This refinement keeps the selected direction but rejects one earlier presentation idea: a single six-stage “live” completion ribbon. Identity, checks, Compute, Storage, lease history, and Gate do not share the same freshness or proof class. Showing them as one completed line would create a false liveness equivalence.

## Product architecture

### The signature: two-plane Proof Ledger

Every proof detail uses two visually connected but semantically independent planes.

```text
SEALED EVIDENCE — historical, versioned, event-preserved
Identity at source block → Deterministic checks → Compute transcript → Storage commitment → Registry event

CURRENT ACCESS — independently observed now
Current ERC-8004 wallet → Current lease state → AgentGateV2 result → Guarded consumer result
```

The sealed plane never disappears because a current dependency is unavailable. The current plane never inherits “verified” from historical evidence. Each item displays its own observation block/time, source, status, and capability.

### Truth-state model

Every visible proof stage must be produced from a typed observation, not inferred from CSS or prose.

```ts
type ObservationScope = "HISTORICAL" | "CURRENT";
type ObservationStatus =
  | "VERIFIED"
  | "BLOCKED"
  | "UNAVAILABLE"
  | "STALE"
  | "MISMATCH"
  | "NOT_APPLICABLE";

type ProofObservation = Readonly<{
  id: "identity" | "checks" | "compute" | "storage" | "registry" | "lease" | "gate" | "consumer";
  scope: ObservationScope;
  status: ObservationStatus;
  observedAt?: string;
  blockNumber?: string;
  registrySourceTxHash?: `0x${string}`;
  storageUploadTxHash?: `0x${string}`;
  freshnessExpiresAt?: string;
  capability: string;
  reasonCode?: string;
}>;
```

Rules:

- `VERIFIED` is allowed only when the corresponding verifier actually completed.
- `BLOCKED` is a current policy decision, not a failed historical proof.
- `MISMATCH` means cryptographic or binding disagreement, not network failure.
- `UNAVAILABLE` means the observation could not be completed; it never inherits adjacent success.
- `STALE` means a once-current observation exceeded its declared TTL. A stale current fact is never silently shown as current.
- `NOT_APPLICABLE` is explicit and neutral.
- “Live” is prohibited unless the named stage was probed in the current request.
- Historical and current observations never share one aggregate success state.
- Observation block/time and freshness metadata come from the server observation boundary; the UI never invents them.

### Claim registry

User-facing claims are keyed, reviewed, and tested. Components receive a claim key/state; they do not invent prose.

| Concept | Permitted language | Prohibited shortcut |
|---|---|---|
| Compute | Capability-specific language keyed by SDK version, method, provider/model, proof class, verification result, and bound transcript/artifact hashes | “TEE-attested” without the exact proof class and successful verification |
| Storage | “Exact bytes retrieved, digest-matched, root-recomputed, and bound to the named finalized Flow upload transaction”; always disclose `networkProofVerified:false` | “Network proof verified” while `networkProofVerified:false` |
| Chain history | “Current RegistryV2 record plus append-preserved `ProofLocked` event provenance” | “Immutable record” or “immutable verdict” |
| Admission | “Current lease plus current Gate and guarded-consumer checks permit access” | “Safe agent” |
| Drift | “On-demand drift observation” | “Continuous monitoring” |
| Discovery | “Recent RegistryV2 activity from block X to Y, capped at N” | “All ProofLocks” without a complete index |
| Verifier | “Public evidence verifier; no new paid Compute” | “Offline verifier” |
| Authority | “One of the named `SCANNER_ROLE` wallets submitted this lease write; guardian authority can mark drift” | “No centralized oracle” or a single-validator claim when multiple scanners are authorized |

## Core journeys

### 1. Public judge journey

The primary unauthenticated path is proof exploration, never a paid mutation:

```text
Landing → Open featured real ProofLock → read two-plane ledger → verify historical artifact → open explorer provenance
```

The first viewport contains:

- One precise proposition: policy-scoped admission backed by exact evidence.
- A featured real proof action when configured.
- A secondary “Verify another proof” action.
- A compact illustrative process strip clearly labeled as architecture, not current health.
- A truthful dependency/network disclosure, not a static “live” badge.

### 2. Public identity journey

```text
ProofLocks → recent-scope disclosure → identity/detail → current access and sealed history
```

Inventory is explicitly bounded until a durable index exists. One enrichment failure preserves all successful rows and renders the failed row as unavailable. Ordering includes both lifecycle and Gate urgency.

### 3. Public verifier journey

```text
Proof ID + identity key + optional source transaction → historical verification
                                                ↘ independent current-access observation
```

Historical verification and current access are separate async state machines. A current outage cannot hide or downgrade a historical match. A later mismatch clears every prior proof artifact before rendering the mismatch.

The server pins one finalized observation block per current refresh, then reads identity, lease, Gate, and guarded-consumer facts independently at that block. Each result is a partial observation with its own reason and TTL. Storage or historical-evidence failure cannot suppress a valid current Gate result; one current dependency failure cannot erase the other current facts. Refresh preserves sealed evidence even when every current observation becomes unavailable.

### 4. Privileged operator journey

```text
Operator workbench → resolve identity → enter one-time token → seal/reseal/drift → recover or inspect result
```

Operator controls move to `/operator`. The route names the mutation cost and authority boundary before the token field. The token is never placed in a URL, storage, analytics, logs, response body, screenshot fixture, or error message; it is cleared on success, failure, cancellation, navigation, and unmount.

Each paid mutation carries a unique idempotency key and a durable operation record containing the exact intended commitments. The service permits one active ceremony per identity and enforces operator/global concurrency, rate, and budget ceilings. Multi-tab, double-click, disconnect, and restart are first-class states, not duplicate paid runs.

## Write-outcome and recovery model

The current “No lease issued” fallback is false after an uncertain readback. The operation must expose four outcomes:

```ts
type WriteOutcome =
  | { status: "NOT_BROADCAST"; failedStage: RunnerStage; code: string }
  | { status: "SUBMISSION_OUTCOME_UNKNOWN"; recoveryId: string; identityKey: Bytes32; expectedVersion: string; transactionHash?: Bytes32 }
  | { status: "FINALIZED_READBACK_UNAVAILABLE"; recoveryId: string; identityKey: Bytes32; expectedVersion: string; transactionHash: Bytes32 }
  | { status: "SEALED"; identityKey: Bytes32; version: string; transactionHash: Bytes32 };
```

`NOT_BROADCAST` is reserved for failures before transaction submission is attempted. Once submission has been attempted, an adapter error without a hash is `SUBMISSION_OUTCOME_UNKNOWN`; it must not assert that broadcast either did or did not happen.

Before any paid side effect, the server writes the first phase of a durable, token-free operation journal in the persistent state directory. It binds an opaque recovery ID and idempotency key to the canonical request/input digest, subject, expected version, policy, runtime facts, and reserved budget. After verified Compute it appends the exact Compute/transcript commitments; after verified Storage it appends Storage/upload/artifact commitments. The complete chain-input commitment set must be durably present before Registry submission. The runner then appends submission attempt, transaction hash when known, receipt/finality, and readback outcome. Each transition is monotonic and restart-safe.

The authenticated, mutation-free recovery endpoint accepts the opaque recovery ID and validates every recovered Registry event/record field against those durable intended commitments. A transaction hash is authoritative only after target, sender, calldata/event, identity/version, receipt status, and finality checks. Recovery never reruns Compute, Storage, or the chain write.

If the stream disconnects before receiving the hash, recovery uses the durable operation record. Identity plus expected version alone is insufficient because another authorized scanner could race the same version. If neither a trustworthy transaction nor the persisted intended commitments are available, the result remains unknown. The UI says “submission attempted; outcome not yet proven—recover before retrying.”

## Information architecture

### Global shell

- **Overview** — public proposition and real-proof entry.
- **ProofLocks** — recent, explicitly scoped registry activity.
- **Verify** — public historical verifier plus independent health.
- **Operator** — visually distinct privileged workbench.

The shell includes a skip link, semantic current-page navigation, dynamic dependency wording, and no unverified green “mainnet/live” indicator.

### Agent detail hierarchy

1. Canonical identity and unmistakable fixture label.
2. Current access decision and reason.
3. Sealed evidence plane.
4. Current access plane.
5. Proof identifiers and explorer links.
6. Lifecycle history.
7. Trust roles and capability limits.
8. Operator actions only on the separate operator surface.

Raw hashes are progressively disclosed or presented in compact data rows with copy actions. Copy actions copy canonical values, never truncated display text.

### Responsive hierarchy

- At 1440px, the two planes can use a split ledger where reading order remains logical.
- At 850px, the planes stack without changing semantic order.
- At 390px and 320px, current decision and primary public action precede explanatory material.
- Tables become semantically equivalent cards; no column or reason disappears.
- All text survives maximum schema lengths, 400% page zoom, and forced-colors mode.

## Design-system architecture

### One source of truth

Use plain CSS because it already fits this product and avoids a deadline migration to a generic library.

```text
frontend/app/styles/
├── foundations.css
├── tokens.css
├── components.css
├── layouts.css
├── motion.css
└── utilities.css
```

`tokens.css` is canonical. `brand.json` retains only metadata that is not a runtime style value, or is generated from the canonical source. Tailwind and its PostCSS plugin are removed if no active utility classes remain. The stale cyan-era design notes and dead components are archived or deleted only after an import-graph check.

### Token layers

- **Primitive:** graphite, paper, violet, status ramps; font families; base dimensions.
- **Semantic:** canvas/surface/paper text, action, focus, divider, status-on-dark, status-on-paper, layers, measures, motion.
- **Component:** button, field, status badge, evidence sheet, data row, state message, proof plane.

Surface-aware state colors are mandatory. A status color passing on graphite is not reused on paper unless it independently passes at the real font size and weight.

### Product primitives

Only seven primitives are needed:

1. `Button`
2. `Field`
3. `StatusBadge`
4. `EvidenceSheet`
5. `DataRow`
6. `StateMessage`
7. `ProofPlane`

Accessibility is part of each primitive's first implementation, not a later cleanup. Every primitive defines focus, hover-capable hover, pressed, disabled, pending, forced-colors, reduced-motion, long-content, and screen-reader behavior where applicable.

### Visual identity

- Preserve graphite, warm paper, provenance violet, square controls, clipped dossier corners, and intentional asymmetry.
- Use the clipped evidence sheet as the declared first-viewport signature.
- Use one exact pixel-offset shadow grammar: `3px 3px 0` for raised controls and `5px 5px 0` for primary evidence sheets; avoid blur shadows and grids of undifferentiated 1px cards.
- Use Chakra Petch for display, IBM Plex Sans for prose, and IBM Plex Mono only for technical evidence.
- Reduce actual UI typography to governed roles with explicit line heights and tabular numerals.
- Motion is state-based, CSS-first, transform/opacity-only, and tokenized: fast ≤150ms, standard ≤200ms, hard ceiling 300ms. Smooth scrolling is prohibited; reduced motion removes nonessential transitions.

## Content and hostile-data safety

React escaping is necessary but insufficient for attacker-controlled onchain content.

- Bound provider/model/name/URI/error display lengths at the client schema boundary.
- Render canonical hashes and addresses in LTR isolation with tabular numerals.
- Render untrusted natural-language strings inside `<bdi>` or an isolation wrapper.
- Strip or visibly replace control characters; preserve the canonical value for proof computation and copy only where safe.
- Permit explorer links only from an allowlisted HTTPS origin assembled by a URL helper.
- Never render onchain SVG/HTML/data URLs as active content.
- Stress-test bidi overrides, confusables, emoji, combining marks, 10k-character strings, malicious URLs, and zero-width characters.

## Accessibility contract

- WCAG 2.2 AA as the release floor, with zero unwaived automated A/AA findings; any tool false positive requires a documented, evidence-backed waiver.
- 44×44px minimum targets; 48px preferred for primary actions.
- 16px minimum input text on mobile.
- Captions are at least 12px, data/secondary text at least 14px, and body/form text at least 16px unless an explicitly tested exception is approved.
- Semantic forms, labels, instructions, `aria-invalid`, and `aria-describedby`.
- Skip link and `aria-current="page"`.
- One `h1`; no skipped heading levels within primary content.
- Status always uses text plus symbol; never color alone.
- Focus indicators pass 3:1 on graphite and paper.
- Action boundaries, icons, rails, and other required non-text indicators pass 3:1 against adjacent colors in computed styles.
- SSE progress announces concise state changes rather than rereading the whole rail.
- Keyboard-only, VoiceOver/NVDA, forced-colors, 200% text zoom, and 400% page zoom are release checks.
- Chromium, Firefox, and WebKit cover the three core journeys.

## Performance contract

Measured on the deployed build or repeatable slow-4G lab profile:

- LCP ≤ 2.5s
- INP ≤ 200ms
- CLS ≤ 0.1
- No async-state layout shift that moves the active control
- Route-level JS and CSS budgets recorded before implementation and may not regress by more than 10% without approval
- Inventory remains responsive with 100 rows
- Detail remains responsive with maximum-length evidence
- Remove unused font weights and avoid importing cryptographic libraries into client components solely for display derivation

## Delivery strategy

### Release 1 — submission-safe truth and accessibility

- **Stop gate:** ship only correctness, durable write certainty/recovery, behavior-only public/operator separation, truthful existing-IA proof/detail/inventory, safe display boundaries, and the minimum `Button`/`Field`/`StateMessage` primitives if the deadline is threatened.
- Correct stale verification and historical/current coupling.
- Add idempotent, abuse-bounded write execution and commitment-bound recovery.
- Make discovery finalized, explicitly bounded, reorg-aware, and fault-tolerant.
- Separate public and operator journeys.
- Establish canonical tokens and the Button/Field/StateMessage pilot.
- Deliver truthful detail/verifier ledgers on the existing information architecture.
- Fix critical contrast, touch, form, metadata, and claim defects.

Full CSS modularization, all seven primitives, landing-page presentation, route-specific/broad metadata polish, and legacy deletion are Release 2 work unless the Release 1 stop gate is already green. The truthful root OG image, error hierarchy, and known standalone regression checks remain mandatory Release 1 repairs.

### Release 2 — world-class Proof Ledger presentation

- Complete the seven primitives.
- Apply the two-plane ledger and first-viewport hierarchy.
- Migrate remaining routes one by one behind visual baselines.
- Add hostile-content, cross-browser, screen-reader, performance, and screenshot matrices.

### Deferred unless a complete inventory is mandatory

- Durable full-history indexer, reorg/backfill service, and external database.
- Generic component library or Storybook deployment.
- Broad authentication/session redesign.
- Continuous drift monitoring.
- New protocol or contract semantics.

Until a durable indexer exists, the product tells the truth about its bounded discovery window.

## Acceptance gates

1. **G0 — Scope and claims:** approved journeys, truth-state matrix, claim registry, and deferrals.
2. **G1 — Correctness:** deterministic tests prove stale-state clearing, historical/current independence, validation order, write recovery, hint compatibility, and row fault isolation.
3. **G2 — Primitive pilot:** one route migrates with zero behavioral/API drift and passes contrast, touch, focus, error, live-region, forced-colors, and hostile-content checks.
4. **G3 — Ledger approval:** no-code 1440/390/320 state specifications cover every truth state, long content, loading, empty, error, unavailable, stale, and public/operator separation; the user explicitly approves them before route styling begins.
5. **G4 — Implementation quality:** route/state matrix, visual diffs, axe, keyboard, screen reader, zoom, three browsers, performance budgets, and clean console/network checks pass.
6. **G5 — Provenance:** a real funded mainnet seal → consumer allow → drift deny → reseal allow survives reload/restart and every displayed link verifies independently.
7. **G6 — Release:** deployed-URL live audit, enforced reviewed CSP or a signed release exception, production-HTTPS HSTS, security/header review, rollback rehearsal, clean standalone artifact, and claim-by-claim signoff.

“World-class” and “submission-ready” are release outcomes, not design intentions. They are used only after G6.

## Rollout and rollback

- Land correctness changes before visual migration.
- Establish screenshots and behavior snapshots for one representative route.
- Migrate the verifier first because it exercises states, fields, badges, data rows, and both dark/paper surfaces without paid mutations.
- Review its 1440/390/320 diff before migrating another route.
- Keep public API response compatibility during route migration.
- Commit each vertical slice separately so any route can be reverted without reverting correctness fixes.
- Preserve a releasable judge path throughout the migration.
