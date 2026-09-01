"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { VerifyEvidenceButton } from "@/components/VerifyEvidenceButton";
import { DataRow } from "@/components/ui/DataRow";
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
  const valid = normalizedProofId !== null && normalizedIdentityKey !== null && sourceParam.status !== "INVALID";
  useEffect(() => { headingRef.current?.focus(); }, [identityKey, params.proofId, rawSourceTxHash]);
  return <section className="workspace-section proof-detail"><div className="wrap"><Link href="/proof" className="text-link">← Verify another proof</Link>
    <header className="detail-header"><div><span className="eyebrow">Historical proof artifact</span><h1 ref={headingRef} tabIndex={-1}>Proof verification</h1></div></header>
    <p className="verify-help">What this page tells you: it re-checks one sealed proof against the exact bytes stored
      on chain and reports whether it still matches, plus whether the agent has live access now. Press verify below
      to run the check. The identifiers used for the check are listed first.</p>
    <ProofIdentifierList proofId={params.proofId} identityKey={identityKey} sourceTxHash={rawSourceTxHash} />
    {valid ? <VerifyEvidenceButton proofId={normalizedProofId} identityKey={normalizedIdentityKey} sourceTxHash={sourceTxHash} /> : <div className="empty-ledger state-bad"><h2>{VERIFIER_CLAIM_COPY.detail.invalidTitle}</h2><p>{VERIFIER_CLAIM_COPY.detail.invalidDetail}</p></div>}
  </div></section>;
}

function ProofIdentifierList({ proofId, identityKey, sourceTxHash }: Readonly<{
  proofId: string; identityKey: string; sourceTxHash: string | null;
}>) {
  const proof = displayValue(proofId, { maxGraphemes: 96 });
  const identity = displayValue(identityKey || "Missing", { maxGraphemes: 96 });
  const normalizedProof = parseNonZeroBytes32(proofId);
  const normalizedIdentity = parseNonZeroBytes32(identityKey);
  const sourceParam = parseSourceTxHashParam(sourceTxHash);
  return <dl className="proof-list proof-identifiers ui-proof-plane--current"><DataRow label="Proof ID" value={proof.canonical}
    displayValue={proof.display} copyable={normalizedProof !== null} />
    <DataRow label="Identity key" value={identity.canonical}
      displayValue={identity.display} copyable={normalizedIdentity !== null} />
    {sourceParam.status !== "ABSENT" && <DataRow label="Registry source transaction hint"
      value={sourceParam.status === "VALID" ? sourceParam.value : VERIFIER_CLAIM_COPY.detail.invalidSource}
      technical={sourceParam.status === "VALID"} copyable={sourceParam.status === "VALID"} />}</dl>;
}
