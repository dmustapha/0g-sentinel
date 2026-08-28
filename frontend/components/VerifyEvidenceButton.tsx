"use client";

import { useState } from "react";
import { ProofLockApiError, readProofLockDetail, verifyProof } from "@/lib/prooflock-client";
import { gateReasonMeta, leaseStatus } from "@/lib/prooflock-status";
import type { ProofVerificationState, VerifiedProof } from "@/lib/prooflock-types";

export function VerifyEvidenceButton({ proofId, identityKey }: { proofId: string; identityKey: string }) {
  const [state, setState] = useState<ProofVerificationState>("IDLE"); const [proof, setProof] = useState<VerifiedProof>();
  const [current, setCurrent] = useState<"ADMITTED" | "BLOCKED">(); const [reason, setReason] = useState<string>();
  async function run(retry = false) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000); setState(retry ? "RETRYING" : "VERIFYING");
    try { const [verified, detail] = await Promise.all([verifyProof(proofId, identityKey, controller.signal), readProofLockDetail(identityKey, controller.signal)]);
      setProof(verified); const gate = detail.detail.gate; const admitted = leaseStatus(detail.proofLock) === "ACTIVE" && gate.status === "VERIFIED" && gate.allowed;
      setCurrent(admitted ? "ADMITTED" : "BLOCKED"); setReason(gate.status === "VERIFIED" ? gateReasonMeta(gate.reason).code : "GATE_UNKNOWN"); setState("MATCH");
    } catch (cause) { if (controller.signal.aborted) setState("TIMEOUT");
      else if (cause instanceof ProofLockApiError && cause.detail.code === "NOT_FOUND") setState("MISMATCH"); else setState("UNAVAILABLE");
    } finally { clearTimeout(timer); }
  }
  return <div className="verification-control"><div className="action-row"><button className="button primary" disabled={state === "VERIFYING" || state === "RETRYING"} onClick={() => run(false)}>Verify exact evidence</button>
    {(state === "UNAVAILABLE" || state === "TIMEOUT") && <button className="button" onClick={() => run(true)}>Retry</button>}</div>
    <VerificationResult state={state} current={current} reasonCode={reason} />
    {proof && <dl className="proof-list verification-proof"><div><dt>Storage root</dt><dd className="mono break">{proof.proofLock.storageRoot}</dd></div>
      <div><dt>Retrieval</dt><dd>Exact bytes, digest, and recomputed 0G root match</dd></div><div><dt>Capability</dt><dd className="mono">networkProofVerified: false</dd></div></dl>}
  </div>;
}

export function VerificationResult({ state, current, reasonCode }: { state: ProofVerificationState; current?: "ADMITTED" | "BLOCKED"; reasonCode?: string }) {
  const labels: Record<ProofVerificationState, string> = { IDLE: "Ready to verify", VERIFYING: "Verifying exact stored bytes…", MATCH: "Historical artifact matches",
    MISMATCH: "Historical artifact mismatch", UNAVAILABLE: "Evidence unavailable", TIMEOUT: "Verification timed out", RETRYING: "Retrying verification" };
  const tone = state === "MATCH" ? "state-good" : state === "IDLE" || state === "VERIFYING" || state === "RETRYING" ? "state-warn" : "state-bad";
  return <div className={`verification-result ${tone}`} aria-live="polite"><b>{labels[state]}</b>{state === "MATCH" && <p>Canonical envelope, record bindings, verified Compute transcript, finalized Storage commitment, and retrieval match at verification time.</p>}
    {current && <p><strong>Current access: {current}</strong>{reasonCode ? ` · ${reasonCode}` : ""}</p>}
    {state === "MATCH" && <small>Historical artifact validity is independent of the current lease and Gate state.</small>}</div>;
}
