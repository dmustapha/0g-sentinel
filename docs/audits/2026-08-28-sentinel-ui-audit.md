# Sentinel ProofLock — World-Class Frontend and Playwright Audit

**Date:** 2026-08-28  
**Builds tested:** clean standalone release without a V2 deployment profile; production-like standalone release with synthetic public addresses  
**Assessment:** strong visual identity, but not submission-ready or world-class until correctness, accessibility, and judge-facing credibility defects are fixed.

## Executive summary

The graphite/violet/paper evidence-dossier system is distinctive and worth preserving. The clipped admission sheet is the product's signature element, the typography fits forensic infrastructure, and the copy describes a bounded admission policy instead of universal safety.

The audit proved that compilation success was not deployment success. The original standalone artifact omitted all static JS, CSS, and font assets. Playwright reproduced 30 console errors and an unstyled, non-interactive page. This is fixed by copying `public/` and `.next/static/` during `postbuild`; the rebuilt standalone app loads with zero baseline console errors.

The remaining blockers are more serious than surface polish: stale evidence can remain visible after a failed re-verification, historical proof verification is coupled to current chain-state availability, several claims disagree with behavior, the inventory is incomplete by construction, and key accessibility requirements are missing. The design-system audit also found a coherent visual language without a governed implementation system: runtime CSS, `brand.json`, Tailwind, stale design notes, raw values, and dormant legacy components currently compete as sources of truth.

## Playwright evidence

### Executed coverage

- Five active routes plus 404 at 1440×1000, 390×844, and 320×700.
- 640px reflow as the 200% zoom equivalent of a 1280px desktop viewport.
- Home: empty, invalid, resolved identity, existing lease, first-seal operator state, and unauthorized mutation failure.
- ProofLocks: unavailable, empty, populated desktop table, populated mobile cards, admitted row, and unavailable enrichment.
- Agent detail: admitted, Gate blocked/unknown, consumer blocked, drifted lease, incomplete coverage, Compute/Storage unavailable, labeled demo fixture, drift mutation success, and reseal failure.
- Verifier: invalid identifiers, successful exact evidence match, mismatch after success, current-state outage, retry availability, and zero bytes32 input.
- Health: real degraded response and mocked independent mixed subsystem states.
- API boundary: 401 admin rejection, 405 wrong method, active endpoint degradation, and 410 retirement of legacy APIs.
- Keyboard-only tab order, visible focus rings, reduced motion, no horizontal overflow, touch dimensions, input sizes, active-nav semantics, and Enter submission.
- Runtime assets, security headers, favicon, metadata image, internal links, and external-link safety attributes.

### Proven passes

- Active route shells do not horizontally overflow at 1440, 640, 390, or 320 CSS pixels.
- Runtime JS, CSS, fonts, and favicon return correct MIME types after the packaging fix.
- Baseline standalone navigation produces no unexpected console errors or warnings.
- Focus order is logical and focus rings are visible.
- Reduced-motion disables functional animation and smooth scrolling.
- Operator token is sent as bearer authorization, excluded from the body, and cleared after failure.
- Legacy surfaces return 410; unauthenticated V2 mutation returns 401.
- Successful inventory, detail, health, drift, and historical-proof states render from schema-valid responses.
- Security headers include frame denial, MIME sniffing protection, and strict-origin referrer policy.

### Not proven

- Paid 0G Compute, Storage upload/retrieval, V2 writes, and seal → consumer → drift → reseal on mainnet. Funded keys, V2 addresses, provider/model acknowledgement, and a real ERC-8004 canary are absent.
- Formal deployed-URL live audit. Its workflow rejects localhost and no confirmed current deployment URL exists.
- The global React error boundary through a deterministic production trigger.
- The 12-second verifier timeout through browser routing. Unit-level behavior exists, but the driver could not hold the request without blocking itself.
- External explorer destinations beyond URL and safe new-tab validation.

## Critical violations

### 1. Stale success remains after proof failure

- **Location:** `frontend/components/VerifyEvidenceButton.tsx`
- **Observed:** after `MATCH`, a later `MISMATCH` leaves old “Current access: ADMITTED” text and the full evidence dossier visible.
- **Impact:** contradictory proof claims appear together.
- **Fix:** clear proof/current/reason atomically at request start and on every non-match state.

### 2. Historical proof depends on current availability

- **Location:** `frontend/components/VerifyEvidenceButton.tsx`
- **Observed:** exact historical evidence can succeed while a current ProofLock outage converts the whole operation to `UNAVAILABLE` and hides the artifact.
- **Impact:** contradicts the stated independence of historical validity.
- **Fix:** render historical verification independently; make current access a secondary observation with its own unavailable state.

### 3. Social preview is broken

- **Location:** `frontend/app/layout.tsx`
- **Observed:** metadata points to `/dashboard.png`; Playwright receives 404.
- **Fix:** generate a current ProofLock OG image and add an automated 200/MIME release check.

