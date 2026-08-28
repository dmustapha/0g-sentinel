import { getBytes, Interface, keccak256, toUtf8Bytes } from "ethers";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  collectBoundedBody,
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
        adapter: adapter({ ownerOf: async () => { throw new Error("ERC721NonexistentToken"); } }).value,
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

describe("registration card URI loader", () => {
  it("decodes base64 and percent-encoded data JSON", async () => {
    const json = JSON.stringify(card());
    const base64 = Buffer.from(json).toString("base64");
    const one = await loadRegistrationCard(`data:application/json;base64,${base64}`, IDENTITY);
    const two = await loadRegistrationCard(`data:application/json,${encodeURIComponent(json)}`, IDENTITY);
    expect(Buffer.from(one.bytes).toString()).toBe(json);
    expect(two.card.name).toBe("Sentinel Canary");
  });

  it("maps IPFS through the configured HTTPS gateway", async () => {
    const seen: string[] = [];
    const loaded = await loadRegistrationCard("ipfs://bafy/card.json", IDENTITY, {
      ipfsGateway: "https://gateway.example",
      resolveDns: async () => ["93.184.216.34"],
      requestHttps: async ({ url }) => {
        seen.push(url.href);
        return response(JSON.stringify(card()));
      },
    });
    expect(seen).toEqual(["https://gateway.example/ipfs/bafy/card.json"]);
    expect(loaded.card.name).toBe("Sentinel Canary");
  });

  it.each(["http://example.com/a", "ftp://example.com/a", "https://user:pass@example.com/a", "https://example.com:444/a"])(
    "rejects unsupported URI %s",
    async (uri) => expectCode(loadRegistrationCard(uri, IDENTITY), "CARD_URI_UNSUPPORTED"),
  );

  it.each([
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.1.1",
    "100.64.0.1", "192.0.2.1", "224.0.0.1", "0.0.0.0", "::1", "::", "fc00::1",
    "fe80::1", "2001:db8::1", "ff02::1", "::ffff:127.0.0.1",
  ])("blocks private/reserved address %s", async (address) => {
    await expectCode(loadRegistrationCard("https://example.com/card", IDENTITY, {
      resolveDns: async () => [address],
      requestHttps: async () => response(JSON.stringify(card())),
    }), "CARD_PRIVATE_NETWORK");
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

  it("enforces content type, size, timeout, UTF-8, and JSON", async () => {
    const options = { resolveDns: async () => ["93.184.216.34"] };
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      ...options, requestHttps: async () => response("{}", { "content-type": "text/plain" }),
    }), "CARD_CONTENT_TYPE");
    await expectCode(loadRegistrationCard("data:application/json," + "x".repeat(140_000), IDENTITY), "CARD_TOO_LARGE");
    await expectCode(loadRegistrationCard("https://example.com/a", IDENTITY, {
      ...options, timeoutMs: 1, requestHttps: async () => new Promise(() => undefined),
    }), "CARD_TIMEOUT");
    await expectCode(loadRegistrationCard("data:application/json;base64,/w==", IDENTITY), "CARD_MALFORMED");
    await expectCode(loadRegistrationCard("data:application/json,%7B", IDENTITY), "CARD_MALFORMED");
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
