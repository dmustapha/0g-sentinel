# Sentinel Proof Ledger — Responsive Route and State Specification

**Date:** 2026-08-28  
**Task:** 9D  
**Approval:** **APPROVED**  
**Implementation status:** No-code specification approved; Task 10 and dependency-ordered route styling are authorized.

## Purpose

This document freezes the information order, responsive behavior, state vocabulary, focus behavior, and long-content handling for the active public and operator surfaces. It is a presentation contract, not a claim that the funded mainnet or deployed-URL release gates have passed.

The design must answer, without narration:

1. Which canonical ERC-8004 identity is in scope?
2. Which historical evidence was sealed, at what source block, and with what verification capability?
3. Does that exact historical artifact match?
4. What do independently pinned current observations say now?
5. If access is blocked or unknown, what exact reason applies?
6. Which actions are public reads and which require named operator authority?

## Frozen truth boundaries

### Architecture/process strip

The only six-step overview strip is:

```text
Identity → Checks → Compute → Storage → Lease → Gate
```

It is always labeled **“Architecture / process — illustrative, not current health.”** It has no progress animation, completion checkmarks, health colors, pulse, or “live” label. It describes system architecture, not the state of a proof or dependency.

### Independent proof planes

Detail and verifier results always keep these planes independent:

```text
SEALED EVIDENCE — historical, versioned, event-preserved
Identity at source block → Checks → Compute → Storage → Registry event

CURRENT ACCESS — independently observed at one finalized block
Current identity → Lease → Gate → Guarded consumer
```

- A historical match remains visible when current reads are unavailable or stale.
- A historical mismatch removes every previous historical artifact from the active result.
- Current access never inherits `VERIFIED` from sealed evidence.
- Storage or Compute unavailability never suppresses a valid current Gate or consumer observation.
- Each current observation shows its block, observation time, TTL/freshness, status, and reason independently.
- `STALE` is current-plane state only. It never rewrites sealed evidence.
- Status is always symbol plus text; color is supplemental.

Every current subsystem (`identity`, `lease`, `gate`, and `consumer`) independently supports `VERIFIED`, `BLOCKED`, `UNAVAILABLE`, `STALE`, `MISMATCH`, and `NOT_APPLICABLE` where semantically valid. `MISMATCH` names a binding disagreement at the pinned observation block. `NOT_APPLICABLE` names a neutral, proven absence of a required predecessor, such as no lease against which Gate could be evaluated; it is never styled or announced as success. One subsystem's failure, mismatch, or non-applicability cannot erase, recolor, or relabel any sibling observation.

### Capability and claim annotation contract

Every claim-bearing row shows `scope`, `status`, source, observation block/time where applicable, and the exact capability annotation below. Concise default copy may precede a disclosure, but the disclosure cannot omit these fields.

| Evidence/authority | Required annotation and permitted claim | Prohibited compression |
|---|---|---|
| Compute | `proofClass: DECENTRALIZED_MODEL_TEE`; SDK version; verification method; provider; model; `processResponseVerified: true`; bound `receiptDigest`, `requestDigest`, `responseDigest`, `signedTextSha256`, `requestSha256`, `rawResponseSha256`, `responseHeadersSha256`, and `artifactHash`. Claim only the exact successful capability. | Bare “TEE-attested,” generic “AI verified,” or any claim when a bound hash or `processResponseVerified` is absent |
| Storage | “Exact bytes retrieved, digest-matched, root-recomputed, and bound to the named finalized Flow upload transaction”; show root, artifact hash, upload transaction, retrieval time, and `networkProofVerified: false`. | “Network proof verified,” generic decentralized-storage proof, or hiding `networkProofVerified: false` |
| Registry history | Distinguish the overwriteable current RegistryV2 record from append-preserved `ProofLocked` event provenance; name source transaction, block/hash, and log index. | “Immutable record,” “immutable verdict,” or implying the current record contains all versions |
| Admission | “Current lease plus current Gate and guarded-consumer checks permit access,” with pinned observation metadata and reason. | “Safe agent” or treating historical verification as current admission |
| Drift | “On-demand drift observation,” with before/after digests and whether the guardian mark was written. | “Continuous monitoring” or implying an unchanged check proves future state |
| Scanner/guardian authority | Name the actual lease-write transaction sender and state that it was one of the authorized `SCANNER_ROLE` wallets. State that multiple scanner wallets may be authorized and the guardian may mark drift. | “One universal validator,” “no centralized oracle,” or attributing a write to a configured address without transaction proof |

### Primary overview action

- Use **“Open featured real ProofLock”** only when the configured record passes exact release-time verification against its canonical identity key, Registry source transaction, sealed artifact, and current route.
- If that release verification is absent, incomplete, stale, mismatched, or unavailable, the primary CTA is **“Browse recent ProofLocks.”**
- Fixture data is never eligible for the featured-real-proof CTA.

### Inventory deferral

Until a durable full-history indexer and backfill/reorg service is explicitly funded and approved, the inventory remains a truthful signed deferral:

> Complete inventory unavailable; showing recent finalized RegistryV2 activity from block {fromBlock} through {toBlock}, with {confirmations} confirmations, capped at {cap} records.

No heading, empty state, metadata label, or CTA may imply “all agents,” “all ProofLocks,” or complete coverage.

### Public/operator boundary

