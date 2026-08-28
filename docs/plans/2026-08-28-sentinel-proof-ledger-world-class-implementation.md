# Sentinel Proof Ledger World-Class Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a truthful, accessible, recoverable, judge-readable two-plane Proof Ledger while preserving Sentinel's strongest visual identity and every existing provenance guarantee.

**Architecture:** Correctness and claim semantics land before presentation. Historical evidence and current access become independent typed state machines; paid operator mutations move to a separate workbench with explicit write recovery. A small CSS-first system and seven product primitives then support a reversible route-by-route migration into the two-plane ledger.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Zod, Ethers v6, CSS custom properties/cascade layers, Vitest, Playwright, `@axe-core/playwright`, 0G Compute/Storage SDKs, RegistryV2, AgentGateV2.

---

## 0. Scope, release cut, and invariants

### Submission-critical Release 1

- Fix stale verifier and evaluator state.
- Separate historical verification from current access.
- Reject zero bytes32 consistently and validate before dependency construction.
- Preserve post-broadcast write certainty and add no-replay recovery.
- Bind every paid run to a durable idempotency/commitment journal and enforce identity, operator, global, rate, and budget ceilings.
- Return current identity/lease/Gate/consumer as independent observations pinned to one finalized block with explicit TTL/stale semantics.
- Make inventory partial-failure tolerant and explicitly bounded.
- Carry/display source transaction hints where available.
- Preserve exact reseal stage/code.
- Separate public proof exploration from privileged operator actions.
- Establish canonical tokens plus `Button`, `Field`, and `StateMessage`.
- Fix critical contrast, forms, focus, targets, mobile type, claims, metadata, and OG image.
- Deliver the truthful two-plane ledger on proof/detail surfaces.

**Release 1 stop gate:** if time is threatened, stop after correctness, durable recovery, behavior-only public/operator separation, safe display boundaries, truthful existing-IA proof/detail/inventory, the broken root OG/error hierarchy/security regression fixes, a persistent browser smoke/a11y harness, and the minimum `Button`/`Field`/`StateMessage` primitives. Full CSS modularization, all seven primitives, landing presentation, route-specific metadata polish, and legacy deletion remain Release 2.

### Release 2 before “world-class” signoff

- Complete all seven primitives and route migration.
- Add hostile-content hardening, three-browser E2E, axe, screen-reader, forced-colors, visual regression, zoom, performance, and 100-row/max-content matrices.
- Remove the obsolete design era and unused styling toolchain.
- Complete the funded mainnet and deployed-URL gates.

### Explicit deferrals

- A complete durable indexer/reorg/backfill service. Until approved separately, inventory says exactly which bounded block range and cap it represents.
- New smart-contract/protocol semantics.
- Continuous monitoring.
- Generic design library, Storybook hosting, or broad session-auth redesign.

### Non-negotiable invariants

1. Historical proof validity never depends on current Gate/lease availability.
2. No unavailable/mismatch state can render stale success evidence.
3. No UI says “No lease issued” after a write may have been broadcast.
4. Recovery never reruns paid Compute/Storage or submits another write.
5. No single proof-chain success state combines historical and current facts.
6. Public reads never require or solicit an operator token.
7. Fixtures remain unmistakably labeled and never become featured real proof data.
8. `networkProofVerified:false` remains visible wherever Storage capability is summarized.
9. UI observation timestamps, blocks, and freshness are server-issued; current facts become `STALE` after their declared TTL.
10. Identity/version alone never resolves an uncertain write; recovery matches the complete intended commitment set or a fully validated transaction.
11. Paid mutations are idempotent and abuse-bounded across double clicks, tabs, reconnects, and process restarts.

## 1. Dependency graph

```text
Truth model + claims + validation
  ├── verifier correctness
  ├── chain progress → durable operation journal → commitment-bound recovery
  ├── finalized discovery + exact proof locator
  ├── pinned independent current observations
  ├── behavior-only public/operator separation
  └── hostile-data boundaries

No-code 1440/390/320 state specification → explicit user approval
  └── persistent mocked + no-interception browser gates

Canonical tokens + primitive contracts
  ├── shell/proof pilot
  ├── inventory migration
  ├── agent detail two-plane ledger
  └── operator workbench migration

All route migrations
  └── adversarial E2E + performance + mainnet + deployed release gates
```

Do not start route styling before Tasks 1–9F are green and the user approves the no-code state specification. Do not delete legacy code before the active import graph is proven clean. Do not call the app world-class before Task 22.

---

### Task 1: Freeze the truth-state and claim contracts

**Files:**
- Create: `frontend/lib/prooflock-observations.ts`
- Create: `frontend/lib/prooflock-observations.test.ts`
- Create: `frontend/lib/prooflock-claims.ts`
- Create: `frontend/lib/prooflock-claims.test.ts`
- Modify: `frontend/lib/prooflock-types.ts`
- Modify: `FEATURE-OBSERVABLES.md`

**Step 1: Write failing truth-state tests**

Cover historical/current scope, verified/blocked/unavailable/stale/mismatch/not-applicable, required observation metadata, TTL expiry/background resume, and prohibited combinations. At minimum:

```ts
expect(() => observation({ id: "compute", scope: "CURRENT", status: "VERIFIED" })).toThrow();
expect(observation({ id: "storage", scope: "HISTORICAL", status: "VERIFIED",
  capability: "ROOT_MATCHED_NO_NETWORK_PROOF", observedAt, storageUploadTxHash })).toMatchObject({ scope: "HISTORICAL" });
```

**Step 2: Run the focused test and prove RED**

Run: `cd frontend && npm test -- lib/prooflock-observations.test.ts`
Expected: FAIL because the module does not exist.

**Step 3: Implement discriminated observation unions**

Require a Compute capability table keyed by SDK version/method, provider/model, proof class, verification result, and bound hashes. Require exact Storage capability plus `networkProofVerified:false`. Use distinct `registrySourceTxHash` and `storageUploadTxHash`. Current facts require server-issued block/time/TTL metadata. Expose one mapping from observation status to allowed copy key and semantic tone.

**Step 4: Add the claim registry**

Encode the permitted/prohibited language table from the approved design. Add tests rejecting “offline verifier,” universal “safe,” continuous drift, `networkProofVerified:true`, and unqualified “TEE-attested.”

**Step 5: Run focused tests and typecheck**

Run: `cd frontend && npm test -- lib/prooflock-observations.test.ts lib/prooflock-claims.test.ts && npm run typecheck`
Expected: PASS.

**Step 6: Commit**

```bash
git add frontend/lib/prooflock-observations.ts frontend/lib/prooflock-observations.test.ts frontend/lib/prooflock-claims.ts frontend/lib/prooflock-claims.test.ts frontend/lib/prooflock-types.ts FEATURE-OBSERVABLES.md
git commit -m "feat(ui): freeze proof observation and claim contracts"
```

---

### Task 2: Share strict identifier validation across client and server

**Files:**
- Create: `frontend/lib/prooflock-validation.ts`
- Create: `frontend/lib/prooflock-validation.test.ts`
- Modify: `frontend/app/proof/page.tsx`
- Modify: `frontend/app/proof/[proofId]/page.tsx`
- Modify: `frontend/server/prooflock/api.ts`
- Modify: `frontend/app/api/v1/identities/resolve/route.ts`
- Modify: `frontend/app/api/v1/prooflocks/[identityKey]/route.ts`
- Modify: `frontend/app/api/v1/proofs/[proofId]/verify/route.ts`
- Test: `frontend/tests/api/prooflock-api.test.ts`
- Create: `frontend/tests/api/validation-order.test.ts`

**Step 1: Write failing boundary tests**

Test zero, short, long, non-hex, uppercase-valid, lowercase-valid, and exact nonzero bytes32. With required environment intentionally absent, verify malformed requests still return `400 INVALID_INPUT` before any dependency factory is called.

**Step 2: Prove RED**

Run: `cd frontend && npm test -- lib/prooflock-validation.test.ts tests/api/prooflock-api.test.ts`
Expected: zero values still pass the page-level regex or the new module is missing.

**Step 3: Implement one validator**

Expose `isNonZeroBytes32`, `parseNonZeroBytes32`, and `isCanonicalAgentId` from a dependency-free, server-safe module with type-only imports. Return the original display value and a separate normalized typed value; never silently rewrite user-visible proof IDs.

**Step 4: Replace page regexes and server duplication**

Both proof pages use the same definition. All three read route files perform cheap preflight parsing before `createProductionReadDependencies()`; handlers still validate the structured request. The route-level test, not only injected handler tests, proves this ordering.

**Step 5: Verify**

Run: `cd frontend && npm test -- lib/prooflock-validation.test.ts tests/api/prooflock-api.test.ts tests/api/validation-order.test.ts tests/ui/proof-health.test.tsx && npm run typecheck`
Expected: PASS; invalid requests never touch dependencies.

**Step 6: Commit**

```bash
git add frontend/lib/prooflock-validation.ts frontend/lib/prooflock-validation.test.ts frontend/app/proof/page.tsx 'frontend/app/proof/[proofId]/page.tsx' frontend/server/prooflock/api.ts frontend/app/api/v1/identities/resolve/route.ts 'frontend/app/api/v1/prooflocks/[identityKey]/route.ts' 'frontend/app/api/v1/proofs/[proofId]/verify/route.ts' frontend/tests/api/prooflock-api.test.ts frontend/tests/api/validation-order.test.ts frontend/tests/ui/proof-health.test.tsx
git commit -m "fix(proof): share strict nonzero identifier validation"
```

