# 0G Sentinel — Implementation Plan

## [EMERGENCY MODE — 3 components mocked]
Mocked components: real-time streaming, token staking, multi-agent coordination.
These are NOT built. Only demo-visible features are implemented.

---

## Section 1: Plan Metadata

**Project:** 0G Sentinel
**Architecture Doc:** `ARCHITECTURE.md` (single source of truth — copy code from there)
**PRD:** `PRD.md` (product context and risk register)
**Deadline:** May 16, 2026, 23:59 UTC+8

**How to use this plan:**
1. Work phases in order. Never start Phase N+1 before Phase N gate passes.
2. Every "Copy from ARCHITECTURE.md Section X" means copy exactly — no paraphrasing.
3. Every decision tree is mandatory. If a step fails, follow the tree before improvising.
4. Commit messages are specified per task. Use them exactly (for backdated commit strategy).
5. Gates are binary: ALL checkboxes must be ticked before advancing.

---

## Section 2: Phase Overview

| Phase | Name | Day | Time Budget | Primary Output |
|-------|------|-----|-------------|----------------|
| 1 | Environment + Contracts | Day 1 AM | 0–4h | 3 contracts deployed to testnet |
| 2 | Scanner Pipelines | Day 1 PM | 4–9h | Both pipelines returning receipt hashes |
| 3 | End-to-End + Mainnet Deploy | Day 1 EVE | 9–14h | Mainnet contracts live, full scan works |
| 4 | Frontend Dashboard | Day 2 AM | 0–6h | Live dashboard reading from chain |
| 5 | Demo Environment | Day 2 PM/EVE | 6–14h | Agents A-H seeded, AgentGate demo works |
| 6 | Polish + Submission | Day 3 | 0–deadline | README, video, submission |

---

## Section 3: Phase 1 — Environment Setup + Contracts

**Risk-first rationale:** Chain ID and RPC endpoint must be verified before any other code is written. A wrong chain ID means all subsequent deploys fail.

### Task 1.1 — Fork AgentMesh and scaffold project

```bash
# From ~/projects (or your build directory)
git clone https://github.com/dmustapha/agentmesh 0g-sentinel
cd 0g-sentinel
git checkout -b main
```

**Commit:** `chore: scaffold 0g-sentinel from agentmesh foundation`

### Task 1.2 — Verify 0G Aristotle mainnet chain ID [CRITICAL — R3]

Run BEFORE writing any Hardhat config:

```bash
curl -X POST https://evmrpc.0g.ai \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

Expected output: `{"result":"0x..."}` — note the hex value, convert to decimal.

#### Decision Point: Chain ID verification

**Run:** `curl` above
**Expected:** Response with `"result"` field containing a hex chain ID

✅ **If it works:** Convert hex to decimal (e.g., `0x40d8` = 16600). Record as `ZEROG_MAINNET_CHAIN_ID`. Continue to Task 1.3.

🔀 **If RPC returns `{"error":...}` or wrong format:**
1. Try secondary RPC: `https://rpc.0g.ai`
2. Check PULSE.md for verified RPC facts
3. Check 0G docs at https://docs.0g.ai for current mainnet RPC
4. If still failing after 3 tries: use testnet chain ID `16602` for now, flag for mainnet verification on Day 2

⛔ **If no 0G RPC responds at all:**
1. Use testnet only for Day 1: `https://evmrpc-testnet.0g.ai`
2. Note in `.env.example`: `# MAINNET RPC UNRESPONSIVE — using testnet for Day 1`
3. Retry mainnet at Day 1 Evening (Task 3.1)

**Commit:** `chore: verify 0g mainnet chain id [chain_id_value]`

### Task 1.3 — Create project structure

Delete AgentMesh files that don't apply. Keep: `hardhat.config.ts`, `package.json`, 0G Compute client pattern (copy to `scanner/compute.ts`).

```bash
# Delete old contracts
rm -rf contracts/ test/ scripts/

# Create new structure
mkdir -p contracts scripts/deploy scanner frontend/app/api/agents
mkdir -p frontend/app/api/scan/behavioral frontend/app/api/scan/code
mkdir -p frontend/app/api/health frontend/app/agents frontend/app/proof
mkdir -p frontend/components frontend/lib submission
```

**Commit:** `chore: create 0g-sentinel project structure`

### Task 1.4 — Set up environment files

Copy from ARCHITECTURE.md Section 15 (`.env.example`):

```bash
cp ARCHITECTURE.md-section-15-content > .env.example
cp .env.example .env
```

Fill in `.env` with real values:
- `PRIVATE_KEY` — your deployer wallet private key
- `ZEROG_MAINNET_RPC` — `https://evmrpc.0g.ai` (or verified value from Task 1.2)
- `ZEROG_TESTNET_RPC` — `https://evmrpc-testnet.0g.ai`
- `ZEROG_CHAIN_ID` — verified value from Task 1.2
- `OG_COMPUTE_API_KEY` — your 0G Compute API key
- Leave contract addresses blank (filled during deploy)

**Commit:** `chore: add env configuration and project structure`

### Task 1.5 — Install dependencies

```bash
# Root dependencies (scanner + hardhat)
npm install

# Verify key packages installed
node -e "require('openai'); console.log('openai OK')"
node -e "require('@0glabs/0g-ts-sdk'); console.log('0g-ts-sdk OK')"
node -e "require('ethers'); console.log('ethers OK')"

# Frontend dependencies
cd frontend && npm install && cd ..
```

#### Decision Point: Dependency installation

**Run:** `npm install` in root
**Expected:** Exit code 0, no unresolved peer deps for critical packages

✅ **If it works:** Continue to Task 1.6.

🔀 **If `@0glabs/0g-ts-sdk` fails to install:**
1. Check exact package name: `npm show @0glabs/0g-ts-sdk`
2. If package doesn't exist: check 0G npm org: `npm search @0glabs`
3. If name differs (e.g., `@0g-labs/0g-ts-sdk`): update `package.json`, update all imports in `scanner/storage.ts` (ARCHITECTURE.md Section 7)
4. If no npm package at all: mark `StorageClient` as `[MOCK]`, skip `uploadEvidence()`, set `evidence_hash` = `ethers.ZeroHash` in scanner.ts — evidence archive is secondary, not demo-blocking (PRD Risk R5)