- `/`, `/agents`, `/agents/[agentId]`, `/proof`, and `/proof/[proofId]` are secret-free public routes.
- They never render an operator token field or put a token in a URL, storage, logs, analytics, network-body diagnostics, screenshots, or error copy.
- `/operator` is the only mutation workbench. It names authority and paid-work consequences before token entry.
- An operator link may carry canonical `agentId`; it never carries a token, recovery secret, or bearer material.

## Shared viewport contract

| Capture | Canvas | Content width | Outer gutters | Density and layout |
|---|---:|---:|---:|---|
| Desktop | 1440×1000 | 1180px maximum, centered | at least 48px | Two columns only where truth planes remain independently labeled; compact data rows; first action above fold |
| Mobile | 390×844 | 358px | 16px | One semantic column; 16px body/input floor; 44px targets; 12–16px section gaps |
| Small mobile | 320×700 | 296px | 12px | One semantic column; no side-by-side actions or key/value pairs; 44px targets; **16px minimum body, form, and input text**; technical values wrap within their row |

The 1440 measurements are maximums, not fixed widths. At 400% zoom or an effective width below 850px, desktop columns stack in the same semantic order as mobile.

### Global shell order

```text
Skip to main content
Header
  Wordmark
  Overview | ProofLocks | Verify | Operator
  truthful network/dependency disclosure
Main
Footer
```

- Header and footer remain content-height; neither overlays route content.
- The active navigation item uses `aria-current="page"`.
- The network disclosure names configuration/observation state and never resembles an unverified green health badge.
- At 390 and 320, the wordmark is first and the disclosure occupies its own line. The four links use the exact two-by-two arrangements below; no horizontal navigation scrolling is permitted.

#### 390×844 header

```text
358px
Wordmark
┌─────────────────┬─────────────────┐
│ Overview        │ ProofLocks      │
├─────────────────┼─────────────────┤
│ Verify          │ Operator        │
└─────────────────┴─────────────────┘
truthful network/dependency disclosure
```

Each link occupies 175px with an 8px column gap and an 8px row gap.

#### 320×700 header

```text
296px
Wordmark
┌───────────────┬───────────────┐
│ Overview      │ ProofLocks    │
├───────────────┼───────────────┤
│ Verify        │ Operator      │
└───────────────┴───────────────┘
truthful network/dependency disclosure
```

Each link occupies 144px with an 8px column gap and an 8px row gap. Labels never abbreviate.

### Global focus order and recovery

The **reading order** includes all landmarks, headings, explanatory text, status, evidence, and actions in DOM order. The **tab order** contains only interactive elements and follows that same DOM sequence; headings and status regions receive programmatic focus only at the deterministic transitions specified below and are `tabindex="-1"`, never added to normal tab order.

Tab order:

1. Skip link.
2. Wordmark.
3. Overview → ProofLocks → Verify → Operator.
4. Route controls in the exact visual order specified below.
5. Footer links.

Additional rules:

- DOM and visual order are identical at every viewport; CSS must not visually reorder focusable content.
- Every standalone target is at least 44×44px with at least 8px separation.
- Loading never removes the stable control that initiated the request unless it is replaced in place by Cancel.
- Validation failure returns focus to the first invalid field.
- Async request failure returns focus to the stable originating field or explicit retry action, not `body`.
- Route-level error reset returns focus to the route's first stable field/action after the rerender.
- Every route preserves exactly one `h1` across loading, empty, partial, success, and error states. Route sections use ordered `h2`, then component `h3`; async swaps never introduce a second `h1` or skip a heading level.
- Named landmarks are one `banner`, one labeled primary `navigation`, one `main` targeted by the skip link, and one `contentinfo`. Repeated route sections use a visible heading or `aria-labelledby`; complementary trust/legacy disclosures have unique accessible names.
- The shell owns one persistent `role="status" aria-live="polite" aria-atomic="true"` announcement node. Historical and current plane messages are prefixed “Historical evidence:” or “Current access:” and enqueue independently through that node; nested components and the visible stage rail are not live regions.
- Errors use a separate alert and are not duplicated into the polite node. Busy regions expose `aria-busy`.
- The visual ten-stage rail is `aria-hidden="true"`. Only the concise current-stage/failure sentence is sent to the persistent status node.
- Reduced motion removes nonessential transitions and never smooth-scrolls focus. Forced colors preserves links, control boundaries, state symbols, focus, and plane separation without relying on backgrounds. At 200% text zoom and 400% page zoom, reading and tab order remain unchanged, content reflows to one column, and no value/action is clipped.

### Long and hostile content

- Canonical hashes, addresses, IDs, versions, blocks, and timestamps render in LTR isolation with tabular numerals.
- Display text is bounded before rendering. Natural-language provider/model/error text uses bidi isolation and visibly marks stripped control characters.
- Canonical values wrap at safe character boundaries inside their own row; they never force viewport overflow.
- Display truncation uses a visible disclosure/copy affordance. Copy returns the canonical validated value, never the truncated display string.
- Explorer links are assembled only from the allowlisted HTTPS origin. Unsafe or invalid bases degrade to inert wrapped text.
- Maximum-content fixtures include 100 inventory rows, all lifecycle entries, all coverage bits, maximum schema-safe provider/model/reason strings, and full 32-byte/20-byte identifiers.
- At 320, every label precedes its value. No hash shares a row with another value or action.

## 1. Overview `/`

### 1440×1000

