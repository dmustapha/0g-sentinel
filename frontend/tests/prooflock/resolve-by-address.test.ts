import { describe, expect, it, vi } from "vitest";
import { id, type Log } from "ethers";

import { resolveAgentIdByAddress, isEvmAddress, type AddressResolverDeps } from "../../server/prooflock/identity/resolve-by-address";

const AGENT_WALLET = "0xDaA09b710cDB279AF411e4a9C4C79D00bfDB282f";
const OTHER = "0x1111111111111111111111111111111111111111";
const REGISTERED_TOPIC = id("Registered(uint256,string,address)");

function log(agentId: bigint, blockNumber: number): Log {
  const idTopic = `0x${agentId.toString(16).padStart(64, "0")}`;
  const ownerTopic = `0x${"0".repeat(24)}${AGENT_WALLET.slice(2).toLowerCase()}`;
  return { topics: [REGISTERED_TOPIC, idTopic, ownerTopic], blockNumber } as unknown as Log;
}

function deps(over: Partial<AddressResolverDeps> = {}): AddressResolverDeps {
  return {
    latestBlock: vi.fn().mockResolvedValue(1_000_000),
    getLogs: vi.fn().mockResolvedValue([]),
    getAgentWallet: vi.fn().mockResolvedValue(AGENT_WALLET),
    ...over,
  };
}

describe("resolveAgentIdByAddress (foolproof)", () => {
  it("returns NOT_AN_AGENT for a non-address input", async () => {
    expect(await resolveAgentIdByAddress("not-an-address", deps())).toEqual({ status: "NOT_AN_AGENT" });
  });

  it("returns NOT_AN_AGENT when no Registered event names the address as owner", async () => {
    const d = deps({ getLogs: vi.fn().mockResolvedValue([]) });
    expect(await resolveAgentIdByAddress(AGENT_WALLET, d)).toEqual({ status: "NOT_AN_AGENT" });
    expect(d.getAgentWallet).not.toHaveBeenCalled();
  });

  it("resolves to the agentId only after on-chain getAgentWallet verification", async () => {
    const d = deps({ getLogs: vi.fn().mockResolvedValue([log(3527152n, 900_000)]) });
    expect(await resolveAgentIdByAddress(AGENT_WALLET, d)).toEqual({ status: "AGENT", agentId: "3527152" });
    expect(d.getAgentWallet).toHaveBeenCalledWith(3527152n);
  });

  it("REFUSES to claim an address as an agent when the on-chain wallet no longer matches (foolproof)", async () => {
    // Event says this address was an owner, but the current agentWallet is someone else: reject.
    const d = deps({ getLogs: vi.fn().mockResolvedValue([log(3527152n, 900_000)]),
      getAgentWallet: vi.fn().mockResolvedValue(OTHER) });
    expect(await resolveAgentIdByAddress(AGENT_WALLET, d)).toEqual({ status: "NOT_AN_AGENT" });
  });

  it("prefers the newest registration and picks the one that verifies", async () => {
    const d = deps({
      getLogs: vi.fn().mockResolvedValue([log(10n, 100), log(99n, 900_000)]),
      getAgentWallet: vi.fn(async (a: bigint) => a === 99n ? AGENT_WALLET : OTHER),
    });
    expect(await resolveAgentIdByAddress(AGENT_WALLET, d)).toEqual({ status: "AGENT", agentId: "99" });
  });

  it("isEvmAddress validates shape", () => {
    expect(isEvmAddress(AGENT_WALLET)).toBe(true);
    expect(isEvmAddress("0x123")).toBe(false);
    expect(isEvmAddress("3527152")).toBe(false);
  });
});
