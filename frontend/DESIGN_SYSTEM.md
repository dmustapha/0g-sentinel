# Proof Ledger design system

This is the implementation contract for the 0G Sentinel Proof Ledger foundation. It records what exists after Task 10; it does not claim that shared primitives or route migrations are complete.

## Sources and cascade

`app/styles/tokens.css` is the canonical style source. `app/globals.css` only declares the fixed cascade order—reset, tokens, base, components, layouts, motion, utilities, overrides—and imports the six owned stylesheets. The eight parent layers remain the public cascade contract. Layer ownership is strict:

- `foundations.css`: reset and element foundations
- `tokens.css`: primitive, semantic, and compatibility custom properties
- `components.css`: existing widget appearance; not a Task 11 primitive library
- `layouts.css`: measures, composition, and responsive rules
- `motion.css`: transform/opacity animation and reduced-motion handling
- `utilities.css`: narrow technical wrapping, state tones, and focus treatment

Raw-color exception: raw color syntax is permitted only in `tokens.css`, plus the two server-rendered Open Graph image modules whose image renderer cannot resolve document custom properties. That narrow allowlist is frozen to canonical token values. All browser CSS and inline JSX/TSX consume semantic custom properties. Compatibility aliases such as `--graphite`, `--paper`, and `--violet` remain temporarily so this foundation does not silently migrate route markup.

## Visual language

Graphite is the working canvas, a darker elevated surface is reserved for evidence dossiers, and 0G scan cyan marks actions and provenance—not generic decoration. Geometry is square, with a single 16px dossier cut. Controls use a crisp `3px 3px 0` shadow and sheets use `5px 5px 0`; neither shadow blurs. Texture stays quiet and never conveys state.

The first-viewport signature is a clipped evidence sheet set against the graphite proof workspace: the warm-paper plane establishes evidence as the primary artifact before any decorative treatment. This signature remains consistent across desktop and mobile reflow.

Status, action, and focus colors are surface-aware. Dark-canvas and paper values are distinct. Normal text and all 12–14px labels meet at least 4.5:1 against their declared surface; control borders and focus indicators meet at least 3:1. Color is never the only state cue: visible labels, reason codes, and status text remain required.

The alpha-composited rail endpoint and running-stage outline use `--rail-end-on-ceremony` and clear 3:1 after compositing on the ceremony surface. Low-alpha texture, soft fills, and subtle separators are decorative support only; they are never the required state indicator or the sole boundary of a control.

## Rhythm, type, and controls

The spacing grammar is based on a 4px half-step and an 8px primary step. Caption, data, and body roles have floors of 12px, 14px, and 16px with line heights 1.4, 1.45, and 1.55. Chakra Petch remains display/UI, IBM Plex Sans body, and IBM Plex Mono technical data. Form controls stay at 16px to prevent mobile zoom.

Every interactive control is at least 44px high; primary actions are 48px. Icons use 16px, 20px, or 24px sizes and require accessible names when they have meaning. Focus uses the surface-specific focus token and is never removed without replacement.

### Component token variants

The component tier names the future primitive contracts without implementing Task 11: button default/primary height, border, and shadow; field height and border; status-badge padding and type; evidence-sheet surface and shadow; data-row label/value type; state-message border and padding; and proof-plane gap and border. Current selectors consume these tokens where an equivalent element already exists. Behavior, accessible naming, and state matrices still belong to Tasks 11–13.

- `--button-min-height: var(--control-min)`, `--button-primary-height: var(--control-primary)`, `--button-border: var(--border-control-on-dark)`, `--button-shadow: var(--shadow-control)`, `--button-primary-surface: var(--action-on-dark)`, `--button-primary-text: var(--action-ink)`, `--button-disabled-surface: var(--surface-control)`, `--button-disabled-text: var(--text-muted-on-dark)`
- `--field-min-height: var(--control-min)`, `--field-border: var(--border-control-on-dark)`, `--field-surface: var(--surface-canvas)`, `--field-text: var(--text-on-dark)`
- `--status-badge-padding: 5px 8px`, `--status-badge-type: var(--type-caption)`, `--status-badge-success-on-paper: var(--status-success-on-paper)`, `--status-badge-caution-on-paper: var(--status-caution-on-paper)`
- `--evidence-sheet-surface: var(--surface-paper)`, `--evidence-sheet-shadow: var(--shadow-sheet)`, `--evidence-sheet-cut: var(--dossier-cut)`
- `--data-row-label-type: var(--type-caption)`, `--data-row-value-type: var(--type-data)`, `--data-row-label-on-paper: var(--text-muted-on-paper)`, `--data-row-value-on-paper: var(--text-on-paper)`
- `--state-message-border: var(--border-control-on-dark)`, `--state-message-padding: var(--space-2-5)`
- `--proof-plane-gap: var(--space-2)`, `--proof-plane-border: var(--border-control-on-dark)`, `--proof-plane-surface: var(--surface-ceremony)`, `--proof-plane-shadow: var(--shadow-sheet)`

## Motion, measures, and reflow

Functional motion is 120ms fast or 180ms standard and never exceeds 300ms. Only transform and opacity animate. Hover-only treatment is pointer-gated, and reduced-motion removes meaningful repetition. No smooth scrolling is installed globally.

The ledger measure is 1180px, verification measure 850px, prose measure 740px, and narrow dossier measure 580px. Governed breakpoints are 850, 600, 390, and 320px. At 390 and 320 the four primary links form an exact 2×2 grid. The 320px gutter is 12px and text retains the 12px caption floor. Content must reflow without global `overflow-x: hidden` masking defects.

Long technical values wrap only through the `.break` utility (`overflow-wrap: anywhere`). Broad wrapping on `code`, `dd`, or `.mono` is forbidden. The planned DataRow component will own the stronger labeled-value behavior in Task 13.

## Enforcement

`tests/ui/token-contract.test.ts` freezes exact values, resolves custom-property graphs, checks alpha-composited contrast and layer ownership, and follows the deterministic TSX import graph from app route/layout/error entries to scan reachable browser UI for raw colors and inline type, motion, wrapping, and shadow violations. Dormant prototypes remain outside this Task 10 migration boundary. Its raw-color contract is an exact name/value map inside the single token `:root`; selectors inside `tokens.css` receive no exception. Negative mutant fixtures guard common regressions. `tests/ui/visual-contract.test.ts` verifies the active direction at its canonical sources. Changes to this contract require updating both the implementation and its tests; metadata in `brand.json` points here and intentionally duplicates no palette, font, or color-mode values.