```text
┌──────────────────────────── 1180 ────────────────────────────┐
│ proposition column 700       │ evidence sheet 440             │
│ eyebrow                       │ PL / ARCHITECTURE               │
│ H1 Policy-scoped admission    │ Architecture / process —       │
│ backed by exact evidence      │ illustrative, not current health│
│ bounded explanatory copy      │ Identity → Checks → Compute →   │
│ [PRIMARY CTA] [Verify another]│ Storage → Lease → Gate          │
│ dependency disclosure         │ bounded admission note          │
├───────────────────────────────────────────────────────────────┤
│ Public proof ledger: what can be independently checked        │
├───────────────────────────────────────────────────────────────┤
│ Trust boundary | capability limits | legacy exclusion         │
└───────────────────────────────────────────────────────────────┘
```

- Columns are 700px and 440px with a 40px gap.
- The proposition, primary CTA, secondary CTA, and dependency disclosure fit in the first 1000px capture.
- The evidence sheet is illustrative architecture, not a status component.
- First action: conditionally **Open featured real ProofLock**, otherwise **Browse recent ProofLocks**.

### 390×844

```text
358px column
eyebrow
H1 proposition
two short proof-boundary paragraphs
[PRIMARY CTA — full width]
[Verify another proof — full width]
dependency disclosure
architecture/process sheet
public-proof explanation
trust boundary
```

- The primary action appears before the architecture sheet and within the first viewport.
- The architecture steps wrap into two or three lines but retain arrow reading order.

### 320×700

```text
296px column
H1 proposition
one bounded summary
[PRIMARY CTA]
[Verify another proof]
dependency disclosure
architecture/process label
Identity → Checks → Compute
Storage → Lease → Gate
remaining explanation
```

- Principle slogans do not displace the first action; they move below the architecture sheet or are omitted as redundant.
- No caption is smaller than 12px.

### Overview states

| State | Required presentation |
|---|---|
| Featured proof release-verified | Primary CTA says “Open featured real ProofLock”; accompanying metadata names canonical Agent ID and verification time without an admission badge |
| Featured proof not verified | Primary CTA says “Browse recent ProofLocks”; no placeholder ID, fixture verdict, or disabled featured-proof control |
| Dependencies partial/unavailable | Disclosure lists known/unknown dependencies independently; proposition and public browsing/verifier actions remain available |
| Maximum content | Long dependency/capability text wraps below the actions; it never widens the architecture sheet or changes CTA order |

Focus after navigation: primary CTA → Verify another proof → later explanatory links.

## 2. Recent ProofLocks `/agents`

### 1440×1000

```text
┌──────────────────────────── 1180 ────────────────────────────┐
│ eyebrow + H1 Recent ProofLocks                               │
│ bounded-inventory explanation                               │
│ scope bar: finalized blocks / confirmations / returned / cap │
│ legend                                                       │
│ table 1180                                                   │
│ caption: Recent finalized RegistryV2 activity; bounded scope  │
│ Identity | Coverage | Seal/source | Lease | Gate | Checked | Action   │
│ row …                                                        │
│ signed complete-inventory deferral                           │
│ legacy V1 exclusion                                         │
└──────────────────────────────────────────────────────────────┘
```

- The table is the dense desktop representation; every row retains Gate reason and row availability.
- The desktop **Seal / Registry source** cell contains two explicitly labeled lines: `Seal — v{version} · {envelopeDigest}` and `Registry source transaction — {transactionHash}` with its canonical locator action. The seven content columns allocate 240 / 90 / 240 / 100 / 130 / 130 / 150px respectively (1080px total); the remaining 100px covers cell padding and rules inside the 1180px table. Values wrap inside their cell, so source-locator parity does not create horizontal overflow.
- The table has the visible caption **“Recent finalized RegistryV2 activity — bounded scope shown above.”** At desktop, the table is the only accessibility-tree representation and mobile cards are `display:none`. At 390/320, the table is `display:none` and cards are the only accessibility-tree representation. `aria-hidden` alone is not used to hide focusable duplicates.
- Row order is lifecycle urgency plus Gate urgency, never a risk leaderboard.
- First action in populated state: the first canonical identity link. First action in error state: Retry read.

### 390×844

```text
358px column
H1 + bounded-scope sentence
scope disclosure card
inventory card 1
  Agent / unavailable identity
  Lease + Gate reason
  Coverage
  Seal version
  Last checked block
  Registry source transaction
  [Open proof record or Verify stored proof]
inventory card 2 …
complete-inventory deferral
legacy exclusion
```

- Desktop legend/table headers are not duplicated above cards.
- Cards preserve every desktop datum and reason; no column disappears.

### 320×700

```text
296px column
H1
scope: blocks
confirmations / returned / cap
signed deferral
card
  Identity
  Lease
  Gate + reason
  Coverage
  Seal
  Last checked
  Registry source transaction
  [Action]
…
```

- Scope metadata stacks label over value.
- One action per line. Full identifiers are disclosed/copyable without horizontal scrolling. Every successful mobile card has the same canonical Registry source locator and public action as its desktop row: Open proof record when identity is verified, and Verify stored proof when only the historical locator is available.

### Inventory states

