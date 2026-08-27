# FOR[Dami]: Sentinel ProofLock

## The Product in Plain English

Sentinel used to publish security scores. ProofLock turns a verified score into a temporary permission another smart contract can enforce.

An agent first proves which ERC-8004 identity and wallet it currently controls. Sentinel runs deterministic checks and a 0G Compute analysis, stores the exact evidence on 0G Storage, retrieves it to prove it is really there, and seals a seven-day lease on 0G Chain. AgentGateV2 then answers one question for any consumer: “May this agent act right now?”

The important upgrade is not another dashboard. It is the fail-closed chain connecting evidence to action.

## Why the Lease Expires

Security evidence becomes stale. A seven-day lease forces periodic re-evaluation, while a 30-day contract maximum prevents a scanner from accidentally issuing effectively permanent approval.

## What the Product Does Not Claim

One authorized wallet still issues and can revoke leases in this hackathon release. ProofLock discloses that trust boundary. It guarantees explicit provenance, reproducible evidence, freshness, drift checks, and contract enforcement—not decentralized consensus among auditors.

## Build Notes

### The three-contract core

- `SentinelRegistryV2` stores the latest compact lease. Scanner and guardian permissions are separate, every lease has complete proof commitments, and old versions are reconstructible from events.
- `AgentGateV2` resolves the current ERC-8004 agent wallet and returns a stable reason code. A wallet change, expired lease, stale policy, missing coverage, risk failure, revocation, drift, or direct runtime-code change fails closed.
- `ProofLockConsumerDemo` proves enforcement. The admitted agent must be the caller; knowing a safe agent ID is not enough to borrow its permission.

The tests cover the full demo lifecycle: admitted action, drift block, expiry block, and resealed admission. They also exercise malformed registry data, hostile constructor settings, caller spoofing, state-transition conflicts, and exact timestamp boundaries.
