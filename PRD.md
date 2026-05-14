# 0G Sentinel — Product Requirements Document

## [EMERGENCY MODE — 3 components mocked: real-time streaming, token staking, multi-agent coordination]

**Hackathon:** 0G APAC Hackathon
**Track:** T1 (Agentic Infrastructure & OpenClaw Lab) + T2 (Agentic Trading Arena / Verifiable Finance)
**Deadline:** May 16, 2026, 23:59 UTC+8 (≈2 days remaining)
**Version:** V1 (Emergency scope — demo-first)

---

## Emergency Mode Notice

The following components are [MOCK] and will NOT be built:
- [MOCK] Real-time agent transaction streaming (would require persistent websocket infrastructure)
- [MOCK] Token staking / slashing mechanism (post-hackathon roadmap)
- [MOCK] Multi-agent coordination layer (Sentinel Swarm V3 architecture — explicitly cut)

All [MOCK] components appear in the Risk Register as [C] Critical with mitigation note.

---

## 1. Project Overview

### One-Liner

0G Sentinel is on-chain security infrastructure that runs two independent AI-powered analysis pipelines on every ERC-7857 AI agent on 0G mainnet and writes verifiable attestations to the chain, so any buyer, protocol, or application can verify whether an agent is safe before trusting it with real money.

### Problem Statement

AI agents on 0G Aristotle mainnet are being bought, hired, and trusted with real money. There is no security layer. Two questions have no on-chain answers for any agent:

1. **Is this agent's behavior safe?** No record of fund flow patterns, call frequency, or anomalous access exists on-chain.
2. **Is this agent's contract code safe?** No verified code audit exists for any deployed agent contract.

The 0G AI ecosystem is 2 months old — AIverse launched March 2026, the 0G App launched April 2026. Security infrastructure must exist before malicious agents proliferate and distrust kills the ecosystem's nascent liquidity. **The one shocking number: $88.88M in 0G Labs ecosystem grants are at stake — every grant-funded agent that turns malicious is a $88.88M liability without a trust layer.**

### Solution

0G Sentinel runs two 0G Compute inference pipelines against every ERC-7857 iNFT on 0G mainnet:
- **Pipeline 1 — Behavioral Analysis:** Analyzes fund flow patterns and transaction history to produce a risk score (0–100) and threat classification (SAFE / CAUTION / FLAGGED). Returns a verifiable 0G Compute receipt hash.
- **Pipeline 2 — Code Vulnerability Scan:** Analyzes the agent's smart contract for reentrancy, broken access control, dangerous delegatecall, and unprotected selfdestruct. Returns code_risk (CLEAN / WARNING / VULNERABLE) and specific findings. Returns a separate receipt hash.

Both verdicts are written as ERC-7857 attestation fields on 0G Chain — part of the agent's portable on-chain identity. Any downstream application reads the attestation without calling 0G Sentinel's servers. `AgentGate.sol` demonstrates composability by blocking FLAGGED or VULNERABLE agents from executing transactions.

### Why This Wins

| Judging Criterion | Weight | How We Excel |
|---|:---:|---|
| 0G Technical Integration Depth & Innovation | ~30% | 2 independent 0G Compute calls + 0G Chain writes + ERC-7857 + 0G Storage. Remove any one component and the product breaks. |
| Technical Implementation & Completeness | ~25% | Working contracts deployed to mainnet. Both pipelines functional. Dashboard live. AgentGate composability demo. Built on AgentMesh (proven 0G winner codebase). |
| Product Value & Market Potential | ~20% | Security infrastructure the ecosystem needs from day 1. AIverse integration path. OpenClaw trust gates. 0G Labs grant applications need this to audit funded agents. |
| User Experience & Demo Quality | ~15% | Pre-seeded agents for instant visual. Live rescan + code scan in 3-minute demo. Explorer verification. Dual badge system. |
| Team Capability & Documentation | ~10% | Builder won 0G Labs track at ETHGlobal. AgentMesh README differentiation. Chinese README. Architecture diagram. |

---