| State | Required presentation and focus |
|---|---|
| Loading | Heading and scope region remain; fixed-height row/card skeletons say “Reading recent finalized RegistryV2 activity…”; no old rows remain; `aria-busy=true` |
| Empty | “No recent finalized events” plus exact observed range and signed complete-inventory deferral; no claim that no active leases exist |
| Whole-route error | “Recent ProofLock read unavailable”; no legacy fallback; Retry read is first action and retains/receives focus after failure |
| Partial | Successful rows remain; failed enrichment is an in-place “Enrichment unavailable” row/card with identity key, source tx, block, reason code, and public stored-proof action where valid |
| Populated | Each row/card states lease, Gate reason, coverage, version, and observed block |
| Blocked | Blocked/unknown rows show text reason and symbol; they may sort ahead by urgency but never imply maliciousness or universal risk |
| Fixture | Unmistakable “DEMO FIXTURE — synthetic, not production evidence” label on the row/card and linked detail; never promoted as featured real proof |
| Maximum content | 100 rows remain responsive; route-specific values wrap inside cells/cards; one bad row cannot erase the list |

## 3. Agent detail `/agents/[agentId]`

### 1440×1000

```text
┌──────────────────────────── 1180 ────────────────────────────┐
│ ← ProofLocks                                                 │
│ identity header: Agent # / wallet / fixture label if exact   │
├───────────────────────────────────────────────────────────────┤
│ CURRENT DECISION 440        │ PRIMARY PUBLIC ACTION 700       │
│ Gate + reason               │ [Verify this historical artifact]│
│ guarded consumer            │ proof/source identifiers         │
│ observation block + TTL     │ explorer provenance              │
├─────────────────────────────┴─────────────────────────────────┤
│ SEALED EVIDENCE — historical                                 │
│ identity@block → checks → Compute → Storage → Registry event  │
│ exact capability and commitments                              │
├───────────────────────────────────────────────────────────────┤
│ CURRENT ACCESS — independently observed                       │
│ identity | lease | Gate | consumer (each status/reason/time)  │
├───────────────────────────────────────────────────────────────┤
│ coverage | identifiers | lifecycle | trust roles              │
│ quiet link: Open operator workbench                           │
│ legacy exclusion                                              │
└───────────────────────────────────────────────────────────────┘
```

- Decision and public verification action share the first viewport; operator controls do not.
- Split-plane widths are 560px each with a 40px gap when shown side by side. DOM order is sealed plane then current plane unless the current decision summary is a separate leading section as drawn.
- The leading decision summary is a projection of current observations, not a replacement for the independently labeled current plane.

### 390×844

```text
358px column
← ProofLocks
Agent identity + fixture label
CURRENT DECISION + reason + freshness
[Verify this historical artifact]
proof/source identifiers
SEALED EVIDENCE
CURRENT ACCESS
coverage
lifecycle
trust roles
quiet operator link
legacy exclusion
```

### 320×700

```text
296px column
back link
Agent #
fixture warning if applicable
Gate: ALLOWED / BLOCKED / UNAVAILABLE / STALE
reason code
observed block + expires/expired time
[Verify historical artifact]
then sealed and current planes as single-column data rows
```

- Current decision and primary public action precede explanatory content.
- Wallets, hashes, and source transactions each occupy a dedicated label/value/copy row.

### Detail states

| State | Sealed evidence plane | Current access plane |
|---|---|---|
| Loading | Identity/detail skeleton; no prior proof claims | Independent current-observation skeleton; no inherited Gate state |
| Route error | Route-level “ProofLock unavailable” with safe bounded reason and back action | No admission inference |
| Historical match | Full exact artifact, source transaction, block/hash, Compute capability, Storage capability, commitments | Reads/rendering proceed independently |
| Historical mismatch | Red mismatch message; all prior proof dossier data cleared; canonical identifiers remain | Current plane may be separately read but is explicitly “not evidence of historical validity” |
| Historical unavailable/hint required/stale link | Current record stays visible; sealed plane says unavailable/hint required/stale locator with exact recovery action | Current observations remain independently visible |
| Current partial | Historical plane unchanged | Identity, lease, Gate, and consumer render independently at the same pinned block; each may be `VERIFIED`, `BLOCKED`, `UNAVAILABLE`, `STALE`, `MISMATCH`, or `NOT_APPLICABLE` without suppressing a sibling |
| Current stale | Historical plane unchanged | Decision says `STALE`; shows last block/time and expiration; offers Refresh current access; never displays stale as current admitted |
| Current mismatch | Historical plane unchanged | The affected identity/lease/Gate/consumer row says `MISMATCH`, names the compared binding and reason, and forces the aggregate decision to BLOCKED/unknown; verified sibling rows remain visible |
| Current not applicable | Historical plane unchanged | The affected row says `NOT_APPLICABLE` and names its missing predecessor; for example, no current lease makes Gate/consumer not applicable rather than unavailable or successful |
| Blocked | Historical proof may still match | BLOCKED appears first with stable reason code; lease/Gate/consumer cause remains visible; no “unsafe agent” language |
| Fixture | Prominent fixture label beside identity and before decision | Every plane remains labeled synthetic; no share/featured-real language |
| Maximum content | All stages, commitments, source locators, lifecycle predecessors, and capability prose wrap/disclose safely | Four observations plus reasons and TTL stack without hiding any failure |

Detail focus order: back → Verify historical artifact → proof/explorer/copy actions → Refresh current access when present → lifecycle links → quiet Operator link. A failed refresh returns focus to Refresh current access while retaining sealed evidence.

## 4. Public verifier `/proof` and `/proof/[proofId]`

### 1440×1000

