# 0G Sentinel ProofLock

When one smart contract wants to let an AI agent act on its behalf (spend funds, trade, call functions), how does it know the agent is safe right now, and how does it revoke that trust the instant the agent's identity changes? 0G Sentinel ProofLock is the answer: a provable, revocable admission pass for AI agents.

Live on 0G Aristotle Mainnet (chain ID `16661`): https://sentinel-prooflock.vercel.app

## The mental model

ProofLock is not a cage. It does not disable an agent, restrict what an agent can do, or sit between an agent and the world. It is opt-in permission infrastructure, closer to a credit score or a bouncer's clipboard than a lock.

Here is the shape of it. ProofLock resolves an agent's ERC-8004 identity, runs a set of checks, and writes a short-lived, versioned verdict on-chain. Any consumer contract that cares can read that verdict at its own door with one call. If the verdict says allowed, the consumer lets the agent through. If the agent's identity later changes, the verdict flips to denied automatically, and the consumer's door closes on the next call. No one is stopped until a contract voluntarily chooses to check.

"Restriction" only ever happens when a consumer contract decides to gate itself. ProofLock issues the verdict. The consumer enforces it.

Being honest about reach: ProofLock is designed for any 0G contract to import with one line, but today only our own `ProofLockConsumerDemo` calls the gate. No third party integrates it yet. This is a hackathon build. The primitive works end to end on mainnet; the ecosystem adoption is future work.

## How it works: the admission chain

A single scan (a "seal") runs this chain:

1. Resolve the agent's ERC-8004 identity from the canonical Identity Registry, then bind its current wallet, registration digest, source block, and runtime commitment.
2. Run deterministic checks plus behavioral and code risk analysis. The risk inference runs on 0G Compute inside a hardware TEE (Intel TDX / dstack) with a separated enclave signer. The host is centralized and proxies to OpenRouter, so this is TEE-attested, not decentralized compute.
3. Upload the exact canonical evidence bytes to 0G Storage, recompute the root locally, and confirm the finalized Flow transaction.
4. Write a time-limited, versioned lease to `SentinelRegistryV2`.
5. `AgentGateV2` then returns a stable allow or deny result with a reason code, recomputed from live on-chain state on every read.

The response bytes are exact-byte bound (`sha256(response)` equals the enclave-signed hash). The request commitment is the enclave-attested normalized hash, because the provider proxies to OpenRouter and re-serializes the request.

The risk analysis returns plain-English reasoning and named factors, and that reasoning is tamper-proof because it lives inside the enclave-signed output. Be clear about depth: the gating logic is deep and heavily tested; the risk signal itself is real but currently modest (deterministic checks plus one TEE inference). Treat it as a tamper-proof verifiable attestation, not a deep forensic audit.

### Drift and revocation

This is the "revocable" half of the pass. If the agent's identity or registration changes, the gate flips to `DENIED` on its own, recomputed from live on-chain state on every read (no cron, no background monitor). A guardian can additionally mark the lease `DRIFTED` on-chain. Access returns only after a reseal, which creates a new version. We prove this full loop on mainnet: seal to consumer-accept to drift (accept reverts) to reseal to consumer-accept again. Transaction hashes are in `submission/proof.md`.

## For users

Four pages, no login. All live at https://sentinel-prooflock.vercel.app.

- **`/scan`** : Scan any agent. Enter an ERC-8004 agent ID or a plain wallet address (address input resolves to the agent ID for you) and it runs a real on-chain seal ceremony against 0G mainnet: identity, deterministic checks, behavioral and code risk via 0G Compute, 0G Storage upload, a versioned `SentinelRegistryV2` lease, and an `AgentGateV2` decision. The sealed result is reconciled on-chain.
- **`/agents`** : A risk leaderboard of scanned agents, ranked by combined behavioral and code risk, plus a recent finalized activity table. This is recent finalized activity, not a complete index.
- **`/agents/:address`** : Per-agent detail: identity, lease, gate decision, evidence, drift and reseal state, the plain-English verdict, and an attestation-history timeline (v1 seal, drift, reseal). The timeline links a version to its predecessor by `previousProofId` (one hop).
- **`/proof`** : A public verifier. Re-verify any historical proof yourself, plus independent subsystem health probes.

## For developers and integrators

### Gate a contract in one line

`AgentGateV2` is the whole integration surface. Import the interface and call it at your door. It is a pure view function, so it costs no gas beyond your own call and cannot alter state.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentGateV2 {
    // reverts AgentRejected(reason) if the agent is not currently admitted
    function requireAgent(uint256 agentId) external view returns (address subject, uint64 version);
}