## 2. System Architecture Overview

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    0G SENTINEL SYSTEM                           │
│                                                                  │
│  User / Protocol / dApp                                          │
│        │                                                         │
│        ▼                                                         │
│  ┌─────────────┐    reads attestations    ┌──────────────────┐  │
│  │  Next.js    │ ◄──────────────────────  │ AttestationReg.  │  │
│  │  Dashboard  │                          │ (0G Chain)       │  │
│  │  [Frontend] │                          │ ERC-7857 fields  │  │
│  └──────┬──────┘                          └────────┬─────────┘  │
│         │  trigger scan                            │ writeAttestation()│
│         ▼                                          │             │
│  ┌──────────────┐  Pipeline 1: Behavioral          │             │
│  │  Scanner     │ ──► 0G Compute API ──► receipt1 ─┤             │
│  │  Service     │  Pipeline 2: Code Scan           │             │
│  │  [Backend]   │ ──► 0G Compute API ──► receipt2 ─┘             │
│  └──────┬───────┘                                                │
│         │ archiveEvidence()                                      │
│         ▼                                                        │
│  ┌──────────────┐                    ┌──────────────────────┐   │
│  │  0G Storage  │                    │  AgentGate.sol       │   │
│  │  Log Layer   │                    │  reads threat_level  │   │
│  │  [Evidence]  │                    │  reverts FLAGGED/    │   │
│  └──────────────┘                    │  VULNERABLE agents   │   │
│                                      └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Table

| Component | Type | Purpose | Key Dependencies |
|-----------|------|---------|-----------------|
| `AttestationRegistry.sol` | Solidity contract | Write/read 8-field ERC-7857 attestations | 0G Chain, AgentRegistry |
| `AgentRegistry.sol` | Solidity contract | Index all ERC-7857 iNFTs from 0G mainnet | 0G Chain, ERC-7857 contract |
| `AgentGate.sol` | Solidity contract | Read attestation, revert FLAGGED/VULNERABLE | AttestationRegistry |
| Scanner Service | TypeScript backend | Orchestrate both pipelines, write attestation | 0G Compute API, @0glabs/0g-ts-sdk, ethers.js |
| Next.js Dashboard | Frontend | Display agents, badges, trigger live scans | Scanner Service API, AttestationRegistry |
| 0G Storage Client | SDK module | Archive evidence + receipt hashes | @0glabs/0g-ts-sdk |

### Data Flow

1. The Scanner Service queries `AgentRegistry.sol` to get all ERC-7857 iNFT addresses on 0G mainnet.
2. For each agent, it fetches on-chain activity data (fund flows, call patterns) and contract source/bytecode.
3. **Pipeline 1:** Scanner calls 0G Compute API (OpenAI-compatible) with behavioral prompt → receives `{behavioral_score, threat_level, reasoning}` + receipt hash.
4. **Pipeline 2:** Scanner calls 0G Compute API with code vulnerability prompt → receives `{code_risk, code_findings}` + receipt hash.
5. Scanner calls `archiveEvidence()` on 0G Storage Log Layer → receives `evidence_hash`.
6. Scanner calls `writeAttestation()` on `AttestationRegistry.sol` → writes all 8 fields to 0G Chain.
7. Next.js Dashboard reads attestations directly from `AttestationRegistry.sol` and displays dual badges.
8. Any protocol calls `AgentGate.sol` which reads `threat_level` / `code_risk` from the registry and reverts FLAGGED or VULNERABLE agents.

---

## 3. User Flows

### Flow 1: View Agent Security Status (primary read path)
1. User opens dashboard at `/agents`
2. Dashboard fetches all ERC-7857 iNFT addresses from `AgentRegistry.sol`
3. For each agent, dashboard reads attestation fields from `AttestationRegistry.sol`
4. Agent cards display: name, address, behavioral badge (GREEN/YELLOW/RED), code badge (CLEAN/WARNING/VULNERABLE), last scan timestamp
5. User clicks agent → detail view shows behavioral_score, threat_level, code_findings, both receipt hashes, evidence link, timestamp

### Flow 2: Live Behavioral Rescan (demo highlight — Pipeline 1)
1. User clicks "Rescan" on any agent card
2. Dashboard calls `POST /api/scan/behavioral` with agentAddress
3. Scanner Service fetches agent's recent on-chain activity
4. Scanner calls 0G Compute API with behavioral analysis prompt
5. Response: `{behavioral_score, threat_level, reasoning, receipt_hash}`
6. Scanner archives evidence to 0G Storage → `evidence_hash`
7. Scanner calls `writeAttestation()` on `AttestationRegistry.sol`
8. Dashboard polls for updated attestation → displays new badge + receipt hash
9. User sees receipt hash — can verify in 0G explorer