---

### Task 3: Make verifier state atomic and historical/current independent

**Files:**
- Create: `frontend/lib/verification-state.ts`
- Create: `frontend/lib/verification-state.test.ts`
- Modify: `frontend/components/VerifyEvidenceButton.tsx`
- Modify: `frontend/lib/prooflock-types.ts`
- Test: `frontend/tests/ui/proof-health.test.tsx`

**Step 1: Write reducer transition tests**

Required sequences:

- `MATCH → START → MISMATCH`: no old proof/current/reason.
- `MATCH → START → TIMEOUT`: no old proof/current/reason.
- historical `MATCH` + current `UNAVAILABLE`: proof remains visible; current plane says unavailable.
- historical `MISMATCH`: current read is not allowed to upgrade it.
- repeated retry: only the latest request can commit state.
- historical cancel produces `CANCELED`, never `TIMEOUT`; current cancel preserves a completed historical match.

**Step 2: Prove RED**

Run: `cd frontend && npm test -- lib/verification-state.test.ts tests/ui/proof-health.test.tsx`
Expected: FAIL against the current independent `useState` fields.

**Step 3: Implement a discriminated reducer**

Use separate `historical` and `current` substates plus a request generation ID. `START` atomically clears prior payloads. Abort the prior controller before starting another request. Give historical and current planes separate controllers and timeout budgets so the first request cannot consume the second plane's deadline.

**Step 4: Decouple request orchestration**

Await `verifyProof` as the primary operation. After historical match, run `readProofLockDetail` as a secondary observation with its own failure state. Do not use one `Promise.all`.

**Step 5: Add Cancel and busy semantics**

Keep a controller ref; show Cancel during verification; expose concise `role="status"` and `aria-busy` behavior.

**Step 6: Verify**

Run: `cd frontend && npm test -- lib/verification-state.test.ts tests/ui/proof-health.test.tsx && npm run typecheck`
Expected: all sequential transitions pass.

**Step 7: Commit**

```bash
git add frontend/lib/verification-state.ts frontend/lib/verification-state.test.ts frontend/components/VerifyEvidenceButton.tsx frontend/lib/prooflock-types.ts frontend/tests/ui/proof-health.test.tsx
git commit -m "fix(verifier): separate historical proof from current access"
```

---

### Task 4: Clear all identity-dependent Evaluate state atomically

**Files:**
- Create: `frontend/lib/evaluate-state.ts`
- Create: `frontend/lib/evaluate-state.test.ts`
- Modify: `frontend/components/ScanInput.tsx`
- Test: `frontend/tests/ui/evaluate.test.tsx`

**Step 1: Write failing transitions**

Cover resolved Agent A → edit Agent B, failed run → edit, resolve-phase cancel, and new resolve superseding an old response. Assert identity, lock, Gate, coverage, stages, failure, and write outcome all reset together.

**Step 2: Prove RED**

Run: `cd frontend && npm test -- lib/evaluate-state.test.ts tests/ui/evaluate.test.tsx`.

**Step 3: Implement the reducer and generation guard**

Replace coordinated identity/lock/Gate/stage booleans with a discriminated state. Any input mutation dispatches `EDIT_IDENTITY`. Cancellation is permitted during identity resolution; once a paid ceremony reaches side-effectful work, cancellation is deferred to the structured uncertainty/recovery behavior in Tasks 5–7.

**Step 4: Add semantic resolve form and visible cancel**

Enter submits only when valid. Resolve-phase Cancel calls the active controller. A paid SEAL/RESEAL cancel never returns directly to idle. The form remains usable without pointer interaction.

**Step 5: Verify and commit**

Run: `cd frontend && npm test -- lib/evaluate-state.test.ts tests/ui/evaluate.test.tsx && npm run typecheck`.

```bash
git add frontend/lib/evaluate-state.ts frontend/lib/evaluate-state.test.ts frontend/components/ScanInput.tsx frontend/tests/ui/evaluate.test.tsx
git commit -m "fix(evaluate): make identity workflow state atomic"
```

---

### Task 5: Preserve exact write certainty in runner and SSE

**Atomic-slice rule:** Tasks 5 and 6 are implemented, reviewed, and committed together. Task 5 may not merge or deploy without Task 6 because every submission-outcome-unknown state requires an already durable recovery ID.

**Files:**
- Create: `frontend/server/prooflock/operation-journal.ts`
- Create: `frontend/tests/prooflock/operation-journal.test.ts`
- Modify: `frontend/server/prooflock/chain.ts`
- Modify: `frontend/server/prooflock/operator.ts`
- Modify: `frontend/server/prooflock/production-operator.ts`
- Modify: `frontend/server/prooflock/runner.ts`
- Modify: `frontend/server/prooflock/api.ts`
- Modify: `frontend/lib/prooflock-types.ts`
- Modify: `frontend/lib/prooflock-client.ts`
- Test: `frontend/tests/prooflock/runner.test.ts`
- Test: `frontend/tests/api/prooflock-api.test.ts`
- Test: `frontend/tests/ui/operator-request.test.ts`

**Step 1: Write fault-injection tests**

Inject failure:

1. Before chain broadcast → `NOT_BROADCAST`.
2. Submission attempted; adapter throws without a reliable hash → `SUBMISSION_OUTCOME_UNKNOWN` (“submission attempted; broadcast not yet proven”).
3. After finalized write, before readback → `FINALIZED_READBACK_UNAVAILABLE` with recovery ID/tx hash/identity/version.
4. After exact readback → `SEALED`.

Assert private provider messages and tokens never enter the SSE frame.

**Step 2: Prove RED**

Run: `cd frontend && npm test -- tests/prooflock/runner.test.ts tests/prooflock/operation-journal.test.ts tests/api/prooflock-api.test.ts`.

**Step 3: Expose submission/finality progress from the chain layer**

Add a sanitized `ChainWriteProgress` callback or split prepare/send/finalize so the runner can distinguish pre-send, submission-attempted, hash-known, receipt/finality, and readback phases. `NOT_BROADCAST` is legal only before invoking send. Add `RunnerProgress`; preserve simple stage events for compatibility and emit the hash as soon as it is reliably known.

Before any paid stage, create the durable operation row with recovery ID, idempotency key, canonical request/input digest, identity/subject/policy/version/runtime facts, and reserved budget. A reused idempotency key with the same digest returns the existing operation; the same key with a different digest fails with a stable conflict and never starts work.

**Step 4: Attach public write outcome to terminal errors**

Extend `ProofLockStageError` with a sanitized optional outcome. Treat `READING_CHAIN_BACK` specially because `chain` is known. Do not serialize `cause`.

**Step 5: Parse terminal outcome in the client**

`runProofLock` returns or throws a typed terminal result. It must preserve failed stage/code/write outcome for ScanInput and RescanButton.

**Step 6: Verify, but do not commit independently**

Run: `cd frontend && npm test -- tests/prooflock/runner.test.ts tests/prooflock/operation-journal.test.ts tests/api/prooflock-api.test.ts tests/ui/operator-request.test.ts && npm run typecheck`.

Proceed directly to Task 6. The combined commit command lives there.

---

### Task 6: Add restart-safe, no-replay write recovery

**Files:**
- Create: `frontend/server/prooflock/recovery.ts`
- Modify: `frontend/server/prooflock/operation-journal.ts`
- Create: `frontend/tests/prooflock/recovery.test.ts`
- Modify: `frontend/tests/prooflock/operation-journal.test.ts`
- Create: `frontend/app/api/admin/prooflocks/recovery/route.ts`
- Modify: `frontend/server/prooflock/operator.ts`
- Modify: `frontend/server/prooflock/production-operator.ts`
- Modify: `frontend/server/prooflock/api.ts`
- Modify: `frontend/lib/prooflock-client.ts`
- Modify: `frontend/lib/prooflock-types.ts`
- Test: `frontend/tests/api/prooflock-api.test.ts`
- Modify: `.env.example`
- Modify: `frontend/.env.example`
- Modify: `frontend/tests/release/config-contract.test.ts`

**Step 1: Write recovery tests**

Cover known finalized tx, reverted tx, unknown tx, adapter failure after possible acceptance, later competing authorized scanner at the same identity/version, RPC outage, malformed input, and unauthorized access. Assert zero calls to Compute, Storage upload, `seal`, or `reseal` during recovery.

**Step 2: Prove RED**

Run: `cd frontend && npm test -- tests/prooflock/recovery.test.ts tests/api/prooflock-api.test.ts`.

**Step 3: Complete the phased operation journal**

Complete the phased SQLite journal in the existing persistent state directory—never persist the bearer token. Phase 1 (before paid work) stores recovery/idempotency IDs, canonical input digest, subject, expected version, policy/runtime facts, and reserved budget. Phase 2 appends exact verified Compute/transcript commitments. Phase 3 appends exact verified Storage/upload/artifact commitments. The complete chain input—policy, risk, coverage, envelope, Compute, Storage, artifact, and runtime commitments—must be durably committed before Registry submission. Later phases append submission attempt, hash, receipt/finality, and terminal outcome.

Enforce one active ceremony per identity plus configured per-operator/global concurrency, request-rate, and daily spend ceilings. Emit token-free structured audit events for accepted, deduplicated, rejected, submitted, recovered, and completed operations.

