"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { DataRow } from "@/components/ui/DataRow";
import { StateMessage, type StateMessageState } from "@/components/ui/StateMessage";
import { VERIFIER_CLAIM_COPY } from "@/lib/prooflock-claims";
import { ProofLockApiError, readProofLockDetail, verifyProof } from "@/lib/prooflock-client";
import { admittedConsumerState, gateReasonMeta, leaseStatus } from "@/lib/prooflock-status";
import { createVerificationCoordinator, initialVerificationState, verificationReducer } from "@/lib/verification-state";
import { explorerAddressUrl, explorerTransactionUrl } from "@/lib/explorer-url";
import { configuredDisplayText, displayValue, safeDisplayText } from "@/lib/safe-display";
import type { VerificationAction } from "@/lib/verification-state";
import type { CurrentVerification, ProofLockDetailResponse, ProofVerificationState, VerifiedProof } from "@/lib/prooflock-types";
import type { LinkedHistoricalProof } from "@/lib/prooflock-routes";

type AbortKind = "TIMEOUT" | "CANCELED";
const REQUEST_TIMEOUT_MS = 12_000;

export function VerifyEvidenceButton({ proofId, identityKey, sourceTxHash }: { proofId: string; identityKey: string; sourceTxHash?: string }) {
  const sessionKey = verificationSessionKey(proofId, identityKey, sourceTxHash);
  return <StatefulVerifyEvidenceButton key={sessionKey} proofId={proofId}
    identityKey={identityKey} sourceTxHash={sourceTxHash} />;
}

export function verificationSessionKey(proofId: string, identityKey: string, sourceTxHash?: string): string {
  return JSON.stringify([proofId, identityKey, sourceTxHash ?? null]);
}

function StatefulVerifyEvidenceButton({ proofId, identityKey, sourceTxHash }: { proofId: string; identityKey: string; sourceTxHash?: string }) {
  const verification = useVerification(proofId, identityKey, sourceTxHash);
  const historical = verification.state.historical;
  const current = verification.state.current;
  const historicalStatusRef = useRef<HTMLHeadingElement>(null);
  const currentStatusRef = useRef<HTMLHeadingElement>(null);
  const focusCurrentOnSettle = useRef(false);
  const priorHistoricalStatus = useRef(historical.status);
  const historicalBusy = historical.status === "VERIFYING" || historical.status === "RETRYING";
  const currentBusy = current.status === "READING";
  const retryable = historical.status === "MISMATCH" || historical.status === "UNAVAILABLE" ||
    historical.status === "TIMEOUT" || historical.status === "CANCELED";
  const retryMode = retryable || historical.status === "RETRYING";
  useEffect(() => {
    const changed = priorHistoricalStatus.current !== historical.status;
    priorHistoricalStatus.current = historical.status;
    if (changed && terminalHistoricalStatus(historical.status)) historicalStatusRef.current?.focus();
  }, [historical.status]);
  useEffect(() => {
    if (focusCurrentOnSettle.current && current.status !== "READING" && current.status !== "IDLE") {
      focusCurrentOnSettle.current = false; currentStatusRef.current?.focus();
    }
  }, [current.status]);
  const cancelCurrent = () => {
    focusCurrentOnSettle.current = true; verification.cancelCurrent();
  };
  const retryAction = retryMode ? <Button pending={historical.status === "RETRYING"}
    pendingLabel={VERIFIER_CLAIM_COPY.actions.retrying} onClick={() => verification.run(true)}>{VERIFIER_CLAIM_COPY.actions.retry}</Button> : undefined;
  return <div className="verification-control"><div className="action-row">
    {!retryMode ? <Button variant="primary" pending={historicalBusy}
      pendingLabel={VERIFIER_CLAIM_COPY.actions.verifying} disabled={currentBusy}
      onClick={() => verification.run(false)}>{VERIFIER_CLAIM_COPY.actions.verify}</Button> : null}
    {historicalBusy && <Button onClick={verification.cancelHistorical}>{VERIFIER_CLAIM_COPY.actions.cancelHistorical}</Button>}
    {currentBusy && <Button onClick={cancelCurrent}>{VERIFIER_CLAIM_COPY.actions.cancelCurrent}</Button>}</div>
    <VerificationResult historicalRef={historicalStatusRef} state={historical.status} current={current.status}
      currentRef={currentStatusRef} reasonCode={"reason" in current ? current.reason : undefined}
      busy={historicalBusy || currentBusy} proof={historical.status === "MATCH" ? historical.proof : undefined}
      explorerBase={process.env.NEXT_PUBLIC_ZERO_G_EXPLORER ?? "https://chainscan.0g.ai"}
      historicalAction={retryAction} />
  </div>;
}

