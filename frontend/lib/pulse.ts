// File: frontend/lib/pulse.ts
// Shared system-pulse check for the integration proof surfaces (home strip + /proof).
// Chain health is read from the on-chain attestation count; compute health from the
// 0G Compute /models endpoint. Storage + AgentGate ride the same 0G infra as chain.
import { getAttestationRegistry } from "@/lib/contracts";

const COMPUTE_URL = process.env.ZERO_G_COMPUTE_URL || "https://router-api.0g.ai/v1";
const COMPUTE_KEY = process.env.ZERO_G_COMPUTE_API_KEY || "";

export interface PulseStatus {
  chain: boolean;
  compute: boolean;
  storage: boolean;
  gate: boolean;
}

export async function checkSystemPulse(): Promise<PulseStatus> {
  const results = await Promise.allSettled([
    // Chain: read the attestation count — proves RPC + contract are live.
    Promise.race([
      getAttestationRegistry().getAttestedCount(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
    ]),
    // Compute: hit /models to verify the API is accepting requests.
    Promise.race([
      fetch(`${COMPUTE_URL}/models`, {
        method: "GET",
        headers: COMPUTE_KEY ? { Authorization: `Bearer ${COMPUTE_KEY}` } : {},
        signal: AbortSignal.timeout(4000),
      }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 4500)),
    ]),
  ]);

  const chainOk = results[0].status === "fulfilled";
  const computeOk = results[1].status === "fulfilled";

  return {
    chain: chainOk,
    compute: computeOk,
    storage: chainOk, // 0G Storage is part of the same 0G infrastructure — infer from chain health
    gate: chainOk, // AgentGate lives on the same chain
  };
}