### Flow 3: Live Code Vulnerability Scan (demo highlight — Pipeline 2)
1. User clicks "Code Scan" on any agent card
2. Dashboard calls `POST /api/scan/code` with agentAddress
3. Scanner fetches agent contract source/bytecode
4. Scanner calls 0G Compute API with code vulnerability prompt
5. Response: `{code_risk, code_findings, receipt_hash}`
6. Scanner writes `code_risk`, `code_findings`, `code_receipt_hash` to attestation
7. Dashboard updates code badge → shows specific findings (e.g., "VULNERABLE — reentrancy at withdraw()")

### Flow 4: On-Chain Composability (demo highlight — AgentGate)
1. Protocol/dApp calls `AgentGate.executeIfSafe(agentAddress, calldata)`
2. `AgentGate.sol` reads `threat_level` and `code_risk` from `AttestationRegistry.sol`
3. If `threat_level == FLAGGED` OR `code_risk == VULNERABLE`: transaction reverts with reason
4. If both pass: calldata is executed on the agent
5. Demo: Agent B (VULNERABLE) → reverted. Agent C (SAFE) → executes.

### Demo Sequence Diagram
```
Dashboard -> AttestationRegistry: getAttestation(agentAddress)
AttestationRegistry -> Dashboard: {behavioral_score, threat_level, code_risk, code_findings, receipt_hash×2, evidence_hash, timestamp}
User -> Dashboard: click "Rescan" on Agent A
Dashboard -> ScannerAPI: POST /api/scan/behavioral {agentAddress}
ScannerAPI -> 0GCompute: inference(behavioral_prompt, agent_activity_data)
0GCompute -> ScannerAPI: {verdict, receipt_hash}
ScannerAPI -> 0GStorage: upload(evidence_data)
0GStorage -> ScannerAPI: evidence_hash
ScannerAPI -> AttestationRegistry: writeAttestation(agentAddress, fields)
AttestationRegistry -> 0GChain: emit AttestationWritten(agentAddress, ...)
Dashboard -> User: "FLAGGED — fund drain pattern detected" + receipt_hash
User -> Dashboard: click "Code Scan" on Agent B
Dashboard -> ScannerAPI: POST /api/scan/code {agentAddress}
ScannerAPI -> 0GCompute: inference(code_vuln_prompt, contract_source)
0GCompute -> ScannerAPI: {VULNERABLE, "reentrancy at withdraw()", receipt_hash}
ScannerAPI -> AttestationRegistry: updateCodeFields(agentAddress, code_risk, code_findings, code_receipt_hash)
Dashboard -> User: "VULNERABLE — reentrancy at withdraw()" + receipt_hash
User -> AgentGate: executeIfSafe(Agent_B, calldata)
AgentGate -> AttestationRegistry: getAttestation(Agent_B)
AttestationRegistry -> AgentGate: code_risk = VULNERABLE
AgentGate -> User: revert("Agent code_risk: VULNERABLE")
```

---

## 4. Technical Specifications

### 4.1 AttestationRegistry.sol

**Purpose:** Store and retrieve 8-field ERC-7857 security attestations for AI agents on 0G Chain.

**Interface (spec — implementation in ARCHITECTURE.md):**
```solidity
interface IAttestationRegistry {
    struct Attestation {
        uint8 behavioral_score;      // 0-100 risk score
        uint8 threat_level;          // 0=SAFE, 1=CAUTION, 2=FLAGGED
        uint8 code_risk;             // 0=CLEAN, 1=WARNING, 2=VULNERABLE
        string code_findings;        // e.g., "reentrancy at withdraw()"
        bytes32 behavioral_receipt_hash;  // 0G Compute receipt
        bytes32 code_receipt_hash;        // 0G Compute receipt
        bytes32 evidence_hash;            // 0G Storage hash
        uint256 attestation_timestamp;
    }

    function writeAttestation(address agentAddress, Attestation calldata attestation) external;
    function getAttestation(address agentAddress) external view returns (Attestation memory);
    function hasAttestation(address agentAddress) external view returns (bool);

    event AttestationWritten(address indexed agentAddress, uint8 threat_level, uint8 code_risk, uint256 timestamp);
}
```

