# WINNER BRIEF — 0G Sentinel
**Hackathon:** 0G APAC Hackathon
**Deadline:** May 16, 2026, 23:59 UTC+8
**Final Score:** 10.0 / 10.0
**War Room Version:** V3 (Final)
**Status:** LOCKED — this is the version that goes to forge

---

## THE IDEA IN ONE SENTENCE

0G Sentinel is on-chain security infrastructure for AI agents: it runs two verifiable analysis pipelines on every ERC-7857 iNFT on 0G Aristotle mainnet — behavioral risk scoring and smart contract vulnerability scanning — and writes the results as persistent ERC-7857 attestations to 0G Chain, so any buyer, protocol, or application can verify whether an agent is safe before trusting it with anything.

---

## THE PROBLEM

AI agents on 0G Aristotle mainnet are being bought, hired, and trusted with real money. There is no security layer. Before anyone interacts with an unknown agent, two questions have no answers:

**1. Is this agent's behavior safe?**
Does it drain wallets? Does it loop abnormally? Does it access contracts it shouldn't? No on-chain record of behavioral history exists for any agent.

**2. Is this agent's contract code safe?**
Does the contract have reentrancy vulnerabilities? Broken access controls? Dangerous delegatecall patterns? Agents are code — and unaudited code gets exploited. No on-chain code audit exists for any agent.

This is structural, not AIverse-specific. Any protocol that hires agents, any developer that deploys agents, any buyer that purchases agents has this problem today. The ecosystem is 2 months old — this infrastructure needs to exist before malicious agents proliferate and distrust kills liquidity.

---

## THE SOLUTION

**Two 0G Compute pipelines. One attestation. Full ecosystem coverage.**

**Pipeline 1 — Behavioral Analysis**
A 0G Compute inference call that receives an agent's on-chain activity data (fund flow patterns, call frequency, transaction history, access patterns) and produces a behavioral risk score (0–100) with a threat classification: SAFE / CAUTION / FLAGGED. The 0G Compute receipt hash is captured — cryptographic proof of what model ran, what input it received, what verdict it produced. This hash is stored in the attestation and is independently verifiable.

**Pipeline 2 — Code Vulnerability Scan**
A second independent 0G Compute inference call that analyzes the agent's smart contract code for known vulnerability patterns: reentrancy exposure, broken access control, unprotected selfdestruct, dangerous delegatecall usage, integer overflow risks. Output: a code risk classification (CLEAN / WARNING / VULNERABLE) with specific findings (e.g., "VULNERABLE — reentrancy at withdraw()"). Receipt hash captured and stored. Deterministic findings, no probabilistic inference.

**Attestation Layer — 0G Chain + ERC-7857**
Both pipeline verdicts written to 0G Chain as an ERC-7857 Agent ID iNFT attestation. Fields: `behavioral_score`, `threat_level`, `code_risk`, `code_findings`, `behavioral_receipt_hash`, `code_receipt_hash`, `evidence_hash`, `attestation_timestamp`. The attestation is part of the agent's portable on-chain identity — queryable by any downstream application without calling 0G Sentinel's servers.

**Evidence Archive — 0G Storage**
Raw behavioral evidence and both inference proof receipts stored on 0G Storage Log Layer. Anyone can retrieve and independently verify the evidence behind any attestation.

**AgentGate.sol — Composability Demo**
A consumer contract that reads `threat_level` or `code_risk` from the attestation registry and reverts transactions from FLAGGED or VULNERABLE agents. Proves the attestation is composable infrastructure, not a dashboard feature.

---

## BUILD FOUNDATION — AGENTMESH ADAPTATION

