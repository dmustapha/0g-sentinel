import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataRow } from "@/components/ui/DataRow";
import type { HistoricalPlaneView } from "@/lib/proof-detail-state";
import type { ComputeVerificationCapability, ProofLockRecord } from "@/lib/prooflock-types";
import { configuredDisplayText, safeDisplayText } from "@/lib/safe-display";
import { explorerAddressUrl, explorerTransactionUrl } from "@/lib/explorer-url";

type LegacyCompute = Readonly<{ provider: string; model: string; verified: boolean }>;
type LegacyStorage = Readonly<Record<string, unknown>>;

export function EvidenceProofCard({ record, historical, compute, explorerBase = "https://chainscan.0g.ai", storage }: Readonly<{
  record: ProofLockRecord; historical?: HistoricalPlaneView; compute?: LegacyCompute;
  explorerBase?: string; storage?: LegacyStorage;
}>) {
  const proof = historical?.status === "MATCH" ? historical.proof : undefined;
  const computeObservation = historical?.observations.find((item) => item.subsystem === "compute");
  const storageObservation = historical?.observations.find((item) => item.subsystem === "storage");
  const capability = computeObservation?.status === "VERIFIED" && "capability" in computeObservation
    ? computeObservation.capability as ComputeVerificationCapability : undefined;
  const legacyMetadata = !historical ? compute : undefined;
  const computeVerified = Boolean(capability);
  const storageVerified = storageObservation?.status === "VERIFIED" || (!historical && storage?.retrievalVerified === true);
  const uploadTx = proof ? stringField(proof.storage.storageCommitment, "uploadTxHash") : stringField(storage, "uploadTxHash");
  const provider = capability?.provider ?? legacyMetadata?.provider;
  const model = capability?.model ?? legacyMetadata?.model;
  return <section className="evidence-card evidence-stack"><div className="card-row"><div><span className="card-kicker">Exact provenance</span><h3>Evidence commitments</h3></div>
    <StatusBadge status={computeVerified && storageVerified ? "VERIFIED" : "UNAVAILABLE"} surface="paper" /></div>
    <div className="evidence-segment"><b>{computeVerified ? "0G Compute capability" : "0G Compute unavailable"}</b>
      {provider && model ? <ComputeDetails provider={provider} model={model} capability={capability} />
        : <p>Compute transcript is unavailable. No fallback receipt is accepted.</p>}</div>
    <div className="evidence-segment"><b>{storageVerified ? "0G Storage evidence" : "0G Storage unavailable"}</b>
      <dl className="proof-list"><DataRow label="Root" value={record.storageRoot} copyable />
        <DataRow label="Upload transaction" value={uploadTx} copyable />
        <DataRow label="Retrieval" value={storageVerified ? "Retrieved bytes and root matched during historical verification" : "Not re-verified"} technical={false} />
        <DataRow label="Capability" value={`networkProofVerified: ${String(proof?.storage.networkProofVerified ?? storage?.networkProofVerified ?? false)}`} /></dl></div>
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
    <p className="trust-note"><code>networkProofVerified: false</code> means the current SDK path verifies exact retrieved bytes, digest, recomputed 0G root, and finalized Flow submission—not an SDK-supplied network Merkle proof.</p>
  </section>;
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
  return typeof candidate === "string" ? safeDisplayText(candidate, { maxGraphemes: 96 }) : undefined;
}