```text
┌──────────────────────────── 1180 ────────────────────────────┐
│ H1 Public evidence verifier                                  │
│ no new paid Compute; retrieval/network scope                 │
│ form 740                                                     │
│ Proof ID                                                     │
│ Identity key                                                 │
│ Optional Registry source transaction                         │
│ [Open verifier]                                              │
├───────────────────────────────────────────────────────────────┤
│ subsystem observations: 3×2 independent cells                │
│ verification-scope disclosure                                │
└───────────────────────────────────────────────────────────────┘

Result route:
┌──────────────────────────── 1180 ────────────────────────────┐
│ ← Verify another | H1 Proof verification                     │
│ canonical identifiers + optional source transaction          │
│ [Verify exact evidence] [Cancel/Retry when applicable]        │
│ SEALED EVIDENCE 700         │ CURRENT ACCESS 440              │
│ historical state/artifact   │ independent current read        │
└───────────────────────────────────────────────────────────────┘
```

- Form measure is 740px; result plane widths are 700px and 440px with a 40px gap.
- First action is the first Proof ID field on entry and Verify exact evidence on a valid result link.

### 390×844

```text
358px column
H1 + scope
Proof ID
Identity key
Optional source transaction
[Open verifier]
validation message
health cells one per row
scope disclosure

Result: identifiers → Verify/Cancel/Retry → historical plane → current plane
```

### 320×700

```text
296px column
H1
scope sentence
three label/input blocks, each input 16px minimum
[Open verifier]
result state
historical evidence rows
current observation rows
```

- Actions never share a row at 320.
- Optional source transaction remains visible on the result route whenever supplied or invalid.

### Verifier states

| State | Required presentation |
|---|---|
| Entry idle | Exact nonzero bytes32 instructions; submit disabled until required values validate |
| Invalid | `aria-invalid` and associated error on each invalid field; focus first invalid field; no navigation |
| Health loading/error/mixed | Six independent probes; retry health does not reset form; one failed probe never recolors other probes |
| Result idle | Canonical identifiers remain; Verify exact evidence is first action |
| Verifying/retrying | Historical plane busy; initiating button remains stable and disabled; Cancel historical verification appears in place |
| Historical match + current reading | Matched dossier renders immediately; current plane separately says Reading current access |
| Historical match + current unavailable/timeout/canceled | Matched dossier remains fully visible; current plane shows its failure and Retry current access where supported |
| Mismatch | Every previous matched dossier and current-access result is cleared before mismatch renders; identifiers remain; Retry is available only as a new clean request |
| Hint required | Explain bounded lookup and require exact Registry source transaction; no approximate event selection |
| Historical unavailable/timeout/canceled | No old artifact/current result; stable Retry; timeout and cancel use distinct copy |
| Current blocked | Historical match remains; current plane says BLOCKED with reason code and pinned observation metadata |
| Current stale | Historical match remains; current plane says STALE with last observed block/time and explicit refresh action |
| Current partial/mismatch/not applicable | Historical match remains; all four current rows remain independent and use the exact per-observation semantics frozen above |
| Maximum content | Full hashes, provider/model, source block/hash/log index, upload tx, root, and capabilities wrap in isolated data rows |

Verifier reading order is identifiers → controls → historical plane → current plane. Verifier tab order is back link → identifier copy/link actions → Verify → visible Cancel/Retry → historical explorer/copy actions → current refresh. Evidence text is read between controls but is not inserted into tab order.

### Verifier deterministic focus destinations

| Transition | Focus destination |
|---|---|
| Entry submit with invalid values | First invalid field: Proof ID, then Identity key, then optional source transaction |
| Valid entry navigation to result route | Result route `h1` with `tabindex="-1"` |
| Verify/Retry starts | Invoking Verify or Retry remains focused and disabled; if it is conditionally replaced, focus moves to the stable historical-status heading |
| Historical match | Historical result heading (`tabindex="-1"`); the subsequent current read announces but does not steal focus |
| Historical mismatch/hint required/unavailable/timeout | Corresponding historical result heading (`tabindex="-1"`), followed by Retry in normal tab order |
| Cancel historical | Canceled historical result heading (`tabindex="-1"`) |
| Current admitted/blocked/partial/mismatch/not applicable/unavailable/stale/timeout/canceled | Current-plane heading (`tabindex="-1"`) only when the user invoked a current refresh/cancel; automatic post-match current completion announces without moving focus |
| Tuple or source locator changes | Proof verification `h1` (`tabindex="-1"`) after all prior result state is cleared |

After every Enter-triggered failure, the destination above is focused before any pointer interaction. If an invoker disappears, the associated stable result heading/status is programmatically focusable and receives focus; focus never falls to `body`.

## 5. Operator `/operator`

### 1440×1000

```text
┌──────────────────────────── 1180 ────────────────────────────┐
│ OPERATOR WORKBENCH | named authority + paid-work disclosure  │
│ “Resolve first. Mutate second.”                              │
├────────────────────────── 560 ─┬────────────── 580 ──────────┤
│ IDENTITY / CURRENT RECORD       │ OPERATION / RECOVERY         │
│ Agent ID                        │ one-time token appears only   │
│ [Resolve identity]              │ after canonical resolution    │
│ identity evidence               │ seal/reseal/drift actions      │
│ current lease/Gate              │ stage rail or outcome          │
│                                 │ recovery action and provenance │
└─────────────────────────────────┴──────────────────────────────┘
```

- Columns use a 40px gap. Resolution precedes token entry in DOM and visual order.
- First action is Agent ID, then Resolve identity. No paid action is above the authority/cost disclosure.

### 390×844

```text
358px column
H1 + authority/cost/recovery disclosure
Agent ID
[Resolve identity / Cancel resolution]
identity result
current record/Gate
one-time token
primary mutation action
secondary drift/reseal/cancel actions
stage progress
write outcome
recovery action
```

