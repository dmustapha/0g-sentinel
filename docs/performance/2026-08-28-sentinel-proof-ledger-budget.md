# Sentinel Proof Ledger performance budget

Measured 2026-08-30 against the packaged Next.js standalone production server. These are browser measurements, not Lighthouse estimates.

## Repeatable profile

- Runner: Apple M1 (arm64), 8 GiB RAM, macOS 26.0.1 (25A362), Node 24.10.0.
- Browser: Playwright 1.62.1 bundled Chromium; performance comparisons are Chromium-only.
- Viewport: 390 × 844 CSS pixels.
- Network: cold cache for every sample, 150 ms latency, 1.6 Mbps download, 750 Kbps upload.
- CPU: 4× CDP slowdown.
- Statistic: median of three new browser contexts per route. The maximum inventory fixture contains 100 rows.
- Routes: `/`, `/agents`, `/agents/7`, `/proof`, one exact `/proof/[proofId]`, and `/operator`.
- Budgets: LCP ≤ 2,500 ms, INP ≤ 200 ms, CLS ≤ 0.1, active-control displacement ≤ 1 px, and no per-route JS/CSS/font transfer growth above 10% without a recorded exception.

The enforced command is `npx playwright test --project=chromium-performance` after `npm run build`. Cross-browser suites remain functional and accessibility gates; their timing is not compared.

## Before and after

Transfer values are encoded response bytes. The after column is the median of the three final green profile runs.

| Route | LCP before → after | CLS before → after | JS before → after | CSS before → after | Font before → after |
|---|---:|---:|---:|---:|---:|
| `/` | 856 → 864 ms | 0 → 0 | 103,169 → 103,187 B | 11,045 → 10,937 B | 99,932 → 90,204 B |
| `/agents` (100 rows) | 2,436 → 2,256 ms | 0.135 → 0 | 149,898 → 141,306 B | 11,045 → 10,937 B | 99,932 → 90,204 B |
| `/agents/7` | 864 → 872 ms | 0.212 → 0 | 165,276 → 156,605 B | 11,045 → 10,937 B | 99,932 → 90,204 B |
| `/proof` | 1,216 → 872 ms | 0 → 0 | 152,796 → 144,205 B | 11,045 → 10,937 B | 99,932 → 90,204 B |
| `/proof/[proofId]` | 1,180 → 872 ms | 0 → 0 | 156,879 → 148,287 B | 11,045 → 10,937 B | 99,932 → 90,204 B |
| `/operator` | 912 → 872 ms | 0.0020 → 0.0006 | 163,131 → 164,039 B | 11,045 → 10,937 B | 99,932 → 90,204 B |

Operator interaction measured 48 ms median INP after the change (48–72 ms across the final runs), with zero active-control displacement. No asset class grew by 10%; the only increase was operator JS at 0.56%.

## Changes justified by measurement

- Identity keys and proof IDs now arrive in strictly validated, cross-bound server locators. Public detail no longer imports Ethers or hashes the Registry tuple in the browser. Legacy detail fields remain intact; locator fields are additive.
- Loading/error detail shells reserve the same page-height contract as the ready route. The inventory legacy disclosure is inserted only after the read settles, so an existing visible control or disclosure is not displaced by the 100-row result.
- Computed CSS usage requires Chakra Petch 500/600/700 and IBM Plex Sans 400/500. Unused Chakra Petch 400 and IBM Plex Sans 600 were removed, saving 9,728 encoded font bytes while preserving Chakra Petch + IBM Plex Sans/Mono. IBM Plex Mono 400/500 remains because the CSS uses both and intentionally synthesizes emphasized labels.

## Final gate runs

1. Green: worst LCP 2,260 ms, worst CLS 0.0006, INP 72 ms, control shift 0 px.
2. Green: worst LCP 2,256 ms, worst CLS 0.0006, INP 48 ms, control shift 0 px.
3. Green: worst LCP 2,248 ms, worst CLS 0.0006, INP 48 ms, control shift 0 px.
