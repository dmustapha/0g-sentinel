"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef } from "react";
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
  const historicalBusy = historical.status === "VERIFYING" || historical.status === "RETRYING";
  const currentBusy = current.status === "READING";
  const busy = historicalBusy || currentBusy;
  const retryable = historical.status === "UNAVAILABLE" ||
    historical.status === "TIMEOUT" || historical.status === "CANCELED";
  return <div className="verification-control"><div className="action-row"><button className="button primary" disabled={busy} onClick={() => verification.run(false)}>Verify exact evidence</button>
    {retryable && <button className="button" onClick={() => verification.run(true)}>Retry</button>}
    {historicalBusy && <button className="button" onClick={verification.cancelHistorical}>Cancel historical verification</button>}
    {currentBusy && <button className="button" onClick={verification.cancelCurrent}>Cancel current access read</button>}</div>
    <VerificationResult state={historical.status} current={current.status} reasonCode={"reason" in current ? current.reason : undefined} busy={busy} />
    {historical.status === "MATCH" && <HistoricalProofDetails proof={historical.proof} explorerBase={process.env.NEXT_PUBLIC_ZERO_G_EXPLORER ?? "https://chainscan.0g.ai"} />}
  </div>;
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
  const provider = compute && configuredDisplayText(compute.provider, "Provider not provided", { maxGraphemes: 96 });
  const model = compute && configuredDisplayText(compute.model, "Model not provided", { maxGraphemes: 120 });
  const version = displayValue(proof.proofLock.version, { maxGraphemes: 80 });
  return <div className="verification-proof"><dl className="proof-list"><div><dt>Registry source transaction</dt><dd><ExplorerValue base={explorerBase} kind="tx" value={proof.source.transactionHash} /></dd></div>
    <div><dt>Source block</dt><dd aria-label={`block ${proof.source.blockNumber}`}>block <bdi dir="ltr">{proof.source.blockNumber}</bdi></dd></div><div><dt>Lease version</dt><dd aria-label={`Version ${version.display}`}>Version <bdi dir="ltr">{version.display}</bdi></dd></div>
    <div><dt>Registry</dt><dd><ExplorerValue base={explorerBase} kind="address" value={proof.source.registryAddress} /></dd></div>
    <div><dt>Source block hash</dt><dd className="mono break"><bdi dir="ltr">{proof.source.blockHash}</bdi></dd></div><div><dt>Log index</dt><dd><bdi dir="ltr">{proof.source.logIndex}</bdi></dd></div>
    <div><dt>Storage root</dt><dd className="mono break"><bdi dir="ltr">{proof.proofLock.storageRoot}</bdi></dd></div><div><dt>Storage upload transaction</dt><dd>{uploadTx ? <ExplorerValue base={explorerBase} kind="tx" value={uploadTx} /> : "Unavailable"}</dd></div>
    <div><dt>Compute provider</dt><dd className="mono break"><bdi>{provider ?? "Unavailable"}</bdi></dd></div><div><dt>Compute model</dt><dd><bdi>{model ?? "Unavailable"}</bdi></dd></div>
    <div><dt>Retrieval</dt><dd>Exact bytes, digest, and recomputed 0G root match</dd></div><div><dt>Capability</dt><dd className="mono">networkProofVerified: false</dd></div></dl></div>;
}

function ExplorerValue({ base, kind, value }: Readonly<{
  base: string; kind: "tx" | "address"; value: string;
}>) {
  const href = kind === "tx" ? explorerTransactionUrl(base, value) : explorerAddressUrl(base, value);
  const display = safeDisplayText(value, { maxGraphemes: 96 });
  if (!href) return <span className="mono break"><bdi dir="ltr">{display}</bdi></span>;
  return <a className="text-link mono break" href={href} target="_blank"
    rel="noopener noreferrer"><bdi dir="ltr">{display}</bdi></a>;
}

export function ProofLocatorNotice({ status, currentHref }: Readonly<{
  status: LinkedHistoricalProof["status"];
  currentHref: string;
}>) {
  if (status === "MATCH") return null;
  if (status === "STALE_LINK") return <div className="inline-state state-warn"><b>Stale proof link</b>
    <p>The supplied Registry source transaction does not identify the current record. No historical match is claimed.</p>
    <Link className="text-link" href={currentHref}>Retry current record without source locator</Link></div>;
  if (status === "MISMATCH") return <div className="inline-state state-bad"><b>Historical proof mismatch</b>
    <p>The linked artifact failed cryptographic or finalized provenance checks. No historical match is claimed.</p></div>;
  if (status === "HINT_REQUIRED") return <div className="inline-state state-warn"><b>Source transaction required</b>
    <p>This proof is outside the bounded historical lookup. Open a link carrying its exact Registry source transaction.</p></div>;
  return <div className="inline-state state-warn"><b>Historical evidence unavailable</b>
    <p>The current record remains visible, but its historical artifact was not verified.</p></div>;
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

export function VerificationResult({ state, current, reasonCode, busy = false }: { state: ProofVerificationState; current?: CurrentVerification["status"]; reasonCode?: string; busy?: boolean }) {
  const labels: Record<ProofVerificationState, string> = { IDLE: "Ready to verify", VERIFYING: "Verifying exact stored bytes…", MATCH: "Historical artifact matches",
    MISMATCH: "Historical artifact mismatch", HINT_REQUIRED: "Source transaction required", UNAVAILABLE: "Evidence unavailable",
    TIMEOUT: "Verification timed out", CANCELED: "Verification canceled", RETRYING: "Retrying verification" };
  const tone = state === "MATCH" ? "state-good" : state === "IDLE" || state === "VERIFYING" || state === "RETRYING" ? "state-warn" : "state-bad";
  const currentVisible = current && current !== "IDLE";
  return <div className={`verification-result ${tone}`} role="status" aria-live="polite" aria-busy={busy}><b>{labels[state]}</b>{state === "MATCH" && <p>Canonical envelope, record bindings, verified Compute transcript, finalized Storage commitment, and retrieval match at verification time.</p>}
    {currentVisible && <p><strong>Current access: {current}</strong>{reasonCode
      ? <> · <bdi>{safeDisplayText(reasonCode, { maxGraphemes: 80 })}</bdi></> : ""}</p>}
    {state === "MATCH" && <small>Historical artifact validity is independent of the current lease and Gate state.</small>}</div>;
}
