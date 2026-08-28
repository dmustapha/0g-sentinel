"use client";

import { useState } from "react";
import { ProofLockApiError, readProofLockDetail, verifyProof } from "@/lib/prooflock-client";
import { admittedConsumerState, gateReasonMeta, leaseStatus } from "@/lib/prooflock-status";
import type { ProofLockDetailResponse, ProofVerificationState, VerifiedProof } from "@/lib/prooflock-types";

export function VerifyEvidenceButton({ proofId, identityKey, sourceTxHash }: { proofId: string; identityKey: string; sourceTxHash?: string }) {
  const [state, setState] = useState<ProofVerificationState>("IDLE"); const [proof, setProof] = useState<VerifiedProof>();
  const [current, setCurrent] = useState<"ADMITTED" | "BLOCKED">(); const [reason, setReason] = useState<string>();
  async function run(retry = false) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000); setState(retry ? "RETRYING" : "VERIFYING");
    try { const [verified, detail] = await Promise.all([verifyProof(proofId, identityKey, controller.signal, sourceTxHash), readProofLockDetail(identityKey, controller.signal)]);
      setProof(verified); const access = currentAccessFor(detail); setCurrent(access.current); setReason(access.reason); setState("MATCH");
    } catch (cause) { setState(verificationStateForError(cause, controller.signal.aborted));
    } finally { clearTimeout(timer); }
  }
  return <div className="verification-control"><div className="action-row"><button className="button primary" disabled={state === "VERIFYING" || state === "RETRYING"} onClick={() => run(false)}>Verify exact evidence</button>
    {(state === "UNAVAILABLE" || state === "TIMEOUT") && <button className="button" onClick={() => run(true)}>Retry</button>}</div>
    <VerificationResult state={state} current={current} reasonCode={reason} />
    {proof && <HistoricalProofDetails proof={proof} explorerBase={process.env.NEXT_PUBLIC_ZERO_G_EXPLORER ?? "https://chainscan.0g.ai"} />}
  </div>;
}

export function verificationStateForError(cause: unknown, aborted: boolean): ProofVerificationState {
  if (aborted || cause instanceof DOMException && cause.name === "AbortError") return "TIMEOUT";
  if (cause instanceof ProofLockApiError && (cause.detail.code === "MISMATCH" || cause.detail.code === "NOT_FOUND")) return "MISMATCH";
  return "UNAVAILABLE";
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
  const compute = firstCompute(proof.storage.envelope); const uploadTx = stringField(proof.storage.storageCommitment, "uploadTxHash");
  const base = explorerBase.replace(/\/$/, "");
  return <div className="verification-proof"><dl className="proof-list"><div><dt>Historical source</dt><dd><a className="text-link mono break" href={`${base}/tx/${proof.source.transactionHash}`} target="_blank" rel="noreferrer">{proof.source.transactionHash}</a></dd></div>
    <div><dt>Source block</dt><dd>block {proof.source.blockNumber}</dd></div><div><dt>Lease version</dt><dd>Version {proof.proofLock.version}</dd></div>
    <div><dt>Registry</dt><dd><a className="text-link mono break" href={`${base}/address/${proof.source.registryAddress}`} target="_blank" rel="noreferrer">{proof.source.registryAddress}</a></dd></div>
    <div><dt>Source block hash</dt><dd className="mono break">{proof.source.blockHash}</dd></div><div><dt>Log index</dt><dd>{proof.source.logIndex}</dd></div>
    <div><dt>Storage root</dt><dd className="mono break">{proof.proofLock.storageRoot}</dd></div><div><dt>Storage upload transaction</dt><dd>{uploadTx ? <a className="text-link mono break" href={`${base}/tx/${uploadTx}`} target="_blank" rel="noreferrer">{uploadTx}</a> : "Unavailable"}</dd></div>
    <div><dt>Compute provider</dt><dd className="mono break">{compute?.provider ?? "Unavailable"}</dd></div><div><dt>Compute model</dt><dd>{compute?.model ?? "Unavailable"}</dd></div>
    <div><dt>Retrieval</dt><dd>Exact bytes, digest, and recomputed 0G root match</dd></div><div><dt>Capability</dt><dd className="mono">networkProofVerified: false</dd></div></dl></div>;
}

function firstCompute(envelope: Readonly<Record<string, unknown>>): { provider: string; model: string } | undefined {
  const proofs = envelope.computeProofs; if (!Array.isArray(proofs) || typeof proofs[0] !== "object" || !proofs[0]) return undefined;
  const provider = stringField(proofs[0] as Record<string, unknown>, "provider"); const model = stringField(proofs[0] as Record<string, unknown>, "model");
  return provider && model ? { provider, model } : undefined;
}
function stringField(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  return typeof value?.[key] === "string" ? value[key] as string : undefined;
}

export function VerificationResult({ state, current, reasonCode }: { state: ProofVerificationState; current?: "ADMITTED" | "BLOCKED"; reasonCode?: string }) {
  const labels: Record<ProofVerificationState, string> = { IDLE: "Ready to verify", VERIFYING: "Verifying exact stored bytes…", MATCH: "Historical artifact matches",
    MISMATCH: "Historical artifact mismatch", UNAVAILABLE: "Evidence unavailable", TIMEOUT: "Verification timed out", RETRYING: "Retrying verification" };
  const tone = state === "MATCH" ? "state-good" : state === "IDLE" || state === "VERIFYING" || state === "RETRYING" ? "state-warn" : "state-bad";
  return <div className={`verification-result ${tone}`} aria-live="polite"><b>{labels[state]}</b>{state === "MATCH" && <p>Canonical envelope, record bindings, verified Compute transcript, finalized Storage commitment, and retrieval match at verification time.</p>}
    {current && <p><strong>Current access: {current}</strong>{reasonCode ? ` · ${reasonCode}` : ""}</p>}
    {state === "MATCH" && <small>Historical artifact validity is independent of the current lease and Gate state.</small>}</div>;
}