function terminalHistoricalStatus(status: ProofVerificationState): boolean {
  return status === "MATCH" || status === "MISMATCH" || status === "HINT_REQUIRED" ||
    status === "UNAVAILABLE" || status === "TIMEOUT" || status === "CANCELED";
}

function useVerification(proofId: string, identityKey: string, sourceTxHash?: string) {
  const [state, dispatch] = useReducer(verificationReducer, initialVerificationState);
  const coordinator = useRef<ReturnType<typeof createVerificationCoordinator> | null>(null);
  coordinator.current ??= newVerificationCoordinator(dispatch);
  const activeCoordinator = coordinator.current;
  useEffect(() => {
    activeCoordinator.setIdentifiers({ proofId, identityKey, sourceTxHash });
    return () => activeCoordinator.dispose();
  }, [activeCoordinator, identityKey, proofId, sourceTxHash]);
  return {
    state,
    run: (retry: boolean) => activeCoordinator.start(retry),
    cancelHistorical: () => activeCoordinator.cancelHistorical(),
    cancelCurrent: () => activeCoordinator.cancelCurrent(),
  };
}

function newVerificationCoordinator(dispatch: (action: VerificationAction) => void) {
  return createVerificationCoordinator({
    timeoutMs: REQUEST_TIMEOUT_MS,
    dispatch,
    verifyHistorical: (identifiers, signal) => verifyProof(
      identifiers.proofId,
      identifiers.identityKey,
      signal,
      identifiers.sourceTxHash,
    ),
    readCurrent: (key, signal) => readProofLockDetail(key, signal),
    mapHistoricalError: verificationStateForError,
    mapCurrentAccess,
  });
}

export function verificationStateForError(cause: unknown, abortKind?: AbortKind): Extract<ProofVerificationState, "MISMATCH" | "HINT_REQUIRED" | "UNAVAILABLE" | "TIMEOUT" | "CANCELED"> {
  if (abortKind) return abortKind;
  if (cause instanceof ProofLockApiError && (cause.detail.code === "MISMATCH" || cause.detail.code === "NOT_FOUND")) return "MISMATCH";
  if (cause instanceof ProofLockApiError && cause.detail.code === "HINT_REQUIRED") return "HINT_REQUIRED";
  return "UNAVAILABLE";
}

function mapCurrentAccess(detail: ProofLockDetailResponse): { access: "ADMITTED" | "BLOCKED"; reason: string } {
  const result = currentAccessFor(detail);
  return { access: result.current, reason: result.reason };
}

export function currentAccessFor(detail: ProofLockDetailResponse): { current: "ADMITTED" | "BLOCKED"; reason: string } {
  const gate = detail.detail.gate;
  const admitted = detail.detail.status === "VERIFIED" && leaseStatus(detail.proofLock) === "ACTIVE" &&
    admittedConsumerState(detail.proofLock, gate, detail.detail.consumer, detail.detail.identity.agentWallet);
  if (admitted) return { current: "ADMITTED", reason: "ALLOWED" };
  if (gate.status !== "VERIFIED") return { current: "BLOCKED", reason: "GATE_UNKNOWN" };
  if (!gate.allowed) return { current: "BLOCKED", reason: gateReasonMeta(gate.reason).code };
  return { current: "BLOCKED", reason: detail.detail.consumer.status === "VERIFIED" ? "CONSUMER_BLOCKED" : "CONSUMER_UNKNOWN" };
}