### 4. Standalone artifact omitted browser assets — fixed

- **Location:** `frontend/package.json`, `frontend/scripts/prepare-standalone.mjs`
- **Before:** 30 JS/CSS/font errors; no hydration or styling.
- **Resolution:** postbuild copies both required asset trees and a release test guards the contract.

## Major violations

1. The verifier accepts all-zero bytes32 values while copy says “nonzero”; the API rejects them later.
2. Invalid active API inputs can return dependency `503` before request validation returns `400`.
3. A successful seal followed by failed read-back is presented as “No lease issued,” although the write may have succeeded.
4. “Current chain state” discovery scans only 2,000 blocks and caps at 100, hiding older active leases.
5. One failed inventory enrichment rejects the entire list instead of preserving successful rows.
6. Inventory copy promises drifted and denied first, but sorting ignores Gate denial.
7. Agent detail can lose valid evidence because verification omits the exact source transaction hint.
8. Reseal failure does not identify the failed ceremony stage.
9. Source transaction hint affects proof selection but is hidden from proof identifiers.
10. Navigation, text links, and most buttons are below 44×44px touch targets.
11. Proof inputs compute to 13.12px on mobile, below the 16px iOS zoom threshold.
12. Invalid fields lack `aria-invalid`/`aria-describedby`; active nav lacks `aria-current`; no skip link exists; 404 has no `h1`.
13. Evaluate and Verify are not semantic forms, so Enter does not submit.
14. Long Compute/Storage operations expose no cancel control although an abort controller exists.
15. The hero has no primary action and pushes interaction far below the fold on mobile.
16. “Public offline verifier” is inaccurate: it performs network retrieval but avoids new paid Compute.
17. The design language has no canonical source of truth, governed scales, typed primitives, or enforceable component-state contracts.
18. Obsolete components and documentation preserve an incompatible cyan/glass design era and reference undefined tokens.

## Visual critique

### Keep

- Graphite world, one violet brand hue, warm evidence paper.
- Chakra Petch with IBM Plex Sans/Mono.
- Square geometry and clipped dossier corner.
- Honest trust-boundary and capability disclosures.

### Improve

- Detail pages become extremely long stacks of equally weighted paper cards rather than a guided decision story.
- Roughly 16 explicit font sizes weaken hierarchy; important labels fall to 9–12px.
- Placeholder and metadata contrast miss or narrowly miss WCAG AA at their actual sizes.
- The first viewport explains the pipeline but does not let a judge act or see live state.
- Static “0G MAINNET” resembles health status even when V2 dependencies are unconfigured.
- Hover transforms run on touch devices and buttons lack a deliberate pressed state.
- Old design notes, screenshots, and dormant legacy components can confuse future work and submission packaging.

## Design-system audit

### Verdict

**Overall maturity: 2.2/5 — coherent visual language, weak system governance.**

Sentinel already has recognizable product DNA: graphite infrastructure surfaces, warm evidence paper, one provenance-violet accent, square geometry, clipped dossier corners, forensic mono data, and restrained elevation. That identity should be consolidated, not replaced.

What it does not yet have is a design system in the operational sense: one canonical token source, documented foundations, typed primitives, complete variants, accessibility defaults, a component-state matrix, automated visual/a11y checks, and a controlled way to evolve the system. Most consistency currently depends on one handcrafted global stylesheet and developer memory.

### Maturity scorecard

