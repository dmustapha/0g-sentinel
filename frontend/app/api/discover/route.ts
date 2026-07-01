// File: frontend/app/api/discover/route.ts
//
// Chain-native contract discovery via eth_getLogs.
//
// Scans the last SCAN_WINDOW blocks for any emitted events.
// Every unique contract address that appears in a log is a live, active
// contract on 0G Aristotle — no manual registration needed.
//
// Results are cached in-memory for CACHE_TTL_MS to avoid hammering the RPC
// on every page load while still reflecting newly active contracts quickly.

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { waitUntil } from "@vercel/functions";
import { enqueueAddresses } from "@scanner/queue";

// Live chain-data route — must NOT be statically prerendered at build time. Without this,
// Next executes the RPC-heavy discovery during `next build`, which blows the static-generation
// timeout and fails the deploy. Runs on-demand (in-memory cached 5 min) instead.
export const dynamic = "force-dynamic";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
// The RPC caps eth_getLogs at 10,000 *logs* (not blocks). 0G Aristotle emits ~65+ logs/block,
// so a wide window overflows that cap. We scan a bounded recent window and split adaptively.
const SCAN_WINDOW = 800; // blocks of recent activity to sample — bounded to keep cold latency low
                         // (0G ~37 logs/block → ~30k logs → a few adaptive sub-requests, not dozens)
const MAX_SPLIT_DEPTH = 14; // adaptive halving depth guard (2^14 blocks >> any window)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * eth_getLogs with adaptive range splitting. Tries [fromBlock, toBlock]; if the RPC rejects
 * the range for exceeding its 10k-log limit, halves the range and recurses on both halves,
 * aggregating results. Self-adapts to any log density without a hardcoded chunk size.
 */
async function getLogsAdaptive(
  provider: ethers.JsonRpcProvider,
  fromBlock: number,
  toBlock: number,
  depth = 0
): Promise<ethers.Log[]> {
  try {
    return await provider.getLogs({ fromBlock, toBlock });
  } catch (err) {
    const raw = (err as { error?: { message?: string }; message?: string }) ?? {};
    const msg = String(raw.error?.message || raw.message || err).toLowerCase();
    const tooManyLogs =
      msg.includes("10000 logs") ||
      msg.includes("exceeds the max") ||
      msg.includes("narrow down") ||
      msg.includes("more than 10000") ||
      msg.includes("query returned more than");
    if (tooManyLogs && toBlock > fromBlock && depth < MAX_SPLIT_DEPTH) {
      const mid = Math.floor((fromBlock + toBlock) / 2);
      const [a, b] = await Promise.all([
        getLogsAdaptive(provider, fromBlock, mid, depth + 1),
        getLogsAdaptive(provider, mid + 1, toBlock, depth + 1),
      ]);
      return [...a, ...b];
    }
    throw err; // non-splittable error, or a single block still over the limit — propagate
  }
}

interface DiscoveredContract {
  address: string;
  logCount: number; // activity proxy — higher = more active
  discoveredAt: number; // Unix ms timestamp
}

interface CacheEntry {
  contracts: DiscoveredContract[];
  latestBlock: number;
  cachedAt: number;
}

let cache: CacheEntry | null = null;

export async function GET() {
  try {
    const now = Date.now();

    if (cache && now - cache.cachedAt < CACHE_TTL_MS) {
      // Re-enqueue even on cache hit — queue resets on server restart but cache may still be valid.
      // waitUntil keeps the Vercel function alive after the response is sent so the queue can run.
      waitUntil(Promise.resolve().then(() => enqueueAddresses(cache!.contracts.map((c) => c.address))));
      return NextResponse.json({
        contracts: cache.contracts,
        latestBlock: cache.latestBlock,
        fromCache: true,
        cacheAgeSeconds: Math.floor((now - cache.cachedAt) / 1000),
      });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - SCAN_WINDOW);

    // Pull all events in the window — no topic filter, every active contract.
    // Adaptive splitting keeps each sub-request under the RPC's 10k-log cap.
    const logs = await getLogsAdaptive(provider, fromBlock, latest);

    // Count logs per address (activity proxy)
    const counts: Record<string, number> = {};
    for (const log of logs) {
      counts[log.address] = (counts[log.address] || 0) + 1;
    }

    // Sort descending by activity
    const contracts: DiscoveredContract[] = Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([address, logCount]) => ({ address, logCount, discoveredAt: now }));

    cache = { contracts, latestBlock: latest, cachedAt: now };

    // Kick off background auto-scan for all discovered contracts.
    // waitUntil keeps the Vercel function alive after the response is sent so the queue can run.
    // The queue checks hasAttestation() before each scan — safe to enqueue all.
    waitUntil(Promise.resolve().then(() => enqueueAddresses(contracts.map((c) => c.address))));

    return NextResponse.json({
      contracts,
      latestBlock: latest,
      fromBlock,
      totalLogs: logs.length,
      fromCache: false,
    });
  } catch (error) {
    console.error("[DiscoverAPI]", error);
    return NextResponse.json({ error: "Chain discovery failed", contracts: [] }, { status: 500 });
  }
}
