import { VERIFIER_CLAIM_COPY } from "@/lib/prooflock-claims";
import type { HealthSnapshot, SubsystemName } from "@/lib/prooflock-types";

const LABELS: Record<SubsystemName, string> = { rpc: "RPC", identity: "ERC-8004", registry: "RegistryV2", gate: "AgentGateV2", compute: "0G Compute", storage: "0G Storage" };
const NAMES = Object.keys(LABELS) as SubsystemName[];

export function SubsystemHealthGrid({ snapshot }: { snapshot: HealthSnapshot }) {
  return <div className="health-grid">{NAMES.map((name) => { const probe = snapshot.dependencies[name]; const tone = probe.status === "HEALTHY" ? "state-good" : probe.status === "UNHEALTHY" ? "state-bad" : "state-warn";
    return <article className={`health-cell bp-bracket ${tone}`} data-subsystem={name} data-status={probe.status} key={name}><span className="bp-corners" aria-hidden="true" /><div className="card-row"><b>{LABELS[name]}</b><span className="status-chip">{probe.status}</span></div>
      <dl><div><dt>Latency</dt><dd><bdi dir="ltr">{probe.latencyMs} ms</bdi></dd></div><div><dt>Observed</dt><dd><bdi dir="ltr">{probe.observedAt}</bdi></dd></div>
        <div><dt>Observation</dt><dd><bdi>{observation(name, probe.detail)}</bdi></dd></div></dl></article>;
  })}</div>;
}

function observation(name: SubsystemName, detail?: Readonly<Record<string, unknown>>): string {
  if (name === "compute" && detail?.observation === "SERVICE_DISCOVERY") return `${VERIFIER_CLAIM_COPY.health.computeObservation} · ${VERIFIER_CLAIM_COPY.health.computeInferenceLabel}: ${String(detail.inferenceExecuted === true)}`;
  if (name === "storage" && detail?.observation === "RETRIEVAL_CANARY") return `${VERIFIER_CLAIM_COPY.health.storageObservation} · ${VERIFIER_CLAIM_COPY.health.storageNetworkProofLabel}: ${String(detail.networkProofVerified === true)}`;
  return VERIFIER_CLAIM_COPY.health.directObservation;
}