| Layer | Score | Finding and evidence |
|---|---:|---|
| Brand foundations | 4.0 | The graphite/violet/paper palette, three-role font pairing, square geometry, and dossier cut are distinctive and appropriate. The signature and shadow philosophy are not formally documented. `frontend/app/globals.css:5-30`, `frontend/app/layout.tsx:7-26` |
| Foundations and tokens | 2.5 | Useful root variables cover color, two elevations, font families, and max width. There are no spacing, type-scale, control-size, border, shape, motion, focus, layer, breakpoint, icon, or content-measure tokens. `frontend/app/globals.css:5-30` |
| Typography roles | 2.0 | Chakra Petch, IBM Plex Sans, and IBM Plex Mono have clear cultural roles, but the CSS contains 19 explicit `font-size` values plus many shorthand sizes rather than a governed four-role scale. Nested `.mono`/`code` sizing is parent-relative. `frontend/app/globals.css:38`, `frontend/app/globals.css:61` |
| Semantic color | 3.0 | Canvas, paper, ink, accent, good, warning, and bad semantics are sensibly named. The same states then split into raw alternatives: success also uses `#177e56`, warning `#b96918`, and unknown `#8d8890`. `frontend/app/globals.css:18-23`, `frontend/app/globals.css:103-114`, `frontend/app/globals.css:145-146` |
| Spacing and density | 1.0 | There is no spacing scale. Components invent dozens of values from 3px through 88px, producing locally tidy but globally ungoverned rhythm. `frontend/app/globals.css:40`, `frontend/app/globals.css:76`, `frontend/app/globals.css:123` |
| Shape and radii | 3.0 | Active UI is consistently square and the clipped dossier corner is a useful signature. Neither is expressed as a formal shape contract; legacy code still references undefined `--r-2`. `frontend/app/globals.css:85`, `frontend/app/globals.css:95`, `frontend/components/QueueBanner.tsx:50` |
| Elevation | 3.0 | Two downward shadows are coherent and reusable. Their component hierarchy and allowed exceptions are undocumented. `frontend/app/globals.css:24-25` |
| Icons and symbols | 2.0 | Sparse symbols suit the interface, but checkmarks, crosses, dots, arrows, and marks are embedded independently with no size, alignment, rendering, or ARIA contract. `frontend/app/layout.tsx:54`, `frontend/components/StreamingScanPanel.tsx:28` |
| Motion | 2.0 | Reduced-motion handling is global and motion is generally purposeful. Durations/easings are untokenized, the 350ms rail entrance is slow for functional UI, hover is not pointer-gated, pressed states are absent, and dormant code animates width for 600ms. `frontend/app/globals.css:87`, `frontend/app/globals.css:129`, `frontend/app/globals.css:271-272`, `frontend/components/QueueBanner.tsx:67` |
| Responsive system | 3.0 | The 850, 600, 390, and 320px adaptations cover desktop through small mobile and tables become cards. Breakpoints are undocumented literals, with no shared viewport contract or component ownership. `frontend/app/globals.css:218-270` |
| Primitives | 2.0 | Button, evidence card, status chip, proof list, inline state, and empty/loading treatments exist as CSS proto-primitives. There are no typed `Button`, `Field`, `StatusBadge`, `EvidenceSheet`, `DataRow`, or `StateMessage` APIs. `frontend/app/globals.css:82-114`, `frontend/app/globals.css:164` |
| Variants and states | 3.0 | Primary/disabled controls and good/warn/bad/unknown outcomes exist. State classes overload inherited color inconsistently, unavailable cards are composed differently, and active/pressed variants are missing. `frontend/app/globals.css:88`, `frontend/app/globals.css:111`, `frontend/components/GateDecisionCard.tsx:5-10` |
| Accessibility defaults | 2.0 | Global focus-visible and reduced-motion rules are sound. The system does not enforce 44px targets, 16px mobile inputs, tap feedback, field-error association, skip navigation, active-page semantics, or live-region behavior. `frontend/app/globals.css:216`, `frontend/components/NavLinks.tsx:9` |
| Documentation | 1.0 | `brand.json` reflects the current identity but is not a runtime source. `ai/design-progress.md` describes an obsolete cyan/Syne/glass system and asserts guarantees contradicted by the current UI. There is no `DESIGN_SYSTEM.md`. `frontend/brand.json:2`, `frontend/ai/design-progress.md:19-90` |
| Tests and governance | 1.5 | The visual-contract test checks only that a few token names and media-query strings exist. It does not validate values, usage, contrast, screenshots, interactions, or accessibility. No lint rule prevents raw colors, spacing, or unresolved variables. `frontend/tests/ui/visual-contract.test.ts:5-19` |

### Source-of-truth audit

| Source | Current role | Defect | Required disposition |
|---|---|---|---|
| `app/globals.css` | Actual runtime system | Monolithic, raw-value heavy, no governed scales | Keep plain CSS, split foundations/tokens/components, and make its token layer canonical |
| `brand.json` | Brand metadata and one test fixture | Duplicates values without feeding runtime; includes unused `surfaceHover` | Generate it from canonical tokens or reduce it to non-style metadata |
| `tailwind.config.ts` | Installed styling framework | Empty theme; provides no token contract | Remove Tailwind if unused, or bind it to the canonical tokens—do not maintain a third system |
| `ai/design-progress.md` | Historical design note | Describes the wrong palette, fonts, radii, effects, and guarantees | Archive or replace with truthful current documentation |
| Inline/raw component styles | Local exceptions | Bypass semantic tokens and preserve old visual eras | Migrate active exceptions; delete or quarantine unused legacy components |
| `tests/ui/visual-contract.test.ts` | Visual-system guard | String-presence assertions create false confidence | Assert exact token values, resolution, component variants, screenshots, contrast, and a11y |

### Token architecture findings

- The root declares 24 variables, but four (`--paper-2`, `--good-soft`, `--warn-soft`, `--bad-soft`) are unused. This is an inventory, not a governed token architecture.
- The stylesheet contains more than 40 unique color/alpha literals. Paper-state colors and dark-surface state colors are disconnected, so a semantic change cannot be made safely in one place.
- The type system has 19 explicit size declarations and numerous shorthand sizes; the smallest responsive nav and network labels reach `.58rem` (about 9.3px).
- Padding, margin, and gap use dozens of unrelated values. There is no 4px/8px rhythm or exception policy.
- Radius is consistently zero, which is a valid product decision, but it should be a named geometry token alongside the dossier-cut exception.
- Two elevation tokens establish a useful single-shadow philosophy. The system still needs a documented mapping from elevation to surface purpose.
- Motion has no duration or easing tokens. Generic `rail-in`/`pulse` names describe movement rather than component state, and hover styles are not wrapped in a hover-capability query.
- Breakpoints (`850`, `600`, `390`, `320`) and content measures (`1180`, `850`, `740`, `580`) are not governed together.

