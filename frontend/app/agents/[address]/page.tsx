"use client";

import { AbiCoder, keccak256 } from "ethers";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AdmissionLeaseCard } from "@/components/AdmissionLeaseCard";
import { DemoFixtureBadge } from "@/components/DemoFixtureBadge";
import { EvidenceProofCard } from "@/components/EvidenceProofCard";
import { GateDecisionCard } from "@/components/GateDecisionCard";
import { ProofCoverageGrid } from "@/components/ProofCoverageGrid";
import { SealLifecycle } from "@/components/SealLifecycle";
import { TrustRoleDisclosure } from "@/components/TrustRoleDisclosure";
import { ProofLocatorNotice } from "@/components/VerifyEvidenceButton";
import { Button } from "@/components/ui/Button";
import { DataRow } from "@/components/ui/DataRow";
import { ProofPlane } from "@/components/ui/ProofPlane";
import { computeProofId, readProofLockDetail, resolveIdentity, verifyProof } from "@/lib/prooflock-client";
import { currentRefreshDelay, initialProofDetailState, mapCurrentPlane, mapHistoricalPlane,
  proofDetailReducer, safeSealedObservedAt, type ProofDetailState } from "@/lib/proof-detail-state";
import { canonicalAgentHref, canonicalProofHref, parseSourceTxHashParam,
  verifyLinkedHistoricalProof } from "@/lib/prooflock-routes";
import { safeDisplayText } from "@/lib/safe-display";
import { observationStatusAt } from "@/lib/prooflock-observations";
import { isCanonicalAgentId } from "@/lib/prooflock-validation";
import type { CanonicalIdentity, ProofLockDetailResponse } from "@/lib/prooflock-types";

type ActiveLocator = Readonly<{ agentId: string; identityKey: string; generation: number }>;
const LEDGER_GRID_STYLE = Object.freeze({
  display: "grid", gap: "40px", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 410px), 1fr))",
});

export default function AgentDetailPage({ params }: { params: { address: string } }) {
  const agentId = params.address;
  const rawSourceTxHash = useSearchParams().get("sourceTxHash");
  const sourceParam = parseSourceTxHashParam(rawSourceTxHash);
  const sourceTxHash = sourceParam.status === "VALID" ? sourceParam.value : undefined;
  const locatorKey = JSON.stringify([agentId, sourceParam.status, sourceTxHash ?? null]);
  const [state, dispatch] = useReducer(proofDetailReducer, initialProofDetailState(locatorKey, 0));
  const [identity, setIdentity] = useState<CanonicalIdentity | null>(null);
  const generation = useRef(0);
  const active = useRef<ActiveLocator | null>(null);
  const currentController = useRef<AbortController | null>(null);
  const refreshGeneration = useRef(0);

  const refreshCurrent = useCallback(async () => {
    const locator = active.current;
    if (!locator) return;
    currentController.current?.abort();
    const controller = new AbortController(); currentController.current = controller;
    const requestGeneration = ++refreshGeneration.current;
    dispatch({ type: "CLOCK_TICK", nowMs: Date.now() });
    dispatch({ type: "CURRENT_STARTED", key: locatorKey, generation: locator.generation });
    try {
      const { identityKey: key } = locator;
      const detail = await readProofLockDetail(key, controller.signal, agentId);
      if (controller.signal.aborted || requestGeneration !== refreshGeneration.current) return;
      if (!detail.currentAccess) throw new Error("Pinned current access is unavailable");
      const nowMs = Date.now();
      dispatch({ type: "CURRENT_SUCCEEDED", key: locatorKey, generation: locator.generation,
        current: mapCurrentPlane(detail.currentAccess, nowMs), nowMs });
    } catch (cause) {
      if (!controller.signal.aborted && requestGeneration === refreshGeneration.current) dispatch({ type: "CURRENT_FAILED", key: locatorKey,
        generation: locator.generation, message: errorMessage(cause) });
    }
  }, [agentId, locatorKey]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    const controller = new AbortController();
    active.current = null; currentController.current?.abort(); refreshGeneration.current++; setIdentity(null);
    dispatch({ type: "START", key: locatorKey, generation: currentGeneration, nowMs: Date.now() });
    void loadInitial(agentId, sourceParam.status, sourceTxHash, controller.signal, (resolved, detail, key) => {
      if (controller.signal.aborted || generation.current !== currentGeneration) return;
      setIdentity(resolved); active.current = { agentId, identityKey: key, generation: currentGeneration };
      dispatch({ type: "BASE_READY", key: locatorKey, generation: currentGeneration, base: detail });
      try {
        if (!detail.currentAccess) throw new Error("Pinned current access is unavailable");
        const nowMs = Date.now();
        dispatch({ type: "CURRENT_SUCCEEDED", key: locatorKey, generation: currentGeneration,
          current: mapCurrentPlane(detail.currentAccess, nowMs), nowMs });
      } catch (cause) {
        dispatch({ type: "CURRENT_FAILED", key: locatorKey, generation: currentGeneration,
          message: errorMessage(cause) });
      }
    }).then((historical) => {
      if (!controller.signal.aborted && generation.current === currentGeneration) dispatch({
        type: "HISTORICAL_SETTLED", key: locatorKey, generation: currentGeneration,
        historical: mapHistoricalPlane(historical.result, historical.observedAt),
      });
    }).catch((cause) => {
      if (!controller.signal.aborted && generation.current === currentGeneration) dispatch({
        type: "ROUTE_FAILED", key: locatorKey, generation: currentGeneration, message: errorMessage(cause),
      });
    });
    return () => { controller.abort(); currentController.current?.abort(); active.current = null; };
  }, [agentId, locatorKey, sourceParam.status, sourceTxHash]);

  useEffect(() => {
    const snapshot = state.current.snapshot;
    if (!snapshot || state.current.refresh !== "IDLE") return;
    const delay = currentRefreshDelay(snapshot.access, state.nowMs);
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "CLOCK_TICK", nowMs: Date.now() }); void refreshCurrent();
    }, delay);
    return () => clearTimeout(timer);
  }, [refreshCurrent, state.current.refresh, state.current.snapshot, state.nowMs]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      dispatch({ type: "CLOCK_TICK", nowMs: Date.now() }); void refreshCurrent();
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [refreshCurrent]);

  const visible = state.key === locatorKey ? state : initialProofDetailState(locatorKey, Date.now());
  if (visible.route.status === "ERROR") return <ErrorView message={visible.route.message} />;
  if (visible.route.status === "LOADING" || !identity) return <LoadingView />;
  return <Detail identity={identity} sourceTxHash={sourceTxHash} state={visible} refreshCurrent={refreshCurrent} />;
}

