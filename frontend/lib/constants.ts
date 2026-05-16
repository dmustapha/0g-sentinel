// Shared constants used across frontend pages and API routes.
// Single source of truth — import from here, never redeclare locally.

export const AGENT_NAMES: Record<string, string> = {
  // Demo scenario agents (seeded for demonstration)
  "0xaaaa000000000000000000000000000000000001": "Agent Alpha",
  "0xbbbb000000000000000000000000000000000002": "Agent Beta",
  "0xcccc000000000000000000000000000000000003": "Agent Gamma",
  "0x62d4144db0f0a6fbbaeb6296c785c71b3d57c526": "0G Flow Protocol",
  // 0G Sentinel system contracts (real contracts on 0G Aristotle)
  "0xb3e7048cef229ff5043cd2dbba296bf278d3f88d": "0G Sentinel: AttestationRegistry",
  "0xcc1cd4550ec98ddcb19f9200331f3e96cab97fac": "0G Sentinel: AgentRegistry",
  "0xca3338af9a1e0df0539c3c8967597a56044d9360": "0G Sentinel: AgentGate",
};

/**
 * Contracts that should always appear on the dashboard as scan targets,
 * even before anyone has explicitly registered them.
 * Source of truth: the 0G Aristotle chain — these addresses have real bytecode.
 */
export const KNOWN_0G_CONTRACTS: string[] = [
  // 0G Sentinel system contracts — real on-chain contracts, interesting to audit
  "0xB3E7048cef229fF5043CD2dBba296bF278d3F88d", // AttestationRegistry
  "0xcc1cd4550ec98DDcB19F9200331f3E96cab97fAc", // AgentRegistry
  "0xCA3338Af9A1E0Df0539c3C8967597A56044D9360", // AgentGate
];

/** Resolve a display name from a lowercase address. */
export function agentDisplayName(address: string, shortFallback = true): string {
  const known = AGENT_NAMES[address.toLowerCase()];
  if (known) return known;
  return shortFallback
    ? `Agent ${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}
