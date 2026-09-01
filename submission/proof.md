# 0G Sentinel ProofLock: Submission Proof

The problem: when one smart contract wants to let an AI agent act on its behalf (spend funds, trade, call functions), how does it know the agent is safe right now, and how does it revoke that trust the instant the agent's identity changes? ProofLock is a provable, revocable admission pass for AI agents. It does not disable or restrict any agent; it issues a verifiable on-chain verdict that other contracts choose to enforce at their own door, with one call (`gate.requireAgent(agentId)`). Today only our own `ProofLockConsumerDemo` calls it; it is designed for any 0G contract to import, but no third party integrates it yet (hackathon). The evidence below proves the full seal, drift, and reseal lifecycle on mainnet.

Network: 0G Aristotle Mainnet (Chain ID: 16661) · RPC: `https://evmrpc.0g.ai` · Explorer: `https://chainscan.0g.ai`
Live dashboard: https://sentinel-prooflock.vercel.app

All values below are real on-chain transactions and 0G Storage roots produced by running the full
funded ceremony against 0G mainnet. Nothing here is a fixture.

## Deployed contracts (V2)

| Contract | Address | From block |
|----------|---------|-----------|
| SentinelRegistryV2 | `0x1d802114cfAFFd179f49E2F6fa8e11207c118944` | 43090189 |
| AgentGateV2 | `0x32Ae81B1150AA7E91d8341E59b3810950e7A1171` | n/a |
| ProofLockConsumerDemo | `0x71823afFA086f6a4Be64B67142480Fa889Cd0773` | n/a |
| Canonical ERC-8004 Identity Registry (dependency) | `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` | n/a |

Role separation is enforced at deploy time (deployer distinct from admin/scanner/guardian):
admin `0x2988609Bc97FA5D03999a93750D7944A35617Ebc`,
scanner `0x361A8776a1C32f2CB5A84b6dEDF43D97205167AA`,
guardian `0x3492C09313B610A200264AB8f78BC263A06b0D4d`.

## ERC-8004 agent identity

Registered on the canonical registry, `agentWallet == subject` (the seal binds them):

- agentId `3527152`, agentWallet/subject `0xDaA09b710cDB279AF411e4a9C4C79D00bfDB282f`
- register tx `0x5b1672b0e3ba6e1b5905299c36419478e4d4f507d59029dd9c39514666266b21`
- registration card (`setAgentURI`) tx `0x63c70e4f9b0ad021ecf0e05c6df2478508d5dc2455ea31240e52d4e05d8ee654`

## Real seal-grade 0G Compute proof

A paid inference round-trips through discovery → eligibility → the isolated subprocess SDK worker →
the SSRF-guarded transport → model binding → EIP-191 signature verification → SDK settlement, then
the offline verifier independently re-verifies it.

- provider `0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C` (registered `zai-org/GLM-5-FP8`, served `z-ai/glm-5`)
- enclave signer `0x4c1b546f5fc11a9c2428eafed1d951aa13c17ee8`, verifiability `TeeML` (Intel TDX / dstack), separated signer
- response bound to EXACT bytes (`rawResponseSha256 == sha256(response) == enclave-signed hash`)
- request commitment is the enclave-attested hash (`requestBytesExact: false`) because the provider proxies to OpenRouter and re-serializes the request; our raw request bytes are retained for transparency
- offline re-verify: `signatureVerified + transcriptVerified + serviceSnapshotVerified`

## Funded lifecycle on 0G mainnet

Identity key `0xf89c397909cc23a344999b4d6a7738fca5324143c0b2bcafb8a716277ae56d78`.

