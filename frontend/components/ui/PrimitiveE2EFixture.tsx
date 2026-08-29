"use client";

import { useState } from "react";
import { Button } from "./Button";
import { Field } from "./Field";
import { StateMessage } from "./StateMessage";

export function PrimitiveE2EFixture() {
  const [activations, setActivations] = useState(0);
  const [pending, setPending] = useState(false);
  const [recoveries, setRecoveries] = useState(0);
  const recovered = recoveries > 0;

  const begin = () => {
    setActivations((count) => count + 1);
    setPending(true);
  };

  return (
    <section className="workspace-section" aria-label="Primitive contract fixture">
      <div className="wrap">
        <h2>Primitive contract fixture</h2>
        <div className="action-row">
          <Button data-testid="primitive-primary" variant="primary" pending={pending}
            pendingLabel="Sealing proof" onClick={begin}>Seal proof</Button>
          <Button disabled>Disabled action</Button>
          <Field label="Agent ID" name="agentId" mono hint="Canonical decimal ID" />
        </div>
        <p data-testid="activation-count">Activations: {activations}</p>
        <div className="action-row">
          <Button data-testid="primitive-secondary">Secondary action</Button>
          <Button data-testid="primitive-quiet" variant="quiet">Quiet action</Button>
          <Button data-testid="primitive-destructive" variant="destructive">Destructive action</Button>
        </div>
        <StateMessage state={recovered ? "success" : "unavailable"}
          title={recovered ? "Read recovered" : "Read unavailable"}
          action={recovered ? undefined : <Button variant="quiet"
            onClick={() => setRecoveries((count) => count + 1)}>Retry read</Button>}>
          {recovered ? "The read result is available." : "No result is inferred."}
        </StateMessage>
        <p data-testid="recovery-count">Recoveries: {recoveries}</p>
      </div>
    </section>
  );
}
