// Local OFAC sanctions seed list. Every entry below is a crypto address that appears on the
// public U.S. Treasury OFAC Specially Designated Nationals (SDN) list, which is public record
// (see https://sanctionslist.ofac.treas.gov and Treasury press releases). The bulk of these are
// Ethereum addresses named in the August 2022 Tornado Cash designation (router/proxy/pool and
// associated wallets) plus a few other publicly documented SDN crypto addresses.
//
// This is a SEED list, intentionally small, meant to be expanded from the authoritative OFAC SDN
// feed. Lookups are exact matches on the lowercased address string; the set is chain-agnostic
// because it keys on the address string alone, which is why it works unchanged on 0G.

export const OFAC_SANCTIONED_ADDRESSES: ReadonlySet<string> = new Set<string>([
  // Tornado Cash core contracts (OFAC SDN, 2022-08-08)
  "0x8589427373d6d84e98730d7795d8f6f8731fda16", // Tornado Cash: donation / community
  "0x722122df12d4e14e13ac3b6895a86e84145b6967", // Tornado Cash: proxy
  "0xdd4c48c0b24039969fc16d1cdf626eab821d3384", // Tornado Cash: 0.1 ETH pool
  "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b", // Tornado Cash: 1 ETH pool
  "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf", // Tornado Cash: 10 ETH pool
  "0xa160cdab225685da1d56aa342ad8841c3b53f291", // Tornado Cash: 100 ETH pool
  "0xd96f2b1c14db8458374d9aca76e26c3d18364307", // Tornado Cash: USDC 100
  "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d", // Tornado Cash: USDC 1000
  "0xd691f27f38b395864ea86cfc7253969b409c362d", // Tornado Cash: USDT 100
  "0x22aaa7720ddd5388a3c0a3333430953c68f1849b", // Tornado Cash: BUSD 100
  "0xba214c1c1928a32bffe790263e38b4af9bfcd659", // Tornado Cash: WBTC 0.1
  "0xb1c8094b234dce6e03f10a5b673c1d8c69739a00", // Tornado Cash: router
  "0x07687e702b410fa43f4cb4af7fa097918ffd2730", // Tornado Cash: WBTC 1
  // Other publicly documented SDN crypto addresses
  "0x098b716b8aaf21512996dc57eb0615e2383e2f96", // Lazarus Group / Ronin bridge exploiter (2022-04)
  "0x35fb6f6db4fb05e6a4ce86f2c93691425626d4b1", // Lazarus Group associated wallet
  "0xf7b31119c2682c88d88d455dbb9d5932c65cf1be", // Blender.io associated wallet (2022-05)
]);
