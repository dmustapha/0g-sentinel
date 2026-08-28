# ProofLock Public Verification Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make public Gate, historical ProofLock, and Storage verification bounded and cryptographically bound to configured 0G contracts.

**Architecture:** Use strict direct contract pointer checks, a transaction-hint-first historical locator with a bounded indexed fallback, and distinct dependency/mismatch error types. Keep all public operations read-only and deadline-aware.

**Tech Stack:** Next.js route handlers, TypeScript, Ethers v6, Vitest, 0G Storage SDK.

---

### Task 1: Gate contract binding

**Files:**
- Modify: `frontend/server/prooflock/read-api.ts`
- Test: `frontend/tests/api/prooflock-api.test.ts`

1. Write tests for missing Gate code and wrong RegistryV2/ERC-8004 pointers.
2. Run the focused tests and confirm RED.
3. Add code and pointer checks before `checkAgent`.
4. Run focused tests and confirm GREEN.

### Task 2: Bounded finalized historical locator

**Files:**
- Modify: `frontend/server/prooflock/api.ts`
- Modify: `frontend/server/prooflock/read-api.ts`
- Test: `frontend/tests/api/prooflock-api.test.ts`

1. Write tests for an old hinted proof, bounded fallback queries, negative caching, and receipt/finality/log adversaries.
2. Run focused tests and confirm RED.
3. Implement the direct receipt path and bounded indexed fallback.
4. Add stable hint-required/not-found error mapping and the enriched source schema.
5. Run focused tests and confirm GREEN.

### Task 3: Storage mismatch taxonomy

**Files:**
- Modify: `frontend/server/prooflock/storage-recovery.ts`
- Modify: `frontend/server/prooflock/read-api.ts`
- Test: `frontend/tests/prooflock/storage-recovery.test.ts`
- Test: `frontend/tests/api/prooflock-api.test.ts`

1. Write dependency and candidate-mismatch tests and confirm RED.
2. Implement Flow code/origin pinning and distinct errors.
3. Run Storage and API tests and confirm GREEN.

### Task 4: Verification and atomic commit

1. Run focused API and Storage tests.
2. Run the full API suite and TypeScript typecheck.
3. Run `git diff --check`.
4. Selectively stage backend, tests, and these plans; commit once.
