import type { HealthSnapshot, SubsystemName } from "@/lib/prooflock-types";

const LABELS: Record<SubsystemName, string> = { rpc: "RPC", identity: "ERC-8004", registry: "RegistryV2", gate: "AgentGateV2", compute: "0G Compute", storage: "0G Storage" };
const NAMES = Object.keys(LABELS) as SubsystemName[];

export function SubsystemHealthGrid({ snapshot }: { snapshot: HealthSnapshot }) {
  return <div className="health-grid">{NAMES.map((name) => { const probe = snapshot.dependencies[name]; const tone = probe.status === "HEALTHY" ? "state-good" : probe.status === "UNHEALTHY" ? "state-bad" : "state-warn";
    return <article className={`health-cell ${tone}`} key={name}><div className="card-row"><b>{LABELS[name]}</b><span className="status-chip">{probe.status}</span></div>
      <dl><div><dt>Latency</dt><dd><bdi dir="ltr">{probe.latencyMs} ms</bdi></dd></div><div><dt>Observed</dt><dd><bdi dir="ltr">{probe.observedAt}</bdi></dd></div>
        <div><dt>Observation</dt><dd><bdi>{observation(name, probe.detail)}</bdi></dd></div></dl></article>;
  })}</div>;
}

function observation(name: SubsystemName, detail?: Readonly<Record<string, unknown>>): string {
  if (name === "compute" && detail?.observation === "SERVICE_DISCOVERY") return `Service discovery only · inferenceExecuted: ${String(detail.inferenceExecuted === true)}`;
  if (name === "storage" && detail?.observation === "RETRIEVAL_CANARY") return `Retrieval canary · networkProofVerified: ${String(detail.networkProofVerified === true)}`;
  return "Direct dependency probe";
}
