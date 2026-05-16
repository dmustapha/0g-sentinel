// File: scanner/queue.ts
//
// Background auto-scan queue — module singleton that persists across API requests
// in the same Node.js process (Railway / standalone Next.js).
//
// Addresses are enqueued by /api/discover on every discovery call.
// Before scanning each address, the queue checks hasAttestation() to skip already-attested
// contracts — so enqueueing all 120 discovered addresses is always safe.
//
// Scans ONE address at a time to avoid nonce collisions on the scanner wallet.
// AI pipelines run internally in parallel (behavioral + code), only the on-chain write is serial.
//
// NOTE: This singleton does NOT persist on Vercel serverless (new process per request).
// For demo deployments on Railway / Fly.io / standalone Next.js it works correctly.

import { runFullScan } from "./scanner";

export interface QueueStatus {
  queued: number;
  inFlight: string | null;
  completed: number;
  failed: number;
  total: number;
  active: boolean;
}

const pending: string[] = [];
const completedSet = new Set<string>();
const failedSet = new Set<string>();
let inFlight: string | null = null;
let running = false;

export function enqueueAddresses(addresses: string[]): void {
  let added = 0;
  for (const addr of addresses) {
    const norm = addr.toLowerCase();
    if (
      !completedSet.has(norm) &&
      !failedSet.has(norm) &&
      inFlight?.toLowerCase() !== norm &&
      !pending.some((a) => a.toLowerCase() === norm)
    ) {
      pending.push(addr);
      added++;
    }
  }
  if (added > 0) {
    console.log(`[Queue] Enqueued ${added} addresses (${pending.length} total pending)`);
  }
  if (!running) processNext();
}

export function getQueueStatus(): QueueStatus {
  return {
    queued: pending.length,
    inFlight,
    completed: completedSet.size,
    failed: failedSet.size,
    total: pending.length + (inFlight ? 1 : 0) + completedSet.size + failedSet.size,
    active: running,
  };
}

async function processNext(): Promise<void> {
  if (pending.length === 0) {
    running = false;
    inFlight = null;
    console.log(`[Queue] All done — ${completedSet.size} scanned, ${failedSet.size} failed`);
    return;
  }

  running = true;
  const addr = pending.shift()!;

  // Check if already attested on-chain before spending compute
  try {
    const { getAttestationRegistry } = await import("@/lib/contracts");
    const registry = getAttestationRegistry();
    const has = await (registry.hasAttestation(addr) as Promise<boolean>);
    if (has) {
      completedSet.add(addr.toLowerCase());
      console.log(`[Queue] ${addr} already attested — skipping`);
      await delay(500);
      processNext();
      return;
    }
  } catch {
    // RPC error — proceed with scan anyway; writeAttestation will overwrite if needed
  }

  inFlight = addr;
  console.log(`[Queue] Scanning ${addr} (${pending.length} remaining)...`);

  try {
    await runFullScan(addr);
    completedSet.add(addr.toLowerCase());
    console.log(`[Queue] ✓ ${addr} — ${completedSet.size} total completed`);
  } catch (err) {
    failedSet.add(addr.toLowerCase());
    console.error(`[Queue] ✗ ${addr} failed:`, String(err).slice(0, 120));
  } finally {
    inFlight = null;
    // 2s breathing room between scans — avoids RPC rate limits + nonce pressure
    await delay(2000);
    processNext();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