### 320×700

```text
296px column
H1
three short disclosure paragraphs
Agent ID
[Resolve]
resolved identity
one-time token
[single primary operation]
[secondary action]
[Cancel when running]
one stage per row
outcome/recovery
```

- Buttons are full width and never adjacent at 320.
- Token text is never echoed in status, error, URL, copy controls, or screenshots.

**Resume/reconcile** has one narrow meaning: authenticated, read-only reattachment to and reconciliation of the same durable operation journal/idempotency key. It may inspect persisted phases, validate known chain evidence, and invoke commitment-bound recovery. It never resumes or reruns a paid Compute, Storage, reservation, or chain-write stage. If reconciliation proves no accepted/broadcast operation, the UI must reach a definitive terminal state before a separately authorized fresh run is offered.

### Operator states

| State | Required presentation and action |
|---|---|
| Empty/invalid | Canonical decimal Agent ID guidance; invalid input associated and focused; no token field |
| Resolving | Stable field disabled; Resolve is replaced in place by Cancel resolution; concise status announcement |
| Resolution missing/mismatch/error | Exact safe reason; no mutation controls; focus returns to Agent ID |
| Resolved without lock | Identity evidence then token; primary action “Run verified evaluation” |
| Resolved with lock | Existing version/Gate shown; token then drift/reseal/recovery choices; no first-seal action |
| Fixture | “DEMO FIXTURE — synthetic scenario” before token; actions retain operator authority and cost warnings |
| Running | Identity locked; token cleared after request acceptance; one current stage announced; Cancel seal/reseal remains stable |
| Admission `ACCEPTED` | Show durable recovery ID and “Operation accepted”; the server-created idempotent operation is now the only allowed operation for this attempt |
| Admission `DEDUPLICATED` | Show durable recovery ID and “Attached to existing operation”; resume/reconcile that operation and never expose a fresh paid action |
| `PRE_SEND` | Say “Paid evidence may be complete; Registry submission has not been attempted”; retain recovery ID and committed-input state; only Cancel and later Recover/reconcile are available |
| Canceled before acceptance | Truthful no-network-invocation message; safe to start only after explicit new token entry |
| Cancel/disconnect after `ACCEPTED` or `PRE_SEND` | Show `RECOVERY_REQUIRED` with certainty `ACCEPTED`; Recover inspects the durable operation and never reruns Compute, Storage, or a chain write; no fresh paid action |
| `SUBMISSION_ATTEMPTED` without hash | Say “Submission attempted; broadcast not yet proven”; Recover checks the durable committed operation and chain evidence; no fresh paid action |
| `HASH_KNOWN` | Show the canonical transaction hash and “Finality not yet proven”; Recover verifies target, sender, calldata/event, receipt, finality, identity/version, and intended commitments; no fresh paid action |
| Cancel/disconnect after `SUBMISSION_ATTEMPTED` or `HASH_KNOWN` | Preserve the highest certainty and known hash; show Recover only after one-time token entry; never downgrade to canceled-before-acceptance or offer a fresh run |
| `FINALIZED` pending read-back | Show finalized transaction/block/confirmations without claiming a sealed current read; Recover validates the finalized write and read-back; no fresh paid action |
| Cancel/disconnect after `FINALIZED` | State that a finalized transaction cannot be canceled; preserve tx/block/confirmations and expose Recover read-back only after one-time token entry; no fresh paid action |
| Connection interrupted before any admission acknowledgement | Outcome unestablished; “Resume/reconcile this same idempotency key”; no fresh paid action until reconciliation proves no accepted operation |
| `NOT_BROADCAST` | Failed stage/code; “No lease was issued” permitted only for proven pre-submission outcome |
| `SUBMISSION_OUTCOME_UNKNOWN` | “Submission attempted; broadcast not yet proven”; recovery ID and hash if known; Recover before retrying |
| `FINALIZED_READBACK_UNAVAILABLE` | Finalized tx/version shown; current read-back unavailable; historical/current claims not invented; Recover write |
| `REVERTED` | Reverted tx and explorer provenance; no sealed claim |
| `SEALED` | Version and tx; current read-back shown as confirming/complete/failed independently |
| `IDEMPOTENCY_CONFLICT` | Existing key does not bind the submitted canonical request; reject before paid work, clear token, focus rejection heading, and require correction—not retry with that key |
| `IDENTITY_ACTIVE` | Another operation owns this identity; show active-operation rejection and its safe reconciliation guidance; no fresh paid action |
| `CONCURRENCY_LIMIT` / `OPERATOR_CONCURRENCY_LIMIT` / `GLOBAL_CONCURRENCY_LIMIT` | Name the exact ceiling that rejected admission; no operation accepted and no paid-work progress is shown; a later retry requires new token entry |
| `RATE_LIMIT` | Name the rate-window rejection without implying dependency failure; no operation accepted; new token required after the disclosed retry window |
| `DAILY_CEREMONY_LIMIT` | Name the daily ceremony ceiling and reject before paid work; no same-day fresh action |
| `DAILY_COST_LIMIT` | Name the daily cost-unit ceiling and reject before reservation/paid work; no same-day fresh action |
| Drift no change | Show `NO DRIFT`, before/after digests, and “No drift mark written”; current lease is refreshed independently |
| Drift detected and marked | Show `DRIFT DETECTED`, before/after digests, guardian-authorized mark transaction/provenance, and “Consumer action blocked”; never imply continuous monitoring |
| Drift failure | Show exact safe failure/code and “No lifecycle claim changed by the UI”; retain prior current observations as stale/last observed, not newly verified |
| Recovery idle | Requires new one-time token; recovery is clearly read-only and never repeats Compute, Storage, or chain write |
| Recovering | Recover button remains in place, disabled, text “Recovering…”; token already cleared |
| Recovery nonterminal/failure | Durable certainty, recovery ID, known tx, exact stage/code retained; focus returns to Recover write/token as applicable |
| Recovery sealed/definitive | Show sealed or reverted/not-broadcast terminal truth, then refresh current observations independently |
| Maximum content | Ten stages, full recovery/tx values, long bounded errors, coverage, Gate, and lifecycle remain within one column on mobile |

