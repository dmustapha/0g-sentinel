import { describe, expect, it, vi } from "vitest";

import {
  collectAddressEvidence,
  type EvidenceCollectorDeps,
} from "../../server/prooflock/analysis/evidence-collector";

const EOA = "0x1111111111111111111111111111111111111111";
const CONTRACT = "0x2222222222222222222222222222222222222222";
const CONTRACT_CODE = "0x6080604052348015600f57600080fd";

// Build deps whose explorer responses are driven by a URL -> envelope router. Anything not routed
// returns an empty OK envelope so unrelated endpoints never fail the test.
function makeDeps(overrides: {
  route?: (url: string) => unknown;
  code?: string;
  nonce?: number;
  balance?: string;
  latestBlock?: number;
  fetchJson?: EvidenceCollectorDeps["fetchJson"];
} = {}): EvidenceCollectorDeps {
  return {
    fetchJson:
      overrides.fetchJson ??
      vi.fn(async (url: string) =>
        overrides.route ? overrides.route(url) : { status: "1", message: "OK", result: [] },
      ),
    getCode: vi.fn(async () => overrides.code ?? "0x"),
    getNonce: vi.fn(async () => overrides.nonce ?? 0),
    getBalance: vi.fn(async () => overrides.balance ?? "0"),
    latestBlock: vi.fn(async () => overrides.latestBlock ?? 500),
  };
}

function envelope(result: unknown[]): unknown {
  return { status: "1", message: "OK", result };
}