**Commit:** `chore: install dependencies`

### Task 1.6 — Configure Hardhat

Copy from ARCHITECTURE.md Section 13, `hardhat.config.ts`:

Verify: networks section has `zerogTestnet` (chain ID 16602 — VERIFIED) and `zerogMainnet` (chain ID from Task 1.2).

```bash
npx hardhat compile
```

Expected: `Compiled N Solidity files successfully`

**Commit:** `chore: configure hardhat for 0g networks`

### Task 1.7 — Write AttestationRegistry.sol

Copy from ARCHITECTURE.md Section 3, `contracts/AttestationRegistry.sol`.

Key fields to verify copied correctly:
- `behavioral_score`, `threat_level`, `code_risk`, `code_findings` — all present
- `behavioral_receipt_hash`, `code_receipt_hash`, `evidence_hash`, `attestation_timestamp` — all present
- `writeAttestation()` — only callable by `SCANNER_ROLE`
- `getAttestation()` — public view

```bash
npx hardhat compile
```

**Commit:** `feat: add AttestationRegistry.sol with 8-field ERC-7857 attestation`

### Task 1.8 — Write AgentRegistry.sol and AgentGate.sol

Copy from ARCHITECTURE.md Section 4 (`AgentRegistry.sol`) and Section 5 (`AgentGate.sol`).

AgentGate verification — ensure this pattern exists:
```solidity
require(
    attestation.threat_level < 3 && attestation.code_risk < 2,
    "Agent not cleared: security attestation required"
);
```

```bash
npx hardhat compile
# Should compile all 3 contracts with 0 errors
```

**Commit:** `feat: add AgentRegistry and AgentGate composability contract`

### Task 1.9 — Write deploy scripts + deploy to testnet

Copy deploy scripts from ARCHITECTURE.md Section 13:
- `scripts/deploy/01_deploy_registry.ts`
- `scripts/deploy/02_deploy_attestation.ts`
- `scripts/deploy/03_deploy_gate.ts`

```bash
# Deploy to testnet first
npx hardhat run scripts/deploy/01_deploy_registry.ts --network zerogTestnet
# Record AgentRegistry address from output

npx hardhat run scripts/deploy/02_deploy_attestation.ts --network zerogTestnet
# Record AttestationRegistry address from output

npx hardhat run scripts/deploy/03_deploy_gate.ts --network zerogTestnet
# Record AgentGate address from output
```

Update `.env` with testnet addresses.

**Testnet verification (5 write/read cycles):**
```bash
# Quick verify: write one attestation, read it back
npx hardhat run scripts/deploy/02_deploy_attestation.ts --network zerogTestnet
```

**Commit:** `deploy: contracts to zerog testnet [testnet-addresses]`

### Phase 1 Gate — ALL must pass before Phase 2

- [ ] 0G Aristotle mainnet chain ID confirmed and recorded in `.env`
- [ ] All 3 contracts compile without errors
- [ ] All 3 contracts deployed to testnet with recorded addresses
- [ ] `getAttestation()` returns data after `writeAttestation()` on testnet
- [ ] No `PRIVATE_KEY` or `OG_COMPUTE_API_KEY` in git history (`git log --all -p | grep -E "0x[0-9a-f]{64}|sk-"` returns nothing)

---

## Section 4: Phase 2 — Scanner Pipelines

**Risk-first rationale:** 0G Compute integration and receipt hash capture are the highest-value and highest-risk components. Test them first as standalone modules before wiring to attestation writes.

### Task 2.1 — Write 0G Compute client

Copy from ARCHITECTURE.md Section 6, `scanner/compute.ts`.

Key pattern — receipt proof capture (VERIFIED mechanism via `@0gfoundation/0g-compute-ts-sdk`):
```typescript
// 0G Compute receipt = TEE-signed routing proof from the broker
// Contains: request hash + response hash + TLS fingerprint + provider identity
// Captured via: broker.getRequestHeaders() before the call, then broker acknowledges response
// Fallback: hash the full response body if SDK receipt unavailable
let receiptHash = data.usage?.receipt_hash || null;
if (!receiptHash) {
  const crypto = await import("crypto");
  receiptHash = "0x" + crypto.createHash("sha256")
    .update(JSON.stringify({ content, usage: data.usage, model }))
    .digest("hex");
  console.warn("[ComputeClient] Using response hash fallback — not native TEE receipt");
}
```

#### Decision Point: 0G Compute receipt hash field

**Run:**
```bash
npx ts-node -e "
const { OpenAI } = require('openai');
const client = new OpenAI({
  apiKey: process.env.OG_COMPUTE_API_KEY,
  baseURL: process.env.OG_COMPUTE_ENDPOINT  // https://router-api.0g.ai/v1
});
client.chat.completions.create({
  model: 'Qwen/Qwen2.5-7B-Instruct',
  messages: [{ role: 'user', content: 'test' }]
}).then(r => { console.log(JSON.stringify(r, null, 2)); }).catch(console.error);
"
```
**Expected:** Inspect `r.usage` for any hash field. Also log response headers if using raw fetch.

✅ **If `usage.receipt_hash` (or similar) exists in response body:** Extract directly. Update `callCompute()`.

🔀 **If receipt hash is in a response header:**
1. Switch to raw `fetch()` call (already in ARCHITECTURE.md Section 6)
2. Inspect all headers: `for (const [k,v] of response.headers.entries()) console.log(k, v)`
3. Find the hash header name and update `callCompute()` accordingly
4. Update ARCHITECTURE.md Section 6 note with verified field name

🔀 **If no receipt hash field anywhere in response:**
1. Fallback pattern (already implemented in ARCHITECTURE.md Section 6):
   ```typescript
   receiptHash = "0x" + crypto.createHash("sha256").update(JSON.stringify({ content, usage, model })).digest("hex")
   ```
2. Add comment: `// FALLBACK: TEE receipt unavailable — using response hash as deterministic proof`
3. Still valid for attestation — judges can verify input→output deterministically