**Key constraints:**
- Only authorized scanners can call `writeAttestation()` (owner + authorized list)
- `attestation_timestamp` is set on-chain using `block.timestamp`
- All agents addressed as EOA or contract addresses of ERC-7857 iNFTs

### 4.2 AgentRegistry.sol

**Purpose:** Maintain an index of known ERC-7857 iNFT addresses for scanning.

**Interface:**
```solidity
interface IAgentRegistry {
    function registerAgent(address agentAddress, uint256 tokenId) external;
    function getAllAgents() external view returns (address[] memory);
    function getAgentCount() external view returns (uint256);
    event AgentRegistered(address indexed agentAddress, uint256 tokenId);
}
```

**Note:** Pre-populated at deployment time with known AIverse iNFT addresses + Agents A-H seed addresses.

### 4.3 AgentGate.sol

**Purpose:** Composability consumer — reads attestation and gates execution.

**Interface:**
```solidity
interface IAgentGate {
    function executeIfSafe(address agentAddress, address target, bytes calldata calldata_) external returns (bytes memory);
    function isSafe(address agentAddress) external view returns (bool safe, string memory reason);
}
```

**Pass criteria:** `threat_level <= 1 AND code_risk <= 1` (SAFE or CAUTION on behavioral; CLEAN or WARNING on code)

### 4.4 Scanner Service API

**Purpose:** TypeScript backend that orchestrates both pipelines. Exposes REST endpoints for dashboard.

**Endpoints:**
```
POST /api/scan/behavioral     { agentAddress: string }
  → { behavioral_score, threat_level, reasoning, receipt_hash, evidence_hash, tx_hash }

POST /api/scan/code           { agentAddress: string }
  → { code_risk, code_findings, receipt_hash, tx_hash }

POST /api/scan/full           { agentAddress: string }
  → { behavioral: {...}, code: {...}, attestation_tx_hash }

GET  /api/agents              → { agents: AgentWithAttestation[] }
GET  /api/agents/:address     → AgentWithAttestation
GET  /api/health              → { status: "ok", compute_endpoint: string }
```

**Data types:**
```typescript
interface AgentWithAttestation {
  address: string;
  tokenId: number;
  name: string;
  behavioral_score: number;    // 0-100
  threat_level: 0 | 1 | 2;    // SAFE | CAUTION | FLAGGED
  code_risk: 0 | 1 | 2;       // CLEAN | WARNING | VULNERABLE
  code_findings: string;
  behavioral_receipt_hash: string;
  code_receipt_hash: string;
  evidence_hash: string;
  attestation_timestamp: number;
  last_scanned_at: string;
}
```

### 4.5 0G Compute Integration

**Provider:** 0G Compute Network — OpenAI-compatible endpoint
**Pattern:** Standard `openai` npm package, custom base URL

**Behavioral Analysis Prompt Schema:**
```json
{
  "model": "Llama-3.1-70B-Instruct",
  "messages": [
    {
      "role": "system",
      "content": "You are a blockchain agent security auditor. Analyze the provided agent activity data and return a JSON object with: behavioral_score (0-100), threat_level (SAFE|CAUTION|FLAGGED), reasoning (string). Be conservative — only flag clear anomalies."
    },
    {
      "role": "user",
      "content": "Agent: {address}. Activity: {fund_flows_json}. Fund transfers in last 30 days: {transfer_count}. Largest single transfer: {max_transfer_pct}% of balance. Contract calls: {call_patterns}."
    }
  ],
  "response_format": { "type": "json_object" }
}
```

**Code Vulnerability Scan Prompt Schema:**
```json
{
  "model": "Llama-3.1-70B-Instruct",
  "messages": [
    {
      "role": "system",
      "content": "You are a smart contract security auditor. Analyze the provided Solidity source code for: reentrancy vulnerabilities, broken access control, unprotected selfdestruct, dangerous delegatecall, and integer overflow risks. Return JSON: code_risk (CLEAN|WARNING|VULNERABLE), code_findings (string — specific finding with function name if vulnerable, empty if clean)."
    },
    {
      "role": "user",
      "content": "Contract address: {address}. Source code:\n\n{solidity_source}"
    }
  ],
  "response_format": { "type": "json_object" }
}
```

**Receipt hash capture:** The 0G Compute response includes a receipt hash in the response headers/body confirming the specific inference run. This hash is stored in `behavioral_receipt_hash` or `code_receipt_hash`.

