"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VerifyEvidenceButton } from "@/components/VerifyEvidenceButton";

export default function ProofDetailPage({ params }: { params: { proofId: string } }) {
  const identityKey = useSearchParams().get("identityKey") ?? "";
  const sourceTxHash = useSearchParams().get("sourceTxHash") ?? undefined; const bytes32 = /^0x[0-9a-fA-F]{64}$/;
  const valid = bytes32.test(params.proofId) && bytes32.test(identityKey) && (!sourceTxHash || bytes32.test(sourceTxHash));
  return <section className="workspace-section proof-detail"><div className="wrap"><Link href="/proof" className="text-link">← Verify another proof</Link>
    <header className="detail-header"><div><span className="eyebrow">Historical proof artifact</span><h1>Proof verification</h1></div></header>
    <dl className="proof-list proof-identifiers"><div><dt>Proof ID</dt><dd className="mono break">{params.proofId}</dd></div><div><dt>Identity key</dt><dd className="mono break">{identityKey || "Missing"}</dd></div></dl>
    {valid ? <VerifyEvidenceButton proofId={params.proofId} identityKey={identityKey} sourceTxHash={sourceTxHash} /> : <div className="empty-ledger state-bad"><h2>Invalid verification link</h2><p>Proof ID, identity key, and optional source transaction must be exact bytes32 identifiers.</p></div>}
  </div></section>;
}