Document `PROOFLOCK_OPERATOR_MAX_CONCURRENCY`, `PROOFLOCK_OPERATOR_RATE_WINDOW_MS`, `PROOFLOCK_OPERATOR_RATE_LIMIT`, `PROOFLOCK_OPERATOR_DAILY_CEREMONY_LIMIT`, and `PROOFLOCK_OPERATOR_DAILY_COST_UNITS_LIMIT` as exact positive integers in both env examples. Each paid stage reserves configured cost units atomically in the journal before execution and reconciles them on terminal outcome. Production startup fails closed on missing/invalid limits; config tests keep names and bounds synchronized.

**Step 4: Implement commitment-bound read-only recovery**

Input is the opaque recovery ID plus optional transaction hash. With a hash, bind receipt target, sender, status, calldata/event, identity/version, every intended commitment, and finality. Without a trustworthy hash, inspect only facts that can be matched to the journal's complete commitment set. If attribution is incomplete, remain unknown.

**Step 5: Expose one authenticated POST recovery endpoint**

Authenticate and validate before constructing chain dependencies. Use `no-store`, a bounded body, request deadlines, and stable errors. The bearer token remains header-only. The endpoint cannot write.

**Step 6: Prove restart and idempotency behavior**

Construct a new service instance after every journal phase and reload it. Cover cancel/restart between Phase 1/Compute, Compute/Storage, Storage/Registry, send/hash, hash/finality, and finality/readback. The same idempotency key + same digest returns the existing operation; same key + different digest is a conflict. Identity/version without journal commitments cannot resolve a racing scanner's write.

**Step 7: Verify and commit**

Run: `cd frontend && npm test -- tests/prooflock/recovery.test.ts tests/prooflock/operation-journal.test.ts tests/api/prooflock-api.test.ts && npm run typecheck`.

```bash
git add frontend/server/prooflock/chain.ts frontend/server/prooflock/operator.ts frontend/server/prooflock/production-operator.ts frontend/server/prooflock/runner.ts frontend/server/prooflock/api.ts frontend/server/prooflock/recovery.ts frontend/server/prooflock/operation-journal.ts frontend/tests/prooflock/runner.test.ts frontend/tests/prooflock/recovery.test.ts frontend/tests/prooflock/operation-journal.test.ts frontend/app/api/admin/prooflocks/recovery/route.ts frontend/lib/prooflock-client.ts frontend/lib/prooflock-types.ts frontend/tests/api/prooflock-api.test.ts frontend/tests/ui/operator-request.test.ts .env.example frontend/.env.example frontend/tests/release/config-contract.test.ts
git commit -m "fix(operator): make paid writes recoverable and idempotent"
```

---

### Task 7: Render truthful operator terminal and recovery states

**Files:**
- Modify: `frontend/components/StreamingScanPanel.tsx`
- Modify: `frontend/components/ScanInput.tsx`
- Modify: `frontend/components/RescanButton.tsx`
- Create: `frontend/components/WriteRecoveryPanel.tsx`
- Test: `frontend/tests/ui/evaluate.test.tsx`
- Create: `frontend/tests/ui/operator-recovery.test.tsx`

**Step 1: Write render tests for every write outcome**

`NOT_BROADCAST` may say no lease was issued. `SUBMISSION_OUTCOME_UNKNOWN` says submission was attempted but broadcast is not proven and forbids retry. `FINALIZED_READBACK_UNAVAILABLE` shows exact explorer tx and Recover. `SEALED` shows version and proof link. Reseal preserves exact failed stage/code.

**Step 2: Prove RED**

Run: `cd frontend && npm test -- tests/ui/evaluate.test.tsx tests/ui/operator-recovery.test.tsx`.

**Step 3: Implement the panel and concise announcements**

The visual ten-stage rail is `aria-hidden` from repetitive announcements; one persistent `role="status"` announces current stage. Errors use `role="alert"`. Recover is stable under keyboard focus.

SEAL and RESEAL expose visible cancellation. Before submission, cancellation is final. After submission is attempted, cancellation enters the same uncertain/recovery state and never implies the paid operation stopped. Cover double-click, multi-tab, disconnect, and cancellation at each side-effect boundary.

**Step 4: Clear token on every terminal path**

Success, failure, cancellation, navigation, and unmount clear the token. No token appears in component logs or serialized fixtures.

**Step 5: Verify and commit**

Run: `cd frontend && npm test -- tests/ui/evaluate.test.tsx tests/ui/operator-recovery.test.tsx tests/ui/operator-request.test.ts && npm run typecheck`.

```bash
git add frontend/components/StreamingScanPanel.tsx frontend/components/ScanInput.tsx frontend/components/RescanButton.tsx frontend/components/WriteRecoveryPanel.tsx frontend/tests/ui/evaluate.test.tsx frontend/tests/ui/operator-recovery.test.tsx frontend/tests/ui/operator-request.test.ts
git commit -m "feat(operator): expose truthful recovery states"
```

---

### Task 8: Make discovery bounded, explicit, fault-tolerant, and Gate-aware

**Files:**
- Modify: `frontend/app/api/discover/route.ts`
- Modify: `frontend/lib/prooflock-types.ts`
- Modify: `frontend/lib/prooflock-client.ts`
- Modify: `frontend/lib/prooflock-status.ts`
- Modify: `frontend/lib/prooflock-status.test.ts`
- Modify: `frontend/app/agents/page.tsx`
- Modify: `frontend/components/AgentsTable.tsx`
- Create: `frontend/tests/api/discovery.test.ts`
- Modify: `frontend/tests/ui/inventory-navigation.test.tsx`

**Step 1: Define the truthful response contract**

Return `fromBlock`, finalized `toBlock`, `confirmations`, `observedAt`, `cap`, `returned`, and `complete:false`. Do not call this an all-registry inventory. Reject removed events or return an explicit provisional/reorg status.

**Step 2: Write failing API/UI tests**

Cover range/cap/finality disclosure, dedupe, newest source tx, removed/reorganized events, one successful + one failed enrichment, all failed, abort, actual maximum concurrent reads, and Gate-denied ACTIVE ordering ahead of admitted ACTIVE.

**Step 3: Prove RED**

Run: `cd frontend && npm test -- tests/api/discovery.test.ts tests/ui/inventory-navigation.test.tsx lib/prooflock-status.test.ts`.

**Step 4: Implement bounded enrichment**

Implement a bounded worker pool; do not create every enrichment promise before the limiter. Return a discriminated row union: verified rows contain proof detail, while `ENRICHMENT_UNAVAILABLE` rows contain only discovery identity/source block/registry transaction/stable code. Preserve successful rows; failed rows are never called admitted.

**Step 5: Make urgency accept the whole item**

Order drift/revoked, verified Gate denials, expired/expiring, incomplete/unknown, then admitted. Add deterministic tie-breakers: block descending, identity key ascending.

**Step 6: Update copy**

Rename the heading/subtitle to “Recent ProofLocks” or display an equally prominent scope disclosure. Show exact observed range, cap, and timestamp.

If the release does not add cursor pagination/backfill from `PROOFLOCK_REGISTRY_V2_FROM_BLOCK`, record “complete inventory unavailable; recent finalized activity only” as a signed Task 22 limitation. Do not imply that older active leases are absent.

**Step 7: Verify and commit**

Run: `cd frontend && npm test -- tests/api/discovery.test.ts tests/ui/inventory-navigation.test.tsx lib/prooflock-status.test.ts && npm run typecheck`.

```bash
git add frontend/app/api/discover/route.ts frontend/lib/prooflock-types.ts frontend/lib/prooflock-client.ts frontend/lib/prooflock-status.ts frontend/lib/prooflock-status.test.ts frontend/app/agents/page.tsx frontend/components/AgentsTable.tsx frontend/tests/api/discovery.test.ts frontend/tests/ui/inventory-navigation.test.tsx
git commit -m "fix(inventory): disclose bounded partial discovery"
```

---

### Task 9: Preserve and display exact proof locator context

**Files:**
- Modify: `frontend/lib/agents.ts` or create `frontend/lib/prooflock-routes.ts`
- Modify: `frontend/components/AgentsTable.tsx`
- Modify: `frontend/app/agents/[address]/page.tsx`
- Modify: `frontend/app/proof/[proofId]/page.tsx`
- Modify: `frontend/components/SealLifecycle.tsx`
- Test: `frontend/tests/ui/inventory-navigation.test.tsx`
- Test: `frontend/tests/ui/proof-health.test.tsx`
- Test: `frontend/tests/api/prooflock-security.test.ts`

**Step 1: Extract a V2-only route helper**

Avoid importing the legacy `agents.ts` graph merely for a URL. Build canonical agent/proof URLs with `URLSearchParams`, including source tx when known.

**Step 2: Write compatibility tests**

Old proof URLs without hints remain valid within locator bounds or return precise `HINT_REQUIRED`. Mismatched hints never select another proof. A source hint never changes the proof ID.

**Step 3: Carry the hint into detail verification**

Inventory links to `/agents/[address]?sourceTxHash=...`. Validate the nonzero hint with the shared parser. Bind it to the loaded record/proof ID before calling `verifyProof`; if the record advanced, render a stale-link state or retry without claiming the hinted proof. Proof identifiers visibly distinguish `registrySourceTxHash` from `storageUploadTxHash` and link each to the correct explorer target.

**Step 4: Handle predecessor links honestly**

If the predecessor source tx is unknown, label the link “locator may require source transaction” rather than implying guaranteed recovery.

**Step 5: Verify and commit**

