# Sentinel ProofLock — World-Class Frontend and Playwright Audit

**Date:** 2026-08-28  
**Builds tested:** clean standalone release without a V2 deployment profile; production-like standalone release with synthetic public addresses  
**Assessment:** strong visual identity, but not submission-ready or world-class until correctness, accessibility, and judge-facing credibility defects are fixed.

## Executive summary

The graphite/violet/paper evidence-dossier system is distinctive and worth preserving. The clipped admission sheet is the product's signature element, the typography fits forensic infrastructure, and the copy describes a bounded admission policy instead of universal safety.

The audit proved that compilation success was not deployment success. The original standalone artifact omitted all static JS, CSS, and font assets. Playwright reproduced 30 console errors and an unstyled, non-interactive page. This is fixed by copying `public/` and `.next/static/` during `postbuild`; the rebuilt standalone app loads with zero baseline console errors.

The remaining blockers are more serious than surface polish: stale evidence can remain visible after a failed re-verification, historical proof verification is coupled to current chain-state availability, several claims disagree with behavior, the inventory is incomplete by construction, and key accessibility requirements are missing.

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

### Phase B — accessibility and interaction

1. Convert action areas to forms with Enter submission.
2. Add skip link, `aria-current`, invalid/described fields, and live-region coverage.
3. Set inputs to at least 16px and interactive targets to at least 44px.
4. Restrict hover to hover-capable devices and add active/tap states.
5. Raise muted/placeholder contrast and reduce typography to four roles.
6. Add cancel controls and explicit retry/recovery copy.
7. Give error/404 pages proper heading hierarchy.

### Phase C — Proof Ledger redesign

1. Move resolver/primary CTA into the hero.
2. Make the six-stage proof ribbon the first-viewport signature interaction.
3. Convert detail into one ledger with progressive disclosure for raw hashes.
4. Add truthfully labeled network/dependency state instead of a static badge.
5. Tighten spacing, status hierarchy, and mobile ordering.
6. Rename to “Public evidence verifier” and simplify jargon-heavy copy.

### Phase D — release validation

1. Turn this CLI matrix into persistent Playwright E2E tests with deterministic fixtures.
2. Re-run all viewports, keyboard, reduced motion, reflow, console, and asset checks.
3. Deploy with real V2 addresses and execute the paid mainnet canary.
4. Run formal live audit, record proof links, and capture final submission media.

## Decision gate

Recommended approval: proceed with **Proof Ledger**, starting with Phase A before aesthetic work. No visual implementation was started during this audit.
