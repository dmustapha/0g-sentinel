# 0G Sentinel - Design System

Extracted from the running code, not aspiration. The canonical source of truth is
`frontend/app/styles/tokens.css`; this document mirrors the values that already ship.
The product is **ProofLock**. The brand tagline is **"Admission should be provable."**

The visual language is a proof dossier: graphite is the working canvas, warm paper is
reserved for evidence, and a single violet marks actions and provenance. Geometry is
square. Shadows are hard offsets that never blur. Color is never the only state cue.

---

## Color tokens

All values below are the literal token declarations in `tokens.css`. In markup and CSS
you consume the semantic aliases (right column), never the raw hex.

### Surfaces

| Role | Hex | Token |
| --- | --- | --- |
| Canvas (working dark) | `#111214` | `--surface-canvas` / `--graphite` |
| Raised | `#191a1e` | `--surface-raised` / `--graphite-2` |
| Control | `#222329` | `--surface-control` / `--graphite-3` |
| Ceremony (proof plane) | `#0d0e10` | `--surface-ceremony` |
| Paper (evidence) | `#f1ebdf` | `--surface-paper` / `--paper` |
| Paper muted | `#e6ddcf` | `--surface-paper-muted` / `--paper-2` |
| Topbar | `rgba(17,18,20,.96)` | `--surface-topbar` |

### Accent, text, status

| Role | Hex | Token |
| --- | --- | --- |
| Violet on dark (action / provenance) | `#ad72ff` | `--action-on-dark` / `--violet` |
| Violet on paper | `#7950ae` | `--action-on-paper` |
| Text on dark | `#f2efe8` | `--text-on-dark` / `--text` |
| Muted on dark | `#a7a39b` | `--text-muted-on-dark` / `--muted` |
| Text on paper | `#19181a` | `--text-on-paper` / `--ink` |
| Muted on paper | `#5b565b` | `--text-muted-on-paper` |
| Success (dark / paper) | `#39b982` / `#116b49` | `--status-success-on-dark` / `--status-success-on-paper` |
| Caution (dark / paper) | `#d79a36` / `#91470a` | `--status-caution-on-dark` / `--status-caution-on-paper` |
| Failure (dark / paper) | `#f07878` / `#aa303a` | `--status-failure-on-dark` / `--status-failure-on-paper` |
| Focus (dark / paper) | `#d0b2ff` / `#674093` | `--focus-on-dark` / `--focus-on-paper` |

Status, action, and focus colors are surface-aware: dark-canvas and paper values are
distinct. Normal text and 12 to 14px labels meet at least 4.5:1 on their declared
surface; borders and focus indicators meet at least 3:1. A status is always carried by
text or a reason code as well as by color.

---

## Type scale

Three families (loaded via `next/font` in `app/layout.tsx`):

- `--font-display`: **Chakra Petch** - display, UI, wordmark.
- `--font-body`: **IBM Plex Sans** - running body copy.
- `--font-mono`: **IBM Plex Mono** - hashes, addresses, reason codes, technical data.

| Role | Size token | Floor | Line height |
| --- | --- | --- | --- |
| Caption | `--type-caption` `0.75rem` | 12px | 1.4 |
| Data | `--type-data` `0.875rem` | 14px | 1.45 |
| Body | `--type-body` `1rem` | 16px | 1.55 |
| Title | `--type-title` `1.25rem` | - | 1.05 heading |
| Display sm | `--type-display-sm` `clamp(1.7rem, 3.4vw, 3rem)` | - | - |
| Display lg | `--type-display-lg` `clamp(2.6rem, 7vw, 6.4rem)` | - | - |

Form controls stay at 16px to prevent mobile zoom. No role drops below its floor.

---

## Spacing, radii, shadows

Spacing is a 4px half-step on an 8px primary step: `--space-half` 4, `--space-1` 8,
`--space-1-5` 12, `--space-2` 16, `--space-2-5` 20, `--space-3` 24, `--space-4` 32,
`--space-5` 40, `--space-6` 48, `--space-8` 64, `--space-11` 88.

