"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { VerifyEvidenceButton } from "@/components/VerifyEvidenceButton";
import { VERIFIER_CLAIM_COPY } from "@/lib/prooflock-claims";
import { parseSourceTxHashParam } from "@/lib/prooflock-routes";
import { displayValue } from "@/lib/safe-display";
import { parseNonZeroBytes32 } from "@/lib/prooflock-validation";

export default function ProofDetailPage({ params }: { params: { proofId: string } }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const identityKey = useSearchParams().get("identityKey") ?? "";
  const rawSourceTxHash = useSearchParams().get("sourceTxHash");
  const sourceParam = parseSourceTxHashParam(rawSourceTxHash);
  const sourceTxHash = sourceParam.status === "VALID" ? sourceParam.value : undefined;
  const normalizedProofId = parseNonZeroBytes32(params.proofId);
  const normalizedIdentityKey = parseNonZeroBytes32(identityKey);
  const proofDisplay = displayValue(params.proofId, { maxGraphemes: 96 });
  const identityDisplay = displayValue(identityKey || "Missing", { maxGraphemes: 96 });
  const valid = normalizedProofId !== null && normalizedIdentityKey !== null && sourceParam.status !== "INVALID";
  useEffect(() => { headingRef.current?.focus(); }, [identityKey, params.proofId, rawSourceTxHash]);
  return <section className="workspace-section proof-detail"><div className="wrap"><Link href="/proof" className="text-link">← Verify another proof</Link>
    <header className="detail-header"><div><span className="eyebrow">Historical proof artifact</span><h1 ref={headingRef} tabIndex={-1}>Proof verification</h1></div></header>
    <dl className="proof-list proof-identifiers"><div><dt>Proof ID</dt><dd className="mono break"><bdi dir="ltr">{proofDisplay.display}</bdi></dd></div><div><dt>Identity key</dt><dd className="mono break"><bdi dir="ltr">{identityDisplay.display}</bdi></dd></div>
      {sourceParam.status !== "ABSENT" && <div><dt>Registry source transaction hint</dt><dd className="mono break">{sourceParam.status === "VALID"
        ? <bdi dir="ltr">{sourceTxHash}</bdi> : VERIFIER_CLAIM_COPY.detail.invalidSource}</dd></div>}</dl>
    {valid ? <VerifyEvidenceButton proofId={normalizedProofId} identityKey={normalizedIdentityKey} sourceTxHash={sourceTxHash} /> : <div className="empty-ledger state-bad"><h2>{VERIFIER_CLAIM_COPY.detail.invalidTitle}</h2><p>{VERIFIER_CLAIM_COPY.detail.invalidDetail}</p></div>}
  </div></section>;
}
