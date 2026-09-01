"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SubsystemHealthGrid } from "@/components/SubsystemHealthGrid";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { StateMessage } from "@/components/ui/StateMessage";
import { TechnicalDisclosure } from "@/components/ui/TechnicalDisclosure";
import { VERIFIER_CLAIM_COPY, assertClaimAllowed, claimFor } from "@/lib/prooflock-claims";
import { readHealth } from "@/lib/prooflock-client";
import { canonicalProofHref } from "@/lib/prooflock-routes";
import type { HealthSnapshot } from "@/lib/prooflock-types";
import { parseNonZeroBytes32 } from "@/lib/prooflock-validation";

const verifierClaim = claimFor("verifier");
assertClaimAllowed(verifierClaim);

export default function ProofPage() {
  const router = useRouter();
  const [proofId, setProofId] = useState(""); const [identityKey, setIdentityKey] = useState("");
  const [sourceTxHash, setSourceTxHash] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const proofRef = useRef<HTMLInputElement>(null); const identityRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const exactProofId = parseNonZeroBytes32(proofId); const exactIdentityKey = parseNonZeroBytes32(identityKey);
  const exactSource = sourceTxHash ? parseNonZeroBytes32(sourceTxHash) : undefined;
  const requiredValid = exactProofId !== null && exactIdentityKey !== null;
  const valid = exactProofId !== null && exactIdentityKey !== null && exactSource !== null;

  const openVerifier = () => {
    setSubmitted(true);
    if (!exactProofId) return proofRef.current?.focus();
    if (!exactIdentityKey) return identityRef.current?.focus();
    if (exactSource === null) return sourceRef.current?.focus();
    router.push(canonicalProofHref(exactProofId, exactIdentityKey, exactSource));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); openVerifier(); };
  const validateEnter = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || valid) return;
    event.preventDefault(); openVerifier();
  };

  return <section className="workspace-section proof-page"><div className="wrap">
    <div className="page-heading"><span className="eyebrow">{VERIFIER_CLAIM_COPY.title}</span><h1>Check an agent&apos;s proof</h1>
      <p>This page lets anyone independently confirm an agent&apos;s sealed evidence and current access. {verifierClaim.text}</p></div>

    <section className="verify-primary" aria-labelledby="verify-primary-title">
      <h2 id="verify-primary-title" className="verify-primary__title">Just want to check an agent?</h2>
      <p>You do not need any codes. Browse the agents with sealed proofs and open one to see a plain
        summary of whether it is admitted and why.</p>
      <div className="verify-primary__actions">
        <Link className="ui-button ui-button--primary ui-button--idle" data-variant="primary" href="/agents">
          <span className="ui-button__content"><span className="ui-button__label">Browse agents</span></span>
        </Link>
        <Link className="text-link" href="/scan">Or scan a new agent by ID</Link>
      </div>
    </section>

    <TechnicalDisclosure summary="I already have a proof ID"
      hint="For developers: paste the exact proof ID and identity key to verify a specific sealed artifact.">
    <p className="verify-help">Where do these come from? Every agent detail page and every sealed proof link
      carries its own proof ID and identity key. Open an agent above, then use its Verify link.</p>
    <form className="verify-sheet" onSubmit={submit} onKeyDown={validateEnter} noValidate>
      <Field ref={proofRef} label="Proof ID" mono required value={proofId} onChange={(event) => setProofId(event.target.value)}
        placeholder="0x…32-byte proof ID" error={(submitted || proofId) && !exactProofId ? VERIFIER_CLAIM_COPY.entry.proofError : undefined} />
      <Field ref={identityRef} label="Identity key" mono required value={identityKey} onChange={(event) => setIdentityKey(event.target.value)}
        placeholder="0x…32-byte identity key" error={(submitted || identityKey) && !exactIdentityKey ? VERIFIER_CLAIM_COPY.entry.identityError : undefined} />
      <Field ref={sourceRef} label="Optional Registry source transaction" mono value={sourceTxHash}
        onChange={(event) => setSourceTxHash(event.target.value)} placeholder="0x…optional 32-byte transaction hash"
        error={sourceTxHash && !exactSource ? VERIFIER_CLAIM_COPY.entry.sourceError : undefined} />
      <Button type="submit" variant="primary" disabled={!requiredValid}>{VERIFIER_CLAIM_COPY.entry.openAction}</Button>
      {(proofId || identityKey || sourceTxHash) && !valid ? <StateMessage state="error" title={VERIFIER_CLAIM_COPY.entry.invalidTitle}>
        {VERIFIER_CLAIM_COPY.entry.invalidDetail}
      </StateMessage> : null}
    </form>
    </TechnicalDisclosure>
    <HealthPanel />
  </div></section>;
}

function HealthPanel() {
  const [health, setHealth] = useState<HealthSnapshot>(); const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(true); const [generation, setGeneration] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setPending(true);
    void readHealth(controller.signal).then((snapshot) => { setHealth(snapshot); setFailed(false); setPending(false); })
      .catch(() => { if (!controller.signal.aborted) { setFailed(true); setPending(false); } });
    return () => controller.abort();
  }, [generation]);
  useEffect(() => {
    if (generation > 0 && !pending && health) headingRef.current?.focus();
  }, [generation, health, pending]);
  return <><div className="section-heading health-heading"><span className="eyebrow">{VERIFIER_CLAIM_COPY.health.eyebrow}</span>
    <h2 ref={headingRef} tabIndex={-1}>{VERIFIER_CLAIM_COPY.health.heading}</h2><p>{VERIFIER_CLAIM_COPY.health.independence}</p></div>
  {pending && !failed ? <StateMessage state="loading" title={VERIFIER_CLAIM_COPY.health.loadingTitle}>{VERIFIER_CLAIM_COPY.health.loadingDetail}</StateMessage> : null}
  {failed ? <StateMessage state="unavailable" title={VERIFIER_CLAIM_COPY.health.unavailableTitle} action={<Button pending={pending}
    pendingLabel={VERIFIER_CLAIM_COPY.health.retryingAction} onClick={() => setGeneration((value) => value + 1)}>{VERIFIER_CLAIM_COPY.health.retryAction}</Button>}>
    {VERIFIER_CLAIM_COPY.health.unavailableDetail}
  </StateMessage> : null}
  {health ? <SubsystemHealthGrid snapshot={health} /> : null}</>;
}
