import type { HealthSnapshot, SubsystemName } from "@/lib/prooflock-types";

const LABELS: Record<SubsystemName, string> = { rpc: "RPC", identity: "ERC-8004", registry: "RegistryV2", gate: "AgentGateV2", compute: "0G Compute", storage: "0G Storage" };
const NAMES = Object.keys(LABELS) as SubsystemName[];

export function SubsystemHealthGrid({ snapshot, observedAt }: { snapshot: HealthSnapshot; observedAt: string }) {
  return <div className="health-grid">{NAMES.map((name) => { const probe = snapshot.dependencies[name]; const tone = probe.status === "HEALTHY" ? "state-good" : probe.status === "UNHEALTHY" ? "state-bad" : "state-warn";
    return <article className={`health-cell ${tone}`} key={name}><div className="card-row"><b>{LABELS[name]}</b><span className="status-chip">{probe.status}</span></div>
      <dl><div><dt>Latency</dt><dd>{probe.latencyMs} ms</dd></div><div><dt>Observed</dt><dd>{observedAt}</dd></div></dl></article>;
  })}</div>;
}

