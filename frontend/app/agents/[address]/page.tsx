"use client";

import { AbiCoder, keccak256 } from "ethers";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdmissionLeaseCard } from "@/components/AdmissionLeaseCard";
import { DemoFixtureBadge } from "@/components/DemoFixtureBadge";
import { EvidenceProofCard } from "@/components/EvidenceProofCard";
import { GateDecisionCard } from "@/components/GateDecisionCard";
import { ProofCoverageGrid } from "@/components/ProofCoverageGrid";
import { SealLifecycle } from "@/components/SealLifecycle";
import { TrustRoleDisclosure } from "@/components/TrustRoleDisclosure";
import { HistoricalProofDetails, ProofLocatorNotice } from "@/components/VerifyEvidenceButton";
import { computeProofId, readProofLockDetail, resolveIdentity, verifyProof } from "@/lib/prooflock-client";
import { canonicalAgentHref, parseSourceTxHashParam, verifyLinkedHistoricalProof } from "@/lib/prooflock-routes";
import { admittedConsumerState } from "@/lib/prooflock-status";
import { safeDisplayText } from "@/lib/safe-display";
import { isCanonicalAgentId } from "@/lib/prooflock-validation";
import type { CanonicalIdentity, GateDecision, ProofLockDetailResponse, VerifiedProof } from "@/lib/prooflock-types";
import type { LinkedHistoricalProof } from "@/lib/prooflock-routes";

type ViewData = Readonly<{ identity: CanonicalIdentity; detail: ProofLockDetailResponse;
  proofId: `0x${string}`; linkedProof: LinkedHistoricalProof; consumerAllowed: boolean }>;
type ViewState =
  | Readonly<{ key: string; status: "LOADING" }>
  | Readonly<{ key: string; status: "READY"; data: ViewData }>
  | Readonly<{ key: string; status: "ERROR"; message: string }>;

export default function AgentDetailPage({ params }: { params: { address: string } }) {
  const agentId = params.address; const rawSourceTxHash = useSearchParams().get("sourceTxHash");
  const sourceParam = parseSourceTxHashParam(rawSourceTxHash);
  const sourceTxHash = sourceParam.status === "VALID" ? sourceParam.value : undefined;
  const sourceStatus = sourceParam.status;
  const locatorKey = JSON.stringify([agentId, sourceStatus, sourceTxHash ?? null]);
  const [state, setState] = useState<ViewState>({ key: locatorKey, status: "LOADING" });
  const generation = useRef(0);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!isCanonicalAgentId(agentId)) throw new Error("Canonical decimal Agent ID required");
    if (sourceStatus === "INVALID") throw new Error("Exact nonzero Registry source transaction required");
    const identity = await resolveIdentity(agentId, signal); const key = identityKey(identity);
    const detail = await readProofLockDetail(key, signal); const registry = process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS;
    if (!registry) throw new Error("RegistryV2 is not configured"); const proofId = computeProofId(registry, detail.proofLock);
    const linkedProof = await verifyLinkedHistoricalProof({ proofId, identityKey: key,
      sourceTxHash }, signal, verifyProof);
    const consumerAllowed = admittedConsumerState(detail.proofLock, detail.detail.gate, detail.detail.consumer, identity.agentWallet);
    return { identity, detail, proofId, linkedProof, consumerAllowed };
  }, [agentId, sourceStatus, sourceTxHash]);
  useEffect(() => {
    const currentGeneration = ++generation.current; const controller = new AbortController();
    setState({ key: locatorKey, status: "LOADING" });
    void load(controller.signal).then((data) => {
      if (!controller.signal.aborted && generation.current === currentGeneration) {
        setState({ key: locatorKey, status: "READY", data });
      }
    }).catch((cause) => {
      if (!controller.signal.aborted && generation.current === currentGeneration) setState({ key: locatorKey,
        status: "ERROR", message: safeDisplayText(cause instanceof Error
          ? cause.message : "ProofLock detail is unavailable", { maxGraphemes: 256 }) });
    });
    return () => controller.abort();
  }, [load, locatorKey]);
  const visible = state.key === locatorKey ? state : { key: locatorKey, status: "LOADING" as const };
  if (visible.status === "ERROR") return <section className="workspace-section"><div className="wrap empty-ledger state-bad"><h1>ProofLock unavailable</h1><p><bdi>{visible.message}</bdi></p><Link href="/agents" className="text-link">← ProofLocks</Link></div></section>;
  if (visible.status === "LOADING") return <section className="workspace-section"><div className="wrap loading-ledger"><i /><i /><i /><span>Resolving identity, lease, evidence, and Gate…</span></div></section>;
  return <Detail data={visible.data} />;
}

function Detail({ data }: { data: ViewData }) {
  const { identity, detail, proofId, linkedProof } = data; const record = detail.proofLock;
  const proof = linkedProof.status === "MATCH" ? linkedProof.proof : undefined;
  const gate: GateDecision | null = detail.detail.gate.status === "VERIFIED" ? { allowed: detail.detail.gate.allowed,
    reason: detail.detail.gate.reason, subject: detail.detail.gate.subject, version: detail.detail.gate.version } : null;
  const envelope = proof?.storage.envelope; const previous = typeof envelope?.previousProofId === "string" ? envelope.previousProofId : undefined;
  const compute = computeSummary(envelope); const storage = storageSummary(proof);
  return <section className="workspace-section detail-page"><div className="wrap"><Link href="/agents" className="text-link">← ProofLocks</Link>
    <header className="detail-header"><div><span className="eyebrow">Canonical ERC-8004 identity</span><h1 aria-label={`Agent #${identity.identity.agentId}`}>Agent #<bdi dir="ltr">{identity.identity.agentId}</bdi></h1><p className="mono break"><bdi dir="ltr">{identity.agentWallet}</bdi></p></div>
      {process.env.NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID === identity.identity.agentId && <DemoFixtureBadge />}</header>
    {detail.detail.status === "UNAVAILABLE" && <div className="inline-state state-warn"><b>{detail.detail.code}</b> · Stored evidence could not enrich this identity. Gate remains UNKNOWN and blocked.</div>}
    <ProofLocatorNotice status={linkedProof.status} currentHref={canonicalAgentHref(identity.identity.agentId)} />
    <div className="decision-grid"><GateDecisionCard decision={gate} /><AdmissionLeaseCard record={record} /></div>
    <div className={data.consumerAllowed ? "consumer-call state-good" : "consumer-call state-bad"}><span className="card-kicker">Guarded ProofLockConsumerDemo simulation</span>
      <b>{data.consumerAllowed ? "CONSUMER ACTION ACCEPTED" : "CONSUMER ACTION BLOCKED"}</b><p>Accepted only when the server-guarded consumer simulation, Gate subject, Gate version, current lease, and ERC-8004 wallet all match.</p></div>
    <ProofCoverageGrid coverage={record.coverage} /><EvidenceProofCard record={record} compute={compute} storage={storage} />
    {proof && <HistoricalProofDetails proof={proof} explorerBase={process.env.NEXT_PUBLIC_ZERO_G_EXPLORER ?? "https://chainscan.0g.ai"} />}
    <SealLifecycle currentVersion={record.version} previousProofId={previous} identityKey={record.identityKey} />
    <aside className="operator-panel lifecycle-controls"><div><span className="card-kicker">Authorized mutation</span>
      <h3>Drift · reseal · recovery</h3><p>Operator credentials and paid actions are isolated from this public proof record.</p></div>
      <Link className="button primary" href={`/operator?agentId=${identity.identity.agentId}`}>Open operator workbench</Link></aside>
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
