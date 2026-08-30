import { describe, expect, it } from "vitest";
import { pinnedLookup } from "../../server/prooflock/compute/safe-https";

// Regression: Node's happy-eyeballs / autoSelectFamily calls a custom `lookup` with
// { all: true } and expects the callback's second argument to be an array of
// { address, family }. The original single-arg-only implementation made Node read
// result[0].address === undefined ("Invalid IP address: undefined") on every real
// socket connect. Tests mock the transport, so only a real request exposed it.
describe("pinnedLookup honors the DNS `all` option", () => {
  it("returns a single {address, family} when all is true", () => {
    const lookup = pinnedLookup("217.18.52.23", 4);
    let received: unknown;
    lookup("host", { all: true } as never, ((_e: unknown, a: unknown) => { received = a; }) as never);
    expect(received).toEqual([{ address: "217.18.52.23", family: 4 }]);
  });

  it("returns the scalar address/family when all is falsy", () => {
    const lookup = pinnedLookup("2606:4700::1", 6);
    const args: unknown[] = [];
    lookup("host", { all: false } as never, ((...a: unknown[]) => { args.push(...a); }) as never);
    expect(args).toEqual([null, "2606:4700::1", 6]);
  });
});