Operator reading order is authority/cost disclosure → identity/resolution → current record → token/actions → stage/status → write outcome/recovery → provenance. Operator tab order is Agent ID → Resolve/Cancel → demo-fixture action if configured → token → allowed primary operation → secondary operation → Cancel → Recover → explorer/open-proof links. Noninteractive identity, stage, and evidence rows stay out of tab order.

### Operator deterministic focus destinations

| Transition | Focus destination |
|---|---|
| Invalid resolve | Agent ID field |
| Resolve canceled | Agent ID field |
| Resolve missing/mismatch/error | Agent ID field after the alert is announced |
| Resolve succeeds | Resolved identity heading (`tabindex="-1"`); token is next in normal tab order |
| Seal/reseal starts and action remains | Invoking action remains focused and disabled |
| Invoking action disappears after `ACCEPTED`/`DEDUPLICATED` | Persistent operation-status heading (`tabindex="-1"`) |
| Cancel before acceptance | Canceled result heading (`tabindex="-1"`), then Agent ID/token path in normal order |
| Cancel/disconnect at accepted, pre-send, submission-attempted, hash-known, or finalized certainty | Recovery-required heading (`tabindex="-1"`); token then Recover are next in normal order |
| Admission/limit rejection | Exact rejection heading (`tabindex="-1"`); Agent ID remains resolved, and token field is next only when a future retry is permitted |
| Drift no-change/detected/failed | Drift result heading (`tabindex="-1"`); no automatic focus move to refreshed current data |
| Direct `NOT_BROADCAST` outcome | Terminal not-broadcast heading (`tabindex="-1"`); a cleared/new one-time token field and explicit start action follow in normal tab order |
| Direct `SUBMISSION_OUTCOME_UNKNOWN` outcome | Recovery-required heading (`tabindex="-1"`); one-time token then Recover are the only operation controls in normal tab order |
| Direct `FINALIZED_READBACK_UNAVAILABLE` outcome | Recovery-required heading (`tabindex="-1"`); one-time token then Recover follow, with no fresh paid action |
| Direct `REVERTED` outcome | Terminal reverted heading (`tabindex="-1"`); canonical explorer transaction action follows |
| Direct `SEALED` outcome | Terminal sealed heading (`tabindex="-1"`); explorer and Open proof record actions follow |
| Recover invoked | Recover button remains focused and disabled; if replaced, Recovering status heading receives focus |
| Recover requested without a one-time token | One-time token field, with an associated recovery-token error; recovery is not invoked |
| Recovery nonterminal/failure | Recovery result heading (`tabindex="-1"`); token then Recover follow in normal order |
| Recovery `SEALED`, `REVERTED`, or proven `NOT_BROADCAST` | Terminal result heading (`tabindex="-1"`); explorer/open-proof action follows |
| Identity/route changes | Agent ID field after token, stages, outcomes, and recovery context are synchronously cleared |

If any invoking control disappears, its stable result/status heading is programmatically focusable and receives focus. No operator transition sends focus to `body`, a removed token field, or a stale recovery action.

## Deterministic transition ledger

| From → event → to | State clearing and preservation contract |
|---|---|
| Current verified → TTL expires while visible → current stale | Atomically mark only expired current observations `STALE`; retain their last block/time as historical context; remove any “currently admitted” aggregate; sealed evidence is untouched |
| Current verified → tab/app hidden past TTL → visibility resume | Before painting an admitted/current label, compare server expiry with current time; immediately render `STALE`, announce “Current access: stale,” and require explicit refresh; no background-resume success is inferred |
| Current partial → refresh at a new pinned block | Replace all four current observations as one block-keyed set, but preserve each successfully returned sibling when another is unavailable/mismatched/not applicable; never mix observations from two pinned blocks in one “current” plane |
| Verifier tuple `(proofId, identityKey, sourceTxHash)` → any member changes | Abort both requests; increment generation; synchronously clear prior historical artifact, current result, reason, retry/cancel state, and announcements before rendering the new idle tuple |
| Detail locator `(agentId, sourceTxHash)` → any member changes | Abort the old route read; clear identity, sealed/current planes, decision, fixture label, lifecycle, and error before the new loading state; late responses cannot commit |
| Verifier match → later mismatch/unavailable/timeout/cancel | Clear the prior dossier and every prior current-access result before the terminal historical state; canonical input identifiers remain |
| Inventory populated → refreshed partial | Preserve every successfully returned row and its Registry source locator/action; replace only failed enrichment rows with explicit unavailable cards/rows; never collapse the list or silently reuse old Gate/lease claims as current |
| Inventory populated/partial → whole-route request failure | Keep the route heading/scope and render route error; prior rows may remain only in a separately labeled stale snapshot, never as the current result |
| Operator identity/route tuple changes | Abort active resolution/run/recovery; increment binding generation; clear token, stages, drift, errors, write outcome, recovery ID/hash, and controls before new state renders; late responses cannot commit |
| `ACCEPTED`/`DEDUPLICATED` → disconnect/cancel | Preserve recovery ID/idempotency ownership and highest certainty; expose Recover/reconcile only; never return to a fresh paid-run state |
| `SUBMISSION_ATTEMPTED` → no hash/disconnect | Preserve “submission attempted” certainty and intended commitments; Recover searches/validates without asserting broadcast or repeating paid work |
| `HASH_KNOWN` → nonterminal recovery | Remain `HASH_KNOWN`/recovery-required with the same canonical hash and no fresh action; never regress to accepted, pre-send, or unknown-without-hash |
| `HASH_KNOWN` → terminal recovery | Transition only to `SEALED`, `REVERTED`, or `FINALIZED_READBACK_UNAVAILABLE`; show the same hash and validated provenance. A known submitted transaction can never regress to `NOT_BROADCAST` |
| `FINALIZED` → read-back failure | Transition to `FINALIZED_READBACK_UNAVAILABLE`; retain tx/block/confirmations and Recover; never say no lease was issued |
| Recovery nonterminal → retry recovery | Use the same recovery ID and optional transaction hash; no Compute, Storage, reservation, or chain write repeats |