Corners are square (`--shape-square: 0`). The only curve in the system is the **16px
dossier cut** (`--dossier-cut`), applied as a `clip-path` on evidence surfaces.

Shadows are hard offsets, never blurred:

- `--shadow-control: 3px 3px 0 #000000` - buttons, cards, panels.
- `--shadow-sheet: 5px 5px 0 #000000` - evidence sheets and proof planes.

Motion is functional only: `--duration-fast` 120ms, `--duration-standard` 180ms, never
above `--duration-maximum` 300ms. Only transform and opacity animate; hover is
pointer-gated; `prefers-reduced-motion: reduce` removes meaningful repetition.

---

## Component patterns

**Buttons** (`.button`, `.button.primary`) - square, 44px min height (48px primary),
1px border, `--shadow-control`. Default is transparent on the canvas; primary is violet
fill with `--action-ink` text. Active nudges `translate(2px, 2px)` (the shadow "presses
in"); pointer-fine hover lifts `translateY(-2px)` and borders violet. Disabled drops to
0.4 opacity, `cursor: not-allowed`, and loses its shadow.

**Evidence card** (`.evidence-card`, `.guarantee-sheet`) - warm paper on graphite, the
signature artifact. Corner-cut via `clip-path` (16px dossier cut) and a 4 to 5px violet
spine on the left edge. State is shown by recoloring that spine: `.state-good`,
`.state-warn`, `.state-bad`.

**Data rows** (`.proof-list`, `.micro-grid`) - a `minmax(125px, .4fr) 1fr` label/value
grid separated by 1px paper rules. Labels are caption-scale mono; values are data-scale.

**Monospace hash treatment** - addresses, roots, and reason codes render in
`--font-mono` at data scale. Long technical strings wrap only through the `.break`
utility (`overflow-wrap: anywhere`); broad wrapping on `code`, `dd`, or `.mono` is
forbidden.

**Status chips / stamps** (`.status-chip`, `.verified-stamp`, `.coverage-total`) -
inline mono caption inside a 1px `currentColor` border, so the chip inherits its status
color for both text and outline.

**Proof ceremony rail** (`.proof-ceremony`, `.rail-stage`) - a vertical timeline on the
ceremony surface. Nodes recolor per stage: complete = success green, running = violet
with an alpha outline, failed = failure red. Idle stages sit at 0.38 opacity.

---

## Logo

`frontend/components/Logo.tsx` - pure inline SVG, no image asset.

**Concept.** A corner-cut seal enclosing a keyhole. The seal frame echoes the dossier
`clip-path` motif from the evidence cards: its top-right corner is clipped and its base
narrows to a sentinel point. The keyhole at the center reads two ways at once - a
watchful eye (the sentinel) and a lock (ProofLock).

**Color.** The frame is drawn with `currentColor`, so the mark inherits the wordmark
text color and stays monochrome-friendly. The keyhole carries the single violet accent
through `var(--logo-accent, var(--action-on-dark))`; set `--logo-accent` on a wrapper to
override. In the nav, `.wordmark .mk` sets `color: var(--text)` and
`--logo-accent: var(--violet)`.

**Usage.** Default render is 22px, sized to the nav wordmark; it scales up cleanly on a
24-unit grid. Pair it with the "0G Sentinel" wordmark in Chakra Petch 700. Pass a
`title` for an accessible name (`role="img"`) or `title={null}` to mark it decorative
when the adjacent wordmark already names the link. Minimum size is 22px; do not recolor
the frame away from the surrounding text color.

---

## Enforcement

`frontend/tests/ui/token-contract.test.ts` freezes the raw token values, forbids raw
colors outside `tokens.css` (and the two Open Graph modules), checks contrast and type
floors, and scans the reachable TSX import graph for inline color, motion, and wrapping
violations. `frontend/tests/ui/visual-contract.test.ts` verifies the type families and
the policy-scoped product claim. Any change to a token must update both the source and
these tests.