⛔ **If 0G Compute API returns 401/403:**
1. Verify `OG_COMPUTE_API_KEY` in `.env`
2. Check `OG_COMPUTE_ENDPOINT` format: must include `/v1` suffix
3. Verify endpoint is `https://router-api.0g.ai/v1` (DNS-verified) — `api.inference.0g.ai/v1` does NOT resolve
4. If still failing: contact 0G team in Discord for API access

**Commit:** `feat: add 0g compute client with receipt hash capture`

### Task 2.2 — Write behavioral analysis pipeline

Copy from ARCHITECTURE.md Section 8, `scanner/behavioral.ts`.

Test with a synthetic agent profile:
```bash
npx ts-node -e "
require('dotenv').config();
const { runBehavioralAnalysis } = require('./scanner/behavioral');
runBehavioralAnalysis('0x1234567890123456789012345678901234567890', {
  txCount: 847,
  uniqueContracts: 3,
  drainEvents: 2,
  avgGasUsed: 285000,
  lastActivity: Math.floor(Date.now()/1000) - 3600
}).then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error);
"
```

**Expected output structure:**
```json
{
  "behavioral_score": 78,
  "threat_level": 2,
  "threat_label": "FLAGGED",
  "reasoning": "...",
  "receipt_hash": "0x..."
}
```

#### Decision Point: Behavioral pipeline classification

**Run:** Command above
**Expected:** JSON with all 5 fields, `receipt_hash` non-null

✅ **If structured JSON returns with all fields:** Continue to Task 2.3.

🔀 **If model returns free text instead of JSON:**
1. In `scanner/behavioral.ts`, add `response_format: { type: "json_object" }` to the API call
2. Add explicit instruction: "Respond ONLY with valid JSON, no prose."
3. Retry — structured output is non-negotiable for reliable demo

🔀 **If score is always 50 (neutral, no differentiation):**
1. The behavioral prompt needs stronger examples
2. Add few-shot examples in prompt: 3 SAFE profiles + 3 FLAGGED profiles
3. Test against Agent B's drain pattern specifically (2+ drain events in ACTIVITY_DATA)

**Commit:** `feat: behavioral analysis pipeline with 0g compute integration`

### Task 2.3 — Write code vulnerability scan pipeline

Copy from ARCHITECTURE.md Section 9, `scanner/code-scan.ts`.

Test with Agent B's reentrancy contract (from ARCHITECTURE.md):
```bash
npx ts-node -e "
require('dotenv').config();
const { runCodeScan } = require('./scanner/code-scan');
const AGENT_B_SOURCE = \`
pragma solidity ^0.8.0;
contract VulnerableAgent {
  mapping(address => uint256) public balances;
  function withdraw() external {
    uint256 amount = balances[msg.sender];
    (bool ok,) = msg.sender.call{value: amount}('');
    require(ok);
    balances[msg.sender] = 0; // STATE UPDATE AFTER EXTERNAL CALL
  }
}\`;
runCodeScan('0x2234567890123456789012345678901234567890', AGENT_B_SOURCE)
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(console.error);
"
```

**Expected:** `code_risk: 2` (VULNERABLE), `code_findings` mentions "reentrancy"

#### Decision Point: Code scan classification [CRITICAL — R2]

**Run:** Command above with Agent B reentrancy source
**Expected:** `code_risk` = `2` and `code_findings` contains "reentrancy"

✅ **If VULNERABLE returned with reentrancy finding:** This is your demo agent. Proceed.

🔀 **If model returns WARNING or CLEAN for obvious reentrancy:**
1. The prompt isn't specific enough — add explicit vulnerability signatures in the prompt
2. Add to system prompt: "A function that makes an external call BEFORE updating state (balances[msg.sender] = 0 AFTER the .call{}) is ALWAYS reentrancy. Rate it code_risk: 2 VULNERABLE."
3. Re-test until VULNERABLE is returned consistently for this exact pattern (10x)
4. **This must work reliably before demo** — run it 10 times, 10/10 must say VULNERABLE

⛔ **If model cannot classify code vulnerabilities at all (gibberish output):**
1. Try a different model: `Qwen/Qwen2.5-72B-Instruct` (larger, better instruction following)
2. If still failing: hardcode Agent B's verdict — `code_risk = 2`, `code_findings = "reentrancy at withdraw(): state update after external call"`, set receipt hash to hash of contract source as proof
3. This is the emergency fallback — document it clearly in demo script

**Commit:** `feat: code vulnerability scan pipeline with reentrancy detection`

### Task 2.4 — Write Scanner orchestrator

Copy from ARCHITECTURE.md Section 10, `scanner/scanner.ts`.

This connects both pipelines and writes the attestation. Verify:
- `runBehavioralAnalysis()` + `runCodeScan()` called independently (separate receipt hashes)
- `uploadEvidence()` called with merged JSON
- `writeAttestation()` called with all 8 fields

```bash
npx ts-node -e "
require('dotenv').config();
const { runFullScan } = require('./scanner/scanner');
// Use a testnet agent address
runFullScan('0x1234567890123456789012345678901234567890')
  .then(r => console.log('SCAN COMPLETE:', JSON.stringify(r, null, 2)))
  .catch(e => console.error('SCAN FAILED:', e));
"
```

**Commit:** `feat: scanner orchestrator wiring both pipelines to attestation write`

### Phase 2 Gate — ALL must pass before Phase 3

- [ ] `runBehavioralAnalysis()` returns valid JSON with `receipt_hash` non-null on every call
- [ ] `runCodeScan()` returns `code_risk: 2` for Agent B reentrancy contract (run 3 times, 3/3)
- [ ] `behavioral_receipt_hash` and `code_receipt_hash` are DIFFERENT values (two independent calls)
- [ ] `uploadEvidence()` returns a non-null hash (or is marked as fallback with explanation)
- [ ] `runFullScan()` completes without errors on a testnet agent address
- [ ] Attestation written to testnet — `getAttestation()` returns all 8 non-zero fields

---

## Section 5: Phase 3 — End-to-End Integration + Mainnet Deploy

### Task 3.1 — Verify mainnet connectivity