### Color and contrast evidence

Measured against the actual declared colors:

| Pair | Contrast | Assessment |
|---|---:|---|
| `--muted` on graphite | 7.46:1 | Pass |
| Placeholder `#716f6b` on graphite | 3.74:1 | Fails normal-text AA |
| Paper metadata `#6d6670` on paper | 4.67:1 | Marginal pass only at normal weight/size |
| Paper body `#625d61` on paper | 5.43:1 | Pass |
| Runtime violet `#ad72ff` on paper | 2.67:1 | Fails normal-text AA |
| Paper violet `#7950ae` on paper | 4.95:1 | Pass |
| Runtime success `#39b982` on paper | 2.10:1 | Fails text and non-text contrast |
| Runtime warning `#d79a36` on paper | 2.07:1 | Fails text and non-text contrast |
| Runtime failure `#e45d5d` on paper | 2.94:1 | Fails normal-text AA and narrowly misses 3:1 UI contrast |
| Paper success `#177e56` on paper | 4.26:1 | Fails normal-text AA |
| Paper warning `#b96918` on paper | 3.47:1 | Fails normal-text AA |
| Paper unknown `#8d8890` on paper | 2.92:1 | Fails normal-text AA |

Color cannot be normalized by replacing everything with the dark-surface values; the system needs surface-aware semantic tokens such as `--text-status-success-on-dark` and `--text-status-success-on-paper`, each contrast-tested at its real size and weight.

### Component-system findings

The active UI has repeated visual concepts but no enforceable component contracts. Raw `<button>` and `<input>` elements are composed page by page; class strings control appearance without guaranteeing icon alignment, focus, pending, disabled, invalid, described-by, touch-size, or pressed behavior. Good/warn/bad/unknown classes serve text, borders, cards, health, Gate decisions, drift, and consumers even though those contexts need different presentations.

The minimum useful primitive set is deliberately small:

1. `Button` — primary/secondary/quiet/destructive; normal/pending/disabled; 44px minimum target; pointer-gated hover and pressed state.
2. `Field` — label, hint, error, input, optional mono mode; generated IDs; `aria-invalid` and `aria-describedby`; 16px mobile floor.
3. `StatusBadge` — success/caution/failure/unknown/unavailable with icon plus text, never color alone.
4. `EvidenceSheet` — graphite/paper surfaces, dossier-cut variant, elevation and spacing contract.
5. `DataRow` — label/value/link/copy affordance, wrapping and tabular-number defaults.
6. `StateMessage` — loading/empty/error/unavailable/success, live-region policy, retry/action slot.

These should remain product-specific rather than importing a generic rounded component library. The objective is to encode Sentinel's existing DNA and accessibility behavior once.

### Legacy-system contamination

`RadarHero`, `GridOverlays`, `FineTuneButton`, `QueueBanner`, `ChainDiscovery`, and `AnimatedScoreBar` are unreferenced design-era components. Several still rely on undefined variables such as `--cy`, `--cy-06`, `--cy-12`, `--tx-lo`, `--tx-dim`, `--fs-xs`, `--r-2`, and `--good-12`. `QueueBanner` also carries a 600ms width animation and rounded cyan styling that contradicts the current system.

These files should not remain discoverable as valid patterns. Confirm they have no runtime consumers, then delete them or move them to an explicitly archived location excluded from production and design documentation.

### Target design-system architecture

Keep the implementation lightweight and CSS-first:

```text
frontend/
├── app/styles/
│   ├── foundations.css     # reset, fonts, primitive ramps
│   ├── tokens.css          # semantic and component tokens
│   ├── utilities.css       # tightly bounded helpers
│   └── motion.css          # durations, easings, reduced motion
├── components/ui/
│   ├── Button.tsx
│   ├── Field.tsx
│   ├── StatusBadge.tsx
│   ├── EvidenceSheet.tsx
│   ├── DataRow.tsx
│   └── StateMessage.tsx
└── DESIGN_SYSTEM.md        # principles, signature, variants, examples, governance
```

Token layers:

1. **Primitive:** neutral, paper, violet, and status ramps; base spacing and type values.
2. **Semantic:** canvas, surface, text, border, action, focus, status, content measure, layer, and motion roles.
3. **Component:** button, field, badge, dossier, data-row, and state-message contracts.

