# PULSE — 0G Sentinel
Rolling context layer. Every skill reads on entry, appends on exit.

---

## Active Facts (override brief if conflict)

- Mainnet required: 0G Aristotle mainnet deployment is MANDATORY — testnet = disqualified [verified: concerns.md C-critical]
- Track: T1 (Agentic Infrastructure & OpenClaw Lab) + T2 (Agentic Trading Arena) — T5 DROPPED (no TEE/ZK components; would hurt T5 score) [USER: approved E-1]
- Demo hook: Opens with "$88.88M in ecosystem grants, every agent operating blind" — NOT the generic "no security layer" line [SKILL: E-2 applied]
- OpenClaw Skill: `openclaw-skill/0g-sentinel-scan.json` to be created Day 3; PR to awesome-openclaw-skills [SKILL: E-3 applied]
- Two independent 0G Compute calls required — separate receipt hashes — if hashes are identical it's disqualifying [C-critical]
- 0G Compute endpoint: `https://router-api.0g.ai/v1` [VERIFIED: DNS resolves] — `api.inference.0g.ai/v1` does NOT resolve (exit code 6) [url_preverify]
- 0G Compute SDK: `@0gfoundation/0g-compute-ts-sdk` v0.8.3 [VERIFIED] — `@0glabs/0g-serving-broker` is DEPRECATED thin shim [url_preverify]
- 0G Compute receipt: TEE-signed routing proof (request hash + response hash + TLS fingerprint + provider identity) — NOT `x-compute-receipt-hash` header (doesn't exist); check `usage.receipt_hash` in body or fallback to response body hash [url_preverify]
- 0G Galileo testnet chain ID: **16602** (0x40da) [VERIFIED: live eth_chainId call] — research-brief said 16601 (WRONG) [url_preverify]
- 0G Aristotle mainnet chain ID: **16661** (0x4115) [VERIFIED: live eth_chainId call] [url_preverify]
- 0G Storage upload: `indexer.upload(file, evmRpc, signer)` using `ZgFile.fromFilePath()` — requires signer, NOT `uploadFile(data)` [url_preverify]
- 0G Explorer mainnet: `https://chainscan.0g.ai` [VERIFIED: web search] [url_preverify]
- 0G Explorer testnet: `https://chainscan-galileo.0g.ai` [VERIFIED: web search] [url_preverify]
- 0G mainnet chain ID: UNVERIFIED for hardhat placeholder — mainnet verified as 16661 above; update hardhat.config.ts placeholder `888888888` → `16661` on Day 1 [carry forward to build]
- AgentMesh differentiation: verbatim sentence required in README (F-008 observable) [non-negotiable]

---

## Decisions Log

| Decision | Rationale | Tag |
|----------|-----------|-----|
| Drop T5, use T2 | T5 requires TEE/ZK — plan has none; T2 maps to AgentGate DeFi gating + behavioral risk = risk management | [USER] |
| Add OpenClaw Skill manifest | T1 explicitly names OpenClaw Lab; skill manifest + PR activates that dimension without architecture change | [USER] |
| Move $88.88M to Scene 1 | Strongest stat in PRD was buried; judging criterion "Product Value" is 20%; specific dollar hook wins | [USER] |
| Safety model documented in ARCH | Section 17 added: circuit breaker patterns for 0G Compute down, Chain down, Storage down; single-POF table | [USER] |
| Pitch deck added Day 3 tasks | HackQuest optional field improves score; 5-slide structure uses existing PRD content; 30-min effort | [USER] |

---

## Verified Facts (from intel/research)

- Prize: $150K USDT — Grand ($45K/$35K/$20K) + 10 Excellence ($3.7K each) + 10 Community ($1.3K) [research-brief.md confirmed]
- Judging weights: 0G Integration ~30%, Technical ~25%, Product Value ~20%, UX/Demo ~15%, Docs ~10% [research-brief.md, low precision on weights]
- ETHGlobal Cannes winner pattern: 0G Compute as core product feature (not decoration) — all 3 winners [research-brief.md]
- T1 competition density: HIGH (80-120 est. teams); T5: LOW (20-40 est. teams) [research-brief.md]
- Track T5 requires: TEE, ZK, 0G Private Computer, AI Alignment Nodes — NONE present in plan [critique finding]
- Submission requires English OR Chinese README (not both required — but both improves score) [research-brief.md]
- Mandatory X post: #0GHackathon #BuildOn0G @0G_labs @0g_CN @0g_Eco @HackQuest_ [research-brief.md]

---

## Deviations

- [SKILL] Forge locked T1+T5. Critique dropped T5 and replaced with T2 after finding zero T5-qualifying components in the plan. All three track mentions in PRD + WINNER-BRIEF updated.

---

## Blockers for Downstream (Build)

- 0G Compute receipt hash field name UNVERIFIED — must be first live API call on Day 1
- 0G mainnet chain ID UNVERIFIED — must verify before writing hardhat.config.ts
- 0G Storage SDK upload method name UNVERIFIED — test on Day 1 before wiring archiveEvidence()
- OpenClaw Skill PR: create Day 3 morning (`openclaw-skill/0g-sentinel-scan.json`), submit PR to VoltAgent/awesome-openclaw-skills

---

## Additions (not in original PRD/Architecture)

- [SKILL] [NEW] `openclaw-skill/0g-sentinel-scan.json` — OpenClaw Skill manifest file (new file, Day 3)
- [SKILL] [NEW] ARCHITECTURE.md Section 16 — OpenClaw Skill Integration (new section)
- [SKILL] [NEW] ARCHITECTURE.md Section 17 — Safety Model with circuit breaker matrix (new section)
- [SKILL] [NEW] PRD.md tasks 31a, 33a — pitch deck creation + upload (new Day 3 tasks)

---

## For Next Skill (Build)

1. Day 1 morning: update `hardhat.config.ts` placeholder chain ID `888888888` → `16661` (mainnet VERIFIED) and testnet `16602` (VERIFIED) — no live verification needed
2. Day 1 package install: `npm install @0gfoundation/0g-compute-ts-sdk@^0.8.3` — do NOT use `@0glabs/0g-serving-broker` (deprecated)
3. Day 1 first compute call: log full response — find receipt hash (check `usage.receipt_hash` in body, then headers, then use response body hash fallback)
4. Day 1 storage test: run `@0glabs/0g-ts-sdk` upload — use `ZgFile.fromFilePath()` + `indexer.upload(file, evmRpc, signer)` — requires a signer object
5. T2 README sentence: "AgentGate.sol enforces risk-management gating for DeFi agents — a composable trust rail for any trading protocol on 0G." — must be in README.md
6. OpenClaw Skill: create `openclaw-skill/0g-sentinel-scan.json` from ARCHITECTURE.md Section 18 on Day 3
7. Demo hook: CONFIRMED as $88.88M grant exposure line — see PRD.md Scene 1 updated text
8. Pitch deck: 5 slides using PRD content — Day 3 step 31a
9. Explorer links in demo: mainnet `https://chainscan.0g.ai` / testnet `https://chainscan-galileo.0g.ai`

---

## Skills Completed

| Skill | Status | Key Output |
|-------|:------:|-----------|
| hackathon-critique | COMPLETE | CRITIQUE-REPORT.md; 5/5 elevations applied; track fixed T5→T2 |
| url_preverify | COMPLETE | 6 corrections: endpoint verified, chain IDs (16661/16602), SDK package, receipt mechanism, storage upload method |
