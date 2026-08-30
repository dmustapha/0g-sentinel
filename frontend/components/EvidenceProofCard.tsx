import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataRow } from "@/components/ui/DataRow";
import type { HistoricalPlaneView } from "@/lib/proof-detail-state";
import type { ComputeVerificationCapability, HistoricalVerifiedStorageObservation, ProofLockRecord,
  ProofLockObservation } from "@/lib/prooflock-types";
import { configuredDisplayText, safeDisplayText } from "@/lib/safe-display";
import { explorerAddressUrl, explorerTransactionUrl } from "@/lib/explorer-url";
import { assertClaimAllowed, claimFor, formatComputeClaim, VERIFIER_CLAIM_COPY } from "@/lib/prooflock-claims";

type LegacyCompute = Readonly<{ provider: string; model: string; verified: boolean }>;
type LegacyStorage = Readonly<Record<string, unknown>>;

export function EvidenceProofCard({ record, historical, compute, explorerBase = "https://chainscan.0g.ai", storage }: Readonly<{
  record: ProofLockRecord; historical?: HistoricalPlaneView; compute?: LegacyCompute;
  explorerBase?: string; storage?: LegacyStorage;
}>) {
  const proof = historical?.status === "MATCH" ? historical.proof : undefined;
  const computeObservation = historical?.observations.find((item) => item.subsystem === "compute");
  const storageObservation = historical?.observations.find(isVerifiedStorageObservation);
  const capability = computeObservation?.status === "VERIFIED" && "capability" in computeObservation
    ? computeObservation.capability as ComputeVerificationCapability : undefined;
  const legacyMetadata = !historical ? compute : undefined;
  const computeVerified = Boolean(capability);
  const storageVerified = Boolean(storageObservation);
  const legacyStorageReported = !historical && storage?.retrievalVerified === true;
  const uploadTx = proof ? stringField(proof.storage.storageCommitment, "uploadTxHash") : stringField(storage, "uploadTxHash");
  const provider = capability?.provider ?? legacyMetadata?.provider;
  const model = capability?.model ?? legacyMetadata?.model;
  const computeClaim = capability ? assertClaimAllowed(formatComputeClaim(capability)) : null;
  const storageClaim = storageObservation
    ? assertClaimAllowed(claimFor("storage", storageObservation)) : null;
  const networkProofDisplay = storageObservation
    ? `networkProofVerified: ${String(storageObservation.capability.networkProofVerified)}`
    : legacyNetworkProofDisplay(storage);
  return <section className="evidence-card evidence-stack"><div className="card-row"><div><span className="card-kicker">Exact provenance</span><h3>Evidence commitments</h3></div>
    <StatusBadge status={computeVerified && storageVerified ? "VERIFIED" : "UNAVAILABLE"} surface="paper" /></div>
    <div className="evidence-segment"><b aria-label={computeVerified ? "Compute evidence" : "0G Compute unavailable"}>Compute evidence</b>
      {provider && model ? <ComputeDetails provider={provider} model={model} capability={capability} />
        : <p>{VERIFIER_CLAIM_COPY.evidence.unavailableValue}</p>}</div>
    {computeClaim ? <p><bdi>{safeDisplayText(computeClaim, { maxGraphemes: 512 })}</bdi></p> : null}
    <div className="evidence-segment"><b>Storage evidence</b>
      <dl className="proof-list"><DataRow label="Root" value={record.storageRoot} copyable />
        <DataRow label="Upload transaction" value={uploadTx}
          displayValue={uploadTx ? safeDisplayText(uploadTx, { maxGraphemes: 96 }) : undefined} copyable />
        <DataRow label="Retrieval" value={storageClaim
          ? safeDisplayText(storageClaim, { maxGraphemes: 512 })
          : legacyStorageReported ? "Unverified legacy metadata: reported root matched during historical verification"
            : VERIFIER_CLAIM_COPY.evidence.unavailableValue} technical={false} />
        <DataRow label="Capability" value={networkProofDisplay} technical={false} /></dl></div>
    <dl className="proof-list commitments"><DataRow label="Envelope digest" value={record.envelopeDigest} copyable />
      <DataRow label="Runtime commitment" value={record.runtimeCodeHash} copyable />
      <DataRow label="Artifact hash" value={proof?.proofLock.artifactHash ?? record.artifactHash} copyable /></dl>
    {proof ? <dl className="proof-list registry-provenance">
      <DataRow label="Registry source transaction" value={proof.source.transactionHash} copyable external
        href={explorerTransactionUrl(explorerBase, proof.source.transactionHash) ?? undefined} />
      <DataRow label="Source block" value={proof.source.blockNumber} />
      <DataRow label="Source block hash" value={proof.source.blockHash} copyable />
      <DataRow label="Log index" value={proof.source.logIndex} />
      <DataRow label="Registry" value={proof.source.registryAddress} copyable external
        href={explorerAddressUrl(explorerBase, proof.source.registryAddress) ?? undefined} /></dl> : null}
    {storageClaim ? <p className="trust-note"><bdi className="break">
      {safeDisplayText(storageClaim, { maxGraphemes: 512 })}</bdi></p> : null}
  </section>;
}

function isVerifiedStorageObservation(item: ProofLockObservation): item is HistoricalVerifiedStorageObservation {
  return item.scope === "HISTORICAL" && item.subsystem === "storage" && item.status === "VERIFIED";
}

function ComputeDetails({ capability, model, provider }: Readonly<{
  capability?: ComputeVerificationCapability; model: string; provider: string;
}>) {
  const providerValue = provider.trim() ? provider : undefined;
  const modelValue = model.trim() ? model : undefined;
  return <dl className="proof-list"><DataRow label="Provider" value={providerValue ?? "Provider not provided"}
    displayValue={configuredDisplayText(provider, "Provider not provided", { maxGraphemes: 96 })}
    technical={Boolean(providerValue)} copyable={Boolean(providerValue)} />
    <DataRow label="Model" value={modelValue ?? "Model not provided"}
      displayValue={configuredDisplayText(model, "Model not provided", { maxGraphemes: 120 })} technical={false} />
    <DataRow label="Verification" value={capability ? `${capability.method} · ${capability.proofClass}` : "Unverified legacy metadata"} technical={false} />
    {capability ? <><DataRow label="SDK" value={capability.sdkVersion} />
      <DataRow label="Process response" value={String(capability.processResponseVerified)} technical={false} />
      {Object.entries(capability.boundHashes).map(([label, value]) =>
        <DataRow key={label} label={`Bound ${label}`} value={value} copyable />)}</> : null}</dl>;
}

function stringField(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function legacyNetworkProofDisplay(storage: LegacyStorage | undefined): string {
  if (!storage || !("networkProofVerified" in storage)) return VERIFIER_CLAIM_COPY.evidence.unavailableValue;
  const reported = safeDisplayText(String(storage.networkProofVerified), { maxGraphemes: 32 });
  return `Unverified legacy metadata: reported networkProofVerified: ${reported}`;
}