describe("collectAddressEvidence", () => {
  it("collects evidence for a normal EOA with OK coverage", async () => {
    const deps = makeDeps({
      nonce: 7,
      balance: "1000000000000000000",
      latestBlock: 4242,
      route: (url) =>
        url.includes("action=txlist&")
          ? envelope([
              {
                hash: "0xabc",
                blockNumber: "10",
                timeStamp: "1700000000",
                from: EOA,
                to: "0x9999999999999999999999999999999999999999",
                value: "5",
                input: "0x",
                gasUsed: "21000",
                txreceipt_status: "1",
              },
            ])
          : envelope([]),
    });

    const evidence = await collectAddressEvidence(EOA, deps);

    expect(evidence.isContract).toBe(false);
    expect(evidence.nonce).toBe(7);
    expect(evidence.balanceWei).toBe("1000000000000000000");
    expect(evidence.observedAtBlock).toBe(4242);
    expect(evidence.coverage).toEqual({ explorer: "OK", rpc: "OK" });
    expect(evidence.transactions).toHaveLength(1);
    expect(evidence.transactions[0].methodId).toBe("0x");
    expect(evidence.transactions[0].to).toBe("0x9999999999999999999999999999999999999999");
    expect(evidence.sourceVerified).toBe(false);
    expect(evidence.source).toBeNull();
    // A contract source lookup must be skipped for an EOA.
    expect(deps.fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("action=getsourcecode"),
      expect.anything(),
    );
  });

  it("marks a contract and reads verified source", async () => {
    const deps = makeDeps({
      code: CONTRACT_CODE,
      route: (url) =>
        url.includes("action=getsourcecode")
          ? { status: "1", message: "OK", result: [{ SourceCode: "contract C {}", ContractName: "C" }] }
          : envelope([]),
    });

    const evidence = await collectAddressEvidence(CONTRACT, deps);

    expect(evidence.isContract).toBe(true);
    expect(evidence.code).toBe(CONTRACT_CODE);
    expect(evidence.sourceVerified).toBe(true);
    expect(evidence.source).toBe("contract C {}");
    expect(evidence.coverage.explorer).toBe("OK");
  });

  it("treats the 'not verified' sentinel as unverified", async () => {
    const deps = makeDeps({
      code: CONTRACT_CODE,
      route: (url) =>
        url.includes("action=getsourcecode")
          ? { status: "1", message: "OK", result: [{ SourceCode: "Contract source code not verified" }] }
          : envelope([]),
    });

    const evidence = await collectAddressEvidence(CONTRACT, deps);

    expect(evidence.sourceVerified).toBe(false);
    expect(evidence.source).toBeNull();
  });

  it("returns RPC floor evidence with explorer UNAVAILABLE when the explorer throws", async () => {
    const deps = makeDeps({
      nonce: 3,
      code: CONTRACT_CODE,
      balance: "42",
      fetchJson: vi.fn(async () => {
        throw new Error("explorer down");
      }),
    });

    const evidence = await collectAddressEvidence(CONTRACT, deps);

    expect(evidence.coverage).toEqual({ explorer: "UNAVAILABLE", rpc: "OK" });
    expect(evidence.nonce).toBe(3);
    expect(evidence.code).toBe(CONTRACT_CODE);
    expect(evidence.isContract).toBe(true);
    expect(evidence.balanceWei).toBe("42");
    expect(evidence.transactions).toEqual([]);
    expect(evidence.tokenTransfers).toEqual([]);
    expect(evidence.internalTxns).toEqual([]);
    expect(evidence.source).toBeNull();
  });

  it("reports PARTIAL coverage when only some explorer endpoints fail", async () => {
    const deps = makeDeps({
      route: (url) => {
        if (url.includes("action=tokentx")) throw new Error("token endpoint down");
        return envelope([]);
      },
    });

    const evidence = await collectAddressEvidence(EOA, deps);

    expect(evidence.coverage.explorer).toBe("PARTIAL");
    expect(evidence.coverage.rpc).toBe("OK");
  });

  it("extracts methodId from calldata and maps isError", async () => {
    const deps = makeDeps({
      route: (url) =>
        url.includes("action=txlist&")
          ? envelope([
              {
                hash: "0xapprove",
                blockNumber: "20",
                timeStamp: "1700000100",
                from: EOA,
                to: "0x3333333333333333333333333333333333333333",
                value: "0",
                input: "0x095ea7b3000000000000000000000000deadbeef",
                gasUsed: "50000",
                txreceipt_status: "0",
              },
              {
                hash: "0xfail",
                blockNumber: "19",
                timeStamp: "1700000090",
                from: EOA,
                to: "0x4444444444444444444444444444444444444444",
                value: "1",
                input: "0x",
                gasUsed: "21000",
                isError: "1",
              },
            ])
          : envelope([]),
    });

    const evidence = await collectAddressEvidence(EOA, deps);

    expect(evidence.transactions[0].methodId).toBe("0x095ea7b3");
    expect(evidence.transactions[0].isError).toBe(true); // txreceipt_status === "0"
    expect(evidence.transactions[0].input).toContain("095ea7b3");
    expect(evidence.transactions[1].methodId).toBe("0x");
    expect(evidence.transactions[1].isError).toBe(true); // isError === "1"
  });

  it("caps transactions to maxTxns and keeps them newest-first", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      hash: `0x${i}`,
      blockNumber: String(i), // ascending on purpose; collector must re-sort descending
      timeStamp: "1700000000",
      from: EOA,
      to: EOA,
      value: "0",
      input: "0x",
      gasUsed: "21000",
      txreceipt_status: "1",
    }));
    const deps = makeDeps({
      route: (url) => (url.includes("action=txlist&") ? envelope(rows) : envelope([])),
    });

    const evidence = await collectAddressEvidence(EOA, deps, { maxTxns: 3 });

    expect(evidence.transactions).toHaveLength(3);
    expect(evidence.transactions.map((tx) => tx.blockNumber)).toEqual([9, 8, 7]);
  });

  it("throws when the RPC cannot supply nonce or code", async () => {
    const deps = makeDeps();
    (deps.getNonce as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("rpc dead"));

    await expect(collectAddressEvidence(EOA, deps)).rejects.toThrow(/RPC unavailable/);
  });

  it("rejects an invalid address before touching the network", async () => {
    const deps = makeDeps();

    await expect(collectAddressEvidence("not-an-address", deps)).rejects.toThrow(/Invalid EVM address/);
    expect(deps.getNonce).not.toHaveBeenCalled();
  });
});
