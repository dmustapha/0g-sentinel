"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VerifyEvidenceButton } from "@/components/VerifyEvidenceButton";
import { parseSourceTxHashParam } from "@/lib/prooflock-routes";
import { displayValue } from "@/lib/safe-display";
import { parseNonZeroBytes32 } from "@/lib/prooflock-validation";

export default function ProofDetailPage({ params }: { params: { proofId: string } }) {
  const identityKey = useSearchParams().get("identityKey") ?? "";
  const rawSourceTxHash = useSearchParams().get("sourceTxHash");
  const sourceParam = parseSourceTxHashParam(rawSourceTxHash);
  const sourceTxHash = sourceParam.status === "VALID" ? sourceParam.value : undefined;
  const normalizedProofId = parseNonZeroBytes32(params.proofId);
  const normalizedIdentityKey = parseNonZeroBytes32(identityKey);
  const proofDisplay = displayValue(params.proofId, { maxGraphemes: 96 });
  const identityDisplay = displayValue(identityKey || "Missing", { maxGraphemes: 96 });
  const valid = normalizedProofId !== null && normalizedIdentityKey !== null && sourceParam.status !== "INVALID";
  return <section className="workspace-section proof-detail"><div className="wrap"><Link href="/proof" className="text-link">← Verify another proof</Link>
    <header className="detail-header"><div><span className="eyebrow">Historical proof artifact</span><h1>Proof verification</h1></div></header>
    <dl className="proof-list proof-identifiers"><div><dt>Proof ID</dt><dd className="mono break"><bdi dir="ltr">{proofDisplay.display}</bdi></dd></div><div><dt>Identity key</dt><dd className="mono break"><bdi dir="ltr">{identityDisplay.display}</bdi></dd></div>
      {sourceParam.status !== "ABSENT" && <div><dt>Registry source transaction hint</dt><dd className="mono break">{sourceParam.status === "VALID"
        ? <bdi dir="ltr">{sourceTxHash}</bdi> : "Invalid value"}</dd></div>}</dl>
    {valid ? <VerifyEvidenceButton proofId={normalizedProofId} identityKey={normalizedIdentityKey} sourceTxHash={sourceTxHash} /> : <div className="empty-ledger state-bad"><h2>Invalid verification link</h2><p>Proof ID, identity key, and optional source transaction must be exact nonzero bytes32 identifiers.</p></div>}
  </div></section>;
}