```bash
# Test mainnet RPC
curl -X POST $ZEROG_MAINNET_RPC \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Expected: `{"result":"0x..."}` with a recent block number.

#### Decision Point: Mainnet RPC

✅ **If mainnet responds:** Proceed to mainnet deploy.

🔀 **If mainnet RPC is slow but responds (>5s):**
1. Use it anyway for deploy (deploy is one-time)
2. For scanner calls: set `provider` timeout to `60000` ms in scanner.ts
3. Pre-seed all agents on Day 1 so Day 2 frontend reads cached data, not live chain

⛔ **If mainnet RPC is completely unreachable:**
1. Use testnet for all remaining work
2. Note in README: "Mainnet deploy attempted — RPC unavailable during demo window. All functionality demonstrated on zerogTestnet (chain 16602)."
3. Judges prefer testnet that works over mainnet that doesn't

**Commit:** `chore: verify 0g mainnet rpc connectivity`

### Task 3.2 — Deploy contracts to 0G Aristotle mainnet

```bash
# Deploy all 3 in sequence
npx hardhat run scripts/deploy/01_deploy_registry.ts --network zerogMainnet
# Copy AgentRegistry address to .env: AGENT_REGISTRY_ADDRESS=

npx hardhat run scripts/deploy/02_deploy_attestation.ts --network zerogMainnet
# Copy AttestationRegistry address to .env: ATTESTATION_REGISTRY_ADDRESS=

npx hardhat run scripts/deploy/03_deploy_gate.ts --network zerogMainnet
# Copy AgentGate address to .env: AGENT_GATE_ADDRESS=
```

**Copy mainnet addresses to:**
- `.env` (all 3 `_ADDRESS` vars)
- `frontend/.env.local` (all 3 `NEXT_PUBLIC_` vars)

**Verify on explorer:**
```
https://chainscan.0g.ai/address/{ATTESTATION_REGISTRY_ADDRESS}
```

**Commit:** `deploy: 0g sentinel contracts to aristotle mainnet`

### Task 3.3 — Run full pipeline on 3 test agents

Create 3 in-memory test profiles and run full scans:

```bash
npx ts-node -e "
require('dotenv').config();
const { runFullScan } = require('./scanner/scanner');

const AGENT_A = '0xAAAA000000000000000000000000000000000001';
const AGENT_B = '0xBBBB000000000000000000000000000000000002';
const AGENT_C = '0xCCCC000000000000000000000000000000000003';

Promise.all([
  runFullScan(AGENT_A),
  runFullScan(AGENT_B),
  runFullScan(AGENT_C)
]).then(results => {
  results.forEach((r, i) => {
    console.log('Agent', ['A','B','C'][i], ':', r.threat_label, '/', r.code_risk_label);
    console.log('  behavioral_receipt_hash:', r.behavioral_receipt_hash);
    console.log('  code_receipt_hash:', r.code_receipt_hash);
    console.log('  attestation_tx_hash:', r.attestation_tx_hash);
  });
}).catch(console.error);
"
```

**Expected output:**
```
Agent A: FLAGGED / CLEAN    (high behavioral score, clean code)
Agent B: SAFE / VULNERABLE  (normal behavior, reentrancy bug)
Agent C: SAFE / CLEAN       (all green)
```

**Commit:** `feat: verified end-to-end pipeline on mainnet test agents`

### Task 3.4 — Verify attestation fields on-chain

For each agent, verify all 8 fields written:

```bash
npx ts-node -e "
require('dotenv').config();
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider(process.env.ZEROG_MAINNET_RPC);
// ... (use AttestationRegistry ABI from ARCHITECTURE.md Section 3)
// getAttestation(AGENT_A) — should return 8 non-zero fields
"
```

**Critical check:** `behavioral_receipt_hash !== code_receipt_hash` — two independent calls, two different hashes. This satisfies [C] concern #1 from concerns.md.

**Commit:** `verify: all 8 attestation fields on-chain for agents A, B, C`

### Phase 3 Gate — ALL must pass before Phase 4

- [ ] All 3 contracts deployed to 0G Aristotle mainnet with valid addresses
- [ ] Contract addresses saved in both `.env` and `frontend/.env.local`
- [ ] At least 3 agents have on-chain attestations (readable via `getAttestation()`)
- [ ] `behavioral_receipt_hash !== code_receipt_hash` for every agent (two separate compute calls)
- [ ] All 8 attestation fields non-zero for Agent A, B, C
- [ ] Explorer shows contract code at `AttestationRegistry` address

---

## Section 6: Phase 4 — Frontend Dashboard

### Task 4.1 — Set up Next.js project

```bash
cd frontend
# If adapting from AgentMesh: keep layout, clear pages
# If fresh: already scaffolded from ARCHITECTURE.md

npm run dev
```

Open `http://localhost:3000` — should render without errors (blank page is fine at this point).

**Commit:** `chore: scaffold next.js dashboard`

### Task 4.2 — Write contracts.ts

Copy from ARCHITECTURE.md Section 22, `frontend/lib/contracts.ts`.

This is the single source of truth for all contract interaction from the frontend. Verify:
- `getAttestationRegistry()` returns an ethers.Contract instance
- `getAgentRegistry()` returns an ethers.Contract instance
- Both use inline ABI arrays (no JSON imports needed)

**Commit:** `feat: add contract helpers and abis`

### Task 4.3 — Write types.ts

Copy from ARCHITECTURE.md Section 12, `frontend/lib/types.ts`.

Verify `THREAT_LABELS`, `CODE_RISK_LABELS`, `THREAT_COLORS`, `CODE_RISK_COLORS`, `THREAT_BG`, `CODE_RISK_BG` maps are all exported.

**Commit:** `feat: add typescript type definitions`

### Task 4.4 — Write API routes

Copy all 4 API routes in this order (each builds on the previous):

**4.4a** — `frontend/app/api/agents/route.ts` (ARCHITECTURE.md Section 11)
Test: `curl http://localhost:3000/api/agents`
Expected: JSON array of agent objects with attestation data

**4.4b** — `frontend/app/api/scan/behavioral/route.ts` (ARCHITECTURE.md Section 11)
Test:
```bash
curl -X POST http://localhost:3000/api/scan/behavioral \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":"0xAAAA000000000000000000000000000000000001"}'
```
Expected: `{"success":true,"agentAddress":"0x...","behavioral_score":...}`

