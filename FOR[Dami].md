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

This document will be expanded after each completed implementation phase with the exact contracts, APIs, UI flow, and proof commands.
