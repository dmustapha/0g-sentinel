import { getBytes, id, Interface, keccak256, toUtf8Bytes } from "ethers";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  bindAbortToTransport,
  collectBoundedBody,
  createPinnedLookup,
  createPinnedRequestOptions,
  loadRegistrationCard,
  REGISTRATION_V1_TYPE,
  validateRegistrationCard,
  type CardHttpResponse,
} from "../../server/prooflock/identity/card";
import {
  createErc8004Adapter,
  resolveAgentIdentity,
  type IdentityChainAdapter,
} from "../../server/prooflock/identity/erc8004";
import { IdentityError } from "../../server/prooflock/errors";
import {
  ERC8004_IDENTITY_REGISTRY,
  type AgentIdentity,
} from "../../server/prooflock/types";

const OWNER = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;
const MISSING_TOKEN_DATA = id("ERC721NonexistentToken(uint256)").slice(0, 10);
const BACKLINK = `eip155:16661:${ERC8004_IDENTITY_REGISTRY}`;
const IDENTITY: AgentIdentity = {
  namespace: "eip155",
  chainId: 16661,
  registryAddress: ERC8004_IDENTITY_REGISTRY,
  agentId: "7",
};

function card(overrides: Record<string, unknown> = {}) {
  return {
    type: REGISTRATION_V1_TYPE,
    name: "Sentinel Canary",
    registrations: [{ agentId: 7, agentRegistry: BACKLINK }],
    ...overrides,
  };
}

function cardUri(raw = JSON.stringify(card())) {
  return `data:application/json,${encodeURIComponent(raw)}`;
}

function adapter(overrides: Partial<IdentityChainAdapter> = {}) {
  const calls: Array<[string, bigint]> = [];
  const value: IdentityChainAdapter = {
    getChainId: async () => 16661n,
    getLatestBlockNumber: async () => 110n,
    getBlock: async (blockNumber) => ({ number: blockNumber, hash: BLOCK_HASH }),
    getCode: async (_address, blockTag) => {
      calls.push(["code", blockTag]);
      return "0x6000";
    },
    ownerOf: async (_agentId, blockTag) => {
      calls.push(["owner", blockTag]);
      return OWNER;
    },
    tokenURI: async (_agentId, blockTag) => {
      calls.push(["uri", blockTag]);
      return cardUri();
    },
    getAgentWallet: async (_agentId, blockTag) => {
      calls.push(["wallet", blockTag]);
      return WALLET;
    },
    ...overrides,
  };
  return { value, calls };
}

async function expectCode(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ name: "IdentityError", code });
}