### 4.6 0G Storage Integration

**Purpose:** Archive raw behavioral evidence and both inference receipts for independent verification.

**SDK:** `@0glabs/0g-ts-sdk`

**Upload schema:**
```typescript
interface EvidenceArchive {
  agent_address: string;
  scan_timestamp: number;
  behavioral_data: {
    activity_summary: object;
    raw_transactions: object[];
  };
  behavioral_receipt: string;  // 0G Compute receipt JSON
  code_receipt: string;        // 0G Compute receipt JSON
}
```

**Returns:** `evidence_hash: string` (stored in attestation `evidence_hash` field)

---

## 5. API Contracts (External)

### 5.1 0G Compute API
- **Endpoint:** `https://router-api.0g.ai/v1` (mainnet) [VERIFIED — url_preverify]
- **Auth:** API key in `Authorization: Bearer {key}` via `@0gfoundation/0g-compute-ts-sdk` broker
- **Format:** OpenAI-compatible (`/chat/completions`)
- **Model:** `Llama-3.1-70B-Instruct` (confirmed supported model)
- **Receipt hash mechanism:** TEE-signed routing proof captured via `@0gfoundation/0g-compute-ts-sdk` (v0.8.3). The broker bundles request hash + response hash + provider TLS fingerprint + provider identity into a signed proof. NOT a simple HTTP response header. Use `broker.getRequestHeaders()` to generate the billing proof before each call. Store the proof hash as `behavioral_receipt_hash` / `code_receipt_hash`. [VERIFIED architecture — exact method names: test on Day 1]
- **SDK:** Use `@0gfoundation/0g-compute-ts-sdk` v0.8.3 (NOT `@0glabs/0g-serving-broker` which is DEPRECATED shim)
- **Risk:** Latency 8-15 seconds per call. Pre-compute everything. Live demo: 2 calls max.

### 5.2 0G Chain RPC
- **Mainnet RPC:** `https://evmrpc.0g.ai` [VERIFIED — PULSE.md]
- **Testnet RPC (dev):** `https://evmrpc-testnet.0g.ai` [VERIFIED — PULSE.md]
- **Chain ID:** Mainnet **16661** (0x4115), Galileo testnet **16602** (0x40da) [VERIFIED — live eth_chainId calls + ChainList]
- **Explorer:** Mainnet `https://chainscan.0g.ai` | Testnet `https://chainscan-galileo.0g.ai` [VERIFIED — url_preverify]
- **Risk:** ~~Mainnet chain ID unknown~~ RESOLVED.

### 5.3 0G Storage API
- **SDK:** `@0glabs/0g-ts-sdk` npm package [VERIFIED — PULSE.md]
- **Method:** `uploadFile(data)` or `upload(Buffer)` → returns hash [UNVERIFIED — exact method name]
- **Risk:** SDK method signatures unknown — test against 0G Storage docs on Day 1.

