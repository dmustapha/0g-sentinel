"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VerifyEvidenceButton } from "@/components/VerifyEvidenceButton";

export default function ProofDetailPage({ params }: { params: { proofId: string } }) {
  const identityKey = useSearchParams().get("identityKey") ?? "";
  const valid = /^0x[0-9a-fA-F]{64}$/.test(params.proofId) && /^0x[0-9a-fA-F]{64}$/.test(identityKey);
  return <section className="workspace-section proof-detail"><div className="wrap"><Link href="/proof" className="text-link">← Verify another proof</Link>
    <header className="detail-header"><div><span className="eyebrow">Historical proof artifact</span><h1>Proof verification</h1></div></header>
    <dl className="proof-list proof-identifiers"><div><dt>Proof ID</dt><dd className="mono break">{params.proofId}</dd></div><div><dt>Identity key</dt><dd className="mono break">{identityKey || "Missing"}</dd></div></dl>
    {valid ? <VerifyEvidenceButton proofId={params.proofId} identityKey={identityKey} /> : <div className="empty-ledger state-bad"><h2>Invalid verification link</h2><p>Proof ID and identity key must both be exact bytes32 identifiers.</p></div>}
  </div></section>;
}