AgentMesh (builder's prior project, won 0G Labs track at ETHGlobal Open Agents 2026) ships working: 0G Compute API client, on-chain attestation contracts, 0G Storage client, specialist vulnerability prompt templates.

0G Sentinel reuses this plumbing directly:

| AgentMesh Component | 0G Sentinel Usage |
|---------------------|-------------------|
| 0G Compute API client | Copy directly — same OpenAI-compatible endpoint, same receipt hash capture |
| `AuditAttestation.sol` | Rename → `AttestationRegistry.sol`. Swap audit fields for trust fields. Same write/read pattern. |
| `AgentRegistry.sol` | Keep. Re-scope to index ERC-7857 iNFTs from 0G mainnet. |
| Reentrancy/access control prompt templates | Copy directly as Pipeline 2 (Code Vulnerability Scan) |
| 0G Storage SDK client | Copy directly — same Log Layer upload, same hash return |
| Contract deployment scripts | Minor edits — point to 0G Aristotle mainnet |

**Dropped entirely:** AXL P2P mesh, ENS identity, WebSocket multi-agent coordinator, specialist routing.

**README differentiation (required):**
> "AgentMesh audits smart contract code written by developers and produces audit reports. 0G Sentinel audits AI agents running on 0G mainnet — their behavior and their contract code — and writes the results as ERC-7857 on-chain identity attestations. Different users, different problem, different output."

This is the plumbing reused. The product is new.

---

## 0G INTEGRATION MAP

| Component | Role | Depth | Est. Build Time |
|-----------|------|:-----:|:---------------:|
| 0G Compute | Behavioral analysis pipeline + Code vulnerability scan (2 independent calls, 2 receipt hashes) | PRIMARY — load-bearing × 2 | 2-3h (plumbing reused) |
| 0G Chain | Attestation writes, ERC-7857 iNFT update | PRIMARY — load-bearing | 1-2h (contract pattern reused) |
| ERC-7857 Agent ID | All 8 metadata fields populated — part of agent's portable on-chain identity | PRIMARY — differentiator | 1-2h |
| 0G Storage | Evidence archive, both inference proof receipts | SECONDARY | 1h (SDK reused) |

**Why this passes the deep integration test:** Remove any single component and the product breaks. Two independent 0G Compute calls with separate verifiable receipt hashes is the deepest provable Compute usage without coordination-layer risk.

---

## DEMO SCRIPT (3 minutes)

**Pre-seeded agents (deploy 48h before demo):**
- Agent A: rapid fund drain pattern — transfers 95% of balance in 3 blocks → behavioral FLAGGED
- Agent B: reentrancy vulnerability in withdraw() function → code VULNERABLE
- Agent C: all clean → SAFE across both pipelines
- Agents D–H: varied scores across both dimensions (mix of CAUTION and SAFE)

**Minute 0:00–0:30 — Hook**
> "0G Labs has distributed $88.88M in ecosystem grants. Every grant-funded agent deployed on 0G Aristotle mainnet right now has no security layer. Any buyer, any protocol, any grant committee is operating blind. 0G Sentinel closes that gap."
> Show: Dashboard loads instantly. All ERC-7857 agents visible with dual badges — behavioral risk (GREEN/YELLOW/RED) and code risk (CLEAN/WARNING/VULNERABLE).

**Minute 0:30–1:15 — Live Behavioral Rescan**
> "Here's how behavioral scoring works — live, on mainnet."
> Show: Click "Rescan" on Agent A. 0G Compute call fires. 8–12 seconds. Receipt hash appears. Verdict: FLAGGED — fund drain pattern detected. Attestation timestamp updates. Receipt hash visible.

**Minute 1:15–2:00 — Live Code Scan**
> "The second thing every agent needs: is the contract code safe?"
> Show: Click "Code Scan" on Agent B. Second 0G Compute pipeline fires. 8–12 seconds. Receipt hash appears. Verdict: VULNERABLE — reentrancy at withdraw(). Finding written to ERC-7857 attestation field `code_findings`.

**Minute 2:00–2:30 — On-Chain Composability**
> "Both verdicts are on-chain. Any application reads them without trusting us."
> Show: 0G explorer — ERC-7857 iNFT with all 8 attestation fields. Show AgentGate.sol blocking Agent B's transaction: reverted — code_risk VULNERABLE.

**Minute 2:30–3:00 — Close**
> "0G Sentinel has scanned every AI agent on 0G Aristotle mainnet. Two verifiable pipelines. Two receipt hashes per agent. This is the security infrastructure the ecosystem needs from day one."
> Show: Attestation counter. GitHub link. Mainnet contract address.

**Demo requirements:**
- Pre-compute all scores 24h before demo. Cache everything.
- Lock 0G Compute model versions before final run.
- 10 calibration checks on both pipeline flows.
- Fallback: if live scan fails, show pre-computed attestations — both receipt hashes in explorer prove pipelines ran.

---

## BUILD SEQUENCE

### Day 1 (0–24h): Contracts + Both Pipelines

**Block 1 (0–2h): Contracts**
1. Fork AgentMesh. Create `0g-sentinel` branch.
2. Rename `AuditAttestation.sol` → `AttestationRegistry.sol`
3. Replace fields: `behavioral_score` (uint8), `threat_level` (uint8), `code_risk` (uint8), `code_findings` (string), `behavioral_receipt_hash` (bytes32), `code_receipt_hash` (bytes32), `evidence_hash` (bytes32), `attestation_timestamp` (uint256)
4. Keep `writeAttestation()` and `getAttestation()` patterns identical
5. Update `AgentRegistry.sol` to index ERC-7857 iNFTs from 0G mainnet
6. Deploy to testnet. 5 write/read tests. Then deploy to 0G Aristotle mainnet. Record addresses.

**Block 2 (2–5h): Behavioral pipeline**
1. Copy 0G Compute client from AgentMesh — no changes to API call pattern
2. Write behavioral prompt: agent_address, recent_txns, call_patterns, fund_flow → behavioral_score, threat_level, reasoning
3. Capture `receipt_hash` from response
4. Wire to attestation write
5. Test with 3 synthetic profiles: clean, suspicious, drain-pattern

**Block 3 (5–9h): Code vulnerability pipeline**
1. Copy reentrancy/access control prompt templates from AgentMesh specialist agents
2. Adapt: input is agent contract bytecode/source, output is code_risk (0=CLEAN/1=WARNING/2=VULNERABLE) + code_findings string
3. Second independent 0G Compute call — same receipt hash capture
4. Wire to attestation write
5. Test: deploy Agent B with known reentrancy — verify VULNERABLE classification

**Block 4 (9–11h): 0G Storage + evidence archive**
1. Copy 0G Storage client from AgentMesh
2. `archiveEvidence(agentAddress, behavioralData, codeAnalysisData)` → Log Layer
3. Return hash → store as `evidence_hash` in attestation
4. Test round-trip

**Block 5 (11–14h): End-to-end integration test**
1. Full pipeline: scan agent → behavioral call → code scan call → write attestation → archive evidence → read back
2. Verify both receipt hashes in attestation
3. Verify evidence hash resolves on 0G Storage
4. Do not proceed to Day 2 until this passes cleanly

---

### Day 2 (24–48h): Frontend + Demo Environment

**Block 6 (24–34h): Next.js dashboard**
1. Fork AgentMesh frontend. Adapt — don't redesign from scratch.
2. Agent listing feed — all ERC-7857 iNFTs on 0G mainnet
3. Dual badge per agent: behavioral risk (GREEN/YELLOW/RED) + code risk (CLEAN/WARNING/VULNERABLE)
4. Agent detail view: both scores, both receipt hashes, code findings, evidence link, timestamp
5. "Rescan" button — live behavioral pipeline trigger
6. "Code Scan" button — live code vulnerability pipeline trigger
7. Pre-load cached trust scores for instant display

**Block 7 (34–40h): Demo seeding**
1. Deploy Agents A–H to 0G Aristotle mainnet
2. Run full scan pipeline against all mainnet ERC-7857 agents
3. Cache all scores to dashboard
4. Verify all 8 attestation fields in 0G explorer per agent
5. Verify both receipt hashes traceable to 0G Compute
6. Verify evidence accessible from 0G Storage hashes

**Block 8 (40–44h): AgentGate.sol**
1. Write `AgentGate.sol`: reads `threat_level` and `code_risk`, reverts if either exceeds threshold
2. Deploy to mainnet
3. Verify: Agent B (VULNERABLE) transaction reverted

---

### Day 3 (48–72h): Polish + Submission

**Block 9 (48–58h): Polish**
1. Clean frontend — dual badge system, clear code findings display, professional design
2. Architecture diagram: two 0G Compute pipelines → ERC-7857 attestation
3. README: AgentMesh differentiation paragraph, contract addresses, deployment instructions
4. Chinese README translation

**Block 10 (58–64h): Final demo run**
1. Record 3-minute demo
2. Verify: both attestation fields visible in explorer with receipt hashes
3. Verify: AgentGate blocks VULNERABLE agent
4. Verify: 0G Storage evidence retrievable
5. 10 calibration checks on both pipeline flows

**Block 11 (64–72h): Submission**
1. Write HackQuest submission
2. Include: both contract addresses, GitHub link, demo video, architecture diagram
3. Pitch: "0G Sentinel is on-chain security infrastructure for AI agents. Two independent 0G Compute pipelines — behavioral risk scoring and smart contract vulnerability scanning — with composable ERC-7857 attestations the entire 0G ecosystem can consume. Built on the codebase that won the 0G Labs track at ETHGlobal."
4. Tracks: T1 (Agentic Infrastructure & OpenClaw Lab) + T2 (Agentic Trading Arena / Verifiable Finance)
5. Submit with buffer.

---

## RISK REGISTER

| # | Risk | Severity | Mitigation |
|---|------|:--------:|------------|
| R1 | 0G Compute latency makes live demo feel slow | CRITICAL | Pre-compute everything. One live rescan + one live code scan only. Fallback: show cached attestations with receipt hashes in explorer. |
| R2 | Code scan misclassifies Agent B during demo | HIGH | Agent B has a real, unambiguous reentrancy pattern in its contract. Test classification against this exact contract 10+ times before demo. Prompt outputs structured JSON — not ambiguous text. |
| R3 | No real behavioral anomalies on mainnet | HIGH | Pre-seed Agents A–H (Day 2 Block 7). Demo uses synthetic agents — not dependent on organic activity. |
| R4 | Dashboard looks sparse | HIGH | Pre-seed 8 agents. Scan ALL ERC-7857 tokens on 0G mainnet. 15–25 entries minimum before demo. |
| R5 | Contract bug discovered after mainnet deploy | MEDIUM | Deploy testnet first. Block 5 integration test must pass before mainnet deploy. |
| R6 | Judges ask "how is this different from AgentMesh?" | MEDIUM | README explicit comparison. Verbal answer ready: "AgentMesh audits developer code. 0G Sentinel audits live agents on mainnet and writes ERC-7857 attestations." |
| R7 | 0G Storage evidence archive fails | LOW | SECONDARY component. Cut from demo if it causes delays. Receipt hashes alone prove the pipelines ran. |
| R8 | Day 2 frontend runs long | LOW | AgentMesh frontend is the starting point. If time is short: minimal dashboard with attestation data visible is sufficient. Contracts and pipelines are the product. |

---

## NON-NEGOTIABLES

1. All ERC-7857 agents on 0G mainnet scanned and attested before demo
2. Two independent 0G Compute pipelines — both producing verifiable on-chain receipt hashes
3. All 8 ERC-7857 attestation metadata fields populated and visible in explorer
4. Pre-computed dashboard for instant load
5. One live behavioral rescan + one live code scan during demo
6. AgentGate.sol composability demo
7. AgentMesh differentiation explicit in README

---

## EXPLICIT OUT-OF-SCOPE

- ModelProof / model fingerprinting (probabilistic, gameable — dropped)
- Multi-agent coordination layer (no AXL, no WebSocket mesh)
- Contested verdict / Judge Agent escalation
- Scanning arbitrary contract addresses (ERC-7857 only)
- Cross-chain monitoring
- Token/staking/slashing
- Real-time transaction streaming
- Mobile app

---

## BACKUP PLAN — SafeStake

If 0G Compute proves unstable for dual pipelines, switch to SafeStake: agent deployers stake ERC-7857 tokens as collateral; a harm oracle triggers slashing if verified harm occurs; slashed funds go to harmed parties. Switch trigger: if Block 2 (behavioral pipeline) is not working by Hour 9 on Day 1.

---

## COMPETITION ANGLE

**Tracks:** T1 (Agentic Infrastructure & OpenClaw Lab) + T2 (Agentic Trading Arena / Verifiable Finance)

**Positioning:**
> "Every project in this hackathon builds a new application on 0G. 0G Sentinel builds the security layer that makes those applications trustworthy. Two independent 0G Compute pipelines. Composable ERC-7857 attestations any protocol can read without trusting our servers. Built on the codebase that won the 0G Labs track at ETHGlobal. This is the infrastructure the ecosystem needs from day one."

**Why this wins:**
- Two load-bearing 0G Compute pipelines with separate verifiable receipt hashes
- Builder has direct 0G codebase credibility (ETHGlobal 0G Labs winner)
- Code vulnerability scan findings are deterministic and verifiable — not probabilistic
- No confirmed competitors in behavioral risk + contract vulnerability attestation category
- AgentMesh plumbing means Day 1 starts from proven working 0G integration

---

## POST-HACKATHON PATH

1. **AIverse integration** — embed 0G Sentinel trust badges in every agent listing. Dual badge: behavioral risk + code risk.
2. **0G Labs ecosystem grant** — $88.88M program. Safety infrastructure they need to fund.
3. **OpenClaw integration** — trust gates before agent task assignment. "Hire verified agents only."
4. **Developer audit API** — expose the code vulnerability scan as a standalone API for agent developers who want a "verified" badge before listing.