async function loadInitial(agentId: string, sourceStatus: ReturnType<typeof parseSourceTxHashParam>["status"],
  sourceTxHash: string | undefined, signal: AbortSignal,
  onBase: (identity: CanonicalIdentity, detail: ProofLockDetailResponse, key: string) => void) {
  if (!isCanonicalAgentId(agentId)) throw new Error("Canonical decimal Agent ID required");
  if (sourceStatus === "INVALID") throw new Error("Exact nonzero Registry source transaction required");
  const identity = await resolveIdentity(agentId, signal); const key = identityKey(identity);
  const detail = await readCompatibleDetail(key, signal, agentId);
  const registry = process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS;
  if (!registry) throw new Error("RegistryV2 is not configured");
  const proofId = computeProofId(registry, detail.proofLock); onBase(identity, detail, key);
  const result = await verifyLinkedHistoricalProof({ proofId, identityKey: key, sourceTxHash }, signal, verifyProof);
  return { result, observedAt: safeSealedObservedAt(detail.proofLock.issuedAt) };
}

async function readCompatibleDetail(key: string, signal: AbortSignal, agentId: string) {
  try { return await readProofLockDetail(key, signal, agentId); }
  catch (cause) {
    if (signal.aborted) throw cause;
    return readProofLockDetail(key, signal);
  }
}

