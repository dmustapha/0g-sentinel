# Sentinel ProofLock Frontend Design

**Status:** Approved under the user's directive to proceed with the recommended product scope.

## Objective

Make the complete ProofLock guarantee understandable and verifiable in under three minutes:

```text
ERC-8004 identity → evidence stages → 0G Storage → versioned lease → AgentGate decision
```

The UI must distinguish analysis from admission. A low risk score is not permission; only a current, complete lease and an `ALLOWED` Gate decision qualify.

## Considered Directions

### 1. Industrial proof ledger — selected

A dense but calm evidence interface: graphite workspace, paper-white proof panels, 0G violet for provenance, and green/amber/red only for verified state. A vertical proof rail makes the joined 0G path memorable.

**Why selected:** It compresses complex infrastructure into one judge-readable ceremony and fits a trust-and-safety product.

### 2. Generic crypto operations dashboard — rejected

Familiar metric cards, gradients, and charts would be quick to scan but would make ProofLock look like another risk leaderboard.

### 3. Cinematic cyberpunk scanner — rejected

Radar, neon, and terminal motion would feel dramatic but overstate continuous monitoring and distract from exact proof semantics.

## Visual System

- **Tone:** industrial, forensic, restrained.
- **Canvas:** near-black graphite with a subtle coordinate grid and low-noise texture.
- **Evidence:** warm off-white panels for canonical proof data, creating a physical “file under review” contrast.
- **Provenance:** 0G violet marks identity, Compute, Storage, and Chain linkage.
- **State colors:** green only for verified/current/allowed; amber for expiring/unknown; red for drifted/revoked/blocked/mismatch.
- **Typography:** Chakra Petch for terse display labels, IBM Plex Sans for explanatory copy, IBM Plex Mono for hashes, addresses, reasons, and timestamps. Existing self-hosted Next font setup remains.
- **Shape:** clipped corners, stepped rails, compact chips, two-level elevation; avoid flat bordered boxes.
- **Motion:** one staged proof-rail reveal and restrained state transitions; honor `prefers-reduced-motion`.

## Information Architecture

### Global navigation

- **Evaluate:** canonical identity resolution and operator-authorized scan/reseal.
- **ProofLocks:** current lease inventory ordered by urgency.
- **Verify:** public historical proof verification.
- **Health:** independent subsystem states, available within Verify or as a visible section.

The header identifies `0G Mainnet · 16661` but never displays a green live badge without health evidence.

### Evaluate page

1. Canonical ERC-8004 identity input; no fictional default.
2. Identity resolution card: registry, agent ID, owner, wallet, finalized block, card digest.
3. Ten-stage progress rail with pending/running/failed/complete states.
4. Coverage grid for the required `0x7f` proof.
5. Admission lease and Gate decision.
6. Clearly labeled demo-fixture action, separate from production input.

Mandatory failure means “No lease issued,” with the stable stage/code shown.

### ProofLocks dashboard

Rows prioritize:

```text
DRIFTED → REVOKED/DENIED → EXPIRED/EXPIRING → INCOMPLETE → ACTIVE
```

Columns show Identity, Coverage, Seal, Lease, Gate, and Last Checked. There is no universal risk ranking.

### Agent detail

- Canonical identity header.
- Gate decision card.
- Admission lease card.
- Seal lifecycle with superseded versions.
- Evidence cards for deterministic checks, verified Compute, Storage, and Chain.
- On-demand drift control shown only for an authenticated operator surface; public viewers see status, not a mutation button.
- Synthetic fixtures carry an unmistakable badge.

### Proof verifier

Historical proof data remains visible regardless of current validity. Verification has five explicit states: match, mismatch, unavailable, timeout/network error, and retrying. Current lease/Gate state is visually separate from historical artifact validity.

### Health

Six independent cells: RPC, ERC-8004, RegistryV2, AgentGateV2, Compute, Storage. Each shows state, latency, observation, and last probe time. Unknown is amber/neutral, never green.

## Data Flow

- Typed client consumes only `/api/v1/*`, `/api/discover`, and `/api/health` for public reads.
- Operator evaluate/reseal uses authenticated SSE and does not persist the token client-side.
- Stable reason codes drive UI states; free-form messages are explanatory only.
- ABI reads use one versioned V2 source.
- Proof verification never starts paid Compute.

## Error and Trust Copy

- “Policy-scoped admission,” not “every agent verified.”
- “Versioned, append-preserved proof history,” not “immutable verdict.”
- “Retrieved and root-matched at {time},” not “permanently retrievable.”
- “Typed deterministic and AI-assisted coverage,” not “two independent audits.”
- Name the operator-authorized validator and centralization boundary.
- Say “on-demand drift detection,” never continuous monitoring.
- Say `networkProofVerified: false` where relevant.

## Responsive and Accessible Behavior

- 320px and 390px layouts preserve navigation, decision, identity, and proof hierarchy.
- Dense tables collapse to ordered proof cards without hiding reason codes.
- Keyboard focus is visible; statuses include text/icons, not color alone.
- Hashes wrap safely or use copy controls; no horizontal page overflow.
- Animations respect reduced motion.

## Verification

- Unit tests cover typed status mapping and urgency ordering.
- Component tests cover identity, stage, lease, Gate, proof, health, and error states.
- Route render checks cover landing, dashboard, detail, proof, and health at desktop and mobile widths.
- Build/typecheck and browser console must be clean.
- Before/after screenshots document the product cutover.

