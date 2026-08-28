"use client";

import { AbiCoder, keccak256 } from "ethers";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdmissionLeaseCard } from "@/components/AdmissionLeaseCard";
import { DemoFixtureBadge } from "@/components/DemoFixtureBadge";
import { EvidenceProofCard } from "@/components/EvidenceProofCard";
import { GateDecisionCard } from "@/components/GateDecisionCard";
import { ProofCoverageGrid } from "@/components/ProofCoverageGrid";
import { RescanButton } from "@/components/RescanButton";
import { SealLifecycle } from "@/components/SealLifecycle";
import { TrustRoleDisclosure } from "@/components/TrustRoleDisclosure";
import { computeProofId, readProofLockDetail, resolveIdentity, verifyProof } from "@/lib/prooflock-client";
import { admittedConsumerState } from "@/lib/prooflock-status";
import type { CanonicalIdentity, GateDecision, ProofLockDetailResponse, VerifiedProof } from "@/lib/prooflock-types";

type ViewData = Readonly<{ identity: CanonicalIdentity; detail: ProofLockDetailResponse; proofId: `0x${string}`; proof?: VerifiedProof; consumerAllowed?: boolean }>;

export default function AgentDetailPage({ params }: { params: { address: string } }) {
  const agentId = params.address; const [data, setData] = useState<ViewData>(); const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!/^(0|[1-9]\d*)$/.test(agentId)) throw new Error("Canonical decimal Agent ID required");
    const identity = await resolveIdentity(agentId, signal); const key = identityKey(identity);
    const detail = await readProofLockDetail(key, signal); const registry = process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS;
    if (!registry) throw new Error("RegistryV2 is not configured"); const proofId = computeProofId(registry, detail.proofLock);
    const proof = await verifyProof(proofId, key, signal).catch(() => undefined);
    const consumerAllowed = admittedConsumerState(detail.proofLock, detail.detail.gate, detail.detail.consumer, identity.agentWallet);
    setData({ identity, detail, proofId, proof, consumerAllowed });
  }, [agentId]);
  useEffect(() => { const controller = new AbortController(); setError(""); void load(controller.signal).catch((cause) => {
    if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "ProofLock detail is unavailable");
  }); return () => controller.abort(); }, [load, revision]);
  if (error) return <section className="workspace-section"><div className="wrap empty-ledger state-bad"><h1>ProofLock unavailable</h1><p>{error}</p><Link href="/agents" className="text-link">← ProofLocks</Link></div></section>;
  if (!data) return <section className="workspace-section"><div className="wrap loading-ledger"><i /><i /><i /><span>Resolving identity, lease, evidence, and Gate…</span></div></section>;
  return <Detail data={data} onComplete={() => setRevision((value) => value + 1)} />;
}

function Detail({ data, onComplete }: { data: ViewData; onComplete(): void }) {
  const { identity, detail, proofId, proof } = data; const record = detail.proofLock;
  const gate: GateDecision | null = detail.detail.gate.status === "VERIFIED" ? { allowed: detail.detail.gate.allowed,
    reason: detail.detail.gate.reason, subject: detail.detail.gate.subject, version: detail.detail.gate.version } : null;
  const envelope = proof?.storage.envelope; const previous = typeof envelope?.previousProofId === "string" ? envelope.previousProofId : undefined;
  const compute = computeSummary(envelope); const storage = storageSummary(proof);
  return <section className="workspace-section detail-page"><div className="wrap"><Link href="/agents" className="text-link">← ProofLocks</Link>
    <header className="detail-header"><div><span className="eyebrow">Canonical ERC-8004 identity</span><h1>Agent #{identity.identity.agentId}</h1><p className="mono break">{identity.agentWallet}</p></div>
      {process.env.NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID === identity.identity.agentId && <DemoFixtureBadge />}</header>
    {detail.detail.status === "UNAVAILABLE" && <div className="inline-state state-warn"><b>{detail.detail.code}</b> · Stored evidence could not enrich this identity. Gate remains UNKNOWN and blocked.</div>}
    <div className="decision-grid"><GateDecisionCard decision={gate} /><AdmissionLeaseCard record={record} /></div>
    <div className={data.consumerAllowed ? "consumer-call state-good" : "consumer-call state-bad"}><span className="card-kicker">Guarded ProofLockConsumerDemo simulation</span>
      <b>{data.consumerAllowed ? "CONSUMER ACTION ACCEPTED" : "CONSUMER ACTION BLOCKED"}</b><p>Accepted only when the server-guarded consumer simulation, Gate subject, Gate version, current lease, and ERC-8004 wallet all match.</p></div>
    <ProofCoverageGrid coverage={record.coverage} /><EvidenceProofCard record={record} compute={compute} storage={storage} />
    <SealLifecycle currentVersion={record.version} previousProofId={previous} identityKey={record.identityKey} />
    <RescanButton identity={identity} record={record} previousProofId={proofId} onComplete={onComplete} />
    <TrustRoleDisclosure admin={process.env.NEXT_PUBLIC_PROOFLOCK_ADMIN_ADDRESS} guardian={process.env.NEXT_PUBLIC_PROOFLOCK_GUARDIAN_ADDRESS}
      validator={process.env.NEXT_PUBLIC_PROOFLOCK_SCANNER_ADDRESS} custodyConstraint={process.env.NEXT_PUBLIC_PROOFLOCK_CUSTODY_CONSTRAINT} />
    <aside className="legacy-banner"><b>LEGACY V1 · excluded</b><span>Historical AttestationRegistry records never appear as an active ProofLock V2 lease.</span></aside>
  </div></section>;
}

function identityKey(identity: CanonicalIdentity): string { return keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"], [16661, identity.identity.registryAddress, BigInt(identity.identity.agentId)])); }
function computeSummary(envelope?: Readonly<Record<string, unknown>>) {
  const proofs = envelope?.computeProofs; if (!Array.isArray(proofs) || !proofs[0] || typeof proofs[0] !== "object") return undefined;
  const first = proofs[0] as Record<string, unknown>; if (typeof first.provider !== "string" || typeof first.model !== "string") return undefined;
  return { provider: first.provider, model: first.model, verified: first.processResponseVerified === true };
}
function storageSummary(proof?: VerifiedProof) {
  if (!proof) return undefined; const commitment = proof.storage.storageCommitment;
  return { uploadTxHash: typeof commitment?.uploadTxHash === "string" ? commitment.uploadTxHash : undefined,
    retrievedAt: new Date().toISOString(), retrievalVerified: proof.storage.retrievalVerified,
    networkProofVerified: proof.storage.networkProofVerified } as const;
}
