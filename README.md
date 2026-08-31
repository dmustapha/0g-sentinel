# 0G Sentinel ProofLock

ProofLock is a policy-scoped admission layer for ERC-8004 agents on 0G Mainnet (chain ID `16661`). It binds a canonical agent identity to a verified evidence envelope, a time-limited onchain lease, and a stable AgentGateV2 decision.

It does **not** certify that an agent is universally safe. Admission means only that the current identity subject, evidence coverage, policy version, lease state, and Gate decision satisfy this deployment's disclosed policy at read time.

## Current V2 flow

1. Resolve an ERC-8004 Agent ID from the canonical Identity Registry.
2. Bind the owner, current agent wallet, registration digest, source block, and runtime commitment.
3. Run typed deterministic checks and two AI-assisted purposes through an acknowledged hardware-TEE-attested (Intel TDX/dstack) separated-signer 0G Compute service. The host is centralized and proxies to OpenRouter; it is not a decentralized operator.
4. Accept Compute evidence only when the SDK's `processResponse` returns `true` and the signed transcript matches the expected provider signer. There is no receipt-eligible hosted-router fallback.
5. Upload the exact canonical envelope bytes to 0G Storage, recompute the 0G root locally, confirm the finalized Flow transaction, retrieve the bytes, and match them again.
6. Write a versioned ProofLock lease to RegistryV2 and read it back.
7. AgentGateV2 returns an explicit allowed/blocked result with a stable reason code.

Proof history is append-preserved by version. Historical artifact validity is separate from current lease and Gate state. On-demand drift can block a consumer action; resealing creates a new version and restores access only after the complete policy succeeds again.

## Honest proof boundaries

- Compute health is service discovery only: `inferenceExecuted: false` and `paidInference: false`. It proves that the configured acknowledged service is discoverable, not that a paid inference just ran.
- Storage proof verification currently reports `networkProofVerified: false`. “Retrieved and root-matched” means the exact bytes were retrieved and recomputed at the recorded observation time; it is not an independently verified network Merkle proof.
- A named operator-authorized validator issues leases. Guardian and validator authority are disclosed trust boundaries and may be centralized in this build.
- Drift checks are on-demand, not continuous monitoring.
- `SAFE` is a policy result, not admission. Only a current lease plus an AgentGateV2 `ALLOWED` decision admits a consumer action.
- Missing, mismatched, stale, wrong-chain, or unavailable evidence fails closed.
- The public `/scan` seal runs against a balance-capped allowance: the server injects the operator token and the spend ceiling is the pre-funded low-value role-key balance. Deployer and subject keys are never on the host, and keys are rotated after the event.
- 0G Compute providers are TEE-attested centralized hosts (Intel TDX / dstack) that proxy to OpenRouter. They are not decentralized. The response is bound to exact bytes; the request commitment is the enclave-attested (normalized) hash.

## Public application

- `/`: resolve an ERC-8004 identity and run an authenticated evaluation
- `/scan`: public scan-and-seal front door: enter any ERC-8004 agentId and run the real seal ceremony (identity, deterministic checks, behavioral and code risk via 0G Compute, 0G Storage, versioned RegistryV2 lease, AgentGateV2 decision) with no login. The sealed result is reconciled on-chain.
- `/agents`: risk-ranking leaderboard of sealed agents (ranked by combined behavioral and code risk via `lib/ranking.ts`), plus the recent finalized ProofLock activity table. This is recent finalized activity, not a complete index.
- `/agents/:agentId`: identity, lease, Gate, evidence, drift, reseal detail, and a per-agent attestation-history timeline (v1 seal, drift, reseal). The timeline links current and previous versions by `previousProofId` (one hop). Full version enumeration is a documented backend deferral.
- `/proof`: public historical proof verifier and independent subsystem health
- `/api/v1/identities/resolve`: guarded canonical identity read
- `/api/v1/prooflocks/:identityKey`: current lease, identity enrichment, and Gate decision
- `/api/v1/proofs/:proofId/verify?identityKey=…`: retrieve and recompute stored evidence
- `/api/health`: six independent timestamped probes
- `/api/scan/stream`: public balance-capped scan-and-seal stream. The server injects the operator token; the spend ceiling is the pre-funded low-value role-key balance. The deployer and subject keys are never on the host, and keys are rotated after the event.
- `/api/admin/prooflocks/stream`: authenticated evaluation stream
- `/api/admin/prooflocks/:identityKey/drift`: authenticated on-demand drift action

