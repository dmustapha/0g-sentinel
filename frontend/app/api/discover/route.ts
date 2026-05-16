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

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
const SCAN_WINDOW = 10_000; // blocks — stays within RPC's 10k-log limit
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

    // Pull all events in the window — no topic filter, every active contract
    const logs = await provider.getLogs({ fromBlock, toBlock: latest });

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