describe("ERC-8004 identity resolution", () => {
  it("pins all registry reads and bytecode to one finalized block", async () => {
    const fake = adapter();
    const result = await resolveAgentIdentity(IDENTITY, {
      adapter: fake.value,
      finalityConfirmations: 5,
    });

    expect(fake.calls).toEqual([
      ["code", 105n],
      ["owner", 105n],
      ["uri", 105n],
      ["wallet", 105n],
    ]);
    expect(result).toMatchObject({
      identity: IDENTITY,
      owner: OWNER,
      agentWallet: WALLET,
      sourceBlockNumber: "105",
      sourceBlockHash: BLOCK_HASH,
      card: { name: "Sentinel Canary" },
    });
    expect(result.registrationDigest).toBe(
      keccak256(toUtf8Bytes(JSON.stringify(card()))),
    );
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("uses an explicit discovery block without consulting a newer head", async () => {
    const getLatestBlockNumber = vi.fn(async () => { throw new Error("latest head must not be read"); });
    const fake = adapter({ getLatestBlockNumber });
    const result = await resolveAgentIdentity(IDENTITY, { adapter: fake.value, sourceBlockNumber: 108n });

    expect(getLatestBlockNumber).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([
      ["code", 108n], ["owner", 108n], ["uri", 108n], ["wallet", 108n],
    ]);
    expect(result.sourceBlockNumber).toBe("108");
  });

  it("rejects a reorg when the selected block hash changes after card resolution", async () => {
    let reads = 0;
    const getBlock = vi.fn(async (blockNumber: bigint) => ({
      number: blockNumber,
      hash: reads++ === 0 ? BLOCK_HASH : `0x${"cd".repeat(32)}`,
    }));
    await expect(
      resolveAgentIdentity(IDENTITY, { adapter: adapter({ getBlock }).value }),
    ).rejects.toMatchObject({ code: "REGISTRY_UNAVAILABLE", retryable: true });
    expect(getBlock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["wrong requested chain", { ...IDENTITY, chainId: 1 }, "INVALID_IDENTITY"],
    ["wrong registry", { ...IDENTITY, registryAddress: OWNER }, "INVALID_IDENTITY"],
    ["leading-zero ID", { ...IDENTITY, agentId: "07" }, "INVALID_IDENTITY"],
    ["overflow ID", { ...IDENTITY, agentId: (1n << 256n).toString() }, "INVALID_IDENTITY"],
  ])("rejects %s", async (_name, identity, code) => {
    await expectCode(resolveAgentIdentity(identity as AgentIdentity, { adapter: adapter().value }), code);
  });

  it("returns a structured error for runtime-malformed identity input", async () => {
    await expectCode(
      resolveAgentIdentity({ namespace: "eip155", chainId: 16661 } as never, {
        adapter: adapter().value,
      }),
      "INVALID_IDENTITY",
    );
  });

  it("rejects a provider on another chain", async () => {
    await expectCode(
      resolveAgentIdentity(IDENTITY, { adapter: adapter({ getChainId: async () => 1n }).value }),
      "WRONG_CHAIN",
    );
  });

  it("distinguishes absent registry, missing token, zero wallet, and URI failures", async () => {
    await expectCode(
      resolveAgentIdentity(IDENTITY, { adapter: adapter({ getCode: async () => "0x" }).value }),
      "REGISTRY_UNAVAILABLE",
    );
    await expectCode(
      resolveAgentIdentity(IDENTITY, {
        adapter: adapter({ ownerOf: async () => { throw { data: MISSING_TOKEN_DATA }; } }).value,
      }),
      "AGENT_NOT_FOUND",
    );
    await expectCode(
      resolveAgentIdentity(IDENTITY, {
        adapter: adapter({ getAgentWallet: async () => "0x0000000000000000000000000000000000000000" }).value,
      }),
      "AGENT_WALLET_UNSET",
    );
    await expectCode(
      resolveAgentIdentity(IDENTITY, {
        adapter: adapter({ tokenURI: async () => { throw new Error("rpc unavailable"); } }).value,
      }),
      "AGENT_URI_UNAVAILABLE",
    );
  });

  it("maps owner provider failures to retryable registry unavailability", async () => {
    await expect(
      resolveAgentIdentity(IDENTITY, {
        adapter: adapter({ ownerOf: async () => { throw new Error("provider offline"); } }).value,
      }),
    ).rejects.toMatchObject({ code: "REGISTRY_UNAVAILABLE", retryable: true });
  });

  it("does not classify malformed owner return data as a missing agent", async () => {
    await expect(
      resolveAgentIdentity(IDENTITY, {
        adapter: adapter({ ownerOf: async () => "0x0000000000000000000000000000000000000000" }).value,
      }),
    ).rejects.toMatchObject({ code: "REGISTRY_UNAVAILABLE", retryable: true });
  });

  it("preserves explicit owner IdentityErrors", async () => {
    const expected = new IdentityError("WRONG_CHAIN", "identity", false);
    await expect(
      resolveAgentIdentity(IDENTITY, {
        adapter: adapter({ ownerOf: async () => { throw expected; } }).value,
      }),
    ).rejects.toBe(expected);
  });

  it("stops before later identity/card stages; paid-stage fault injection belongs to the runner", async () => {
    const tokenURI = vi.fn(async () => cardUri());
    const getAgentWallet = vi.fn(async () => WALLET);
    const requestHttps = vi.fn(async () => response(JSON.stringify(card())));
    await expectCode(resolveAgentIdentity(IDENTITY, {
      adapter: adapter({
        ownerOf: async () => { throw new Error("provider offline"); },
        tokenURI,
        getAgentWallet,
      }).value,
      cardLoaderOptions: { requestHttps },
    }), "REGISTRY_UNAVAILABLE");
    expect(tokenURI).not.toHaveBeenCalled();
    expect(getAgentWallet).not.toHaveBeenCalled();
    expect(requestHttps).not.toHaveBeenCalled();
  });

  it.each(["0x", "0x00", "0x000000"])("rejects absent all-zero registry code %s", async (code) => {
    await expectCode(resolveAgentIdentity(IDENTITY, {
      adapter: adapter({ getCode: async () => code }).value,
    }), "REGISTRY_UNAVAILABLE");
  });

  it("uses raw resolved JSON bytes for the digest", async () => {
    const firstRaw = JSON.stringify(card()).replace(",\"name\"", ", \"name\"");
    const secondRaw = JSON.stringify(card());
    const first = toUtf8Bytes(firstRaw);
    const second = toUtf8Bytes(secondRaw);
    const one = await resolveAgentIdentity(IDENTITY, {
      adapter: adapter({ tokenURI: async () => cardUri(firstRaw) }).value,
    });
    const two = await resolveAgentIdentity(IDENTITY, {
      adapter: adapter({ tokenURI: async () => cardUri(secondRaw) }).value,
    });
    expect(one.registrationDigest).toBe(keccak256(first));
    expect(one.registrationDigest).not.toBe(two.registrationDigest);
  });

  it("uses ABI calls with a common blockTag in the production adapter", async () => {
    const iface = new Interface([
      "function ownerOf(uint256) view returns (address)",
      "function tokenURI(uint256) view returns (string)",
      "function getAgentWallet(uint256) view returns (address)",
    ]);
    const calls: any[] = [];
    const provider = {
      getNetwork: vi.fn(async () => ({ chainId: 16661n })),
      getBlockNumber: vi.fn(async () => 12),
      getBlock: vi.fn(async () => ({ number: 10, hash: BLOCK_HASH })),
      getCode: vi.fn(async () => "0x6000"),
      call: vi.fn(async (tx) => {
        calls.push(tx);
        const selector = tx.data.slice(0, 10);
        if (selector === iface.getFunction("ownerOf")!.selector) {
          return iface.encodeFunctionResult("ownerOf", [OWNER]);
        }
        if (selector === iface.getFunction("tokenURI")!.selector) {
          return iface.encodeFunctionResult("tokenURI", ["data:application/json,%7B%7D"]);
        }
        return iface.encodeFunctionResult("getAgentWallet", [WALLET]);
      }),
    };
    const chain = createErc8004Adapter(provider as never);
    await chain.ownerOf(7n, 10n);
    await chain.tokenURI(7n, 10n);
    await chain.getAgentWallet(7n, 10n);
    expect(calls.every((tx) => tx.blockTag === 10)).toBe(true);
    expect(calls.every((tx) => tx.to === ERC8004_IDENTITY_REGISTRY)).toBe(true);
  });
});

describe("registration-v1 validation", () => {
  it("accepts one exact backlink and active absent/true", () => {
    expect(validateRegistrationCard(card(), IDENTITY).name).toBe("Sentinel Canary");
    expect(validateRegistrationCard(card({ active: true }), IDENTITY).active).toBe(true);
  });

  it.each([
    ["wrong type", card({ type: "registration-v1" }), "CARD_MALFORMED"],
    ["inactive", card({ active: false }), "CARD_INACTIVE"],
    ["wrong ID", card({ registrations: [{ agentId: 8, agentRegistry: BACKLINK }] }), "CARD_BACKLINK_MISMATCH"],
    ["string ID", card({ registrations: [{ agentId: "7", agentRegistry: BACKLINK }] }), "CARD_BACKLINK_MISMATCH"],
    ["wrong chain", card({ registrations: [{ agentId: 7, agentRegistry: BACKLINK.replace("16661", "1") }] }), "CARD_BACKLINK_MISMATCH"],
    ["duplicate backlink", card({ registrations: [{ agentId: 7, agentRegistry: BACKLINK }, { agentId: 7, agentRegistry: BACKLINK }] }), "CARD_BACKLINK_MISMATCH"],
    ["pollution key", JSON.parse(`{"type":"${REGISTRATION_V1_TYPE}","registrations":[],"__proto__":{}}`), "CARD_MALFORMED"],
  ])("rejects %s", (_name, value, code) => {
    expect(() => validateRegistrationCard(value, IDENTITY)).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});

describe("lossless uint256 registration backlinks", () => {
  const largeId = (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString();
  const largeIdentity = { ...IDENTITY, agentId: largeId };

  function rawLarge(agentIdToken: string) {
    return `{"type":"${REGISTRATION_V1_TYPE}","registrations":[{"agentId":${agentIdToken},"agentRegistry":"${BACKLINK}"}]}`;
  }

  it("accepts a numeric MAX_SAFE+1 backlink without precision loss", async () => {
    const result = await loadRegistrationCard(cardUri(rawLarge(largeId)), largeIdentity);
    expect(result.card.registrations[0].agentId).toBe(largeId);
  });

  it.each([
    ["off by one", (BigInt(largeId) + 1n).toString()],
    ["quoted", `"${largeId}"`],
    ["decimal", `${largeId}.0`],
    ["exponent", `${largeId}e0`],
    ["negative", "-1"],
  ])("rejects %s uint256 token", async (_name, token) => {
    await expectCode(
      loadRegistrationCard(cardUri(rawLarge(token)), largeIdentity),
      "CARD_BACKLINK_MISMATCH",
    );
  });

  it("rejects duplicate JSON object keys", async () => {
    const raw = `{"type":"ignored","type":"${REGISTRATION_V1_TYPE}","registrations":[{"agentId":7,"agentRegistry":"${BACKLINK}"}]}`;
    await expectCode(loadRegistrationCard(cardUri(raw), IDENTITY), "CARD_MALFORMED");
  });
});

describe("registration card URI loader", () => {
  it("decodes base64 and percent-encoded data JSON", async () => {
    const json = JSON.stringify(card());
    const base64 = Buffer.from(json).toString("base64");
    const one = await loadRegistrationCard(`data:application/json;base64,${base64}`, IDENTITY);
    const two = await loadRegistrationCard(`data:application/json,${encodeURIComponent(json)}`, IDENTITY);
    expect(one.registrationDigest).toBe(keccak256(toUtf8Bytes(json)));
    expect("bytes" in one).toBe(false);
    expect(two.card.name).toBe("Sentinel Canary");
    expect(two.card.registrations[0].agentId).toBe("7");
  });

  it("maps IPFS through the configured HTTPS gateway", async () => {
    const seen: string[] = [];
    const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3hzc5wmjzvkwsl3vpj4lr6d6i";
    const loaded = await loadRegistrationCard(`ipfs://${cid}/card.json`, IDENTITY, {
      ipfsGateway: "https://gateway.example",
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: async ({ url }) => {
        seen.push(url.href);
        return response(JSON.stringify(card()));
      },
    });
    expect(seen).toEqual([`https://gateway.example/ipfs/${cid}/card.json`]);
    expect(loaded.card.name).toBe("Sentinel Canary");
  });

  it.each([
    ["CIDv0", `Qm${"a".repeat(44)}`, "docs/card.json"],
    ["CIDv1 base32", "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3hzc5wmjzvkwsl3vpj4lr6d6i", "metadata.json"],
    ["CIDv1 base36", `k${"a1".repeat(8)}`, "nested/card.json"],
  ])("accepts strict %s IPFS URIs", async (_name, cid, path) => {
    const seen: string[] = [];
    await loadRegistrationCard(`ipfs://${cid}/${path}`, IDENTITY, {
      ipfsGateway: "https://gateway.example",
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: async ({ url }) => {
        seen.push(url.href);
        return response(JSON.stringify(card()));
      },
    });
    expect(seen).toEqual([`https://gateway.example/ipfs/${cid}/${path}`]);
  });

  it.each([
    ["userinfo", `ipfs://user@Qm${"a".repeat(44)}/card.json`],
    ["query", `ipfs://Qm${"a".repeat(44)}/card.json?download=1`],
    ["fragment", `ipfs://Qm${"a".repeat(44)}/card.json#proof`],
    ["backslash", `ipfs://Qm${"a".repeat(44)}\\card.json`],
    ["empty authority", "ipfs:///card.json"],
    ["dot", `ipfs://Qm${"a".repeat(44)}/./card.json`],
    ["dotdot encoded", `ipfs://Qm${"a".repeat(44)}/%2e%2e/card.json`],
    ["decoded slash", `ipfs://Qm${"a".repeat(44)}/bad%2Fsegment`],
    ["decoded backslash", `ipfs://Qm${"a".repeat(44)}/bad%5Csegment`],
    ["decoded NUL", `ipfs://Qm${"a".repeat(44)}/bad%00segment`],
    ["double dotdot", `ipfs://Qm${"a".repeat(44)}/%252e%252e/card.json`],
    ["double slash", `ipfs://Qm${"a".repeat(44)}/bad%252fsegment`],
    ["double backslash", `ipfs://Qm${"a".repeat(44)}/bad%255csegment`],
    ["double NUL", `ipfs://Qm${"a".repeat(44)}/bad%2500segment`],
    ["invalid CID", "ipfs://not-a-cid/card.json"],
  ])("rejects malicious IPFS %s", async (_name, uri) => {
    await expectCode(loadRegistrationCard(uri, IDENTITY), "CARD_URI_UNSUPPORTED");
  });

  it.each([
    "http://gateway.example",
    "https://user@gateway.example",
    "https://gateway.example:444",
    "https://gateway.example/base",
    "https://gateway.example?x=1",
    "https://gateway.example#x",
  ])("rejects unsafe configured gateway %s", async (gateway) => {
    await expectCode(loadRegistrationCard(`ipfs://Qm${"a".repeat(44)}`, IDENTITY, {
      ipfsGateway: gateway,
    }), "CARD_URI_UNSUPPORTED");
  });

  it.each(["http://example.com/a", "ftp://example.com/a", "https://user:pass@example.com/a", "https://example.com:444/a", "https://example.com/a#fragment"])(
    "rejects unsupported URI %s",
    async (uri) => expectCode(loadRegistrationCard(uri, IDENTITY), "CARD_URI_UNSUPPORTED"),
  );

  it.each([
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.1.1",
    "100.64.0.1", "192.0.2.1", "224.0.0.1", "0.0.0.0", "::1", "::", "fc00::1",
    "fe80::1", "2001:db8::1", "ff02::1", "::ffff:127.0.0.1", "100::1",
    "fec0::1", "64:ff9b::1", "64:ff9b:1::1", "2001::1", "2001:2::1",
    "2001:10::1", "2001:20::1", "2002::1", "3fff::1",
  ])("blocks private/reserved address %s", async (address) => {
    await expectCode(loadRegistrationCard("https://example.com/card", IDENTITY, {
      resolveDns: async () => [address],
      requestHttps: async () => response(JSON.stringify(card())),
    }), "CARD_PRIVATE_NETWORK");
  });

  it("accepts a real global-unicast IPv6 address and pins its family", async () => {
    const requests: Array<{ pinnedAddress: string; family: number }> = [];
    await loadRegistrationCard("https://example.com/card", IDENTITY, {
      resolveDns: async () => ["2606:4700:4700::1111"],
      requestHttps: async ({ pinnedAddress, family }) => {
        requests.push({ pinnedAddress, family });
        return response(JSON.stringify(card()));
      },
    });
    expect(requests).toEqual([{ pinnedAddress: "2606:4700:4700::1111", family: 6 }]);
  });

  it("rejects mixed public and private DNS answers", async () => {
    await expectCode(loadRegistrationCard("https://example.com/card", IDENTITY, {
      resolveDns: async () => ["93.184.216.34", "127.0.0.1"],
      requestHttps: async () => response(JSON.stringify(card())),
    }), "CARD_PRIVATE_NETWORK");
  });

  it("passes the exact selected public IPv4 and family to the request transport", async () => {
    const requestHttps = vi.fn(async () => response(JSON.stringify(card())));
    await loadRegistrationCard("https://example.com/card", IDENTITY, {
      resolveDns: async () => ["93.184.216.34", "1.1.1.1"],
      requestHttps,
    });
    expect(requestHttps).toHaveBeenCalledWith(expect.objectContaining({
      pinnedAddress: "93.184.216.34",
      family: 4,
    }));
  });

  it("pinned lookup ignores the requested hostname and returns only the selected address", async () => {
    const lookup = createPinnedLookup("2606:4700:4700::1111", 6);
    const result = await new Promise<{ address: unknown; family: unknown }>((resolve, reject) => {
      lookup("attacker-controlled.example", { family: 4 }, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    });
    expect(result).toEqual({ address: "2606:4700:4700::1111", family: 6 });
  });

  it("disables connection pooling while preserving pinned lookup and abort signal", async () => {
    const controller = new AbortController();
    const options = createPinnedRequestOptions({
      url: new URL("https://example.com/card"),
      pinnedAddress: "93.184.216.34",
      family: 4,
      timeoutMs: 100,
      maxBytes: 1024,
      signal: controller.signal,
    });
    expect(options.agent).toBe(false);
    expect(options.signal).toBe(controller.signal);
    const result = await new Promise<{ address: unknown; family: unknown }>((resolve, reject) => {
      options.lookup!("different.example", {}, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    });
    expect(result).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("destroys both request and active response when the absolute signal aborts", () => {
    const controller = new AbortController();
    const request = { destroy: vi.fn() };
    const response = { destroy: vi.fn() };
    const cleanup = bindAbortToTransport(controller.signal, request, () => response);
    controller.abort(new IdentityError("CARD_TIMEOUT", "card", true));
    expect(request.destroy).toHaveBeenCalledOnce();
    expect(response.destroy).toHaveBeenCalledOnce();
    cleanup();
  });

  it("propagates the absolute abort signal into a never-ending transport", async () => {
    let aborted = false;
    await expectCode(loadRegistrationCard("https://example.com/card", IDENTITY, {
      timeoutMs: 5,
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      }),
    }), "CARD_TIMEOUT");
    expect(aborted).toBe(true);
  });

  it.each(["localhost", "api.localhost", "foo.local", "foo.internal"])(
    "blocks localhost-style name %s",
    async (host) => expectCode(loadRegistrationCard(`https://${host}/card`, IDENTITY), "CARD_PRIVATE_NETWORK"),
  );

  it("revalidates redirects and detects loops", async () => {
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      resolveDns: async (host) => host === "internal.test" ? ["127.0.0.1"] : ["93.184.216.34"],
      requestHttps: async () => ({ status: 302, headers: { location: "https://internal.test/card" }, body: new Uint8Array() }),
    }), "CARD_PRIVATE_NETWORK");
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: async ({ url }) => ({ status: 302, headers: { location: url.href }, body: new Uint8Array() }),
    }), "CARD_REDIRECT_LOOP");
  });

  it("rejects finite non-loop redirect exhaustion", async () => {
    let hop = 0;
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      maxRedirects: 2,
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: async () => ({
        status: 302,
        headers: { location: `https://example.com/${++hop}` },
        body: new Uint8Array(),
      }),
    }), "CARD_REDIRECT_LIMIT");
    expect(hop).toBe(3);
  });

  it("classifies an exact loop before redirect-limit exhaustion", async () => {
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      maxRedirects: 0,
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: async ({ url }) => ({
        status: 302,
        headers: { location: url.href },
        body: new Uint8Array(),
      }),
    }), "CARD_REDIRECT_LOOP");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "http://["],
  ])("classifies %s redirect locations as invalid", async (_name, location) => {
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: async () => ({
        status: 302,
        headers: { location },
        body: new Uint8Array(),
      }),
    }), "CARD_REDIRECT_INVALID");
  });

  it("uses one cumulative timeout budget across redirects", async () => {
    vi.useFakeTimers();
    try {
      const budgets: number[] = [];
      let hop = 0;
      const action = loadRegistrationCard("https://example.com/a", IDENTITY, {
        timeoutMs: 30,
        resolveDns: async () => ["93.184.216.34"],
        requestHttps: ({ timeoutMs }) => new Promise((resolve) => {
          budgets.push(timeoutMs);
          setTimeout(() => resolve({
            status: 302,
            headers: { location: `https://example.com/${++hop}` },
            body: new Uint8Array(),
          }), 20);
        }),
      });
      const timeoutAssertion = expectCode(action, "CARD_TIMEOUT");
      await vi.advanceTimersByTimeAsync(50);
      await timeoutAssertion;
      expect(budgets[0]).toBeLessThanOrEqual(30);
      expect(budgets[1]).toBeLessThanOrEqual(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces content type, size, timeout, UTF-8, and JSON", async () => {
    const options = { resolveDns: async () => ["93.184.216.34"] };
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      ...options, requestHttps: async () => response("{}", { "content-type": "text/plain" }),
    }), "CARD_CONTENT_TYPE");
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      ...options,
      requestHttps: async () => response(JSON.stringify(card()), { "content-length": "999999" }),
    }), "CARD_TOO_LARGE");
    await expectCode(loadRegistrationCard("data:application/json," + "x".repeat(140_000), IDENTITY), "CARD_TOO_LARGE");
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      ...options, timeoutMs: 1, requestHttps: async () => new Promise(() => undefined),
    }), "CARD_TIMEOUT");
    await expectCode(loadRegistrationCard("data:application/json;base64,/w==", IDENTITY), "CARD_MALFORMED");
    await expectCode(loadRegistrationCard("data:application/json,%7B", IDENTITY), "CARD_MALFORMED");
  });

  it.each([
    [408, true], [429, true], [500, true], [503, true], [400, false], [404, false],
  ])("classifies HTTP %i retryability", async (status, retryable) => {
    await expect(loadRegistrationCard("https://example.com/a", IDENTITY, {
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: async () => ({
        status,
        headers: { "content-type": "application/json" },
        body: new Uint8Array(),
      }),
    })).rejects.toMatchObject({ code: "AGENT_URI_UNAVAILABLE", retryable });
  });

  it("surfaces transport byte-cap failures as CARD_TOO_LARGE", async () => {
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: async () => { throw new IdentityError("CARD_TOO_LARGE", "card", false); },
    }), "CARD_TOO_LARGE");
  });

  it("aborts a streamed response immediately after the byte cap", async () => {
    const stream = Readable.from([Buffer.alloc(4), Buffer.alloc(5)]);
    const destroy = vi.spyOn(stream, "destroy");
    await expectCode(collectBoundedBody(stream, 8), "CARD_TOO_LARGE");
    expect(destroy).toHaveBeenCalled();
  });
});

function response(body: string, headers: Record<string, string> = {}): CardHttpResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
    body: getBytes("0x" + Buffer.from(body).toString("hex")),
  };
}
