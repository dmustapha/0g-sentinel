# ProofLock Public Verification Hardening Design

## Trust boundaries

Public verification may report a Gate decision only after a raw 0G mainnet guard, deployed Gate bytecode, and exact `registry()` and `identityRegistry()` pointer checks. The RegistryV2 pointer must equal the configured registry and the identity pointer must equal the canonical ERC-8004 registry.

Historical proofs are located by an optional transaction-hash hint or a bounded recent indexed-log search. A hint provides constant-query recovery for arbitrarily old proofs. The fallback searches only a configured block window with a fixed query budget and bounded negative cache. Outside that window the API returns a stable locator error, never a cryptographic mismatch.

## Historical evidence

A historical result is valid only when its `ProofLocked` event is present in a successful receipt sent to RegistryV2, the receipt and log agree on transaction/block identity, the canonical block hash matches, and the inclusion block is below the configured finalized head. The public source includes registry address, transaction hash, block number, block hash, and log index.

## Storage taxonomy

Missing Flow configuration, missing Flow bytecode, provider failure, incomplete receipts, and absence of any indexed root candidate are dependency failures. Once a pinned Flow event identifies the requested root, conflicting transaction origin/calldata or canonical artifact binding is a non-retryable proof mismatch.

## Testing

Tests cover Gate bytecode/pointer adversaries; hinted proofs more than 100,000 blocks old; bounded fallback queries and negative caching; receipt, finality, block-hash, and exact-log adversaries; and Storage dependency-versus-mismatch classification.
