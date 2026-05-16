// Shared constants used across frontend pages and API routes.
// Single source of truth — import from here, never redeclare locally.

export const AGENT_NAMES: Record<string, string> = {
  "0xaaaa000000000000000000000000000000000001": "Agent Alpha",
  "0xbbbb000000000000000000000000000000000002": "Agent Beta",
  "0xcccc000000000000000000000000000000000003": "Agent Gamma",
};

/** Resolve a display name from a lowercase address. */
export function agentDisplayName(address: string, shortFallback = true): string {
  const known = AGENT_NAMES[address.toLowerCase()];
  if (known) return known;
  return shortFallback
    ? `Agent ${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}