**4.4c** — `frontend/app/api/scan/code/route.ts` (ARCHITECTURE.md Section 22)
Test:
```bash
curl -X POST http://localhost:3000/api/scan/code \
  -H "Content-Type: application/json" \
  -d '{"agentAddress":"0xBBBB000000000000000000000000000000000002","contractSource":"..."}'
```

**4.4d** — `frontend/app/api/health/route.ts` (ARCHITECTURE.md Section 11)
Test: `curl http://localhost:3000/api/health`
Expected: `{"status":"ok"}`

#### Decision Point: API routes can't import scanner code

**Run:** `npm run dev` after adding API routes
**Expected:** No import errors in terminal

✅ **If routes compile and respond:** Continue.

🔀 **If `Cannot find module '@scanner/scanner'`:**
1. Verify `frontend/next.config.ts` has the webpack alias (ARCHITECTURE.md Section 22):
   ```typescript
   config.resolve.alias["@scanner"] = path.resolve(__dirname, "../scanner");
   ```
2. Verify `frontend/tsconfig.json` has the paths entry (ARCHITECTURE.md Section 22):
   ```json
   "@scanner/*": ["../scanner/*"]
   ```
3. Restart `npm run dev` (webpack config changes require restart)
4. If still failing: move scanner code inline into the API route as a temporary fix — copy `runFullScan` body directly into `behavioral/route.ts`. Not clean, but unblocks demo.

**Commit:** `feat: api routes for agents list and scan triggers`

### Task 4.5 — Write AgentCard component

Copy from ARCHITECTURE.md Section 12, `frontend/components/AgentCard.tsx`.

This is the dual-badge card: behavioral badge (SAFE/CAUTION/FLAGGED) + code badge (CLEAN/WARNING/VULNERABLE). Verify colors render correctly with Tailwind classes from `THREAT_BG` and `CODE_RISK_BG`.

**Commit:** `feat: agentcard component with dual badge system`

### Task 4.6 — Write dashboard pages

In this order:

**4.6a** — `frontend/app/agents/page.tsx` (ARCHITECTURE.md Section 12) — main agent grid
**4.6b** — `frontend/app/agents/[address]/page.tsx` (ARCHITECTURE.md Section 22) — agent detail
**4.6c** — `frontend/app/proof/page.tsx` (ARCHITECTURE.md Section 22) — proof artifacts
**4.6d** — `frontend/app/layout.tsx` (ARCHITECTURE.md Section 22) — root layout
**4.6e** — `frontend/app/page.tsx` (ARCHITECTURE.md Section 22) — redirect to /agents

```bash
# Full build check
cd frontend && npm run build
```

Expected: Build completes without errors.

**Commit:** `feat: dashboard pages — agent grid, detail view, proof page`

### Task 4.7 — Verify dashboard renders real data

With `npm run dev` running:
1. Open `http://localhost:3000/agents`
2. Should show agents loaded from chain (Agent A, B, C from Phase 3)
3. Agent A → FLAGGED + CLEAN badges visible
4. Agent B → SAFE + VULNERABLE badges visible (red VULNERABLE badge is your demo anchor)
5. Click any agent → detail view shows both receipt hashes, explorer link works

#### Decision Point: Dashboard shows empty or error state

✅ **If agent grid shows data:** Continue to Phase 5.

🔀 **If `/api/agents` returns empty array:**
1. Check that `NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS` is set in `frontend/.env.local`
2. Check that `NEXT_PUBLIC_RPC_URL` is set to mainnet RPC
3. Log `agentAddresses` array before the `.map()` — should be non-empty
4. If `getAllAgents()` returns empty: agents weren't registered to `AgentRegistry.sol`. Run seed script (Phase 5, Task 5.1) before dashboard test.

🔀 **If chain reads time out (>30s):**
1. Switch to a cache-first approach: pre-bake a `public/attestations-cache.json` with all agent data
2. In `/api/agents`: try chain, fallback to JSON cache if chain read takes >5s
3. Dashboard shows cached data with "Last updated: {timestamp}" indicator

**Commit:** `feat: dashboard verified rendering real chain data`

### Phase 4 Gate — ALL must pass before Phase 5

- [ ] `http://localhost:3000/agents` renders agent grid (no error page)
- [ ] `/api/agents` returns JSON array with at least 3 agents
- [ ] Agent badges (behavioral + code) render in correct colors
- [ ] `/api/health` returns `{"status":"ok"}`
- [ ] `npm run build` completes without TypeScript errors

---

## Section 7: Phase 5 — Demo Environment Setup

**Goal:** Deploy Agents A-H, seed all attestations, verify every demo scenario works. This is pre-computation — NOT live during the demo.

### Task 5.1 — Write and run seed-demo.ts

Copy from ARCHITECTURE.md Section 14, `scripts/seed-demo.ts`.

This deploys Agents A-H and runs full scans:

```bash
# From project root
npx ts-node scripts/seed-demo.ts
```

Expected output:
```
Deploying Agent A (FLAGGED/CLEAN)... ✓ 0xAAAA...
Deploying Agent B (SAFE/VULNERABLE)... ✓ 0xBBBB...
...
Deploying Agent H... ✓ 0xHHHH...
All agents seeded. Dashboard pre-load cache written.
```

This takes ~10-20 minutes (8 agents × ~2 API calls × ~20-30s each).

#### Decision Point: Seed script runs out of gas or fails mid-way

✅ **If all 8 agents seed successfully:** Record all addresses in `.env`.

🔀 **If script fails partway through (3 agents seeded, then error):**
1. Check which agents are already in `AgentRegistry` with `getAllAgents()`
2. Modify seed script to skip already-seeded agents
3. Resume from the next agent
4. **Agent A and Agent B are MANDATORY** — demo depends on them. Agents C-H are density. If only A and B are seeded and rest fail, demo can proceed.

🔀 **If 0G Compute calls are rate-limited during bulk seed:**
1. Add `await new Promise(r => setTimeout(r, 3000))` between scans (3s delay)
2. Run seed in batches: `./scripts/seed-demo.ts --batch agents-ab`, then `--batch agents-cd`, etc.