Transitions are monotonic by generation, pinned-block key, or operation certainty. No late request, viewport change, focus event, or resume event may resurrect cleared state.

## 6. Global error boundary

### 1440×1000

```text
centered state, maximum 580px
Fail-closed interface
H1 Proof surface unavailable
No admission state inferred
[Retry read] [Open ProofLocks]
```

### 390×844

```text
358px column, vertically offset below header
eyebrow
H1
bounded explanation
[Retry read — full width]
[Open ProofLocks — full width]
```

### 320×700

Same order within 296px. Actions stack with 8px minimum separation. No diagnostic digest, stack, secret, hostile error text, or inferred status is shown.

Focus order: Retry read → Open ProofLocks. After reset failure, focus returns to Retry read and the error is announced once. Exactly one `h1` is present.

## 7. 404

### 1440×1000

```text
centered state, maximum 580px
404
H1 Proof route not found
No legacy or approximate identity substituted
[Open ProofLocks]
```

### 390×844 and 320×700

The same order uses the full 358px or 296px content width. The action is full width, at least 44px high, and is the first focus target after global navigation. Exactly one `h1` is present. The route does not echo an untrusted path.

## Cross-route state coverage matrix

| Required state | Overview | Inventory | Detail | Verifier | Operator | Error/404 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Loading | dependency disclosure | yes | yes | historical/current/health | resolution/run/recovery | n/a |
| Empty | no featured proof | yes | n/a | idle form | empty identity | n/a |
| Error/unavailable | dependency partial | route + row | route + each plane | each plane + health | resolve/run/recovery | yes |
| Stale | no featured claim | bounded range only | current plane | current plane | read-back only | n/a |
| Partial | dependencies | row enrichment | current observations | health/current | staged outcome | n/a |
| Mismatch | n/a | identity/current enrichment binding | sealed artifact + current identity/lease/Gate/consumer bindings | sealed artifact + current identity/lease/Gate/consumer bindings | identity/operation/recovery binding | no approximate route |
| Not applicable | n/a | lease/Gate/consumer row with named missing predecessor | each current observation independently | each current observation independently | action/current-observation prerequisite | n/a |
| Blocked | bounded copy | Gate reason | current decision | current decision | current Gate | n/a |
| Fixture | never featured | labeled row | labeled identity/planes | labeled inputs/result | labeled before paid action | n/a |
| Uncertain write | prohibited | prohibited | public link only | prohibited | full typed outcomes | prohibited |
| Recovery | prohibited | prohibited | quiet operator link | prohibited | full workflow | prohibited |
| Maximum content | yes | 100 rows | all evidence/lifecycle | all proof fields | stages/outcomes | bounded copy |

## Approval checklist

Approval means the user accepts all of the following before any route styling begins:

- [ ] The 1440, 390, and 320 viewport orders and widths.
- [ ] The first action on every route and state.
- [ ] The architecture/process strip wording and non-live treatment.
- [ ] The sealed-evidence/current-access independence rules.
- [ ] The inventory completeness deferral.
- [ ] The public/operator secret boundary.
- [ ] The loading, empty, error, stale, partial, mismatch, blocked, fixture, uncertain-write, recovery, and maximum-content behavior.
- [ ] Focus order, focus recovery, mobile stacking, and hostile/long-content behavior.
- [ ] Exact Compute, Storage, Registry-history, admission, drift, scanner, and guardian claim annotations.
- [ ] Persistent heading/landmark/live-region behavior and reduced-motion, forced-colors, 200%-text, and 400%-zoom contracts.
- [ ] The deterministic tuple, TTL/resume, inventory-partial, and operator-certainty transition ledger.

**Approval record:** `APPROVED`  
**Approved by:** User  
**Exact approval:** “I approve the Task 9D no-code 1440/390/320 state specification and authorize Task 10 and route styling.”  
**Approved at:** 2026-08-29T12:29:53Z (2026-08-29 13:29:53 WAT)

Task 10 and route styling may now proceed in the approved dependency order. This approval does not satisfy Task 22's funded-mainnet or deployed-URL release gates.
