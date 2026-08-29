import { describe, expect, it } from "vitest";

import { explorerAddressUrl, explorerTransactionUrl } from "./explorer-url";

const tx = `0x${"ab".repeat(32)}`;
const address = `0x${"aB".repeat(20)}`;

describe("explorer URL construction", () => {
  it("builds only validated paths on the allowlisted HTTPS origin", () => {
    expect(explorerTransactionUrl("https://chainscan.0g.ai", tx))
      .toBe(`https://chainscan.0g.ai/tx/${tx}`);
    expect(explorerAddressUrl("https://chainscan.0g.ai/", address))
      .toBe(`https://chainscan.0g.ai/address/${address}`);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,owned",
    "http://chainscan.0g.ai",
    "https://user:pass@chainscan.0g.ai",
    "https://evil.example",
    "https://chainscan.0g.ai.evil.example",
    "https://chainscan.0g.ai/base",
    "https://chainscan.0g.ai?next=https://evil.example",
    "https://chainscan.0g.ai:443",
    "https://chainscan.0g.ai:8443",
    "https://chainscan.0g.ai/#owned",
    "https://xn--chainscan-9za.0g.ai",
    "https://chaіnscan.0g.ai",
    "not a url",
  ])("rejects invalid explorer base %s", (base) => {
    expect(explorerTransactionUrl(base, tx)).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,owned",
    `0x${"ab".repeat(31)}`,
    `0x${"00".repeat(32)}`,
    `${tx}/../../address/owned`,
  ])("rejects invalid transaction value %s", (value) => {
    expect(explorerTransactionUrl("https://chainscan.0g.ai", value)).toBeNull();
  });

  it("rejects malformed addresses while preserving a valid mixed-case address", () => {
    expect(explorerAddressUrl("https://chainscan.0g.ai", `${address}/tx/${tx}`)).toBeNull();
    expect(explorerAddressUrl("https://chainscan.0g.ai", address))
      .toBe(`https://chainscan.0g.ai/address/${address}`);
  });
});
