# 0G Sentinel ProofLock

ProofLock is a policy-scoped admission layer for ERC-8004 agents on 0G Mainnet (chain ID `16661`). It binds a canonical agent identity to a verified evidence envelope, a time-limited onchain lease, and a stable AgentGateV2 decision.

It does **not** certify that an agent is universally safe. Admission means only that the current identity subject, evidence coverage, policy version, lease state, and Gate decision satisfy this deployment's disclosed policy at read time.

## Current V2 flow

1. Resolve an ERC-8004 Agent ID from the canonical Identity Registry.
2. Bind the owner, current agent wallet, registration digest, source block, and runtime commitment.
3. Run typed deterministic checks and two AI-assisted purposes through an acknowledged decentralized separated-model 0G Compute service.
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

## Public application

- `/` — resolve an ERC-8004 identity and run an authenticated evaluation
- `/agents` — current ProofLock V2 lease inventory
- `/agents/:agentId` — identity, lease, Gate, evidence, drift, and reseal detail
- `/proof` — public historical proof verifier and independent subsystem health
- `/api/v1/identities/resolve` — guarded canonical identity read
- `/api/v1/prooflocks/:identityKey` — current lease, identity enrichment, and Gate decision
- `/api/v1/proofs/:proofId/verify?identityKey=…` — retrieve and recompute stored evidence
- `/api/health` — six independent timestamped probes
- `/api/admin/prooflocks/stream` — authenticated evaluation stream
- `/api/admin/prooflocks/:identityKey/drift` — authenticated on-demand drift action

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
npx ts-node scripts/prooflock/run.ts /absolute/path/to/operator-input.json
npx ts-node scripts/prooflock/check-drift.ts 0x<identity-key> [--mark]
```

The scanner private key signs Compute, Storage, and Registry writes; the guardian key is distinct and only
marks drift. Startup verifies both configured addresses against their keys and their onchain RegistryV2 roles.

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

## Legacy V1 — excluded

`AttestationRegistry`, `AgentRegistry`, the original `AgentGate`, address-based scanning, background queue, risk ranking, fine-tuning, fictional seeded addresses, and the old evidence endpoint are Legacy V1. Their historical deployments and source remain for provenance, but they are excluded from active ProofLock V2 admission and are not evidence for V2 claims. Legacy mutation/read endpoints return `410 GONE`.

Current V2 deployment addresses must come from environment configuration. This repository does not invent a production deployment or treat old attestation transactions as current ProofLock evidence.

## License

MIT