export function HistoricalProofDetails({ proof, explorerBase }: Readonly<{
  proof: VerifiedProof; explorerBase: string;
}>) {
  const compute = firstCompute(proof.storage.envelope);
  const uploadTx = stringField(proof.storage.storageCommitment, "uploadTxHash");
  const provider = compute && configuredDisplayText(compute.provider, VERIFIER_CLAIM_COPY.evidence.providerFallback, { maxGraphemes: 96 });
  const model = compute && configuredDisplayText(compute.model, VERIFIER_CLAIM_COPY.evidence.modelFallback, { maxGraphemes: 120 });
  const providerConfigured = Boolean(compute && provider !== VERIFIER_CLAIM_COPY.evidence.providerFallback);
  const version = displayValue(proof.proofLock.version, { maxGraphemes: 80 });
  return <div className="verification-proof"><dl className="proof-list">
    <DataRow label="Registry source transaction" value={proof.source.transactionHash} copyable external
      href={explorerTransactionUrl(explorerBase, proof.source.transactionHash) ?? undefined} />
    <DataRow label="Source block" value={proof.source.blockNumber}
      displayValue={`block ${proof.source.blockNumber}`} copyable />
    <DataRow label="Lease version" value={version.canonical} displayValue={`Version ${version.display}`} copyable />
    <DataRow label="Registry" value={proof.source.registryAddress} copyable external
      href={explorerAddressUrl(explorerBase, proof.source.registryAddress) ?? undefined} />
    <DataRow label="Source block hash" value={proof.source.blockHash} copyable />
    <DataRow label="Log index" value={proof.source.logIndex} copyable />
    <DataRow label="Storage root" value={proof.proofLock.storageRoot} copyable />
    <DataRow label="Storage upload transaction" value={uploadTx}
      displayValue={uploadTx ? safeDisplayText(uploadTx, { maxGraphemes: 96 }) : undefined} copyable external
      href={uploadTx ? explorerTransactionUrl(explorerBase, uploadTx) ?? undefined : undefined} />
    <DataRow label="Compute provider" value={providerConfigured ? compute!.provider
      : provider ?? VERIFIER_CLAIM_COPY.evidence.unavailableValue}
      displayValue={provider} technical={providerConfigured} copyable={providerConfigured} />
    <DataRow label="Compute model" value={model ?? VERIFIER_CLAIM_COPY.evidence.unavailableValue}
      displayValue={model} technical={false} />
    <DataRow label={VERIFIER_CLAIM_COPY.evidence.storageFlagLabel}
      value={VERIFIER_CLAIM_COPY.evidence.storageFlagValue} /></dl></div>;
}

export function ProofLocatorNotice({ status, currentHref }: Readonly<{
  status: LinkedHistoricalProof["status"];
  currentHref: string;
}>) {
  if (status === "MATCH") return null;
  if (status === "STALE_LINK") return <div className="inline-state state-warn"><b>{VERIFIER_CLAIM_COPY.locator.staleTitle}</b>
    <p>{VERIFIER_CLAIM_COPY.locator.staleDetail}</p>
    <Link className="text-link" href={currentHref}>{VERIFIER_CLAIM_COPY.locator.staleAction}</Link></div>;
  if (status === "MISMATCH") return <div className="inline-state state-bad"><b>{VERIFIER_CLAIM_COPY.locator.mismatchTitle}</b>
    <p>{VERIFIER_CLAIM_COPY.locator.mismatchDetail}</p></div>;
  if (status === "HINT_REQUIRED") return <div className="inline-state state-warn"><b>{VERIFIER_CLAIM_COPY.locator.hintTitle}</b>
    <p>{VERIFIER_CLAIM_COPY.locator.hintDetail}</p></div>;
  return <div className="inline-state state-warn"><b>{VERIFIER_CLAIM_COPY.locator.unavailableTitle}</b>
    <p>{VERIFIER_CLAIM_COPY.locator.unavailableDetail}</p></div>;
}

function firstCompute(envelope: Readonly<Record<string, unknown>>): { provider: string; model: string } | undefined {
  const proofs = envelope.computeProofs;
  if (!Array.isArray(proofs) || typeof proofs[0] !== "object" || !proofs[0]) return undefined;
  const provider = stringField(proofs[0] as Record<string, unknown>, "provider");
  const model = stringField(proofs[0] as Record<string, unknown>, "model");
  return provider && model ? { provider, model } : undefined;
}
function stringField(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  return typeof value?.[key] === "string" ? value[key] as string : undefined;
}

