import { describe, expect, it } from "vitest";
import { checkThreatIntel, type ThreatIntelDeps } from "../../server/prooflock/analysis/threat-intel";

const CLEAN = "0x1111111111111111111111111111111111111111";
const OFAC_HIT = "0x8589427373D6d84E98730D7795D8f6f8731FDA16"; // in the seed list (mixed case on purpose)

// A deps builder with sensible defaults; each test overrides what it needs.
function makeDeps(over: Partial<ThreatIntelDeps> = {}): ThreatIntelDeps {
  return {
    ofac: new Set<string>(["0x8589427373d6d84e98730d7795d8f6f8731fda16"]),
    chainalysisApiKey: "test-key",
    scamsnifferApiKey: "test-key",
    fetchJson: async () => ({ identifications: [], status: "PASSED" }),
    ...over,
  };
}

describe("checkThreatIntel", () => {
  it("OFAC local hit => sanctioned + hard signal, matched case-insensitively", async () => {
    const t = await checkThreatIntel(OFAC_HIT, makeDeps());
    expect(t.sanctioned).toBe(true);
    const sig = t.signals.find((s) => s.id === "sanctioned");
    expect(sig?.hard).toBe(true);
    expect(sig?.value).toBe(1);
    expect(sig?.weight).toBe(1);
    expect(t.sources.find((s) => s.name === "OFAC")?.status).toBe("HIT");
  });

  it("Chainalysis non-empty identifications => sanctioned", async () => {
    const deps = makeDeps({
      fetchJson: async (url) =>
        url.includes("chainalysis")
          ? { identifications: [{ category: "sanctions", name: "SDN Entity" }] }
          : { status: "PASSED" },
    });
    const t = await checkThreatIntel(CLEAN, deps);
    expect(t.sanctioned).toBe(true);
    expect(t.sources.find((s) => s.name === "Chainalysis")?.status).toBe("HIT");
    expect(t.signals.some((s) => s.id === "sanctioned" && s.hard)).toBe(true);
  });

  it("ScamSniffer blocked => scamFlagged with a hard signal", async () => {
    const deps = makeDeps({
      fetchJson: async (url) =>
        url.includes("scamsniffer") ? { status: "BLOCKED" } : { identifications: [] },
    });
    const t = await checkThreatIntel(CLEAN, deps);
    expect(t.scamFlagged).toBe(true);
    expect(t.sanctioned).toBe(false);
    const sig = t.signals.find((s) => s.id === "scam_flagged");
    expect(sig?.hard).toBe(true);
    expect(t.sources.find((s) => s.name === "ScamSniffer")?.status).toBe("HIT");
  });

  it("handles a boolean blocked field from ScamSniffer", async () => {
    const deps = makeDeps({
      fetchJson: async (url) =>
        url.includes("scamsniffer") ? { blocked: true } : { identifications: [] },
    });
    const t = await checkThreatIntel(CLEAN, deps);
    expect(t.scamFlagged).toBe(true);
  });

  it("all network sources down (fetchJson throws) => UNAVAILABLE, not sanctioned, no throw", async () => {
    const deps = makeDeps({
      fetchJson: async () => {
        throw new Error("network down");
      },
    });
    const t = await checkThreatIntel(CLEAN, deps);
    expect(t.sanctioned).toBe(false);
    expect(t.scamFlagged).toBe(false);
    expect(t.signals).toEqual([]);
    expect(t.sources.find((s) => s.name === "Chainalysis")?.status).toBe("UNAVAILABLE");
    expect(t.sources.find((s) => s.name === "ScamSniffer")?.status).toBe("UNAVAILABLE");
    // OFAC is local so it still resolves cleanly even when the network is dead.
    expect(t.sources.find((s) => s.name === "OFAC")?.status).toBe("CLEAR");
  });

  it("no Chainalysis key => that source is UNAVAILABLE, never fails", async () => {
    const deps = makeDeps({ chainalysisApiKey: undefined });
    const t = await checkThreatIntel(CLEAN, deps);
    const entry = t.sources.find((s) => s.name === "Chainalysis");
    expect(entry?.status).toBe("UNAVAILABLE");
    expect(entry?.detail).toContain("No API key");
    expect(t.sanctioned).toBe(false);
  });

  it("clean address => all CLEAR, empty signals", async () => {
    const t = await checkThreatIntel(CLEAN, makeDeps());
    expect(t.sanctioned).toBe(false);
    expect(t.scamFlagged).toBe(false);
    expect(t.signals).toEqual([]);
    expect(t.sources.every((s) => s.status === "CLEAR")).toBe(true);
    expect(t.sources).toHaveLength(3);
  });
});
