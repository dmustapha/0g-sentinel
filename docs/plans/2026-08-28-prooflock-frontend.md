# Sentinel ProofLock Frontend Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Replace the legacy risk-scanner UI with a complete proof-first interface for canonical identity, ProofLock lifecycle, Gate decisions, historical verification, and independent health.

**Architecture:** A typed client maps stable read/admin APIs into one frontend domain model. Shared status functions own lifecycle and urgency semantics; components render those semantics without inferring from prose. Public pages remain read-only, while the evaluate flow invokes the authenticated synchronous SSE runner.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, CSS variables, Vitest, ethers-generated/versioned V2 ABI.

---

### Task 1: Freeze typed domain and status semantics

**Files:**
- Create: `frontend/lib/prooflock-types.ts`
- Create: `frontend/lib/prooflock-client.ts`
- Create: `frontend/lib/prooflock-status.ts`
- Create: `frontend/lib/prooflock-status.test.ts`
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/contracts.ts`

1. Write failing tests for lifecycle labels, Gate reasons, expiring thresholds, dashboard urgency, coverage, and historical/current separation.
2. Run the focused test and confirm missing exports fail.
3. Implement strict response parsing and exhaustive status mapping.
4. Replace active handwritten V1 tuple reads with one versioned V2 ABI source.
5. Run focused tests and both typechecks.
6. Commit `feat(prooflock): add typed frontend domain`.

### Task 2: Build Evaluate and ten-stage proof ceremony

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/components/ScanInput.tsx`
- Modify: `frontend/components/StreamingScanPanel.tsx`
- Modify: `frontend/lib/scan-errors.ts`
- Create: `frontend/components/IdentityResolver.tsx`
- Create: `frontend/components/ProofCoverageGrid.tsx`
- Create: `frontend/components/GateDecisionCard.tsx`
- Add component tests under `frontend/tests/ui/`

1. Write failing tests for invalid/resolving/missing/mismatch/valid identity.
2. Add tests for all ten stages and “no lease” on mandatory failure.
3. Add tests for active/expiring/expired/revoked/drifted/resealed and every stable Gate reason.
4. Implement the typed identity resolver and abort-aware SSE client.
5. Implement proof rail, coverage grid, decision card, and unmistakable demo fixture action.
6. Remove fictional production defaults and all legacy risk-board language.
7. Run focused UI/API tests, typecheck, and page render.
8. Commit `feat(prooflock): build evaluate ceremony`.

### Task 3: Replace dashboard and agent detail

**Files:**
- Modify: `frontend/app/agents/page.tsx`
- Replace: `frontend/app/agents/[address]/page.tsx` with canonical agent-ID semantics
- Modify: `frontend/components/AgentsTable.tsx`
- Modify: `frontend/lib/agents.ts`
- Modify: `frontend/lib/ranking.ts`
- Modify: `frontend/components/RescanButton.tsx`
- Create: `frontend/components/AdmissionLeaseCard.tsx`
- Create: `frontend/components/SealLifecycle.tsx`
- Create: `frontend/components/EvidenceProofCard.tsx`
- Create: `frontend/components/DemoFixtureBadge.tsx`

1. Write failing urgency-order and route-semantics tests.
2. Build Identity/Coverage/Seal/Lease/Gate/Last Checked dashboard columns.
3. Build responsive card fallback at 390px and 320px.
4. Build detail lifecycle, evidence, Gate, lease, and labeled operator reseal surface.
5. Remove risk leaderboard, address-as-agent identity, and unsafe rescan behavior.
6. Run tests, typecheck, and route renders.
7. Commit `feat(prooflock): replace dashboard with lease inventory`.

### Task 4: Build public proof and health surfaces

**Files:**
- Modify: `frontend/app/proof/page.tsx`
- Create: `frontend/app/proof/[proofId]/page.tsx`
- Modify: `frontend/components/VerifyEvidenceButton.tsx`
- Create: `frontend/components/SubsystemHealthGrid.tsx`

1. Write failing tests for match/mismatch/unavailable/timeout/retry.
2. Add tests separating historical artifact validity from current lease validity.
3. Implement proof lookup and offline-verification result surface.
4. Implement six independent health states with latency and observed timestamp.
5. Keep `networkProofVerified:false` visible and explain its scope.
6. Run tests, typecheck, and route renders.
7. Commit `feat(prooflock): add public verifier and health`.

### Task 5: Apply the industrial proof-ledger system and finish UX

**Files:**
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/components/NavLinks.tsx`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/app/error.tsx`
- Modify: `frontend/app/not-found.tsx`
- Modify: OpenGraph image routes
- Modify: `frontend/brand.json`

1. Add visual-regression fixtures for desktop, 390px, and 320px.
2. Implement proof-ledger tokens, evidence panels, vertical rail, elevation, focus, motion, and reduced motion.
3. Correct all mandatory trust/claim copy and metadata.
4. Remove legacy queue/risk/scanner UI components and `/api/agents` consumers from active routes.
5. Verify keyboard flow, color-independent states, wrapping, and no horizontal overflow.
6. Run full frontend/ProofLock/API tests, both typechecks, Hardhat 140, and production build.
7. Start a clean dev server, inspect key routes and browser console, and take desktop/mobile after screenshots.
8. Commit `feat(prooflock): finish proof-ledger frontend`.

### Task 6: Independent feature and design review

1. Map every row in `FEATURE-OBSERVABLES.md` to a reachable route/component.
2. Confirm every public/admin control is wired to real API behavior and has loading/empty/error states.
3. Run an independent UI/code review and fix all Critical/Important findings.
4. Re-run the complete verification gate and record evidence in `BUILD-REPORT.md`.