export function VerificationResult({ state, current, reasonCode, busy = false, historicalRef, currentRef,
  proof, explorerBase, historicalAction }: {
  state: ProofVerificationState; current?: CurrentVerification["status"]; reasonCode?: string;
  busy?: boolean; historicalRef?: RefObject<HTMLHeadingElement>; currentRef?: RefObject<HTMLHeadingElement>;
  proof?: VerifiedProof; explorerBase?: string; historicalAction?: ReactNode;
}) {
  const labels: Record<ProofVerificationState, string> = VERIFIER_CLAIM_COPY.historical.labels;
  const currentVisible = current && current !== "IDLE";
  const historicalBusy = state === "VERIFYING" || state === "RETRYING";
  const outcome = verdictOutcome(state);
  return <div className="verification-result">
    <section data-plane="historical">
      {outcome ? <div key={state} className="verdict-reveal" data-outcome={outcome}>
        <VerdictMark outcome={outcome} />
        <h2 ref={historicalRef} tabIndex={-1}>{labels[state]}</h2>
      </div> : <h2 ref={historicalRef} tabIndex={-1}>{labels[state]}</h2>}
      <PlaneAnnouncement busy={historicalBusy || (busy && !currentVisible)} text={labels[state]} />
      <StateMessage announce="off" state={historicalMessageState(state)} title={VERIFIER_CLAIM_COPY.historical.boundaryTitle}>
        {VERIFIER_CLAIM_COPY.historical.boundaryDetail}
      </StateMessage>
      {historicalAction ? <div className="action-row verification-result__action">{historicalAction}</div> : null}
      {proof ? <HistoricalProofDetails proof={proof}
        explorerBase={explorerBase ?? "https://chainscan.0g.ai"} /> : null}
    </section>
    {currentVisible ? <section data-plane="current">
      <h2 ref={currentRef} tabIndex={-1}>{VERIFIER_CLAIM_COPY.current.headingPrefix}: {current}</h2>
      <PlaneAnnouncement busy={current === "READING"}
        text={`${VERIFIER_CLAIM_COPY.current.headingPrefix}: ${current}`} />
      <StateMessage announce="off" state={currentMessageState(current)} title={VERIFIER_CLAIM_COPY.current.boundaryTitle}>
        {reasonCode ? <>{VERIFIER_CLAIM_COPY.current.reasonPrefix}: <bdi>{safeDisplayText(reasonCode, { maxGraphemes: 80 })}</bdi></> : VERIFIER_CLAIM_COPY.current.noReason}
      </StateMessage>
    </section> : null}
  </div>;
}

function PlaneAnnouncement({ busy, text }: Readonly<{ busy: boolean; text: string }>) {
  return <span className="sr-only" role="status" aria-live="polite" aria-atomic="true"
    aria-busy={busy}>{text}</span>;
}

function verdictOutcome(state: ProofVerificationState): "pass" | "fail" | null {
  if (state === "MATCH") return "pass";
  if (state === "MISMATCH" || state === "UNAVAILABLE" || state === "TIMEOUT"
    || state === "CANCELED" || state === "HINT_REQUIRED") return "fail";
  return null;
}

// The verify payoff mark: a drawn check for a pass, a drawn cross for a fail. The stroke draws in via
// the .verdict-mark class in motion.css; decorative only (announcements live in the sr-only status).
function VerdictMark({ outcome }: Readonly<{ outcome: "pass" | "fail" }>) {
  const stroke = outcome === "pass" ? "var(--good)" : "var(--bad)";
  return <svg className="verdict-icon" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"
    fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="14" cy="14" r="12" stroke={stroke} strokeWidth="1.4" opacity="0.4" />
    {outcome === "pass"
      ? <path d="M8.5 14.5l3.5 3.5 7-8" />
      : <path d="M9 9l10 10M19 9L9 19" />}
  </svg>;
}

function historicalMessageState(state: ProofVerificationState): StateMessageState {
  if (state === "MATCH") return "success";
  if (state === "VERIFYING" || state === "RETRYING") return "loading";
  if (state === "IDLE") return "empty";
  if (state === "HINT_REQUIRED" || state === "UNAVAILABLE") return "unavailable";
  return "error";
}

function currentMessageState(state: Exclude<CurrentVerification["status"], "IDLE">): StateMessageState {
  if (state === "READING") return "loading";
  if (state === "ADMITTED") return "success";
  if (state === "UNAVAILABLE") return "unavailable";
  return "error";
}