### 5.4 AgentMesh Codebase (Build Foundation)
- **Repo:** `github.com/dmustapha/agentmesh` (builder's own repo, ETHGlobal winner)
- **Components reused:** 0G Compute client, AuditAttestation.sol pattern, 0G Storage client, reentrancy/access control prompt templates, deployment scripts
- **Risk:** NONE — builder has full access and intimate knowledge.

---

## 6. Demo Script (3 Minutes)

### Pre-demo requirements
- Agents A-H deployed to 0G Aristotle mainnet, all scanned, attestations written
- Dashboard deployed and pre-loaded with cached attestations
- Lock 0G Compute model versions
- 10 calibration checks on both pipeline flows

**Scene 1: Hook (0:00–0:30)**
> "0G Labs has distributed $88.88M in ecosystem grants. Every grant-funded agent deployed on 0G Aristotle mainnet right now has no security layer. Any buyer, any protocol, any grant committee is operating blind. 0G Sentinel closes that gap."

Show: Dashboard loads instantly. 8+ agents visible with dual badges — behavioral risk (GREEN/YELLOW/RED) and code risk (CLEAN/WARNING/VULNERABLE). Agent A shows RED FLAGGED. Agent B shows VULNERABLE. Agent C shows all-green SAFE. The visual is immediate.

**Scene 2: Live Behavioral Rescan (0:30–1:15)**
> "Here's how behavioral scoring works — live, on mainnet."

Show: Click "Rescan" on Agent A. 0G Compute call fires. Timer shows ~10 seconds. Receipt hash appears. Verdict: FLAGGED — fund drain pattern detected. Behavioral score: 87. Receipt hash visible — click to verify on 0G explorer.

> "That hash proves exactly what model ran, what input it received, and what verdict it produced. Cryptographically verifiable."

**Scene 3: Live Code Scan (1:15–2:00)**
> "The second pipeline: is the contract code safe?"

Show: Click "Code Scan" on Agent B. Second 0G Compute pipeline fires. Timer: ~10 seconds. Verdict: VULNERABLE — reentrancy at withdraw(). Finding written to ERC-7857 attestation field `code_findings`. Receipt hash visible.

> "Deterministic findings. No probabilistic inference — this contract has a real reentrancy vulnerability, and now it's part of the agent's on-chain identity forever."

**Scene 4: On-Chain Composability (2:00–2:30)**
> "Both verdicts are on-chain. Any application reads them without trusting our servers."

Show: 0G Chain explorer — ERC-7857 iNFT metadata for Agent B with all 8 attestation fields visible. Then: AgentGate.sol demo — attempt to execute transaction through Agent B → revert: "Agent code_risk: VULNERABLE."

**Scene 5: Close (2:30–3:00)**
> "0G Sentinel has scanned every AI agent on 0G Aristotle mainnet. Two verifiable pipelines. Two receipt hashes per agent. The security infrastructure the ecosystem needs from day one."

Show: Dashboard with full agent list. Attestation counter. GitHub link. Mainnet contract address.

### Voice & Copy Notes
- No em dashes in voiceover
- Direct, technical, confident language
- Numbers are specific: "87" not "high score"
- No filler: "Let's see what happens" type phrases deleted

---

## 7. Risk Register

| # | Risk | Severity | Likelihood | Impact | Mitigation |
|---|------|:--------:|:----------:|:------:|------------|
| R1 | 0G Compute latency makes live demo feel slow | CRITICAL | HIGH | Demo loses momentum | Pre-compute everything. TWO live calls max (1 behavioral + 1 code scan). Hard cutoff: if call doesn't return in 20s, show fallback. Fallback: cached attestation with receipt hashes visible in explorer. |
| R2 | Code scan misclassifies Agent B during live demo | CRITICAL | MEDIUM | Demo loses credibility | Agent B has a real, unambiguous reentrancy pattern. Test classification against this exact contract 10+ times before demo. Structured JSON output — not ambiguous text. |
| R3 | 0G Chain mainnet chain ID unknown — deploy fails | CRITICAL | MEDIUM | No mainnet contracts | Verify mainnet chain ID on Day 1, 9:00 AM. Add to Hardhat config before writing any other code. |
| R4 | 0G Compute receipt hash field name unknown | HIGH | MEDIUM | Receipt hash can't be captured | Check API response headers and body on first test call. If `x-compute-receipt-hash` doesn't exist, hash response body as fallback proof. |
| R5 | 0G Storage SDK upload method name wrong | HIGH | MEDIUM | Evidence archive fails | Test SDK on Day 1. Check npm docs for `@0glabs/0g-ts-sdk` exact method. Evidence archive is SECONDARY — if it fails, cut from demo, receipt hashes alone prove pipelines ran. |
| R6 | Dashboard looks sparse | HIGH | MEDIUM | Weak visual impression | Pre-seed Agents A-H. Scan ALL ERC-7857 tokens on 0G mainnet. 15+ entries minimum. |
| R7 | Judges ask "how is this different from AgentMesh?" | HIGH | HIGH | Score penalty on uniqueness | README explicit comparison paragraph. Verbal answer ready: "AgentMesh audits developer code. 0G Sentinel audits live agents on mainnet and writes ERC-7857 attestations." |
| R8 | ERC-7857 interface doesn't support custom metadata fields | HIGH | MEDIUM | Attestation layer requires redesign | Primary fallback: write custom `AttestationRegistry.sol` mapping entirely, reference the iNFT address as key. ERC-7857 reference only in naming, not as inheritance. |
| R9 | [MOCK] Real-time streaming not built | CRITICAL | N/A — intentional | Replace mock with real implementation before production | [MOCK] Not in scope. Polling + pre-computed cache is the demo pattern. |
| R10 | Day 3 frontend runs long | MEDIUM | MEDIUM | Submission without polished UI | AgentMesh frontend is starting point. Minimal dashboard with attestation data visible is sufficient. Contracts and pipelines are the product. |

### Minimum 6 risk categories covered:
- Technical: R3, R4, R5, R8
- Demo: R1, R2, R6
- Competitive: R7
- Time: R10
- Scope: R9
- Judging: R7

---

## 7.5 Judge Experience

**First-visit state:** Dashboard at `/agents` shows full grid of agents with dual badges. No login wall, no empty state. Pre-seeded Agent A (FLAGGED/CLEAN), Agent B (SAFE/VULNERABLE), Agent C (all SAFE), plus 5+ real mainnet iNFTs with their actual scores.

**Seed script requirements (`scripts/seed-demo.ts`):**
- Deploy 3 named test agents (Agent A, B, C) with known vulnerability profiles
- Run full scan pipeline against all 3 (behavioral + code)
- Verify all 8 attestation fields on-chain
- Deploy 5+ additional agents with varied scores (D-H) for dashboard density
- Cache all attestations to dashboard pre-load JSON

**10-second test:** Hero section shows "0G Sentinel — On-chain security for every AI agent on 0G." Dual badge grid immediately visible.

**30-second test:** Click any agent → detail view shows both scores, both receipt hashes, code findings, explorer link. Visually clear.

**60-second test:** Click "Rescan" on a FLAGGED agent — live pipeline demo starts.

**No empty states.** Dashboard pre-loads from cached attestations. If on-chain read fails, cached data is shown with stale timestamp indicator.

---

## 7.6 Judge Proof Artifacts

**Proof page:** `/proof` page with:
- `AttestationRegistry.sol` mainnet address linked to 0G Chain explorer
- `AgentGate.sol` mainnet address
- Sample tx hashes from attestation writes
- Both receipt hashes from live scan calls
- Evidence hash resolving on 0G Storage

**Explorer links:** `https://chainscan.0g.ai/address/{contract_address}` [ASSUMED — verify explorer URL]

**Proof generation:** After deploy, run `scripts/generate-proof.ts` which:
1. Reads all contract addresses
2. Fetches 5 sample tx hashes from attestation writes
3. Captures receipt hashes from 2 live scan calls
4. Writes `submission/proof.md`

---

## 8. Day-by-Day Build Plan

**Today:** May 14, 2026 — Day 1 (build)
**Tomorrow:** May 15, 2026 — Day 2 (frontend + demo seeding)
**Deadline:** May 16, 2026, 23:59 UTC+8 — Day 3 (polish + submission)

### Day 1 (May 14): Contracts + Both Pipelines

**Morning (0-4h):**
1. Fork AgentMesh → create `0g-sentinel` branch
2. Verify 0G mainnet chain ID and RPC endpoint
3. Rename `AuditAttestation.sol` → `AttestationRegistry.sol` with 8 new fields
4. Write `AgentRegistry.sol`, `AgentGate.sol`
5. Deploy contracts to testnet → 5 write/read tests

**Afternoon (4-9h):**
6. Copy 0G Compute client from AgentMesh (no changes to API call pattern)
7. Write behavioral analysis prompt → test with 3 synthetic profiles
8. Copy reentrancy/access control prompt templates → adapt for code scan
9. Wire both pipelines to attestation write
10. End-to-end test: scan agent → both calls → write attestation → read back

**Evening (9-14h):**
11. Copy 0G Storage client → wire `archiveEvidence()`
12. Deploy contracts to 0G Aristotle mainnet → record addresses
13. Run full pipeline against 3 mainnet agents
14. Gate: BOTH receipt hashes visible in attestation before Day 2

### Day 2 (May 15): Frontend + Demo Environment

**Morning (0-6h):**
15. Fork AgentMesh frontend → adapt for 0G Sentinel
16. Agent listing page with dual badge system
17. Agent detail view: both scores, both receipt hashes, code findings
18. "Rescan" + "Code Scan" buttons triggering live pipelines
19. Pre-load cached attestations for instant display

**Afternoon (6-10h):**
20. Deploy Agents A-H to mainnet
21. Run full scan pipeline against all A-H
22. Scan ALL real ERC-7857 iNFTs on 0G mainnet
23. Cache all attestations to dashboard

**Evening (10-14h):**
24. `AgentGate.sol` demo verification — Agent B transaction reverts
25. `/proof` page with contract addresses + tx hashes
26. Explorer verification for all 8 attestation fields per agent

### Day 3 (May 16): Polish + Submission

**Morning (0-6h):**
27. Frontend polish — dual badge system, professional design
28. Architecture diagram
29. README (English): AgentMesh differentiation paragraph + contract addresses + deployment instructions
30. Chinese README translation

**Afternoon/Evening (6–deadline):**
31. Record 3-minute demo video
31a. Create 5-slide pitch deck (Problem / Solution / How It Works / Why We Win / Vision) — 30 minutes using PRD content
32. Final calibration checks (10× both pipeline flows)
33. Write HackQuest submission form
33a. Upload pitch deck to HackQuest submission (optional field — improves score)
34. X post with #0GHackathon #BuildOn0G @0G_labs @0g_CN @0g_Eco @HackQuest_
35. Submit with buffer before 23:59 UTC+8

---

## 9. Dependencies & Prerequisites

| Dependency | Type | Notes |
|------------|------|-------|
| 0G Compute API key | External service | Register at https://0g.ai — get key before Day 1 starts |
| 0G Aristotle mainnet tokens | Token | Faucet: https://faucet.0g.ai (0.1 0G/day limit). Get tokens NOW. |
| AgentMesh repo | GitHub | `github.com/dmustapha/agentmesh` — builder's own, immediate access |
| `@0glabs/0g-ts-sdk` | npm | `npm install @0glabs/0g-ts-sdk` |
| `openai` npm package | npm | `npm install openai` (for 0G Compute compatibility) |
| `ethers` v6 | npm | `npm install ethers` |
| Hardhat | npm | `npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox` |
| Next.js 14 | npm | Fork AgentMesh frontend |
| 0G mainnet chain ID | Verify | Unknown — check 0G docs on Day 1 morning |
| 0G explorer URL | Verify | Assumed `chainscan.0g.ai` — confirm before submitting |

---

## 10. Concerns Compliance

| # | Severity | Concern | How 0G Sentinel Addresses It |
|---|:---:|---------|------------------------------|
| 1 | C | Time NOT a constraint | Emergency scope: pre-built plumbing from AgentMesh. 2 days is achievable. |
| 2 | I | Devnet/testnet fine | Mainnet deployment REQUIRED for this hackathon (see PULSE). Testnet used for dev only. |
| 3 | C | Uniqueness required | Zero confirmed competitors in behavioral risk + code vulnerability attestation category. |
| 4 | A | Fresh ideas | 0G Sentinel is a new product. AgentMesh reuses plumbing only — different problem, different output. |
| 5 | C | Real humans test | AI agent buyers on AIverse who risk real money: concrete, reachable, existing today. |
| 6 | I | Use all research | Research-brief.md ETHGlobal Cannes winners (0G Compute as core), PULSE verified facts, thin population framing — all incorporated. |
| 7 | I | Be extensive | 3-session forge. Full PRD + Architecture + Plan. |
| 8 | C | Cumulative corrections | All 5 warroom corrections carried forward. ModelProof → Code Vulnerability Scan swap preserved. |
| 9 | C | Significant problem | On-chain security for a real ecosystem ($88.88M grant exposure). Builder conviction confirmed. |
| 10 | I | Broad problem | AI agent security is ecosystem-wide infrastructure. Every 0G agent is a potential user/target. |
| 11 | I | Win AND impact | 0G Labs ecosystem grant path is the post-hackathon commercial opportunity. |
| 12 | A | Reframing on table | Reframed 3× (AgentWatch → 0G Sentinel Enhanced → 0G Sentinel). Correct framing locked. |
| 13 | C | Users exist today | AIverse iNFT buyers exist today. Developers deploying agents today. |
| 14 | I | Demo feels real | Pre-seeded agents. Cached attestations. Live scan on mainnet. Explorer verification. |
| C-proj | C | Mainnet required | AttestationRegistry.sol deployed to 0G Aristotle mainnet. Confirmed in submission form. |
| C-proj | C | Two independent pipelines | Two separate 0G Compute calls, two separate receipt hashes. Architecture enforces this. |
| I-proj | I | AgentMesh differentiation | Explicit paragraph in README + verbal answer prepared. |
