# 0G APAC HACKATHON — Ideas
**Generated:** 2026-05-13 (Warroom Phase 0.5)
**Deadline:** May 16, 2026, 23:59 UTC+8 (~72 hours)

## Selected: [AWAITING WARROOM DELIBERATION]

---

## Generation Stats
- Raw ideas generated: 18
- Killed by Kill List: 5 (broken deps, already-built, saturated)
- Killed by Demo Test: 2 (abstract demos, no visceral moment)
- Killed by score threshold (<12/25): 3
- Salvaged kernels: 4
- Final presented: 6

---

## Presented Ideas

### #1: ZeroOracle — Verifiable Private AI Prediction Network
**Score:** 32/35 — Ship [4] | Demo [5] | Sponsor [5] | Novel [5] | Memorable [5] | +Track [3] | +OnChain [5]

**Pitch:** A decentralized prediction market where an AI oracle reasons privately inside a TEE and produces on-chain verifiable outcomes — users can verify the AI made a specific prediction without ever seeing its reasoning process.

**Demo:** User opens ZeroOracle. They see a live "AI Judgment" request: "Will ETH break $4K this week?" They place a bet. Watch: the 0G Compute inference call fires (OpenAI-compatible endpoint, pointed at 0G), the TEE seal is captured, the result is posted to 0G Chain with a verifiable proof hash, the outcome is uploaded to 0G Storage. All in ~30 seconds. Judges see: verifiable inference in action, on-chain settlement, and a product anyone can understand.