Run: `cd frontend && npm test -- tests/ui/inventory-navigation.test.tsx tests/ui/proof-health.test.tsx tests/api/prooflock-api.test.ts tests/api/prooflock-security.test.ts && npm run typecheck`.

```bash
git add frontend/lib/prooflock-routes.ts frontend/components/AgentsTable.tsx frontend/app/agents/page.tsx 'frontend/app/agents/[address]/page.tsx' frontend/app/proof/page.tsx 'frontend/app/proof/[proofId]/page.tsx' frontend/components/SealLifecycle.tsx frontend/tests/ui/inventory-navigation.test.tsx frontend/tests/ui/proof-health.test.tsx frontend/tests/api/prooflock-api.test.ts frontend/tests/api/prooflock-security.test.ts
git commit -m "fix(proof): preserve exact locator context"
```

---

### Task 9A: Return pinned, independent current observations

**Files:**
- Create: `frontend/server/prooflock/current-observations.ts`
- Create: `frontend/tests/prooflock/current-observations.test.ts`
- Modify: `frontend/server/prooflock/read-api.ts`
- Modify: `frontend/server/prooflock/api.ts`
- Modify: `frontend/lib/prooflock-types.ts`
- Modify: `frontend/lib/prooflock-client.ts`
- Modify: `frontend/tests/api/prooflock-api.test.ts`

**Step 1: Write the partial-observation contract tests**

Pin one finalized block, then independently exercise identity, lease, Gate, and guarded-consumer reads. Prove historical MATCH + Storage unavailable + current Gate BLOCKED remains renderable. Cover one/multiple current dependency failures, RPC inconsistency, stale TTL, background resume, refresh failure, a reorg-shaped block mismatch, legacy response compatibility, and rejection when supplied `agentId` resolves/recomputes to a different identity key.

**Step 2: Prove RED**

Run: `cd frontend && npm test -- tests/prooflock/current-observations.test.ts tests/api/prooflock-api.test.ts`.

**Step 3: Implement one server observation boundary**

Resolve a finalized block once. Issue each current read with that explicit block tag and settle them independently. Return server-owned `observedAt`, `blockNumber`, `freshnessExpiresAt`, capability, status, and stable reason per observation. Health discovery remains current availability only; it can never stand in for a verified Compute inference.

**Step 4: Add versioned current observations without breaking readers**

Keep the existing response fields through a compatibility adapter and add a versioned `sealedEvidence`/`currentAccess` shape that new clients prefer. Deprecate—do not silently replace—the old all-or-nothing `ProofLockDetail` contract during migration. The request carries canonical `agentId` plus `identityKey`; the server recomputes the identity key from the resolved ERC-8004 identity and rejects any mismatch before returning current facts. Identity key alone is never treated as reversible. Storage/evidence retrieval failure cannot erase current Gate/consumer facts, and current refresh cannot mutate historical proof state.

**Step 5: Verify and commit**

Run: `cd frontend && npm test -- tests/prooflock/current-observations.test.ts tests/api/prooflock-api.test.ts && npm run typecheck`.

```bash
git add frontend/server/prooflock/current-observations.ts frontend/tests/prooflock/current-observations.test.ts frontend/server/prooflock/read-api.ts frontend/server/prooflock/api.ts frontend/lib/prooflock-types.ts frontend/lib/prooflock-client.ts frontend/tests/api/prooflock-api.test.ts
git commit -m "fix(proof): pin independent current observations"
```

---

### Task 9B: Split public and operator behavior before visual redesign

**Files:**
- Create: `frontend/app/operator/page.tsx`
- Create: `frontend/app/operator/layout.tsx`
- Create: `frontend/components/OperatorWorkbench.tsx`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/app/agents/[address]/page.tsx`
- Modify: `frontend/components/ScanInput.tsx`
- Modify: `frontend/components/RescanButton.tsx`
- Modify: `frontend/components/NavLinks.tsx`
- Create: `frontend/tests/ui/operator-routing.test.tsx`

**Step 1: Write behavior-only route tests**

The public landing and detail pages contain no token input or mutation control. `/operator?agentId=...` preloads only the public identifier, never a token. The workbench supports initial seal plus existing-record drift/reseal/recovery. Public detail links to it. Navigation announces the current route.

**Step 2: Move behavior without restyling**

Preserve current visual classes and request contracts. Move `ScanInput` and all `RescanButton` behavior into `OperatorWorkbench`. Name the authority/cost boundary before the token field. Confirm the token clears on terminal, cancel, navigation, and unmount paths.

**Step 3: Verify and commit**

Run: `cd frontend && npm test -- tests/ui/operator-routing.test.tsx tests/ui/evaluate.test.tsx tests/ui/operator-recovery.test.tsx && npm run typecheck`.

```bash
git add frontend/app/operator/page.tsx frontend/app/operator/layout.tsx frontend/components/OperatorWorkbench.tsx frontend/app/page.tsx 'frontend/app/agents/[address]/page.tsx' frontend/components/ScanInput.tsx frontend/components/RescanButton.tsx frontend/components/NavLinks.tsx frontend/tests/ui/operator-routing.test.tsx
git commit -m "refactor(ui): separate public and operator journeys"
```

---

### Task 9C: Establish hostile-data and link safety before route pilots

**Files:**
- Create: `frontend/lib/safe-display.ts`
- Create: `frontend/lib/safe-display.test.ts`
- Create: `frontend/lib/explorer-url.ts`
- Create: `frontend/lib/explorer-url.test.ts`
- Modify: `frontend/lib/prooflock-client.ts`
- Modify: `frontend/components/VerifyEvidenceButton.tsx`
- Modify: `frontend/components/EvidenceProofCard.tsx`
- Modify: `frontend/components/IdentityResolver.tsx`
- Modify: `frontend/components/TrustRoleDisclosure.tsx`
- Modify: `frontend/components/SubsystemHealthGrid.tsx`
- Modify: `frontend/components/AgentsTable.tsx`
- Modify: `frontend/components/GateDecisionCard.tsx`
- Modify: `frontend/app/agents/[address]/page.tsx`
- Modify: `frontend/app/proof/[proofId]/page.tsx`
- Create: `frontend/tests/ui/hostile-content.test.tsx`

**Step 1: Write adversarial fixtures**

Cover bidi overrides, zero-width/control characters, combining marks, confusables, emoji, 10k-character strings, invalid explorer bases, `javascript:`, `data:`, user-info URLs, and display/canonical-value separation.

**Step 2: Implement safe boundaries**

Bound display-only natural language at Zod/client parse boundaries without truncating canonical values used for hashing, verification, copy, or provenance. Render hashes/addresses in LTR isolation and natural language in bidi isolation. Build external links only from an allowlisted HTTPS explorer origin.

**Step 3: Apply the boundary to every active Release 1 surface**

Migrate verifier, detail, inventory, identity, trust-role, health, evidence, and Gate rendering now. Include blank role strings, hostile provider/model/error text, and unsafe explorer configuration. No later visual pilot may reintroduce raw untrusted prose or direct URL concatenation.

**Step 4: Verify and commit**

Run: `cd frontend && npm test -- lib/safe-display.test.ts lib/explorer-url.test.ts tests/ui/hostile-content.test.tsx && npm run typecheck`.

```bash
git add frontend/lib/safe-display.ts frontend/lib/safe-display.test.ts frontend/lib/explorer-url.ts frontend/lib/explorer-url.test.ts frontend/lib/prooflock-client.ts frontend/components/VerifyEvidenceButton.tsx frontend/components/EvidenceProofCard.tsx frontend/components/IdentityResolver.tsx frontend/components/TrustRoleDisclosure.tsx frontend/components/SubsystemHealthGrid.tsx frontend/components/AgentsTable.tsx frontend/components/GateDecisionCard.tsx 'frontend/app/agents/[address]/page.tsx' 'frontend/app/proof/[proofId]/page.tsx' frontend/tests/ui/hostile-content.test.tsx
git commit -m "feat(ui): establish hostile evidence boundaries"
```

---

### Task 9D: Approve the complete no-code state specification

**Files:**
- Create: `docs/design/2026-08-28-sentinel-proof-ledger-state-spec.md`
- Modify: `docs/plans/2026-08-28-sentinel-proof-ledger-world-class-design.md`

**Step 1: Produce exact 1440/390/320 wireframes**

Specify viewport order, widths, density, focus order, mobile stacking, long-content behavior, and first-viewport actions for overview, recent ProofLocks, detail, verifier, operator, global error, and 404. Cover loading, empty, error, stale, partial, mismatch, blocked, fixture, uncertain write, recovery, and maximum-content states.

**Step 2: Freeze semantics in the drawings**

The architecture strip reads `Identity → Checks → Compute → Storage → Lease → Gate` and is labeled “architecture/process”—never animated or presented as live completion. The two-plane ledger keeps historical and current observations independent. The configured featured proof is called “featured real proof” only after exact release-time verification; otherwise the CTA says “Browse recent ProofLocks.”

**Step 3: User approval gate**

Present the no-code state specification and wait for explicit user approval. Do not begin Task 10 or route styling until approval is recorded in the document.

```bash
git add docs/design/2026-08-28-sentinel-proof-ledger-state-spec.md docs/plans/2026-08-28-sentinel-proof-ledger-world-class-design.md
git commit -m "docs(design): freeze Proof Ledger route states"
```

---

### Task 9E: Install a persistent submission-critical browser harness

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/tests/e2e/public-smoke.spec.ts`
- Create: `frontend/tests/e2e/operator-safety.spec.ts`
- Create: `frontend/tests/e2e/accessibility-smoke.spec.ts`