function Detail({ identity, refreshCurrent, sourceTxHash, state }: Readonly<{
  identity: CanonicalIdentity; refreshCurrent: () => Promise<void>; sourceTxHash?: string; state: ProofDetailState;
}>) {
  if (state.route.status !== "READY") return null;
  const record = state.route.base.proofLock;
  const historical = state.historical.status === "LOADING" ? null : state.historical;
  const linkedProof = historical;
  const current = state.current.snapshot;
  const currentRecord = current?.access.observations.lease.value ?? null;
  const currentLease = current?.access.observations.lease;
  const currentLeaseStatus = currentLease ? observationStatusAt(currentLease.observation, state.nowMs) : "UNAVAILABLE";
  const currentLeaseReason = currentLeaseStatus === "STALE" ? "OBSERVATION_EXPIRED" : currentLease?.reason;
  const pinnedNowSeconds = current ? Number(current.access.observationBlock.timestamp) : undefined;
  const registry = process.env.NEXT_PUBLIC_PROOFLOCK_REGISTRY_V2_ADDRESS;
  const proofId = registry ? computeProofId(registry, record) : null;
  const isFixture = process.env.NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID === identity.identity.agentId;
  const sameHistoricalVersion = historical?.status === "MATCH"
    && (!currentRecord || currentRecord.version === record.version);
  const previous = sameHistoricalVersion && typeof historical.proof.storage.envelope.previousProofId === "string"
    ? historical.proof.storage.envelope.previousProofId : undefined;
  const verifiedSourceTxHash = historical?.status === "MATCH"
    ? historical.proof.source.transactionHash : sourceTxHash;
  return <section className="workspace-section detail-page"><div className="wrap"><Link href="/agents" className="text-link">← ProofLocks</Link>
    <header className="detail-header"><div><span className="eyebrow">Canonical ERC-8004 identity</span><h1 aria-label={`Agent #${identity.identity.agentId}`}>Agent #<bdi dir="ltr">{identity.identity.agentId}</bdi></h1><p className="mono break"><bdi dir="ltr">{identity.agentWallet}</bdi></p></div>
      {process.env.NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID === identity.identity.agentId && <DemoFixtureBadge />}</header>
    <section aria-labelledby="current-decision"><div className="card-row"><div><span className="eyebrow">Current decision</span><h2 id="current-decision">Current decision</h2></div></div>
      {current ? <GateDecisionCard current={current.decision} /> : <p role="status">Pinned current decision unavailable. Access is not admitted.</p>}
      {state.current.refresh === "FAILED" && <p role="status">Refresh unavailable: <bdi>{state.current.error}</bdi>. The last pinned snapshot remains visible.</p>}
    </section>
    {proofId && <p><Link className="text-link" href={canonicalProofHref(proofId, record.identityKey, verifiedSourceTxHash)}>Verify this historical artifact</Link></p>}
    {linkedProof && <ProofLocatorNotice status={linkedProof.status} currentHref={canonicalAgentHref(identity.identity.agentId)} />}
    <div className="decision-grid" style={LEDGER_GRID_STYLE}>
      {historical?.observations.length ? <div data-demo-fixture={isFixture || undefined}>{isFixture && <DemoFixtureBadge />}<ProofPlane scope="HISTORICAL" observations={historical.observations} /></div>
        : historical ? <section data-plane="historical"><h2>Sealed evidence</h2><p><b>Historical artifact {historical.status}</b> · Observation time unavailable.</p></section>
        : <section data-plane="historical"><h2>Sealed evidence</h2><p>Historical verification is in progress.</p></section>}
      {current ? <div data-demo-fixture={isFixture || undefined}>{isFixture && <DemoFixtureBadge />}<ProofPlane scope="CURRENT" observations={current.observations} nowMs={state.nowMs} /></div>
        : <section data-plane="current"><h2>Current access</h2><p>Pinned current observations are unavailable.</p></section>}
    </div>
    <section aria-labelledby="supporting-current"><h2 id="supporting-current">Supporting current state</h2>
      <div className="decision-grid" style={LEDGER_GRID_STYLE}><AdmissionLeaseCard record={currentRecord}
        nowSeconds={pinnedNowSeconds} reason={currentLeaseReason} status={currentLeaseStatus} />
        <ProofCoverageGrid coverage={currentRecord?.coverage} /></div></section>
    <section aria-labelledby="historical-details"><h2 id="historical-details">Historical evidence details</h2>
      {historical?.status === "MATCH" ? <EvidenceProofCard record={record} historical={historical}
        explorerBase={process.env.NEXT_PUBLIC_ZERO_G_EXPLORER ?? "https://chainscan.0g.ai"} />
        : <p>The historical evidence dossier is unavailable unless the exact linked artifact matches.</p>}</section>
    <section aria-labelledby="identifiers-lifecycle"><h2 id="identifiers-lifecycle">Identifiers and lifecycle</h2>
      <dl className="proof-list proof-identifiers"><DataRow label="Identity key" value={record.identityKey} copyable />
        <DataRow label="Envelope digest" value={record.envelopeDigest} copyable /></dl>
      <Button pending={state.current.refresh === "REFRESHING"} pendingLabel="Refreshing current state"
        onClick={() => void refreshCurrent()}>Refresh current state</Button>
      <SealLifecycle currentVerified={Boolean(currentRecord)} currentVersion={(currentRecord ?? record).version}
        previousProofId={previous} identityKey={record.identityKey} />
      {!currentRecord && <AdmissionLeaseCard basis="registry" record={record} />}</section>
    <p><Link className="text-link" href={`/operator?agentId=${identity.identity.agentId}`}>Open operator workbench</Link> for authorized drift, reseal, and recovery actions.</p>
    <TrustRoleDisclosure admin={process.env.NEXT_PUBLIC_PROOFLOCK_ADMIN_ADDRESS} guardian={process.env.NEXT_PUBLIC_PROOFLOCK_GUARDIAN_ADDRESS}
      validator={process.env.NEXT_PUBLIC_PROOFLOCK_SCANNER_ADDRESS} custodyConstraint={process.env.NEXT_PUBLIC_PROOFLOCK_CUSTODY_CONSTRAINT} />
    <aside className="legacy-banner"><b>LEGACY V1 · excluded</b><span>Historical AttestationRegistry records never appear as an active ProofLock V2 lease.</span></aside>
  </div></section>;
}

function LoadingView() { return <section className="workspace-section"><div className="wrap loading-ledger"><h1>ProofLock detail</h1><i /><i /><i /><span>Resolving identity, lease, evidence, and Gate with pinned current access…</span></div></section>; }
function ErrorView({ message }: { message: string }) { return <section className="workspace-section"><div className="wrap empty-ledger"><h1>ProofLock unavailable</h1><p><bdi>{message}</bdi></p><Link href="/agents" className="text-link">← ProofLocks</Link></div></section>; }
function errorMessage(cause: unknown): string { return safeDisplayText(cause instanceof Error ? cause.message : "ProofLock detail is unavailable", { maxGraphemes: 256 }); }
function identityKey(identity: CanonicalIdentity): string { return keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"], [16661, identity.identity.registryAddress, BigInt(identity.identity.agentId)])); }