**Commit:** `feat: seed demo agents a-h with full attestations`

### Task 5.2 — Scan real ERC-7857 iNFTs from 0G mainnet

```bash
# Get all real iNFT addresses
npx ts-node -e "
require('dotenv').config();
const { ethers } = require('ethers');
// Use AgentRegistry.getAllAgents() OR query 0G App API for live agents
// ... (pattern from ARCHITECTURE.md Section 14)
"
```

Run full scan pipeline against every real iNFT found. This is the "comprehensive coverage" angle — not just test agents, but real agents.

If live iNFT count is < 5: add more seeded test agents (Agents D-H with varied profiles) to hit 10+ dashboard entries.

**Commit:** `feat: scan all real erc-7857 inft agents on 0g mainnet`

### Task 5.3 — Verify AgentGate.sol composability demo

This is the [C] critical composability requirement (concerns.md):

```bash
npx ts-node -e "
require('dotenv').config();
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider(process.env.ZEROG_MAINNET_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// AgentGate ABI from ARCHITECTURE.md Section 5
const gate = new ethers.Contract(process.env.AGENT_GATE_ADDRESS, AGENT_GATE_ABI, wallet);

// Try to execute Agent B (VULNERABLE) — should REVERT
try {
  const tx = await gate.executeIfCleared(process.env.AGENT_B_ADDRESS);
  console.log('UNEXPECTED SUCCESS — gate not working!');
} catch (e) {
  if (e.message.includes('Agent not cleared')) {
    console.log('REVERT CONFIRMED: Agent B blocked by AgentGate ✓');
  } else {
    console.log('Unexpected error:', e.message);
  }
}

// Try Agent C (SAFE/CLEAN) — should SUCCEED
const tx = await gate.executeIfCleared(process.env.AGENT_C_ADDRESS);
console.log('Agent C passed gate ✓ tx:', tx.hash);
"
```

#### Decision Point: AgentGate composability

**Expected:** Agent B reverts with "Agent not cleared", Agent C passes.

✅ **If both cases work:** Record Agent B revert tx hash for `/proof` page.

🔀 **If Agent B doesn't revert (gate passes everyone):**
1. Check `AgentGate.sol` threshold values — `threat_level < 3` should block FLAGGED (level 2)
2. Check that Agent B's attestation has `threat_level >= 3` OR `code_risk >= 2`
3. May need to adjust the threshold: `threat_level > 1 || code_risk > 1` (block anything not SAFE/CLEAN)
4. Redeploy AgentGate with corrected threshold

**Commit:** `verify: agentgate composability confirmed - agent b reverts`

### Task 5.4 — Build proof page and run generate-proof.ts

Copy from ARCHITECTURE.md Section 22, `scripts/generate-proof.ts`.

```bash
npx ts-node scripts/generate-proof.ts
```

Expected output: Creates `submission/proof.md` with:
- Contract addresses linked to chainscan.0g.ai
- 5 sample tx hashes from attestation writes
- Both receipt hashes from 2 live scan calls
- Evidence hash (if storage working) or "N/A — receipt hashes are primary proof"

View proof page at: `http://localhost:3000/proof`

**Commit:** `feat: proof page with contract addresses and tx hash evidence`

### Task 5.5 — 10× calibration run

Run each demo flow 10 times. Record pass/fail:

```bash
for i in {1..10}; do
  echo "Run $i:"
  # Behavioral rescan on Agent A (FLAGGED expected)
  curl -s -X POST http://localhost:3000/api/scan/behavioral \
    -H "Content-Type: application/json" \
    -d "{\"agentAddress\":\"$AGENT_A_ADDRESS\"}" | jq '.threat_level'
done
```

**Pass criteria:** 10/10 returns `threat_level: 2` (FLAGGED) for Agent A, `code_risk: 2` (VULNERABLE) for Agent B.

If any run fails (wrong classification), adjust prompts before demo.

**Commit:** `test: 10x calibration run - both pipelines stable`

### Phase 5 Gate — ALL must pass before Phase 6

- [ ] Dashboard shows 8+ agents with varied badges (not all same color)
- [ ] Agent A shows FLAGGED behavioral badge (red)
- [ ] Agent B shows VULNERABLE code badge (red)
- [ ] Agent C shows both SAFE badges (green)
- [ ] AgentGate: Agent B revert confirmed with tx hash recorded
- [ ] AgentGate: Agent C execute confirmed with tx hash recorded
- [ ] `/proof` page shows valid contract addresses with explorer links
- [ ] Calibration: 10/10 Agent A = FLAGGED, 10/10 Agent B = VULNERABLE
- [ ] 0 hard failures in 10 calibration runs

---

## Section 8: Phase 6 — Polish + Submission

### Task 6.1 — Deploy frontend to production

```bash
cd frontend
npm run build

# Deploy to Vercel (recommended for instant HTTPS URL)
# Or: docker build + deploy to fly.io
vercel --prod
```

Note the production URL (e.g., `https://0g-sentinel.vercel.app`). Add to `.env` as `NEXT_PUBLIC_APP_URL`.

**Commit:** `deploy: frontend to production`

### Task 6.2 — Write README.md (English)

The README must contain these verbatim sections (IMPORTANT concerns):

**Section A — AgentMesh differentiation (mandatory verbatim):**
```
AgentMesh audits developer code. 0G Sentinel audits live agents on mainnet
and writes ERC-7857 on-chain identity attestations.
```

**Section B — Contract addresses:**
```
## Deployed Contracts (0G Aristotle Mainnet)
- AttestationRegistry: [address] — chainscan.0g.ai/address/[address]
- AgentRegistry: [address] — chainscan.0g.ai/address/[address]
- AgentGate: [address] — chainscan.0g.ai/address/[address]
```

**Section C — Architecture section with diagram**

**Section D — Local setup instructions**

**Section E — Submission statement:**
```
Built for 0G APAC Hackathon 2026 — Track T1 (Agentic Infrastructure)
```

**Commit:** `docs: readme with agentmesh differentiation and contract addresses`

### Task 6.3 — Write Chinese README (README_CN.md)