Use a four-role type hierarchy with explicit line heights; a 4px half-step/8px primary spacing rhythm; 44/48px control sizes; square geometry plus one named dossier-cut exception; two elevations; fast/standard motion no longer than 300ms; tabular numerals for technical data; and documented content-driven breakpoints.

### Governance and test contract

The design system is complete only when drift is difficult:

- Reject raw colors and untokenized spacing in active component code, with a small documented exception list.
- Fail on unresolved or unused CSS custom properties.
- Render every primitive across variant, state, long-content, and keyboard matrices.
- Screenshot-diff the active component/route matrix at 1440, 390, and 320px.
- Run axe, keyboard order, focus visibility, touch-target, contrast, reduced-motion, and 200% zoom checks.
- Validate real token values and component behavior, not the presence of strings.
- Require `DESIGN_SYSTEM.md` updates in the same change as a new token, variant, or exception.

### Systemic remediation order

1. Preserve the existing visual DNA and declare it in `DESIGN_SYSTEM.md`.
2. Choose canonical CSS tokens; generate or narrow `brand.json`; remove or integrate Tailwind.
3. Add primitive, semantic, and component token layers with accessible surface-aware colors.
4. Introduce the seven typed primitives and migrate active routes without changing product behavior.
5. Replace inherited state coloring with explicit component-state mappings.
6. Remove the legacy token namespace and obsolete components/design notes.
7. Apply the Proof Ledger information-architecture redesign using only the governed primitives.
8. Add visual, accessibility, interaction, and token-governance gates before release.

## Deep-audit addendum

### Depth assessment

The first audit was deep enough to choose a direction and expose the dominant visual/correctness problems. It was not yet the deepest practical implementation audit. It did not fully model sequential state transitions, uncertain writes, hostile onchain content, the public/operator boundary, CSS cascade behavior, screen-reader announcement behavior, forced colors, route hydration, performance budgets, rollout/rollback, or the differing freshness of every proposed proof stage.

This addendum closes those gaps through:

- Full active route, component, API, state, selector, token, and test inventory.
- Nielsen heuristic scoring using severity × frequency × impact.
- Sequential-state analysis, not only isolated rendered states.
- WCAG 2.2 AA, screen-reader, forced-colors, zoom, pointer, and long-content review.
- Provenance/claim review of every stage in the proposed proof ribbon.
- Operator-token, uncertain-write, URL, Unicode, and hostile-content threat review.
- Client/server boundary, bundle, hydration, metadata, release, and rollback review.

The UI-revamp syntax checker scanned 47 app/component files and reported only the unguarded hover selector. That result is explicitly insufficient: the checker detects a narrow list of syntax patterns and did not detect the proven contrast, stale-state, touch, semantic, provenance, or architecture failures.

### Active surface inventory

| Surface | States and dependencies | Deep-audit result |
|---|---|---|
| Global shell | static network label, active navigation, metadata, error, 404 | No skip link or `aria-current`; static “0G MAINNET” resembles health; root OG image is missing; error/404 use `h2`; all routes share one title |
| `/` | hero, architecture sheet, public resolution, operator mutation | Primary action is below fold; public and privileged journeys are conflated; token entry appears in a public judge path |
| `/agents` | loading, error, empty, populated; discovery + row enrichment | Bounded 2,000-block/100-row set can look complete; one row failure kills all rows; sorting ignores Gate denial |
| `/agents/[agentId]` | loading, error, verified, unavailable enrichment, fixture, Gate/lease/consumer/coverage/evidence/lifecycle/operator | Valid proof recovery omits source transaction; historical proof failure is silently collapsed; long equal-weight stack; operator mutation mixed into public detail; state can age without a refresh timer |
| `/proof` | form validity; health loading/error/ready with six probes | Zero bytes32 accepted despite copy; not a semantic form; “offline” is false; field errors are unassociated |
| `/proof/[proofId]` | invalid; verify idle/verifying/match/mismatch/unavailable/timeout/retry; current admitted/blocked | Historical/current requests are coupled; stale success survives later failure; source hint affects selection but is hidden |
| Seal/reseal stream | ten stages, terminal success/error, abort | Generic error loses write certainty; “No lease issued” can be false after broadcast/finality; no restart-safe recovery or visible cancel |
| Health | healthy/unhealthy/unknown per dependency | Independent model is good; raw timestamps and static shell label weaken comprehension |

### Nielsen heuristic score

Priority uses severity × frequency × impact, each scored 1–4.

