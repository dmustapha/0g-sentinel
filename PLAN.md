# Sentinel ProofLock — Wave 3 Build Cursor

Source of truth: `/Users/MAC/hackathon-toolkit/active/0g-apac-hackathon/0g-sentinel/docs/plans/2026-08-27-sentinel-prooflock.md`

## Scope

Ship a mandatory Wave 3 cut: a verified 0G Compute result and retrievable 0G Storage evidence become a seven-day, mainnet admission lease consumed by AgentGateV2.

## Binding Decisions

- Contract maximum TTL: 30 days; product TTL: 7 days.
- One disclosed EOA may hold scanner and guardian roles.
- Canonical ERC-8004 identity is load-bearing; the custom AgentRegistry is legacy-only.
- Public application is read-only; scan and reseal require admin authentication.
- ERC-8004 Validation Registry publication is stretch-only.

## Phases

- [x] 1. SentinelRegistryV2, AgentGateV2, and consumer contract with reason-coded tests.
- [x] 2. Canonical evidence types, hashing, and structured errors.
- [x] 3. ERC-8004 identity and registration-card resolution.
- [x] 4. Subject classification and deterministic analysis consolidation.
- [ ] 5. Strict verified Compute and independently verified Storage.
- [ ] 6. Controlled runner, drift lifecycle, APIs, auth, and spend safety.
- [ ] 7. ProofLock dashboard, agent detail, proof, health, and demo states.
- [ ] 8. Mainnet deployment, live proof, documentation, and submission package.

## Non-goals

- No autonomous public scanner queue, generalized production monitoring platform, arbitrary gate executor, fine-tuning flow, DA integration, 0G Pay, or Validation publication in the mandatory cut.

## Completion Gate

All targeted tests, full Hardhat tests, root/frontend typechecks, frontend build, live mainnet reads, verified Storage retrieval, verified Compute receipt, and allow/block/reseal demo evidence must pass.