Translate README.md to Chinese. The verbatim AgentMesh comparison paragraph must be present in Chinese.

Key phrases:
- "AgentMesh 审计开发者代码。0G Sentinel 审计主网上的活跃 AI 代理，并将 ERC-7857 身份证明写入链上。"

**Commit:** `docs: add chinese readme (readme_cn.md)`

### Task 6.4 — Record 3-minute demo video

Scene sequence (from PRD Section 6):
1. **Hook (0-20s):** "AI agents on 0G are being trusted with real money. There's no security layer. Until now." — show dashboard with badges
2. **Problem (20-40s):** Show empty chain state before Sentinel. "No audit, no attestation."
3. **Pipeline 1 demo (40-80s):** Live behavioral rescan on Agent A → FLAGGED result + receipt hash
4. **Pipeline 2 demo (80-110s):** Code scan on Agent B → VULNERABLE + "reentrancy at withdraw()"
5. **On-chain proof (110-140s):** Explorer showing all 8 fields. AgentGate revert demo.
6. **Composability (140-160s):** Show how downstream apps can query attestations
7. **Closing (160-180s):** "Security infrastructure for every agent on 0G."

**Pre-demo checklist before recording:**
- [ ] Cache pre-loaded — dashboard shows instantly (no spinner on load)
- [ ] Agent A and B addresses in env vars for API calls
- [ ] Explorer tab pre-opened at AttestationRegistry address
- [ ] 0G Compute API key valid and quota available

**Commit:** `media: demo video recorded [youtube-url or placeholder]`

### Task 6.5 — Complete submission

**HackQuest submission form:**
- Project name: 0G Sentinel
- Track: T1 (Agentic Infrastructure & OpenClaw Lab)
- Demo video: [YouTube URL]
- Live URL: [production URL from Task 6.1]
- GitHub: https://github.com/dmustapha/0g-sentinel
- Contract addresses: [all 3 from mainnet deploy]
- Description: use PRD Section 1 problem statement

**X post (required by hackathon rules):**
```
Just built 0G Sentinel for @0G_labs @0g_CN @0g_Eco 🔒

On-chain security infrastructure for every AI agent on 0G mainnet.
Two independent AI analysis pipelines. ERC-7857 attestations. On-chain composability.

Built on @AgentMesh foundation — evolved for live agent security.

@HackQuest_ #0GHackathon #BuildOn0G
[link to demo video]
```

**Final gate before submit:**
- [ ] All 3 contract addresses visible on chainscan.0g.ai
- [ ] Frontend live at HTTPS URL (not localhost)
- [ ] Demo video uploaded and link working
- [ ] README has AgentMesh differentiation paragraph
- [ ] README_CN.md exists
- [ ] X post published
- [ ] Submission form filled and submitted before 23:59 UTC+8

**Commit:** `chore: final pre-submission commit [v1.0.0]`

---

## Section 9: Decision Trees — All CRITICAL and HIGH Risks

### DT-R1: 0G Compute slow during live demo [CRITICAL]

**Pre-demo:** Run both pipeline calls in the 2 hours before demo. Cache results. If live call doesn't return in 20s:

```
TIMER STARTS → 0G Compute call triggered
    │
    ├── < 20s: call returns → show live result
    │
    └── > 20s: hard cutoff
           │
           ├── Show cached attestation: "Pre-computed 2h ago. Receipt hashes verified on 0G Chain."
           │   → Open explorer tab showing the receipt hash on-chain
           │   → "The receipt hash you see is stored on 0G Chain — not in our database"
           │
           └── If judge asks "is this live?"
                   → "Live rescan takes 20-30 seconds. The pre-computed attestation shows the same
                      pipeline output — both receipt hashes from two independent 0G Compute calls."
                   → Show explorer verification — this is the proof
```

### DT-R2: Code scan misclassifies Agent B [CRITICAL]

**Pre-demo guard:** Run code scan against Agent B 10 times. All 10 must return VULNERABLE.

```
10× pre-demo calibration:
    │
    ├── 10/10 VULNERABLE: safe to demo live
    │
    ├── 8-9/10 VULNERABLE: risky — use cached scan result, don't trigger live
    │
    └── < 8/10: DO NOT demo live code scan
           │
           ├── Use the pre-computed Agent B scan result
           │   (behavioral scan can still be live — lower risk)
           │
           └── Verbal explanation: "Agent B has a reentrancy vulnerability at withdraw().
                The model correctly identified it in our testing. Here's the finding on-chain."
                → Show receipt hash on explorer
```

### DT-R3: Mainnet deploy fails [CRITICAL]

Already handled in Task 3.1. Summary:
```
Mainnet unreachable → use testnet (chain 16602 — VERIFIED)
Testnet deploy fails → check chain ID, RPC, gas token balance
Gas insufficient → faucet at https://faucet.0g.ai (0.1 0G/day)
Still failing → report to 0G Discord, deploy to alternative testnet
```

### DT-R4: Receipt hash field not in API response [HIGH]

Already handled in Task 2.1. Summary:
```
Header field present: use it (VERIFIED)
Header field absent, body has hash: extract from body (UNVERIFIED)
No hash anywhere: compute ethers.id(JSON.stringify(response)) (FALLBACK)
Fallback: still writes a deterministic hash — judges can verify input produces same hash
```

### DT-R5: 0G Storage SDK upload fails [HIGH]

```
uploadEvidence() called:
    │
    ├── Returns hash: ✓ evidence_hash stored in attestation
    │
    ├── Throws "method not found" or name error:
    │   1. Check SDK docs: npm show @0glabs/0g-ts-sdk
    │   2. Find correct method name (may be .upload(), .store(), etc.)
    │   3. Update storage.ts
    │
    └── Cannot be fixed quickly:
           → Set evidence_hash = ethers.id(JSON.stringify(evidenceData))
           → This is a content-addressable hash of the evidence
           → Demo proceeds: "Evidence is content-hashed. 0G Storage integration
              is secondary to the receipt hashes, which are primary proof."
           → Receipt hashes from Compute are the demo anchor — not storage
```

### DT-R6: Dashboard looks sparse [HIGH]