| Heuristic | S | F | I | Priority | Principal evidence |
|---|---:|---:|---:|---:|---|
| H1 Visibility of status | 4 | 3 | 4 | 48 | Stale verifier result, static network label, uncertain write state, silent detail proof failure |
| H2 Match with real world | 3 | 3 | 4 | 36 | “Offline,” “live,” and one completed proof chain collapse distinct capabilities/freshness |
| H3 User control | 3 | 3 | 4 | 36 | Long operations have abort controllers but no Cancel; recovery after disconnect is undefined |
| H4 Consistency | 4 | 4 | 4 | 64 | Competing design sources, global inherited state colors, broken unknown mapping, stale design documentation |
| H5 Error prevention | 4 | 3 | 4 | 48 | Zero bytes32, validation-after-composition, public operator-token path, duplicate-write risk |
| H6 Recognition over recall | 3 | 3 | 3 | 27 | Hidden source hint, truncated values without copy, dense hashes/jargon, no canonical share contract |
| H7 Flexibility/efficiency | 2 | 2 | 3 | 12 | No public/operator split, no copy primitives, no durable recovery path |
| H8 Aesthetic minimalism | 3 | 4 | 3 | 36 | Long equal-weight card stack and excessive bordered surfaces obscure the decision story |
| H9 Error recovery | 4 | 3 | 4 | 48 | Generic reseal errors, whole-list failure, historical proof hidden by current outage, uncertain write |
| H10 Help/documentation | 3 | 3 | 4 | 36 | Documentation states false guarantees and no current system/claim contract exists |

### New P0 findings

#### 1. The proposed six-stage ribbon mixed incompatible truth classes

Identity/lease can be historical chain records, checks/Compute are production-time evidence, Storage verification is a retrieval-time observation with `networkProofVerified:false`, and Gate/consumer are current mutable reads. One completed “live” ribbon would overclaim shared freshness.

**Required design correction:** use two independent planes:

```text
Sealed evidence: identity-at-block → checks → Compute → Storage → Registry event
Current access: current identity → lease → Gate → guarded consumer
```

Every stage needs typed scope, status, observation time/block, source, capability, and allowed copy. “Live” is banned unless that stage was probed in the current request.

#### 2. Public and privileged journeys are conflated

The public landing and detail surfaces expose a one-time bearer-token field and paid mutation as part of the primary journey. This makes a judge hit an authority wall and increases secret-handling risk.

**Required correction:** make a real public proof the primary judge action. Move seal/reseal/drift to a clearly named `/operator` workbench. The token must never enter URL, storage, analytics, logs, screenshots, response bodies, or errors and must clear on every terminal/unmount path.

#### 3. Post-broadcast failure has no truthful recovery model

Renaming the error is insufficient. After Registry broadcast or finality, a readback failure cannot truthfully say “No lease issued,” and immediately retrying may duplicate paid work or the write.

**Required correction:** reserve `NOT_BROADCAST` for failure before submission is attempted; otherwise model submission-outcome-unknown, finalized-readback-unavailable, and sealed. Before paid work, persist a token-free journal phase binding recovery/idempotency IDs to the canonical input digest and reserved budget; append verified Compute and Storage commitments as those stages complete; durably persist the full chain-input commitment before Registry submission. Recovery must compare transaction target/sender/calldata, event, receipt/finality, and all record fields; identity/version alone can misattribute a competing authorized scanner's write. Recovery never reruns Compute, Storage, or Chain writes.

#### 4. Untrusted evidence rendering is under-specified

Provider/model strings, URIs, errors, onchain display data, hashes, and external bases can contain long text, bidi controls, confusables, unsafe schemes, or layout/announcement denial inputs. React escaping prevents HTML injection but not visual spoofing or resource exhaustion.

**Required correction:** bound display schemas; use LTR isolation for canonical technical values and bidi isolation for natural text; strip/mark control characters; build links from an allowlisted HTTPS origin; never render untrusted active SVG/HTML/data URLs; fuzz maximum lengths and hostile Unicode.

#### 5. Current design-system state colors fail on their most important surface

The global `.state-*` utilities are inherited into warm paper cards. Actual `--good`, `--warn`, and `--bad` contrast on paper is 2.10:1, 2.07:1, and 2.94:1. This affects the ALLOWED/BLOCKED heading, state mark, chip border/text, and dossier rail—the central decision artifact.

**Required correction:** surface-aware tokens and component-owned state mapping. Global state classes set semantic properties, never blanket inherited color.

#### 6. “Current access” is not independently or atomically observed

The detail read pipeline must complete Storage/evidence retrieval before returning identity, lease, Gate, and consumer facts, and those facts are not pinned to one explicit finalized block. A Storage outage can therefore hide a valid Gate denial, while unpinned sequential reads can combine facts from different chain states.

**Required correction:** pin one finalized block per refresh; read current identity, lease, Gate, and guarded-consumer facts independently at that block; return a discriminated partial-observation set with server-issued block/time/TTL metadata. A failed plane never erases another plane or historical evidence.

#### 7. Paid operator work lacks an abuse and idempotency boundary

Double-clicks, multiple tabs, reconnects, or concurrent operators can start duplicate Compute/Storage/write ceremonies. A bearer token authenticates the caller but does not make the operation idempotent or affordable.

**Required correction:** require a unique idempotency key, one active ceremony per identity, bounded operator/global concurrency, rate and daily budget ceilings, and token-free audit events. Test duplicate clicks, tabs, reconnects, process restart, and a racing authorized scanner.