**Step 1: Install explicit tooling**

Add Playwright and `@axe-core/playwright`, plus deterministic scripts. Install Chromium, Firefox, and WebKit with `npx playwright install chromium firefox webkit` (`--with-deps` in Linux CI when required). Keep the existing Node Vitest suite for reducers/static rendering; browser focus, keyboard, computed-style, and race assertions live here unless jsdom/Testing Library is separately introduced.

**Step 2: Add two isolated projects**

Create a deterministic mocked UI-state project and a production-standalone no-interception smoke project. Mocked fixtures may not intercept asset requests. The standalone project may render truthful degraded API states with missing credentials but must not intercept same-origin API, route, health, font, or media requests.

**Step 3: Enforce the Release 1 browser floor**

Test public/operator route separation, Enter submission, focus return, 44px targets, 16px mobile inputs, blank trust-role fallback, deterministic error-boundary trigger, zero unwaived axe A/AA findings, and no token in URL/storage/console/network bodies. Disable trace/video for synthetic-token tests or use verified redaction.

**Step 4: Verify and commit**

Run: `cd frontend && npm run typecheck && npm run build && npm run test:e2e -- --project=chromium-mocked && npm run test:e2e -- --project=standalone-smoke`. The standalone project must prove process teardown, packaged assets, and unmocked same-origin route/API/health behavior.

```bash
git add frontend/package.json frontend/package-lock.json frontend/playwright.config.ts frontend/tests/e2e/public-smoke.spec.ts frontend/tests/e2e/operator-safety.spec.ts frontend/tests/e2e/accessibility-smoke.spec.ts
git commit -m "test(ui): establish submission browser gates"
```

---

### Task 9F: Close known release-shell regressions before visual work

**Files:**
- Create: `frontend/app/opengraph-image.tsx`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/app/error.tsx`
- Modify: `frontend/app/not-found.tsx`
- Modify: `frontend/next.config.mjs`
- Modify: `frontend/tests/release/config-contract.test.ts`
- Modify: `frontend/scripts/test-release.mjs`

**Step 1: Lock the already-proven failures**

Assert the root OG image returns 200/image MIME, error and 404 surfaces have one `h1`, baseline frame/MIME/referrer headers remain exact, and the packaged standalone route/assets continue to load.

**Step 2: Apply only submission-blocking shell corrections**

Generate a truthful root OG image without a fixture verdict/live badge, correct heading hierarchy, and preserve the already-fixed standalone asset packaging. Defer route-specific metadata and the final enforced CSP decision to Task 18.

**Step 3: Verify and commit**

Run: `cd frontend && npm test -- tests/release/config-contract.test.ts && npm run typecheck && npm run build && npm run test:release`.

```bash
git add frontend/app/opengraph-image.tsx frontend/app/layout.tsx frontend/app/error.tsx frontend/app/not-found.tsx frontend/next.config.mjs frontend/tests/release/config-contract.test.ts frontend/scripts/test-release.mjs
git commit -m "fix(release): close judge-facing shell regressions"
```

---

### Task 10: Establish the canonical design-system source

**Files:**
- Create: `frontend/app/styles/foundations.css`
- Create: `frontend/app/styles/tokens.css`
- Create: `frontend/app/styles/components.css`
- Create: `frontend/app/styles/layouts.css`
- Create: `frontend/app/styles/motion.css`
- Create: `frontend/app/styles/utilities.css`
- Create: `frontend/DESIGN_SYSTEM.md`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/brand.json`
- Replace/archive: `frontend/ai/design-progress.md`
- Create: `frontend/tests/ui/token-contract.test.ts`

**Step 1: Write failing token-governance tests**

Assert exact primitive/semantic/component token names and values, all variable references resolve, active style files have no forbidden raw colors except an allowlist, and documented surface pairs meet contrast targets.

**Step 2: Prove RED**

Run: `cd frontend && npm test -- tests/ui/token-contract.test.ts`.

**Step 3: Define the canonical layers**

Import every declared file from `globals.css` and use cascade layers in this order: reset, tokens, base, components, layouts, motion, utilities, overrides. Add:

- Surface-aware text/status/action/focus tokens.
- 4px half-step/8px primary spacing scale.
- Governed type roles and line heights.
- 44/48px controls.
- Square geometry plus dossier-cut token.
- Exact no-blur shadow grammar: `3px 3px 0` controls and `5px 5px 0` primary sheets.
- Fast ≤150ms and standard ≤200ms durations; transform/opacity only; no smooth scrolling; hard maximum 300ms.
- Layer, measure, icon, and breakpoint documentation.

**Step 4: Correct contrast before migration**

Every normal text token pair ≥4.5:1; UI/focus/large/non-text indicators ≥3:1. Add computed tests for captions ≥12px, data/secondary ≥14px, body/form ≥16px, and a static rule forbidding broad `word-break` outside `DataRow`. Do not reuse dark status values on paper.

**Step 5: Make documentation truthful**

Document signature, shadow philosophy, token layers, variants, accessibility defaults, exception policy, and test links. Reduce `brand.json` to non-style metadata or generate it from tokens.

**Step 6: Verify and commit**

Run: `cd frontend && npm test -- tests/ui/token-contract.test.ts tests/ui/visual-contract.test.ts && npm run typecheck`.

```bash
git add frontend/app/styles/foundations.css frontend/app/styles/tokens.css frontend/app/styles/components.css frontend/app/styles/layouts.css frontend/app/styles/motion.css frontend/app/styles/utilities.css frontend/app/globals.css frontend/DESIGN_SYSTEM.md frontend/brand.json frontend/ai/design-progress.md frontend/tests/ui/token-contract.test.ts frontend/tests/ui/visual-contract.test.ts
git commit -m "feat(design): establish canonical Proof Ledger tokens"
```

---

### Task 11: Build accessible Button, Field, and StateMessage primitives

**Files:**
- Create: `frontend/components/ui/Button.tsx`
- Create: `frontend/components/ui/Field.tsx`
- Create: `frontend/components/ui/StateMessage.tsx`
- Create: `frontend/components/ui/ui-contract.test.tsx`
- Modify: `frontend/app/styles/components.css`
- Modify: `frontend/app/globals.css`

**Step 1: Write the primitive state matrix tests**

Button: primary/secondary/quiet/destructive × pending/disabled. Field: hint/error/invalid/read-only/mono. StateMessage: loading/empty/error/unavailable/success with optional action and correct live policy.

**Step 2: Prove RED**

Run: `cd frontend && npm test -- components/ui/ui-contract.test.tsx`.

**Step 3: Implement semantics at creation time**

- Buttons default to 44px, expose `aria-busy`, stable label width, pressed feedback, and hover only inside `(hover:hover) and (pointer:fine)`.
- Field generates IDs and wires label/hint/error through `aria-describedby` and `aria-invalid`.
- StateMessage uses persistent `role=status` for progress and `role=alert` for errors, with controlled `aria-live`/`aria-atomic`.

**Step 4: Add forced-colors/reduced-motion rules**

No primitive may depend on background color alone. Remove smooth scrolling globally.

**Step 5: Verify and commit**

Run: `cd frontend && npm test -- components/ui/ui-contract.test.tsx tests/ui/token-contract.test.ts && npm run typecheck && npm run test:e2e -- --project=chromium-mocked --grep "primitive"`.

```bash
git add frontend/components/ui/Button.tsx frontend/components/ui/Field.tsx frontend/components/ui/StateMessage.tsx frontend/components/ui/ui-contract.test.tsx frontend/app/styles/components.css frontend/app/globals.css
git commit -m "feat(ui): add accessible interaction primitives"
```

---

### Task 12: Pilot the system on the public verifier

**Files:**
- Modify: `frontend/app/proof/page.tsx`
- Modify: `frontend/app/proof/[proofId]/page.tsx`
- Modify: `frontend/components/VerifyEvidenceButton.tsx`
- Modify: `frontend/components/SubsystemHealthGrid.tsx`
- Modify: `frontend/tests/ui/proof-health.test.tsx`

**Step 1: Freeze before screenshots and behavior**

Capture 1440×1000, 390×844, and 320×700 for health loading/error/mixed and verifier idle/match/mismatch/unavailable. Record tab order and accessible names.

**Step 2: Migrate without changing API behavior**

Use semantic forms plus Button/Field/StateMessage. Rename “Public offline verifier” to “Public evidence verifier.” Display source hint and capability boundaries.

All user-facing capability/status prose comes from the claim registry; add a static assertion that the verifier cannot ship component-local replacements for governed claims.

**Step 3: Add stable focus behavior**

On submit, focus remains on the stable action or the persistent status region. Retry does not disappear without a focus destination.

**Step 4: Verify the pilot gate**

Run focused tests including `tests/ui/hostile-content.test.tsx`, typecheck, three viewport screenshots, keyboard-only flow, forced-colors, reduced-motion, and one screen-reader announcement pass. Zero behavior/API diffs beyond approved fixes and zero hostile-content boundary regression.

**Step 5: Commit**

```bash
git add frontend/app/proof/page.tsx 'frontend/app/proof/[proofId]/page.tsx' frontend/components/VerifyEvidenceButton.tsx frontend/components/SubsystemHealthGrid.tsx frontend/tests/ui/proof-health.test.tsx
git commit -m "feat(verifier): pilot accessible Proof Ledger system"
```

Stop and review the pilot diff before migrating another route.