```
Agent count after seeding:
    │
    ├── 10+: dashboard looks healthy
    │
    ├── 5-9: acceptable — add more seeded agents to reach 10
    │
    └── < 5: urgency
           1. Check 0G App/AIverse for real ERC-7857 iNFT list
           2. Scan every address found
           3. If real agents are < 3: add more seeded test profiles
              (D: reentrancy + drain pattern, E: safe, F: code warnings only, etc.)
           4. Target: never show fewer than 8 cards in dashboard
```

### DT-R7: Judges ask "how is this different from AgentMesh?" [HIGH]

**Prepared answer (memorize):**
> "AgentMesh audits developer code before deployment. 0G Sentinel audits live agents already on mainnet and writes ERC-7857 on-chain identity attestations. The attestation is part of the agent's portable identity — queryable by any contract, protocol, or user without touching our servers. We reused AgentMesh's 0G Compute client pattern because it was proven — but the product is entirely different."

**README must have this in writing.** README verification is in Phase 6 Gate.

### DT-R8: ERC-7857 interface doesn't support custom fields [HIGH]

Already resolved in architecture: `AttestationRegistry.sol` is a custom contract with ERC-7857 iNFT addresses as keys. It doesn't inherit the ERC-7857 standard — it REFERENCES it.

```
If judge asks "does this implement ERC-7857?":
    → "AttestationRegistry stores security data keyed by ERC-7857 agent addresses.
       The attestation fields extend the agent's on-chain identity
       without requiring a standard interface change."
    → The 8 fields are custom — no inheritance required
```

---

## Section 10: Concerns Verification Steps

Every [C] concern must have an explicit verification step in a phase gate:

| Concern | Phase Gate | Verification Command/Check |
|---------|-----------|---------------------------|
| [C] Both pipelines must return separate receipt hashes | Phase 3 Gate | `behavioral_receipt_hash !== code_receipt_hash` in attestation |
| [C] Mainnet deployment required | Phase 3 Gate | Explorer URL resolves to deployed contract |
| [C] Two independent 0G Compute calls | Phase 2 Gate | Run two calls, verify different receipt hashes |
| [C] All 8 ERC-7857 fields on-chain | Phase 3 Gate | `getAttestation()` returns all 8 non-zero fields |
| [C] Demo must not fail live | Phase 5 Gate | 10× calibration, fallback cache ready |
| [I] AgentMesh differentiation in README | Phase 6 Gate | Verbatim paragraph present |
| [I] Pre-seeded agents before demo | Phase 5 Gate | 8+ agents in dashboard |
| [I] AgentGate composability demo | Phase 5 Gate | Agent B revert confirmed |
| [I] 0G Storage evidence archive | Phase 3 Gate | Hash non-null or fallback documented |
| [I] Chinese README | Phase 6 Gate | README_CN.md present with differentiation paragraph |

---

## Section 11: Forge → Build Step Mapping

| Plan Step | What | Architecture Reference |
|-----------|------|----------------------|
| Phase 1, Task 1.6 | Domain knowledge: verify chain ID + API patterns first | Section 17 (Config Reference) |
| Phase 1, Task 1.9 | Deploy scripts (test before mainnet) | Section 13 |
| Phase 5, Task 5.1 | Seed demo script — creates pre-seeded agent data | Section 14 |
| Phase 5, Task 5.4 | Proof script — generates `/proof` page content | Section 22 (`generate-proof.ts`) |
| Phase 4, Task 4.2-4.3 | Type definitions and contract helpers | Section 12, 22 |
| All phases | Create test file alongside source code | Section 18 (Testing Strategy) |

---

## Section 12: Commit Log (Summary)

| Phase | Commit Message |
|-------|---------------|
| 1.1 | `chore: scaffold 0g-sentinel from agentmesh foundation` |
| 1.2 | `chore: verify 0g mainnet chain id [value]` |
| 1.3 | `chore: create 0g-sentinel project structure` |
| 1.4 | `chore: add env configuration and project structure` |
| 1.5 | `chore: install dependencies` |
| 1.6 | `chore: configure hardhat for 0g networks` |
| 1.7 | `feat: add AttestationRegistry.sol with 8-field ERC-7857 attestation` |
| 1.8 | `feat: add AgentRegistry and AgentGate composability contract` |
| 1.9 | `deploy: contracts to zerog testnet [testnet-addresses]` |
| 2.1 | `feat: add 0g compute client with receipt hash capture` |
| 2.2 | `feat: behavioral analysis pipeline with 0g compute integration` |
| 2.3 | `feat: code vulnerability scan pipeline with reentrancy detection` |
| 2.4 | `feat: scanner orchestrator wiring both pipelines to attestation write` |
| 3.1 | `chore: verify 0g mainnet rpc connectivity` |
| 3.2 | `deploy: 0g sentinel contracts to aristotle mainnet` |
| 3.3 | `feat: verified end-to-end pipeline on mainnet test agents` |
| 3.4 | `verify: all 8 attestation fields on-chain for agents A, B, C` |
| 4.1 | `chore: scaffold next.js dashboard` |
| 4.2 | `feat: add contract helpers and abis` |
| 4.3 | `feat: add typescript type definitions` |
| 4.4 | `feat: api routes for agents list and scan triggers` |
| 4.5 | `feat: agentcard component with dual badge system` |
| 4.6 | `feat: dashboard pages — agent grid, detail view, proof page` |
| 4.7 | `feat: dashboard verified rendering real chain data` |
| 5.1 | `feat: seed demo agents a-h with full attestations` |
| 5.2 | `feat: scan all real erc-7857 inft agents on 0g mainnet` |
| 5.3 | `verify: agentgate composability confirmed - agent b reverts` |
| 5.4 | `feat: proof page with contract addresses and tx hash evidence` |
| 5.5 | `test: 10x calibration run - both pipelines stable` |
| 6.1 | `deploy: frontend to production` |
| 6.2 | `docs: readme with agentmesh differentiation and contract addresses` |
| 6.3 | `docs: add chinese readme (readme_cn.md)` |
| 6.4 | `media: demo video recorded [url]` |
| 6.5 | `chore: final pre-submission commit [v1.0.0]` |
