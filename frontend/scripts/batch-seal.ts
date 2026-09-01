// Seal a batch of REAL 0G ERC-8004 agents to populate the leaderboard with genuine examples.
// The seal ATTESTS about an agent (the scanner signs; the agent's key is never needed), so any
// registered agent with a set wallet can be scanned. Sequential (respects the one-op-per-identity
// guard); failures are logged and skipped. Run from frontend cwd.
import { config } from "dotenv";
config({ path: "../.env" });

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
// Real 0G ecosystem agents (evoevo.ai ERC-8004 registrations), each with a DISTINCT on-chain wallet
// so their real activity produces varied scores. Sealed via on-chain-bound mode (cardVerified=false).
const AGENT_IDS = ["1", "10", "50", "100", "200", "500", "1000", "1500", "2000", "2500", "3000", "3200", "3400"];

async function main(): Promise<void> {
  const { loadProofLockRunner } = await import("../server/prooflock/operator.js");
  const { createProductionReadDependencies } = await import("../server/prooflock/read-api.js");
  const { computeIdentityKey } = await import("../server/prooflock/chain.js");
  const runner = await loadProofLockRunner();
  const reads: any = createProductionReadDependencies(process.env);
  const AbortController_ = AbortController;
  const results: Array<{ agentId: string; ok: boolean; detail: string }> = [];
  for (const agentId of AGENT_IDS) {
    const identity = { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: REGISTRY as `0x${string}`, agentId };
    process.stderr.write(`\n=== sealing agent ${agentId} ===\n`);
    try {
      // Auto-detect: RESEAL an agent that already has a lease (so existing agents get the deep
      // pipeline), otherwise SEAL a fresh one.
      const identityKey = computeIdentityKey(identity);
      let input: any = { identity, mode: "SEAL" };
      try {
        const record = await reads.readProofLock(identityKey, new AbortController_().signal);
        const previousProofId = reads.computeProofId(reads.registryAddress, record);
        input = { identity, mode: "RESEAL", expectedPriorVersion: record.version, previousProofId };
      } catch { /* no lease: SEAL */ }
      const result: any = await runner.run(input,
        (s: string) => process.stderr.write(`  ${agentId}: ${s}\n`));
      if (result.kind === "SEALED") {
        const v = result.writeOutcome?.version ?? result.chain?.expectedVersion;
        const score = result.compute?.behavioralScore;
        console.log(`OK agent ${agentId} SEALED v${v} behavioralScore=${score}`);
        results.push({ agentId, ok: true, detail: `v${v}` });
      } else {
        console.log(`SKIP agent ${agentId} -> ${result.kind}`);
        results.push({ agentId, ok: false, detail: result.kind });
      }
    } catch (error: any) {
      const code = error?.code ?? error?.name ?? "ERROR";
      const msg = (error?.message ?? String(error)).slice(0, 100);
      console.log(`FAIL agent ${agentId} -> ${code}: ${msg}`);
      results.push({ agentId, ok: false, detail: `${code}` });
    }
  }
  const sealed = results.filter((r) => r.ok).length;
  console.log(`\n=== BATCH DONE: ${sealed}/${AGENT_IDS.length} sealed ===`);
  console.log(JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