#### 8. Bounded discovery lacks finality and reorg semantics

Disclosing a 2,000-block/100-row window is honest about completeness but does not state whether the upper bound is finalized or how removed/reorganized events affect rows.

**Required correction:** scan only through an explicit finalized upper bound, disclose the confirmation policy, reject or mark removed/provisional rows, and test reorg-shaped event changes. A complete inventory remains an explicit deferred indexer/backfill decision.

### Additional systemic findings

1. **Sequential state leakage:** changing the Agent ID clears identity/error but can leave the prior lock, Gate, coverage, stages, and failure visible. `frontend/components/ScanInput.tsx:51-65`.
2. **Unknown looks like provenance:** `.state-unknown` sets `--state` but not the card rail, so “Decision unavailable” retains the default violet rail. `GateDecisionCard.tsx:5`, `globals.css:96`, `globals.css:114`.
3. **Cascade is implicit:** broad `p`, `dt`, `dd`, `input`, `.state-*`, `currentColor`, and one `!important` combine differently by surface. No cascade layers define ownership.
4. **Control boundaries are too subtle:** `--line` produces roughly 1.4–1.5:1 contrast on dark surfaces; controls that depend on it miss 3:1 non-text contrast.
5. **Mobile readability is not world-class:** `.58rem` navigation/network labels and `.62–.68rem` technical text pass overflow but not practical readability.
6. **Live regions are noisy/incomplete:** the entire ten-stage rail is live, while several errors are neither alerts nor persistently announced status regions.
7. **Focus recovery is undefined:** retry controls disappear during loading, potentially returning focus to the document body.
8. **Trust roles can render blank:** an empty string is invalid but `address ?? "not configured"` renders it as empty.
9. **Global wrapping is over-broad:** all `dd`, code, and mono content can break anywhere, including prose/provider names; wrapping belongs to a technical-value primitive.
10. **Smooth scrolling violates the product's motion constraints:** `html { scroll-behavior:smooth }` animates navigation unless reduced motion is set.
11. **Client-heavy read routes:** `/agents`, detail, and verifier routes ship as client pages and fetch after hydration. This delays public proof visibility and makes core reads JS-dependent.
12. **Client cryptography:** agent detail and inventory import `ethers`, canonicalization, and validation code for display-time proof ID derivation; route payload and shared-chunk budgets should be measured before/after moving derivation server-side.
13. **Font payload is unbudgeted:** nine declared weights and generated font assets have no performance budget or usage audit.
14. **No content-security policy:** the operator-token surface has frame/MIME/referrer headers but no CSP, HSTS deployment gate, or Permissions Policy review.
15. **No cross-browser/a11y harness:** current Vitest rendering is valuable but cannot prove computed styles, focus, target size, announcement order, WebKit input behavior, or forced colors.
16. **No stale-current state:** current facts have observation timestamps but no enforced TTL, background-resume invalidation, or `STALE` presentation.
17. **Authority terminology is inaccurate:** code uses `SCANNER_ROLE`; multiple wallets may write, and provenance must name the actual transaction sender rather than one universal validator.
18. **Registry record history is overstated:** the current record is overwritten by version; `ProofLocked` events are append-preserved, not the record itself.

### Component-state contract required before migration

| Primitive/workflow | Required states |
|---|---|
| Button | primary/secondary/quiet/destructive × idle/hover/pressed/focus/disabled/pending |
| Field | empty/valid/invalid/disabled/read-only × hint/error × dark/paper |
| StatusBadge | verified/allowed/caution/blocked/mismatch/unavailable/stale/not-applicable × dark/paper |
| EvidenceSheet | default/provenance/success/caution/failure/unknown × short/maximum content |
| DataRow | text/hash/address/time/link/copy × present/missing/unavailable × long/bidi content |
| StateMessage | loading/empty/error/unavailable/success × retry/action × polite/assertive |
| ProofPlane | historical/current × all observation statuses × partial/unavailable/mismatch |
| Verifier | seven request states plus independent current access and every sequential transition |
| Operator | idle/resolving/running/cancelling/recovering/uncertain/finalized/failed |
| Inventory | loading/error/empty/partial/populated × bounded scope × desktop/mobile parity |

Impossible combinations should be prevented through discriminated unions or reducers rather than coordinated independent booleans.

### Deep acceptance criteria