---

### Task 13: Build StatusBadge, EvidenceSheet, DataRow, and ProofPlane

**Files:**
- Create: `frontend/components/ui/StatusBadge.tsx`
- Create: `frontend/components/ui/EvidenceSheet.tsx`
- Create: `frontend/components/ui/DataRow.tsx`
- Create: `frontend/components/ui/ProofPlane.tsx`
- Modify: `frontend/components/ui/ui-contract.test.tsx`
- Modify: `frontend/app/styles/components.css`

**Step 1: Write exhaustive matrices**

Test all observation statuses on dark/paper, long/missing values, canonical copy, external links, no-color meaning, and historical/current ProofPlane headings.

**Step 2: Prove RED and implement minimally**

Use product-specific square/dossier geometry. `DataRow` owns hash wrapping, LTR isolation, tabular numerals, copy labels, and canonical full-value copying.

**Step 3: Assert impossible combinations**

ProofPlane accepts typed observations only. A current Gate/lease/consumer `VERIFIED` item without a current pinned probe must fail before render. Compute remains sealed historical evidence unless a separate capability-specific current inference is actually performed and represented.

**Step 4: Verify and commit**

Run: `cd frontend && npm test -- components/ui/ui-contract.test.tsx tests/ui/token-contract.test.ts && npm run typecheck`.

```bash
git add frontend/components/ui/StatusBadge.tsx frontend/components/ui/EvidenceSheet.tsx frontend/components/ui/DataRow.tsx frontend/components/ui/ProofPlane.tsx frontend/components/ui/ui-contract.test.tsx frontend/app/styles/components.css
git commit -m "feat(ui): add evidence and proof-plane primitives"
```

---

### Task 14: Apply the approved visual system to landing and Operator

**Files:**
- Modify: `frontend/app/operator/page.tsx`
- Modify: `frontend/app/operator/layout.tsx`
- Modify: `frontend/components/OperatorWorkbench.tsx`
- Create: `frontend/components/FeaturedProofLink.tsx`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/components/ScanInput.tsx`
- Modify: `frontend/components/NavLinks.tsx`
- Modify: `frontend/app/layout.tsx`
- Test: `frontend/tests/ui/evaluate.test.tsx`
- Test: `frontend/tests/release/config-contract.test.ts`
- Modify: `.env.example`
- Modify: `frontend/.env.example`

**Step 1: Write route and secret-boundary tests**

Preserve the behavior-only split from Task 9B. Public landing contains no token field or mutation CTA. Operator route contains authority/cost disclosure before the field. Token never enters URL, storage, logs, fixtures, or error payloads.

**Step 2: Create a truthful featured-proof action**

Use server-only `PROOFLOCK_FEATURED_PROOF_ID`, `PROOFLOCK_FEATURED_IDENTITY_KEY`, and `PROOFLOCK_FEATURED_SOURCE_TX_HASH`. Validate all three together in both env examples and the config-contract test. Label it a featured real proof only after exact release-time verification; incomplete/invalid config falls back to “Browse recent ProofLocks.”

**Step 3: Move the workbench**

Apply the approved dossier hierarchy to the existing workbench; preserve seal, current-record detection, drift, reseal, cancellation, and recovery. Add the compact first-viewport architecture strip, explicitly labeled as process—not live completion or health.

**Step 4: Fix shell semantics**

Add skip link, `aria-current=page`, semantic Next `Link` wordmark, route titles, and neutral network configuration language.

**Step 5: Verify and commit**

Run: `cd frontend && npm test -- tests/ui/evaluate.test.tsx tests/release/config-contract.test.ts && npm run typecheck`.

```bash
git add frontend/app/operator/page.tsx frontend/app/operator/layout.tsx frontend/app/page.tsx frontend/components/OperatorWorkbench.tsx frontend/components/FeaturedProofLink.tsx frontend/components/ScanInput.tsx frontend/components/NavLinks.tsx frontend/app/layout.tsx frontend/tests/ui/evaluate.test.tsx frontend/tests/release/config-contract.test.ts .env.example frontend/.env.example
git commit -m "feat(product): separate public and operator journeys"
```

---

### Task 15: Build the two-plane agent detail ledger

**Files:**
- Create: `frontend/lib/proof-detail-state.ts`
- Create: `frontend/lib/proof-detail-state.test.ts`
- Modify: `frontend/app/agents/[address]/page.tsx`
- Modify: `frontend/components/GateDecisionCard.tsx`
- Modify: `frontend/components/AdmissionLeaseCard.tsx`
- Modify: `frontend/components/ProofCoverageGrid.tsx`
- Modify: `frontend/components/EvidenceProofCard.tsx`
- Modify: `frontend/components/SealLifecycle.tsx`
- Modify: `frontend/components/TrustRoleDisclosure.tsx`
- Modify: `frontend/tests/ui/dashboard.test.tsx`
- Modify: `frontend/tests/ui/lifecycle-trust.test.tsx`

**Step 1: Write observation-mapping tests**

Create fixtures for full match/admitted, historical match/current unavailable, historical mismatch/current blocked, Storage no network proof, Compute unavailable, Gate denied, consumer unknown, drift, expired, fixture, and maximum content.

The reducer/view model represents historical and current planes independently; the page may not catch historical verification into `undefined` or fail the entire route when one current observation fails.

**Step 2: Build the hierarchy**

Current decision first. Then `ProofPlane scope=HISTORICAL`, then `ProofPlane scope=CURRENT`, then identifiers/lifecycle/trust. Operator controls no longer render on this public route.

**Step 3: Correct unknown and surface-state mapping**

Unknown has its own icon/text/rail/background. No global `.state-*` inherited color determines paper text.

**Step 4: Fix time freshness**

Render server-issued observation times/blocks and TTL. On TTL, background resume, or explicit “Refresh current state,” refetch identity, lease, Gate, and consumer together at a newly pinned finalized block. Keep historical evidence visible if refresh fails. Clean up timers on navigation/unmount.

**Step 5: Verify responsive/heading behavior**

One `h1`, ordered `h2`s, no skipped sections. At 320px decision precedes explanation, all hashes copy/wrap, no text under the minimum scale.

**Step 6: Commit**

```bash
git add frontend/lib/proof-detail-state.ts frontend/lib/proof-detail-state.test.ts 'frontend/app/agents/[address]/page.tsx' frontend/components/GateDecisionCard.tsx frontend/components/AdmissionLeaseCard.tsx frontend/components/ProofCoverageGrid.tsx frontend/components/EvidenceProofCard.tsx frontend/components/SealLifecycle.tsx frontend/components/TrustRoleDisclosure.tsx frontend/tests/ui/dashboard.test.tsx frontend/tests/ui/lifecycle-trust.test.tsx
git commit -m "feat(detail): ship two-plane Proof Ledger"
```

---

### Task 16: Migrate the recent ProofLocks inventory

**Files:**
- Modify: `frontend/app/agents/page.tsx`
- Modify: `frontend/components/AgentsTable.tsx`
- Modify: `frontend/tests/ui/inventory-navigation.test.tsx`
- Modify: `frontend/app/styles/layouts.css`

**Step 1: Test desktop/mobile semantic parity**

Every table datum and action must exist in the mobile card. Add caption/scope text, partial-results state, empty recovery, and failed-row explorer link tests.

**Step 2: Migrate to primitives**

Use StatusBadge, DataRow, and StateMessage. Add an accessible table caption and deterministic order disclosure. Do not hide Gate reasons or source scope on mobile.

**Step 3: Stress 100 rows**

Measure render/interactivity with 100 rows and maximum identifiers. Do not add virtualization unless the measured budget fails.

**Step 4: Verify and commit**

Run: `cd frontend && npm test -- tests/ui/inventory-navigation.test.tsx lib/prooflock-status.test.ts && npm run typecheck`.

```bash
git add frontend/app/agents/page.tsx frontend/components/AgentsTable.tsx frontend/tests/ui/inventory-navigation.test.tsx frontend/app/styles/layouts.css
git commit -m "feat(inventory): migrate recent ProofLocks ledger"
```

---

### Task 17: Complete hostile-data migration across active evidence surfaces

**Files:**
- Modify: `frontend/lib/safe-display.ts`
- Modify: `frontend/lib/explorer-url.ts`
- Modify: `frontend/lib/prooflock-client.ts`
- Modify: `frontend/components/VerifyEvidenceButton.tsx`
- Modify: `frontend/components/EvidenceProofCard.tsx`
- Modify: `frontend/components/IdentityResolver.tsx`
- Modify: `frontend/components/TrustRoleDisclosure.tsx`
- Modify: `frontend/components/SubsystemHealthGrid.tsx`
- Modify: `frontend/components/AgentsTable.tsx`
- Modify: `frontend/components/GateDecisionCard.tsx`
- Modify: `frontend/app/agents/[address]/page.tsx`
- Modify: `frontend/app/proof/[proofId]/page.tsx`
- Modify: `frontend/tests/ui/hostile-content.test.tsx`

**Step 1: Expand hostile fixtures across every active surface**

Cover bidi overrides, zero-width characters, confusables, control characters, emoji/combining marks, 10k strings, malicious `javascript:`, `data:`, credentialed URLs, mixed-case addresses, and huge numeric IDs.

Include blank trust-role strings and assert the explicit “not configured” fallback. Governed capability/status prose must resolve through claim keys.

**Step 2: Bound display schemas**

Reject or safely truncate display-only provider/model/error fields while preserving canonical proof values outside display transformations. Never mutate values used in hashes.

**Step 3: Isolate direction and copying**

Technical values render LTR with isolation and copy canonical full values. Natural untrusted text uses `<bdi>`/CSS isolation. Visible truncation never changes copied proof data.

**Step 4: Allowlist explorer origins**

Build URLs with `new URL`, require HTTPS and a configured allowlist, and append only validated address/tx paths.

**Step 5: Verify and commit**

Run: `cd frontend && npm test -- lib/safe-display.test.ts lib/explorer-url.test.ts tests/ui/hostile-content.test.tsx && npm run typecheck`.

```bash
git add frontend/lib/safe-display.ts frontend/lib/explorer-url.ts frontend/lib/prooflock-client.ts frontend/components/VerifyEvidenceButton.tsx frontend/components/EvidenceProofCard.tsx frontend/components/IdentityResolver.tsx frontend/components/TrustRoleDisclosure.tsx frontend/components/SubsystemHealthGrid.tsx frontend/components/AgentsTable.tsx frontend/components/GateDecisionCard.tsx 'frontend/app/agents/[address]/page.tsx' 'frontend/app/proof/[proofId]/page.tsx' frontend/tests/ui/hostile-content.test.tsx
git commit -m "fix(ui): harden untrusted evidence rendering"
```

---

### Task 18: Complete shell, metadata, security, and social proof

**Files:**
- Modify: `frontend/app/opengraph-image.tsx`
- Create: `frontend/app/agents/[address]/opengraph-image.tsx`
- Create: `frontend/app/proof/[proofId]/opengraph-image.tsx`
- Create: `frontend/app/agents/layout.tsx`
- Create: `frontend/app/proof/layout.tsx`
- Modify: `frontend/app/operator/layout.tsx`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/app/error.tsx`
- Modify: `frontend/app/not-found.tsx`
- Modify: `frontend/next.config.mjs`
- Modify: `frontend/package.json`
- Test: `frontend/tests/release/config-contract.test.ts`
- Create: `frontend/scripts/test-standalone.mjs`