Operator tokens are server secrets. The UI keeps an entered token only in component memory for the request and clears it afterward.

## Configuration

Copy both active examples as appropriate:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

V2 public address names are exact and never fall back to Legacy V1 addresses:

```text
NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS
NEXT_PUBLIC_AGENT_GATE_V2_ADDRESS
NEXT_PUBLIC_PROOFLOCK_CONSUMER_ADDRESS
NEXT_PUBLIC_PROOFLOCK_VALIDATOR_ADDRESS
```

See the example files for the complete server, health-canary, version, policy, and optional labeled-demo configuration.

### Run the production operator

ProofLock ships its production operator in the application bundle; it never loads executable code from a
runtime filesystem path. Configure the scanner and guardian keys, their matching RegistryV2 role addresses,
the acknowledged Compute provider/model, and an absolute durable state directory. Set
`PROOFLOCK_SPEND_AUTHORIZED=true` only after accepting paid 0G Compute and Storage operations.

The API accepts only identity, mode, expected prior version, and prior proof ID. Registry address, scanner,
software version, policy version, and seven-day TTL are injected by the server. The same boundary applies to:

```bash
npm run prooflock:run -- /absolute/path/to/operator-input.json
npm run prooflock:drift -- 0x<identity-key> [--mark]
```

The Compute payer key is isolated from Registry authority. The scanner signs Storage and Registry writes; the
guardian is distinct and only marks drift. Every mutation rechecks the separated admin/scanner/guardian role matrix.

ProofLock analyzes proxy and EIP-7702 delegation targets, but this V2 Gate can enforce only the subject's direct
runtime hash. Nested executable subjects therefore fail before paid Compute and cannot receive a lease until a later
Gate version stores and checks the nested executable commitment on every admission.

### Deploy ProofLock V2 to 0G mainnet

Set the nine `PROOFLOCK_*` deployment values documented in both environment examples, keep the admin,
scanner, and guardian under distinct custody, configure `DEPLOYER_PRIVATE_KEY`, then run:

```bash
npm run deploy:mainnet
```

Preflight rejects non-mainnet Chain, Storage indexer, and Flow settings, requires at least three
confirmations, budgets the full three-contract graph before transaction one, and writes a resumable
deployment journal plus a machine-readable artifact under `deployments/16661/`. The ERC-8004 registry
is fixed to its canonical address rather than accepted from operator input. Canonical 0G endpoints and
the Flow address come from the [official 0G Mainnet overview](https://docs.0g.ai/developer-hub/mainnet/mainnet-overview).

## Run and verify

```bash
npm install
cd frontend && npm install
npm test
npm run typecheck
npm run build
cd .. && npx hardhat test
```

## Legacy V1 registries: excluded

The old V1 contracts (`AttestationRegistry`, `AgentRegistry`, the original `AgentGate`), their fictional seeded addresses, address-based scanning, and the old evidence endpoint remain Legacy V1. Their historical deployments and source stay for provenance only. They are excluded from active ProofLock V2 admission, are not evidence for any V2 claim, and their mutation and read endpoints return `410 GONE`.

Scanning, risk ranking, and attestation history are now revived as ProofLock-V2-backed views. They are new surfaces built on the V2 core (RegistryV2, AgentGateV2, the seal ceremony), not the old V1 registries or endpoints. Nothing here reads or trusts the excluded V1 data.

Still out of scope, roadmap only:

- Fine-tuning is not built. Its honest current form is a CLI-command return.
- ERC-7857 iNFT detection is not built (P2).
- A background batch queue is not built (P2).
- A complete historical indexer or backfill is deferred; the timeline links versions one hop via `previousProofId`, not a full enumeration.

Current V2 deployment addresses must come from environment configuration. This repository does not invent a production deployment or treat old attestation transactions as current ProofLock evidence.

## License

MIT