- All surface-aware normal text passes 4.5:1; large text, focus, icons, rails, and actionable boundaries pass 3:1.
- Informative captions never fall below 12px; data/secondary UI targets 14px; body/input remains at least 16px.
- Every field has associated help/error semantics; progress is concise and announced once; errors are alerts; busy regions expose `aria-busy`.
- Every standalone action has a 44×44px target and at least 8px separation.
- Forced-colors preserves controls, links, focus, and all state meaning.
- 320/390/1440, 200% text zoom, 400% page zoom, reduced motion, long content, and table/card parity pass.
- Chromium, Firefox, and WebKit pass the public proof, verifier, and operator-recovery journeys.
- VoiceOver or NVDA confirms landmark/heading order, form errors, verifier transitions, and streaming progress.
- A route and primitive screenshot matrix covers every state; axe reports zero unwaived WCAG A/AA findings, with evidence-backed waivers only for confirmed tool false positives.
- Deployed slow-4G budgets are LCP ≤2.5s, INP ≤200ms, CLS ≤0.1, with explicit JS/CSS/font budgets and 100-row/max-content fixtures.
- A real funded mainnet seal → consumer allow → drift deny → reseal allow survives reload/process restart and every displayed link independently verifies.
- No “world-class” or “submission-ready” claim is made until the deployed-URL, provenance, accessibility, performance, and claim-signoff gates pass.

## Recommended direction: two-plane Proof Ledger

Preserve the identity, but turn the dossier into two connected truth planes:

`Sealed evidence: Identity-at-block → Checks → Compute → Storage → Registry event`

`Current access: Current identity → Lease → Gate → Guarded consumer`

Place a real public proof action and compact dependency disclosure in the hero. On detail, replace the card stack with one continuous evidence ledger: current decision first, sealed provenance second, current observations third, lifecycle and trust boundary last. Move privileged controls to a separate Operator workbench. On mobile, the public decision/action comes before explanation.

Alternatives considered:

- **Verification Desk:** paper-dominant and institutional, but a larger redesign.
- **Operator Console:** efficient split-pane workflow, but weaker for a three-minute judge demo.

Proof Ledger has the best impact-to-risk ratio because it preserves the strongest current work.

## Complete implementation scope

### Phase A — correctness and claim integrity

1. Decouple historical match from current access and clear stale state.
2. Share strict nonzero bytes32 validation across UI and API.
3. Add typed write outcomes, durable idempotent operation journaling, abuse ceilings, and commitment-bound restart-safe recovery; never claim no lease or rerun paid work after an uncertain read-back.
4. Return pinned, independent, partial current observations with server-owned freshness and a visible stale state.
5. Make finalized bounded discovery explicit, partial-failure tolerant, and reorg-aware; defer a complete durable indexer until its operational architecture is approved.
6. Contain per-row failure and sort by lifecycle plus Gate urgency.
7. Carry the exact source transaction into current detail verification.
8. Preserve failed SSE stage/code in reseal ceremony.
9. Display optional source transaction in proof identifiers.
10. Validate request shape before dependency composition.
11. Generate a current OG image and quarantine obsolete V1 artifacts.

### Phase B — design-system and accessibility foundation

1. Write `DESIGN_SYSTEM.md` and declare the dossier signature, square geometry, single-shadow philosophy, type roles, and exception policy.
2. Establish canonical primitive/semantic/component tokens; remove duplicate and unresolved token sources.
3. Correct surface-aware contrast, establish type/spacing/control/motion/breakpoint scales, and encode accessibility defaults.
4. Build the seven typed primitives with accessibility in their first contract and migrate one pilot route without changing behavior.
5. Delete or quarantine obsolete design-era components and stale documentation.
6. Add token, primitive-state, contrast, axe, screenshot, and viewport governance tests.

### Phase C — journey ergonomics

1. Convert action areas to forms with Enter submission.
2. Add skip link, `aria-current`, invalid/described fields, and live-region coverage.
3. Set inputs to at least 16px and interactive targets to at least 44px.
4. Restrict hover to hover-capable devices and add active/tap states.
5. Raise muted/placeholder contrast and reduce typography to four roles.
6. Add cancel controls and the typed recovery workflow.
7. Separate the public judge journey from the privileged Operator workbench.
8. Give error/404 pages proper heading hierarchy.

### Phase D — Proof Ledger redesign

1. Make a configured real public proof the hero's primary action; keep paid mutation off the public path.
2. Make the two-plane Proof Ledger the first-viewport signature interaction.
3. Convert detail into one ledger with typed per-stage freshness and progressive disclosure for raw hashes.
4. Add truthfully labeled network/dependency state instead of a static badge.
5. Tighten spacing, status hierarchy, and mobile ordering.
6. Rename to “Public evidence verifier” and simplify jargon-heavy copy.

### Phase E — release validation

1. Turn this CLI matrix into persistent Playwright E2E tests with deterministic fixtures.
2. Re-run all viewports, keyboard, reduced motion, reflow, console, and asset checks.
3. Deploy with real V2 addresses and execute the paid mainnet canary.
4. Run formal live audit, record proof links, and capture final submission media.

## Decision gate

The **two-plane Proof Ledger** direction is approved from the user's earlier instruction to proceed with the recommendations. Begin with Phase A before aesthetic work, and review the verifier primitive pilot before migrating another route. No visual implementation was started during this audit/planning pass.
