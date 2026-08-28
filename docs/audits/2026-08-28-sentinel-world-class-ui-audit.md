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
4. Introduce the six typed primitives and migrate active routes without changing product behavior.
5. Replace inherited state coloring with explicit component-state mappings.
6. Remove the legacy token namespace and obsolete components/design notes.
7. Apply the Proof Ledger information-architecture redesign using only the governed primitives.
8. Add visual, accessibility, interaction, and token-governance gates before release.

## Recommended direction: Proof Ledger

Preserve the identity, but turn the dossier into a live six-stage proof ribbon:

`Identity → Checks → Compute → Storage → Lease → Gate`

Place the Agent ID resolver and compact dependency disclosure in the hero. On detail, replace the card stack with one continuous evidence ledger: decision and lease first, provenance second, lifecycle third, operator controls last. On mobile, action comes before explanation.

Alternatives considered:

- **Verification Desk:** paper-dominant and institutional, but a larger redesign.
- **Operator Console:** efficient split-pane workflow, but weaker for a three-minute judge demo.

Proof Ledger has the best impact-to-risk ratio because it preserves the strongest current work.

## Complete implementation scope

### Phase A — correctness and claim integrity

1. Decouple historical match from current access and clear stale state.
2. Share strict nonzero bytes32 validation across UI and API.
3. Add `WRITE_CONFIRMED_READBACK_UNAVAILABLE`; never claim no lease after an uncertain read-back.
4. Replace rolling discovery with deployment-from-block pagination/indexing and disclose completeness/freshness.
5. Contain per-row failure and sort by lifecycle plus Gate urgency.
6. Carry the exact source transaction into current detail verification.
7. Preserve failed SSE stage/code in reseal ceremony.
8. Display optional source transaction in proof identifiers.
9. Validate request shape before dependency composition where safe.
10. Generate a current OG image and quarantine obsolete V1 artifacts.

### Phase B — design-system foundation

1. Write `DESIGN_SYSTEM.md` and declare the dossier signature, square geometry, single-shadow philosophy, type roles, and exception policy.
2. Establish canonical primitive/semantic/component tokens; remove duplicate and unresolved token sources.
3. Correct surface-aware contrast, establish type/spacing/control/motion/breakpoint scales, and encode accessibility defaults.
4. Build the six typed primitives and migrate active surfaces without changing behavior.
5. Delete or quarantine obsolete design-era components and stale documentation.
6. Add token, primitive-state, contrast, axe, screenshot, and viewport governance tests.

### Phase C — accessibility and interaction

1. Convert action areas to forms with Enter submission.
2. Add skip link, `aria-current`, invalid/described fields, and live-region coverage.
3. Set inputs to at least 16px and interactive targets to at least 44px.
4. Restrict hover to hover-capable devices and add active/tap states.
5. Raise muted/placeholder contrast and reduce typography to four roles.
6. Add cancel controls and explicit retry/recovery copy.
7. Give error/404 pages proper heading hierarchy.

### Phase D — Proof Ledger redesign

1. Move resolver/primary CTA into the hero.
2. Make the six-stage proof ribbon the first-viewport signature interaction.
3. Convert detail into one ledger with progressive disclosure for raw hashes.
4. Add truthfully labeled network/dependency state instead of a static badge.
5. Tighten spacing, status hierarchy, and mobile ordering.
6. Rename to “Public evidence verifier” and simplify jargon-heavy copy.

### Phase E — release validation

1. Turn this CLI matrix into persistent Playwright E2E tests with deterministic fixtures.
2. Re-run all viewports, keyboard, reduced motion, reflow, console, and asset checks.
3. Deploy with real V2 addresses and execute the paid mainnet canary.
4. Run formal live audit, record proof links, and capture final submission media.

## Decision gate

Recommended approval: proceed with **Proof Ledger**, starting with Phase A before aesthetic work. No visual implementation was started during this audit.