contract MyProtocol {
    IAgentGateV2 public immutable gate;

    constructor(address gateAddress) {
        gate = IAgentGateV2(gateAddress); // AgentGateV2 on 0G mainnet
    }

    function doSomethingForAgent(uint256 agentId) external {
        // one line: admits or reverts
        (address subject, uint64 version) = gate.requireAgent(agentId);
        require(msg.sender == subject, "caller is not the bound agent wallet");
        // ... your logic runs only for a currently-admitted agent
    }
}
```

That is exactly what `ProofLockConsumerDemo` (deployed, see below) does. If you prefer a non-reverting branch, call `checkAgent` instead:

```solidity
interface IAgentGateV2Check {
    function checkAgent(uint256 agentId)
        external
        view
        returns (bool allowed, uint8 reason, address subject, uint64 version);
}
```

`reason` is a stable code. `0` is `ALLOWED`. Non-zero values name the exact rejection, including `NO_PROOF` (1), `DRIFTED` (3), `EXPIRED` (4), `SUBJECT_CHANGED` (5), and `RUNTIME_CODE_DRIFT` (6). The full set is defined as constants in `contracts/AgentGateV2.sol`.

### Read APIs

For off-chain integrations and verifiers:

- `GET /api/v1/prooflocks/:identityKey` : current lease, identity enrichment, and gate decision.
- `GET /api/v1/proofs/:proofId/verify?identityKey=…` : retrieve stored evidence from 0G Storage and recompute it.
- `GET /api/discover` : recent finalized ProofLock activity.
- `GET /api/agents/resolve-address` : resolve a wallet address to its ERC-8004 agent ID.
- `GET /api/health` : six independent timestamped subsystem probes.

### Verify evidence yourself

You do not have to trust our UI. The `/proof` page and the `/api/v1/proofs/:proofId/verify` endpoint both re-download the exact evidence bytes from 0G Storage, recompute the root, and re-verify the enclave signature offline. The offline verifier checks `signatureVerified`, `transcriptVerified`, and `serviceSnapshotVerified` independently of the seal that produced them.

### ERC-8004 identity binding

The seal binds `subject == getAgentWallet(agentId)` and re-resolves the registration card at a finalized block. Identity is the canonical mainnet ERC-8004 Identity Registry, not a copy.

### Operator seal ceremony

The production operator ships in the application bundle and never loads executable code from a runtime filesystem path. The API accepts only identity, mode, expected prior version, and prior proof ID; registry address, scanner, software version, policy version, and TTL are injected server-side. The Compute payer key is isolated from Registry authority; the scanner signs Storage and Registry writes; the guardian is distinct and only marks drift.

```bash
npm run prooflock:run   -- /absolute/path/to/operator-input.json
npm run prooflock:drift -- 0x<identity-key> [--mark]
```

## Deployed contracts (0G Aristotle Mainnet, chain ID 16661)

| Contract | Address |
|----------|---------|
| SentinelRegistryV2 | `0x1d802114cfAFFd179f49E2F6fa8e11207c118944` |
| AgentGateV2 | `0x32Ae81B1150AA7E91d8341E59b3810950e7A1171` |
| ProofLockConsumerDemo | `0x71823afFA086f6a4Be64B67142480Fa889Cd0773` |
| Canonical ERC-8004 Identity Registry (dependency) | `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` |

Full transaction hashes, storage roots, and the proven seal-drift-reseal lifecycle are in `submission/proof.md`.

## Honest limitations

We keep these visible on purpose.

- **Compute is TEE-attested, not decentralized.** 0G Compute providers are centralized hosts running in a hardware TEE (Intel TDX / dstack) that proxy to OpenRouter. The response is bound to exact bytes; the request commitment is the enclave-attested normalized hash (`requestBytesExact: false` is expected for proxying providers).
- **Storage reports `networkProofVerified: false`.** Retrieval and merkle inclusion are verified; no independent network availability proof is claimed.
- **Compute health is service discovery only (`inferenceExecuted: false`).** The health probe confirms the configured TEE service is discoverable; it does not claim a paid inference ran on that probe. Real paid inference happens during a seal.
- **Legacy V1 is excluded.** The original address-based scanner, `AttestationRegistry`, `AgentRegistry`, the old `AgentGate`, fine-tuning, and iNFT detection are Legacy V1. Their historical deployments remain for provenance only; they are not evidence for any V2 claim, and their old mutation and read endpoints return `410 GONE`.
- **Drift is on-demand, not continuous.** The gate recomputes from live on-chain state on every read, but there is no background monitor that pushes alerts.
- **Discovery is a recent-finalized window, not a complete index.** The proof reader surfaces recent finalized activity, not a full historical backfill. The timeline links versions one hop via `previousProofId`, not a full enumeration.
- **Guardian and validator authority is a disclosed trust boundary** and may be centralized in this build.
- **No third-party integrations yet.** Only `ProofLockConsumerDemo` calls the gate today. The one-line integration above is real and tested, but adoption is future work.
- **The risk signal is modest.** Deterministic checks plus one TEE inference. Tamper-proof verifiable attestation, not a deep forensic audit.

## Testing

- Around 150 Hardhat contract tests. `AgentGateV2` covers every reason code and its boundaries; the registry, edge cases, and the end-to-end seal to drift to reseal loop are all tested.
- 1454+ frontend tests.
- The full lifecycle is proven on mainnet with real transactions (see `submission/proof.md`).

```bash
npm install
cd frontend && npm install && cd ..
npx hardhat test          # contract tests
cd frontend && npm test   # frontend tests
```

## Configuration

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

Public V2 address names are exact and never fall back to legacy addresses:

```text
NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS
NEXT_PUBLIC_AGENT_GATE_V2_ADDRESS
NEXT_PUBLIC_PROOFLOCK_CONSUMER_ADDRESS
NEXT_PUBLIC_PROOFLOCK_VALIDATOR_ADDRESS
```

See the example files for the complete server, health-canary, version, and policy configuration.

### Deploy to 0G mainnet

Set the `PROOFLOCK_*` deployment values documented in both environment examples, keep admin, scanner, and guardian under distinct custody, configure `DEPLOYER_PRIVATE_KEY`, then run:

```bash
npm run deploy:mainnet
```

Preflight rejects non-mainnet chain, storage, and Flow settings, requires at least three confirmations, budgets the full three-contract graph before the first transaction, and writes a resumable journal plus a machine-readable artifact under `deployments/16661/`. The ERC-8004 registry is fixed to its canonical address, never accepted from operator input. Canonical 0G endpoints come from the [official 0G Mainnet overview](https://docs.0g.ai/developer-hub/mainnet/mainnet-overview).

## License

MIT