| Step | Result | Evidence |
|------|--------|----------|
| SEAL v1 | gate ALLOWED | seal tx `0x8e9333fb0ae45c8900d6066d3312d4145ed0966d67ff2e3c557c08acda586c39`; 0G Storage root `0xade600cc75bf0fee228c712a304f90bcb240693bf6af32231de09668a6fd4bec`, upload tx `0xce85fe311f2063d3c408528567e1e167c827f743e5fdf684045c010a3a27299f`, finalized block 43111520 |
| Consumer accept (v1) | accepted | tx `0x099cf5c9be95f83c75d07d9d129ea38079960e9bb6797102278e80bd7af908a7` (acceptedCount → 1) |
| DRIFT | registration digest changed → gate DENIED | card rotate tx `0x3ef17fcb9eb4c859080c4429f8262774e0a7a6aa4db3cb1c743c5b3eadc2b8eb`; guardian drift mark tx `0x4e86d50cb2a24421fa7c1256e93846008f5af790e6f655f24397761bd6f2d178`; consumer.acceptAgent reverted |
| RECOVER | fresh process reproduced sealed v1 state from chain + 0G Storage | drift re-detected read-only, version 1 matched |
| RESEAL v2 | gate ALLOWED | reseal tx `0x6fce85904517381e834f85defd900fb8d9403ad0aac63d0f7be6ab7674b7f2bb`; storage root `0x1891d590bb93181ee1fee2376380116cdcddd9aace2d79108a2d59ad29f5ca9a`, upload tx `0xf5b91e7da7e6463072796598d7ab53bc1bcb25ee676c22f5604d0332946b7d32`, finalized block 43116385; previous proofId `0xb64e28f0ff606cab1dfc8dd9b7784a207cb955e2c094be98a0d573b53ef37e38` |
| Consumer accept (v2) | accepted | tx `0x57daad296435e392efabe911387c2e8a61497c960a937eab49a8f66c8369456d` (acceptedCount → 2) |
| Public verifier | reproduced the historical proof | current proofId `0xa4c3bf5c178efaebc568f3d96b98e76c1e7bcd921dc230bccb0938c66028e7c2`; detail status VERIFIED, gate allowed, consumer accepted, storage `retrievalVerified: true` |

## Revived product surface (live)

The former V1 features are revived on top of the ProofLock V2 core. These are new views over V2 state, not the excluded V1 registries. All are live at https://sentinel-prooflock.vercel.app:

- **`/scan`**: public scan-and-seal front door. Enter any ERC-8004 agentId and the real seal ceremony runs (identity, deterministic checks, behavioral and code risk via 0G Compute, 0G Storage, versioned RegistryV2 lease, AgentGateV2 decision), then reconciles the sealed result on-chain. No login. Backed by the public `/api/scan/stream` endpoint: the server injects the operator token and the spend ceiling is the pre-funded low-value role-key balance. Deployer and subject keys are never on the host; keys are rotated after the event.
- **`/agents` leaderboard**: sealed agents ranked by combined behavioral and code risk (`lib/ranking.ts`), plus the recent finalized ProofLock activity table. Scope is recent finalized activity, not a complete index.
- **Per-agent attestation timeline**: on `/agents/:agentId`, the v1-seal / drift / reseal history. It links current and previous versions by `previousProofId` (one hop). Full version enumeration is a documented backend deferral.

Honest limitations for this surface: fine-tuning and ERC-7857 iNFT detection are not built (roadmap); no background batch queue; no complete historical indexer or backfill; 0G Compute providers are TEE-attested centralized hosts (Intel TDX / dstack) proxying to OpenRouter, not decentralized.

## 0G integration summary

- **0G Compute**: mandatory hardware-TEE (TeeML / Intel TDX / dstack) inference through the 0G Compute broker with a separated enclave signer; the strict broker binds the exact response bytes and the enclave-attested request hash, then the SDK settlement (`processResponse`) verifies on-chain accounting. Runs in an isolated subprocess with an SSRF-guarded, credential-stripped transport.
- **0G Storage**: the canonical evidence envelope is uploaded to 0G Storage (`@0gfoundation/0g-storage-ts-sdk`); the public verifier re-downloads it with a merkle proof and reconstructs the finalized Flow commitment by scanning `FixedPriceFlow` `Submit` logs and folding the submission subtree roots into the file root.
- **0G Chain**: proofs are written to `SentinelRegistryV2` with append-only versioning; `AgentGateV2.checkAgent` is a pure-view admission oracle (ALLOWED / NO_PROOF / DRIFTED / SUBJECT_CHANGED / RUNTIME_CODE_DRIFT), and `ProofLockConsumerDemo.acceptAgent` is the composability primitive that only accepts a subject the gate allows.
- **ERC-8004**: identity is the canonical mainnet Identity Registry; the seal binds `subject == getAgentWallet(agentId)` and re-resolves the registration card at a finalized block.

## Signed limitations (honest scope)

- The request digest is the enclave's normalized (proxy) view, not our raw POST bytes; the response is bound to exact bytes. `requestBytesExact: false` is expected and benign for OpenRouter-proxying providers.
- Storage `networkProofVerified: false` by design: retrieval + merkle inclusion are verified; no independent network availability proof is claimed.
- The proof reader surfaces recent finalized activity from `PROOFLOCK_REGISTRY_V2_FROM_BLOCK`; a complete historical indexer/backfill is a documented deferral, not a silent omission.