**Step 1: Write release assertions**

Root OG returns 200 with image MIME; route titles are descriptive; error/404 have `h1`; a deterministic E2E-only trigger proves the production error boundary. Assert `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a reviewed `Permissions-Policy`, and the exact CSP decision below. Emit `Strict-Transport-Security: max-age=31536000; includeSubDomains` only in production HTTPS deployments.

**Step 2: Generate a truthful OG image**

Use the current graphite/paper/violet system. Do not include a fabricated verdict, live badge, or fixture proof.

**Step 3: Introduce CSP safely**

Ship an enforced reviewed policy compatible with the built Next asset/runtime graph, at minimum constraining `default-src 'self'`, `base-uri 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`, explicit script/style/font/img/connect origins, and `upgrade-insecure-requests` in production. If nonce/hash compatibility cannot be proven, record CSP as a signed G6 release exception; report-only alone does not pass. Do not configure a report body/path that could capture operator tokens.

**Step 4: Verify standalone runtime**

Add `npm run test:standalone`. After `npm run build`, spawn `PORT=<isolated> HOSTNAME=127.0.0.1 node .next/standalone/server.js`, request HTML, `/_next/static/*`, JS, CSS, fonts/media, favicon, root/dynamic OG, and each route, and guarantee teardown on success/failure. Expect zero MIME/404 regressions.

**Step 5: Commit**

```bash
git add frontend/app/opengraph-image.tsx 'frontend/app/agents/[address]/opengraph-image.tsx' 'frontend/app/proof/[proofId]/opengraph-image.tsx' frontend/app/agents/layout.tsx frontend/app/proof/layout.tsx frontend/app/operator/layout.tsx frontend/app/layout.tsx frontend/app/error.tsx frontend/app/not-found.tsx frontend/next.config.mjs frontend/package.json frontend/tests/release/config-contract.test.ts frontend/scripts/test-standalone.mjs
git commit -m "fix(release): finish metadata security and social proof"
```

---

### Task 19: Expand the persistent browser/a11y/visual matrix

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/playwright.config.ts`
- Create: `frontend/tests/e2e/fixtures.ts`
- Create: `frontend/tests/e2e/routes.spec.ts`
- Create: `frontend/tests/e2e/accessibility.spec.ts`
- Create: `frontend/tests/e2e/visual.spec.ts`
- Create: `frontend/tests/e2e/operator.spec.ts`
- Create: `frontend/tests/e2e/performance.spec.ts`

**Step 1: Complete pinned scripts and browser setup**

Keep the Task 9E dependencies pinned; add visual/full scripts and document `npx playwright install chromium firefox webkit` plus CI `--with-deps` setup.

**Step 2: Build deterministic network fixtures**

In the mocked state-matrix project, cover every route plus loading, empty, partial, full, invalid, mismatch, unavailable, stale, canceled, timeout, all Gate/lease/health states, uncertain write, recovery, maximum content, and labeled fixture. Keep a separate no-interception standalone smoke project so fixtures cannot conceal broken same-origin APIs/assets.

**Step 3: Add behavioral assertions**

Keyboard order, Enter submit, cancel, focus persistence, no stale state, source links, public/operator separation, no secret leakage, console cleanliness, response/MIME checks.

**Step 4: Add a11y matrix**

Axe zero unwaived A/AA findings; computed text floors (12/14/16px); ≥3:1 focus/action/icon/rail boundaries; 44px target boxes; 16px mobile inputs; tokenized transform/opacity motion; forced colors; 200% text zoom; 400% page zoom; blank trust roles; and table/card semantic parity.

**Step 5: Add screenshot matrix**

1440×1000, 390×844, and 320×700 for all primary and adverse states. Configure `snapshotPathTemplate` to `frontend/tests/e2e/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}`. Use a small stable threshold; manually approve intentional diffs.

**Step 6: Run and commit**

Run: `cd frontend && npm run build && npm run test:e2e`
Expected: all three browsers pass; no unexpected console/network error.

```bash
git add frontend/package.json frontend/package-lock.json frontend/playwright.config.ts frontend/tests/e2e/fixtures.ts frontend/tests/e2e/routes.spec.ts frontend/tests/e2e/accessibility.spec.ts frontend/tests/e2e/visual.spec.ts frontend/tests/e2e/operator.spec.ts frontend/tests/e2e/performance.spec.ts frontend/tests/e2e/__screenshots__
git commit -m "test(ui): add persistent cross-browser quality gates"
```

---

### Task 20: Enforce performance budgets and reduce avoidable client work

**Files:**
- Modify: `frontend/app/agents/page.tsx`
- Modify: `frontend/app/agents/[address]/page.tsx`
- Modify: `frontend/app/proof/page.tsx`
- Modify: `frontend/app/proof/[proofId]/page.tsx`
- Modify: `frontend/components/AgentsTable.tsx`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/lib/prooflock-client.ts`
- Modify: `frontend/tests/e2e/performance.spec.ts`
- Create: `docs/performance/2026-08-28-sentinel-proof-ledger-budget.md`

**Step 1: Record the baseline**

Capture route JS/CSS/font transfer, LCP/INP/CLS under repeatable slow 4G, and 100-row/max-content responsiveness before refactoring.

**Step 2: Move display derivation server-side where safe**

Add `proofId` plus the typed Registry source locator to server detail/discovery responses and validate both in the client schema. Remove Ethers/canonicalization imports from public inventory/detail only after parity tests prove identical IDs. This additive API change must be version-compatible. Keep interactive islands small.

**Step 3: Audit font weights**

Remove unused weights only after computed usage confirms they are unnecessary. Preserve the approved cultural pairing.

**Step 4: Enforce budgets**

Measure performance in Chromium only under one documented CI hardware profile, throttling configuration, viewport, warm/cold-cache policy, and three-sample median. LCP ≤2.5s, INP ≤200ms, CLS ≤0.1; no route asset grows >10% without a documented exception; no layout shift moves an active control. Cross-browser suites remain functional/accessibility gates, not performance comparators.

**Step 5: Verify and commit**

Run production build and performance E2E three times; use the median. Commit the measured before/after table.

```bash
git add frontend/app/agents/page.tsx 'frontend/app/agents/[address]/page.tsx' frontend/app/proof/page.tsx 'frontend/app/proof/[proofId]/page.tsx' frontend/components/AgentsTable.tsx frontend/app/layout.tsx frontend/server/prooflock/read-api.ts frontend/lib/prooflock-types.ts frontend/lib/prooflock-client.ts frontend/tests/e2e/performance.spec.ts docs/performance/2026-08-28-sentinel-proof-ledger-budget.md
git commit -m "perf(ui): enforce Proof Ledger budgets"
```

---

### Task 21: Remove legacy design/tooling contamination

**Files:**
- Delete after import proof: `frontend/components/AnimatedScoreBar.tsx`
- Delete after import proof: `frontend/components/ChainDiscovery.tsx`
- Delete after import proof: `frontend/components/FineTuneButton.tsx`
- Delete after import proof: `frontend/components/GridOverlays.tsx`
- Delete after import proof: `frontend/components/QueueBanner.tsx`
- Delete after import proof: `frontend/components/RadarHero.tsx`
- Preserve: legacy scanner/lib graph and 410 route tombstones; backend deletion is outside this UI plan
- Modify/remove: `frontend/tailwind.config.ts`, `frontend/postcss.config.js`, Tailwind dependency/directives
- Modify: `frontend/tsconfig.json`
- Modify: `frontend/next.config.mjs`
- Modify: `frontend/tests/release/config-contract.test.ts`
- Modify: `.env.example`
- Modify: `frontend/.env.example`

**Step 1: Prove the active import graph**

Run targeted `rg` and a production build. Extract `canonicalAgentHref` from the mixed legacy `agents.ts` dependency before deleting any legacy lib. Remove only now-unused `@scanner/*` aliases, legacy public env entries, webpack aliases/comments, and related imports after the preserved scanner/backend graph proves they are truly dead.

**Step 2: Add static failure tests**

Fail on undefined `--cy*`, `--tx-*`, `--fs-xs`, `--r-2`, `--good-12`; fail if deleted components are imported; fail on Tailwind directives/config when Tailwind is removed.

**Step 3: Delete only proven-dead UI code**

Retain the 410 route tombstones. Deleting scanner/backend history is a separate reviewed decision and is not authorized by this plan.

**Step 4: Remove unused Tailwind toolchain**

Only after confirming zero utility usage and a green clean build. Keep Autoprefixer if the CSS pipeline still needs it.

**Step 5: Verify and commit**

Run all frontend tests, typecheck, clean build, and standalone runtime tests.

```bash
git add frontend/components/AnimatedScoreBar.tsx frontend/components/ChainDiscovery.tsx frontend/components/FineTuneButton.tsx frontend/components/GridOverlays.tsx frontend/components/QueueBanner.tsx frontend/components/RadarHero.tsx frontend/lib/prooflock-routes.ts frontend/tailwind.config.ts frontend/postcss.config.js frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/next.config.mjs frontend/tests/release/config-contract.test.ts .env.example frontend/.env.example
git commit -m "refactor(ui): remove obsolete design era"
```

---

### Task 22: Complete real provenance and deployed release gates

**Files:**
- Modify: `BUILD-REPORT.md`
- Modify: `FEATURE-OBSERVABLES.md`
- Modify: `PULSE.md`
- Update: `FOR[Dami].md`
- Add final screenshots under `docs/screenshots/proof-ledger-final/`

**Step 1: Run the complete local gate**

```bash
cd frontend && npm test && npm run typecheck && npm run build && npm run test:standalone && npm run test:e2e
cd .. && npm test && npm run typecheck
git diff --check
```

The root commands are the Hardhat contract/deployment/integration and root TypeScript gates. Do not preserve stale historical test-count expectations; record the actual counts from this release run.

**Step 2: Run manual accessibility evidence**

Keyboard-only all core journeys; VoiceOver or NVDA announcement order; forced colors; 200% text zoom; 400% page zoom; Chromium/Firefox/WebKit; 320/390/1440 screenshots; blur/squint hierarchy review.

**Step 3: Run the funded mainnet lifecycle**

With approved funded credentials and deployed V2 addresses:

```text
seal → exact explorer/storage/registry proof → consumer allowed
drift → consumer denied
process restart/page reload → recover exact state
reseal → consumer allowed
public verifier independently reproduces historical proof
```

Record every contract address, identity key, proof ID, source tx, Storage tx/root, observation block/time, and expected capability. Verify links independently in a clean browser.

**Step 4: Run the deployed-URL live audit**

No localhost. Confirm assets, headers, enforced CSP or signed exception, metadata/OG, console, network failures, secret absence, performance budgets, accessibility, and route state matrix. Capture named 1440/390/320 route/state images under `docs/screenshots/proof-ledger-final/`.

**Step 5: Claim-by-claim signoff**

Search the built app, docs, screenshots, and submission copy for each governed claim. Every claim maps to current evidence or is removed. Fixtures are unmistakable.

**Step 6: Rehearse rollback**

Verify the previous releasable artifact can be restored and the new route layer can be reverted without reverting backend correctness.

**Step 7: Final commit**

```bash
git add BUILD-REPORT.md FEATURE-OBSERVABLES.md PULSE.md 'FOR[Dami].md' docs/audits/2026-08-28-sentinel-world-class-ui-audit.md docs/plans/2026-08-28-sentinel-proof-ledger-world-class-design.md docs/plans/2026-08-28-sentinel-proof-ledger-world-class-implementation.md docs/design/2026-08-28-sentinel-proof-ledger-state-spec.md docs/performance/2026-08-28-sentinel-proof-ledger-budget.md docs/screenshots/proof-ledger-final
git commit -m "docs(release): record Proof Ledger evidence"
```

Only after this task passes may the release be described as world-class and submission-ready.

---

## Audit-to-plan traceability

The 22 numbered tasks plus six pre-visual gates (`9A`–`9F`) form 28 executable work packages.

| Audit defect / risk | Fix package | Proof required |
|---|---|---|
| Stale verifier/evaluator state; coupled historical/current requests | Tasks 3–4, 9A, 15 | Reducer sequences, independent timeouts, partial-plane API/render tests |
| Validation occurs after dependency construction | Task 2 | Route tests with malformed input and missing environment return `INVALID_INPUT` without factory calls |
| Ambiguous Compute/Storage/chain/authority claims | Tasks 1, 12, 14–17, 22 | Capability table, claim-key consumption/static scan, release claim signoff |
| Uncertain post-send write and false “no lease” copy | Tasks 5–7 | Chain-layer progress, failure injection at every send/finality/readback boundary |
| Recovery can misattribute a competing scanner | Task 6 | Durable full-commitment journal, sender/calldata/event/finality matching, restart/race tests |
| Duplicate paid runs / no spend controls | Tasks 6–7, 9E | Idempotency, one active identity, rate/concurrency/budget, multi-tab/double-click E2E |
| Discovery is incomplete, fail-all, non-finalized, and Gate-blind | Task 8 | Finalized range disclosure, reorg cases, discriminated failure rows, bounded-worker concurrency test |
| Proof source locator is hidden/under-bound | Task 9 | Validated query hint, record-version compatibility, security/API tests, distinct Registry/Storage tx labels |
| Current access reads are unpinned/all-or-nothing | Task 9A | Same-block partial observations, server timestamps/TTL, Storage failure with visible Gate result |
| Public judge path exposes operator authority/token | Tasks 9B, 14 | Behavior-only split first, then styling; public-route secret absence and operator parity tests |
| Hostile/bidi/oversized evidence and unsafe explorer URLs | Tasks 9C, 17 | Parse-bound display limits, isolation, allowlist, route-wide hostile fixtures |
| No approved all-state responsive design | Task 9D | Explicitly approved no-code 1440/390/320 state spec before styling |
| No persistent browser/a11y truth gate | Tasks 9E, 19 | Mocked state matrix plus no-interception standalone project, three browsers, zero unwaived A/AA findings |
| Broken root OG, error hierarchy, and release-shell regressions | Tasks 9F, 18 | Submission-critical shell gate first; route metadata/CSP/standalone matrix later |
| Multiple design sources, unsafe state colors, weak type/targets/motion | Tasks 10–13 | Canonical cascade/tokens, computed contrast/type/target rules, primitive contracts and pilot |
| Detail page hides historical failure and ages silently | Task 15 | Independent view model, stale/background/refresh tests, timer cleanup |
| Inventory desktop/mobile and maximum-content fragility | Task 16 | Semantic parity, 100-row/max-content measurement |
| Missing metadata/OG/error hierarchy/security headers | Task 18 | Exact route metadata, deterministic error boundary, standalone asset smoke, enforced CSP or signed exception |
| Excess JS/fonts and unmeasured performance | Task 20 | Additive server proof locator, measured Chromium median, route/font budgets |
| Dead UI/tooling and stale aliases/config | Task 21 | Import-graph proof, exact deletions/config cleanup, clean build |
| No real deployed lifecycle proof | Task 22 | Funded mainnet lifecycle, independent links, deployed live audit, rollback rehearsal |
| Complete inventory/indexer and broad session auth | Explicit deferral + Tasks 8/22 | Signed limitation, truthful bounded copy; no world-class claim that implies completeness |

---

## Review checkpoints

1. After Task 3: reviewer proves historical/current independence and no stale success.
2. After Task 7: security/correctness reviewer proves no duplicate-write path and no secret leakage.
3. After Task 9A: provenance reviewer validates locator compatibility plus pinned/partial current observations.
4. After Task 9D: user explicitly approves the no-code 1440/390/320 route/state specification.
5. After Task 9E: test reviewer proves the no-interception smoke suite cannot be masked by fixtures.
6. After Task 9F: release reviewer confirms the known root OG/error/standalone regressions are closed.
7. After Task 12: user reviews the implemented verifier pilot before another route migrates.
8. After Task 16: design/accessibility reviewer validates the full route/state matrix.
9. After Task 19: test reviewer validates all browsers, hostile states, computed accessibility, and visual baselines.
10. After Task 22: final release reviewer signs claims and mainnet evidence.

## Definition of done

- Every finding in the world-class audit is fixed and tested, or recorded as a signed limitation with truthful UI copy. The complete indexer/backfill and broad session-auth redesign are explicit deferrals, not silent omissions.
- Every submission-critical task is green before aesthetic-only work.
- Historical, current, unavailable, mismatch, and uncertain-write states are visibly and structurally distinct.
- The public judge journey requires no secret and reaches real provenance within 60 seconds.
- The three-minute demo completes without narration-dependent UI.
- No unwaived axe A/AA finding, broken keyboard path, forced-color loss, zoom loss, unexpected console/network error, or budget regression remains.
- Real deployed 0G evidence—not synthetic mocks—is recorded for the full lifecycle.