**Targets:** Track 2 (Agentic Trading Arena) + Track 5 (Privacy & Sovereign Infrastructure)
**0G Integration Stack:**
- **Primary:** 0G Compute — verifiable AI inference via TEE (every prediction routed through 0G's compute with proof)
- **Secondary:** 0G Chain — bet settlement + result posting
- **Secondary:** 0G Storage — prediction history + proof archives + inference receipts
- **Secondary:** Agent ID (ERC-7857) — mint the oracle agent as an iNFT with its track record embedded
- **Optional:** 0G Private Computer — for explicitly TEE-gated inference path

**What This Becomes:** A universal verifiable AI oracle layer on 0G — any smart contract can query it for verified AI judgments. Prediction markets are the first application; insurance, governance, and compliance follow.

**The Shocking Number:** $80B prediction market industry. Zero players provide verifiable AI oracle judgments — all rely on crowd consensus or centralized APIs.

**The Risk:** 0G Compute verifiable inference setup (45-90 min, medium friction). Mitigation: start with OpenAI-compatible endpoint, add proof layer second. Fallback: use 0G Compute standard inference + manual TEE attestation if proof endpoint has issues.

**Why this wins:** Matches the ETHGlobal Cannes winner pattern exactly — AInfluencer routed every prompt through verifiable 0G Compute. This does the same but for predictions. Multi-track (T2+T5). Novel primitive on 0G. Demo is immediately visceral.

**Method:** recombination (DIVE oracle swarm + 0G verifiable compute + prediction market mechanics)

---

### #2: AgentWatch — 0G Agent Trust Scanner
**Score:** 31/35 — Ship [4] | Demo [5] | Sponsor [4] | Novel [5] | Memorable [5] | +Track [3] | +OnChain [5]

**Pitch:** An autonomous security scanner that evaluates the trustworthiness of AI agents deployed on 0G, produces on-chain trust attestations, and finds REAL security issues during the hackathon — not hypothetical risks.

**Demo:** Open AgentWatch. Click "Scan 0G Agents." System queries 0G Chain for deployed agent contracts, runs behavioral analysis via 0G Compute (OpenAI evaluating agent code + on-chain behavior), scores each agent on 5 trust dimensions, writes attestations on-chain. During the APAC hackathon itself, scan active agents — find real anomalies. Show judges: "We scanned 47 agents on 0G Aristotle mainnet. 8 show suspicious behavior patterns. Here are 3 on-chain attestation hashes proving our analysis."

**Targets:** Track 1 (Agentic Infrastructure) + Track 5 (Privacy & Sovereign Infrastructure)
**0G Integration Stack:**
- **Primary:** 0G Compute — AI behavioral analysis of agent code and on-chain activity
- **Primary:** 0G Chain — on-chain trust attestation writes (3,000+ attestations = overwhelming on-chain proof)
- **Secondary:** Agent ID (ERC-7857) — identity layer for agents being scanned
- **Secondary:** 0G Storage — evidence archive for each agent's trust report

**What This Becomes:** The trust layer for the entire 0G agent ecosystem — every agent marketplace, every agent hiring system would integrate AgentWatch scores before deploying agents.

**The Shocking Number:** 40% of on-chain transactions are now from autonomous agents. Zero verifiable trust infrastructure exists for them on 0G.

**The Risk:** Getting enough agents to scan on mainnet during the hackathon. Mitigation: scan testnet + mainnet, include our own demo agents, deploy a "honeypot agent" with known bad behavior to prove the system catches it.

**Why this wins:** Sentinel8004 (Synthesis Hackathon) won 2 tracks by finding 1,797 real sybil wallets. Same pattern, 0G-native. Security = underserved (~8% of teams) but high win rate. The live hackathon scan is the ultimate demo.

**Method:** external-injection (Sentinel8004 pattern transplanted to 0G ecosystem)

---

### #3: ZeroProof — Verifiable AI Trading Agent
**Score:** 27/35 — Ship [4] | Demo [4] | Sponsor [4] | Novel [3] | Memorable [4] | +Track [3] | +OnChain [5]

**Pitch:** An AI trading agent where every market analysis and trade decision is verifiable on-chain via 0G Compute — the agent can't lie about its reasoning, and users can audit every decision.

**Demo:** Open ZeroProof. Agent is running on 0G Aristotle mainnet. User sees: live market analysis happening via 0G Compute (verifiable inference call visible). Agent makes a trade on a DEX. The inference proof is uploaded to 0G Storage. The Agent ID (ERC-7857) acts as the agent's on-chain identity, accumulating a trade history. Judges see: "This agent has made 15 trades. Every single decision has a verifiable proof. Here's the inference receipt for trade #7."

**Targets:** Track 2 (Agentic Trading Arena) + Track 1 (Agentic Infrastructure)
**0G Integration Stack:**
- Primary: 0G Compute (verifiable AI inference for every trade decision)
- Secondary: 0G Chain (trade execution, agent settlement)
- Secondary: 0G Storage (inference proof archive + trade history)
- Secondary: Agent ID (ERC-7857) (agent identity with reputation)
- Optional: Chainlink price feeds (ecosystem partner for market data)

**The Risk:** DeFi agent category has 50-80 teams. Differentiation relies on the verifiable inference being demonstrably deep. Mitigation: make the verifiable proof the CENTERPIECE of the demo, not a footnote.

**Why this wins:** ETHGlobal Cannes winner pattern — AInfluencer won 1st by using 0G Compute for every action. Same here for trading. Strong T2 position.

**Method:** constraint-D (demo impact — "watch your trades get verified on-chain")

---

### #4: CascadeGuard — AI Cascade Prevention for 0G DeFi
**Score:** 26/35 — Ship [4] | Demo [4] | Sponsor [4] | Novel [3] | Memorable [4] | +Track [3] | +OnChain [4]

**Pitch:** Real-time AI-powered risk monitoring for DeFi protocols on 0G Chain. Uses 0G Compute to detect cascade patterns before they trigger and autonomously pauses risky activity — the system that prevents the next $400M liquidation event.

**Demo:** Deploy a simulated DeFi scenario on testnet where an AI agent starts making increasingly aggressive trades. CascadeGuard (running on 0G Compute) detects the pattern, triggers a circuit breaker on 0G Chain, and posts an on-chain warning with the analysis. Judges see: "On February 3, 2026, $400M was liquidated in 4 hours. CascadeGuard would have triggered a pause 47 minutes before the first liquidation."

**Targets:** Track 2 (Agentic Trading Arena) + Track 1 (Agentic Infrastructure)
**0G Integration Stack:**
- Primary: 0G Compute (AI anomaly detection on trading patterns)
- Primary: 0G Chain (circuit breaker smart contracts, automated pause/resume)
- Secondary: 0G Storage (behavioral history archive)
- Secondary: Agent ID (identifying which agents are high-risk)

**The Risk:** T2 is MEDIUM density. Differentiation from generic "risk management bot" requires the Feb 2026 cascade as specific narrative and verifiable 0G integration.

**Method:** problem-first (Feb 2026 $400M AI cascade is the specific problem statement)

---

### #5: HealthGuard — TEE-Private AI Health Assistant for APAC
**Score:** 26/35 — Ship [4] | Demo [4] | Sponsor [5] | Novel [5] | Memorable [4] | +Track [0] | +OnChain [3]

**Pitch:** AI health assistant for APAC users where medical queries run inside a TEE — the AI answers your health questions but your symptoms are never exposed to any server, provider, or third party.

**Demo:** User enters symptoms in the app. Watch: query routes to 0G Private Computer (TEE inference), result returned with a TEE attestation — proof that no human or server saw the raw query. The Agent ID (ERC-7857) is the health assistant agent, with its credentials and model version on-chain. 0G Storage holds encrypted health history. Judges see: "1.4 billion APAC residents. Zero privacy-preserving AI health tools they can trust."

**Targets:** Track 5 (Privacy & Sovereign Infrastructure) — lowest competition density
**0G Integration Stack:**
- Primary: 0G Private Computer / TEE (confidential inference — core value prop)
- Primary: 0G Compute (AI health query processing)
- Secondary: Agent ID (ERC-7857) (health assistant identity + credential)
- Secondary: 0G Storage (encrypted health records, AES-256-CTR)
- Secondary: 0G Chain (consent management, access logs)

**The Shocking Number:** 1.4B APAC residents. $500B APAC digital health market. Zero apps provide TEE-verified AI health advice.

**The Risk:** 0G Private Computer TEE documentation is sparse (noted in Kill List: "High friction, sparse docs"). Mitigation: use 0G Compute as the AI layer, add TEE attestation via standard Intel SGX if 0G Private Computer docs are insufficient. Claude Code handles this.

**Why this wins:** Track 5 = lowest competition. ETHGlobal Cannes 2nd place (PrivyCycle) was health data + 0G Compute AI. This takes that pattern to Track 5 with TEE. APAC community award angle.

**Method:** problem-first + external-injection (PrivyCycle pattern + APAC healthcare gap)

---

### #6: AgentPassport — ERC-7857 Reputation & Credential System
**Score:** 24/35 — Ship [4] | Demo [3] | Sponsor [4] | Novel [4] | Memorable [3] | +Track [5] | +OnChain [3]

**Pitch:** The first verifiable reputation layer built on 0G's Agent ID standard (ERC-7857) — agents accumulate a portable credential history that any app can verify before deploying or hiring them.

**Demo:** Mint two agents as Agent IDs on 0G. First agent has completed 50 tasks with verifiable proofs stored on 0G Storage. Second agent is brand new. User "hires" agent for a task — see the reputation score (computed via 0G Compute) factored into a hiring decision. The hiring contract on 0G Chain checks Agent ID reputation before releasing payment.

**Targets:** Track 1 (Agentic Infrastructure) + Track 3 (Agentic Economy) + Track 2 (trading agent credentials)
**0G Integration Stack:**
- Primary: Agent ID (ERC-7857) deep integration — reputation fields + credential metadata
- Secondary: 0G Storage (task history, performance evidence)
- Secondary: 0G Compute (AI-powered reputation scoring)
- Secondary: 0G Chain (hiring contract, credential checks)

**The Risk:** Demo is less visceral than top ideas. Reputation systems are familiar concepts. Differentiation: this is the FIRST ERC-7857 application beyond AIverse — judges value "firsts."

**Method:** constraint-F (market gap — ERC-7857 exists but no reputation layer built on it)

---

## Honorable Mentions (Scored 20-23)
- **APAC Remittance Agent** — M2M payments for migrant workers via 0G Pay + Agent ID. T3. Strong real-world impact ($18-24B annual remittance fees). Killed by Demo Test (payment flows are less visceral).
- **TEE Creator Economy** — APAC creator monetization with private AI coaching via 0G Private Computer. T3+T4. Killed by scope (requires both social + privacy implementations).

---

## Killed Ideas (Notable)

| Idea | Method | Kill Reason |
|------|--------|-------------|
| 0G Model Bazaar | recombination | BROKEN DEPENDENCY: Fine-tuning CLI is early dev; too risky as core feature |
| Generic AI Agent Framework | method-1 | SATURATED: Kill List category 1 — most teams targeting this |
| AIverse Clone | method-2 | ALREADY BUILT: AIverse marketplace exists on mainnet |
| 0G App Clone | method-6 | ALREADY BUILT: 0G App launched April 14, 2026 |
| Generic Yield Aggregator | method-3 | SATURATED + Zero 0G differentiation |
| AI Chatbot with 0G Storage | method-6 | SATURATED + Bolted-on 0G use |
| Standard NFT Collection | method-1 | ZERO ALIGNMENT with judging criteria |

---

## Salvaged Kernels
1. **Verifiable inference as attestation** — any idea that uses 0G Compute should expose the inference receipt as an on-chain hash. Use this in ZeroOracle, AgentWatch, ZeroProof.
2. **Judge-optimized proof flow** — from Spawn Protocol pattern: build a `/verify` button that runs the full lifecycle in <4 min with tx hashes. Apply to ALL finalist ideas.
3. **Agent ID reputation accumulation** — add this as a secondary feature to any idea that uses agents. Doesn't require a dedicated project.
4. **Honeypot agent technique** — from AgentWatch: deploy an intentionally vulnerable agent to prove the scanner catches it. Apply to any security-adjacent idea.
