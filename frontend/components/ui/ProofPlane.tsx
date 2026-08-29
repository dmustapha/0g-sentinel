import { useId, type HTMLAttributes } from "react";
import { assertObservation, observationStatusAt } from "../../lib/prooflock-observations";
import type { ObservationScope, ProofLockObservation } from "../../lib/prooflock-types";
import { DataRow } from "./DataRow";
import { StatusBadge } from "./StatusBadge";

const PLANE_COPY = Object.freeze({
  HISTORICAL: { heading: "Sealed evidence", detail: "Historical, versioned, event-preserved" },
  CURRENT: { heading: "Current access", detail: "Independently observed at one finalized block" },
} satisfies Record<ObservationScope, Readonly<{ heading: string; detail: string }>>);

type ScopedObservation<S extends ObservationScope> = ProofLockObservation & Readonly<{ scope: S }>;
type ProofPlaneProps = Omit<HTMLAttributes<HTMLElement>, "children"> & ({
  scope: "HISTORICAL";
  observations: readonly ScopedObservation<"HISTORICAL">[];
  nowMs?: never;
} | {
  scope: "CURRENT";
  observations: readonly ScopedObservation<"CURRENT">[];
  nowMs: number;
});

export function ProofPlane({ className = "", nowMs, observations, scope, ...props }: ProofPlaneProps) {
  const validated = assertProofPlaneObservations(scope, observations);
  const headingId = useId();
  const copy = PLANE_COPY[scope];
  const presentationTime = scope === "CURRENT" ? nowMs : 0;
  return (
    <section {...props} aria-labelledby={headingId} data-plane={scope.toLowerCase()}
      className={`ui-proof-plane ui-proof-plane--${scope.toLowerCase()} ${className}`.trim()}>
      <header className="ui-proof-plane__header">
        <h2 id={headingId}>{copy.heading}</h2><p>{copy.detail}</p>
      </header>
      <div className="ui-proof-plane__observations">
        {validated.map((observation, index) =>
          <ObservationSummary key={`${observation.subsystem}-${index}`}
            observation={observation} nowMs={presentationTime} />)}
      </div>
    </section>
  );
}

export function assertProofPlaneObservations(scope: ObservationScope,
  observations: readonly ProofLockObservation[]): readonly ProofLockObservation[] {
  const validated = observations.map((candidate) => {
    const observation = assertObservation(candidate);
    if (observation.scope !== scope) throw new TypeError(
      `${observation.scope} observation does not belong to the ${scope} plane`,
    );
    return observation;
  });
  if (scope === "CURRENT") assertPinnedCoordinate(validated);
  return validated;
}

function ObservationSummary({ nowMs, observation }: Readonly<{
  nowMs: number; observation: ProofLockObservation;
}>) {
  const surface = observation.scope === "HISTORICAL" ? "paper" : "dark";
  const status = observationStatusAt(observation, nowMs);
  return (
    <article className="ui-proof-plane__observation" data-subsystem={observation.subsystem}>
      <div className="ui-proof-plane__observation-heading">
        <h3>{subsystemLabel(observation.subsystem)}</h3>
        <StatusBadge status={status} surface={surface} />
      </div>
      <dl className="ui-proof-plane__metadata">
        <DataRow label="Observed at" value={observation.observedAt} />
        {observation.scope === "CURRENT" ? <>
          <DataRow label="Observation block" value={observation.observationBlockNumber} />
          <DataRow label="Fresh until" value={observation.freshnessExpiresAt} />
        </> : null}
        {"reasonCode" in observation && observation.reasonCode
          ? <DataRow label="Reason" value={observation.reasonCode} technical={false} /> : null}
      </dl>
    </article>
  );
}

function subsystemLabel(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function assertPinnedCoordinate(observations: readonly ProofLockObservation[]) {
  const current = observations.filter((item) => item.scope === "CURRENT");
  if (current.length < 2) return;
  const coordinate = currentCoordinate(current[0]!);
  if (current.some((item) => currentCoordinate(item) !== coordinate)) {
    throw new TypeError("CURRENT observations must share one pinned coordinate");
  }
}

function currentCoordinate(observation: Extract<ProofLockObservation, { scope: "CURRENT" }>): string {
  return JSON.stringify([observation.observationBlockNumber, observation.observationBlockHash,
    observation.observedAt, observation.serverIssuedAt, observation.ttlMs, observation.freshnessExpiresAt]);
}
