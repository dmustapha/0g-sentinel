"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { DataRow } from "@/components/ui/DataRow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { explorerTransactionUrl } from "@/lib/explorer-url";
import { canonicalAgentHref, canonicalProofHref } from "@/lib/prooflock-routes";
import { gateReasonMeta, leaseStatus } from "@/lib/prooflock-status";
import { safeDisplayText } from "@/lib/safe-display";
import { isCanonicalAgentId, isCanonicalUint64, isPositiveUint48, isPositiveUint64 } from "@/lib/prooflock-validation";
import type { LeaseStatus, ObservationStatus, ProofLockInventoryItem } from "@/lib/prooflock-types";

const CAPTION = "Recent finalized RegistryV2 activity — bounded scope shown above.";

export function AgentsTable({ items, referenceTimeSeconds }: {
  items: readonly ProofLockInventoryItem[]; referenceTimeSeconds?: number;
}) {
  const snapshotSeconds = referenceTimeSeconds ?? Math.floor(Date.now() / 1000);
  const entries = items.map((item) => ({ item, content: values(item, snapshotSeconds) }));
  return <div className="inventory-shell"><table className="inventory-table"><caption>{CAPTION}</caption>
    <thead><tr>{["Identity", "Coverage", "Seal / Registry source", "Lease", "Gate", "Checked", "Action"]
      .map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
    <tbody>{entries.map(({ item, content }) => <InventoryRow item={item} content={content}
      key={item.identityKey} />)}</tbody></table>
    <div className="inventory-cards" aria-label={CAPTION}>{entries.map(({ item, content }) =>
      <InventoryCard item={item} content={content} key={item.identityKey} />)}</div></div>;
}

function InventoryRow({ item, content }: { item: ProofLockInventoryItem; content: InventoryValues }) {
  return <tr className="inventory-row"><td>{content.identity}</td><td>{content.coverage}</td><td><SealSource content={content} transactionHash={item.transactionHash} /></td>
    <td><StatusCell status={content.leaseStatus} detail={content.lease} /></td>
    <td><StatusCell status={content.gateStatus} detail={content.gate} /></td>
    <td>{content.last}</td><td>{content.action ?? "Unavailable"}</td></tr>;
}

function InventoryCard({ item, content }: { item: ProofLockInventoryItem; content: InventoryValues }) {
  return <article className="inventory-card"><div className="card-row"><dl className="inventory-card-identity"><div><dt className="sr-only">Identity</dt><dd>{content.identity}</dd></div></dl>
    <StatusBadge status={content.leaseStatus} /></div><dl className="inventory-card-data">
      <DataRow label="Coverage" value={content.coverage} />
      <DataRow label="Seal" value={content.seal} copyable />
      <StatusRow label="Lease" status={content.leaseStatus} detail={content.lease} />
      <StatusRow label="Gate" status={content.gateStatus} detail={content.gate} />
      <DataRow label="Registry source transaction" value={item.transactionHash} copyable external
        href={sourceHref(item.transactionHash) ?? undefined} />
      <DataRow label="Last checked" value={content.last} />
      <div className="inventory-action-row"><dt>Action</dt><dd>{content.action ?? "Unavailable"}</dd></div>
    </dl></article>;
}

function SealSource({ content, transactionHash }: { content: InventoryValues; transactionHash: string }) {
  return <span className="inventory-seal-source"><small>Seal</small><span className="inventory-copy-value">
    <bdi dir="ltr" className="break">{content.seal}</bdi><CopyControl label="Seal" value={content.seal} /></span>
    <small>Registry source transaction</small><span className="inventory-copy-value">
      <SourceLink transactionHash={transactionHash} /><CopyControl label="Registry source transaction" value={transactionHash} />
    </span></span>;
}

function StatusCell({ detail, status }: { detail: string; status: ObservationStatus }) {
  return <span className="inventory-status"><StatusBadge status={status} /><small>{detail}</small></span>;
}

function StatusRow({ detail, label, status }: { detail: string; label: string; status: ObservationStatus }) {
  return <div className="inventory-status-row"><dt>{label}</dt><dd><StatusCell status={status} detail={detail} /></dd></div>;
}

function SourceLink({ transactionHash }: { transactionHash: string }) {
  const href = sourceHref(transactionHash);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
    <bdi dir="ltr" className="break">{transactionHash}</bdi></a> : <span>Unavailable</span>;
}

function CopyControl({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  useEffect(() => setState("idle"), [value]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setState("success"); }
    catch { setState("error"); }
  };
  const prefix = state === "success" ? "Copied" : state === "error" ? "Retry copy" : "Copy";
  return <button type="button" onClick={() => void copy()} aria-label={`${prefix} ${label}`}>{prefix}</button>;
}

function IdentityValue({ label, value }: { label: string; value: string }) {
  return <span className="inventory-copy-value mono">
    <bdi dir="ltr" className="break">{value}</bdi><CopyControl label={label} value={value} />
  </span>;
}

function values(item: ProofLockInventoryItem, referenceTimeSeconds: number): InventoryValues {
  if (item.status === "ENRICHMENT_UNAVAILABLE") return unavailableValues(item);
  if (!validInventoryNumerics(item)) return invalidRecordValues(item);
  const lease = leaseStatus(item.proofLock, referenceTimeSeconds); const gate = item.detail.gate;
  const gateMeta = gate.status === "VERIFIED" ? gateReasonMeta(gate.reason) : null;
  const gateConsistent = gate.status === "VERIFIED" && gateMeta?.allowed === gate.allowed;
  return { identity: identityValue(item), coverage: `0x${item.proofLock.coverage.toString(16).padStart(2, "0")} / 0x7f`,
    seal: `v${item.proofLock.version} · ${item.proofLock.envelopeDigest}`, lease,
    leaseStatus: leaseObservationStatus(lease), gate: gateConsistent ? gateMeta.code
      : gateMeta ? `GATE_TUPLE_MISMATCH · ${gateMeta.code} · allowed=${String(gate.allowed)}` : "UNKNOWN",
    gateStatus: !gateMeta ? "UNAVAILABLE" : !gateConsistent ? "MISMATCH" : gate.allowed ? "VERIFIED" : "BLOCKED",
    action: actionValue(item),
    last: `block ${item.blockNumber}` };
}

function identityValue(item: Extract<ProofLockInventoryItem, { status: "VERIFIED" }>): ReactNode {
  if (item.detail.status !== "VERIFIED") return <div><b>Identity unavailable</b>
    <IdentityValue label="Identity key" value={item.identityKey} /><small>{item.detail.code}</small></div>;
  const agentId = safeDisplayText(item.detail.identity.agentId, { maxGraphemes: 80 });
  return <div><b>Agent #</b><IdentityValue label="Agent ID" value={agentId} />
    <IdentityValue label="Agent wallet" value={item.detail.identity.agentWallet} /></div>;
}

function actionValue(item: Extract<ProofLockInventoryItem, { status: "VERIFIED" }>): ReactNode {
  if (item.detail.status === "VERIFIED") return <Link className="identity-link"
    href={canonicalAgentHref(item.detail.identity.agentId, item.transactionHash)}>Open proof record</Link>;
  const proofHref = historicalProofHref(item);
  return proofHref ? <Link className="identity-link" href={proofHref}>Verify stored proof</Link> : null;
}

function invalidRecordValues(item: Extract<ProofLockInventoryItem, { status: "VERIFIED" }>): InventoryValues {
  return { identity: <div><b>Record unavailable</b><IdentityValue label="Identity key" value={item.identityKey} />
    <small>Canonical numeric fields are invalid</small></div>, coverage: "Unavailable", seal: "Unavailable",
    lease: "UNKNOWN", leaseStatus: "UNAVAILABLE", gate: "UNKNOWN", gateStatus: "UNAVAILABLE", action: null,
    last: `block ${item.blockNumber}` };
}

function unavailableValues(item: Extract<ProofLockInventoryItem, { status: "ENRICHMENT_UNAVAILABLE" }>): InventoryValues {
  return { identity: <div><b>Enrichment unavailable</b><IdentityValue label="Identity key" value={item.identityKey} />
    <small>{item.code}</small></div>, coverage: "Unavailable", seal: `Registry tx ${short(item.transactionHash)}`,
    lease: "UNKNOWN", leaseStatus: "UNAVAILABLE", gate: "UNKNOWN", gateStatus: "UNAVAILABLE", action: null,
    last: `block ${item.blockNumber}` };
}

function validInventoryNumerics(item: Extract<ProofLockInventoryItem, { status: "VERIFIED" }>): boolean {
  const record = item.proofLock;
  if (!isPositiveUint64(record.version) || !isPositiveUint48(record.issuedAt)
    || !isPositiveUint48(record.validUntil)) return false;
  if (item.detail.status !== "VERIFIED") return true;
  return isCanonicalAgentId(item.detail.identity.agentId)
    && (item.detail.gate.status !== "VERIFIED" || isCanonicalUint64(item.detail.gate.version))
    && (item.detail.consumer.status !== "VERIFIED" || isCanonicalUint64(item.detail.consumer.version));
}

function leaseObservationStatus(status: LeaseStatus): ObservationStatus {
  if (status === "ACTIVE" || status === "EXPIRING") return "VERIFIED";
  if (status === "INCOMPLETE") return "UNAVAILABLE";
  return "BLOCKED";
}

function historicalProofHref(item: Extract<ProofLockInventoryItem, { status: "VERIFIED" }>): string | null {
  try { return canonicalProofHref(item.proofId, item.identityKey, item.transactionHash); }
  catch { return null; }
}

function sourceHref(transactionHash: string): string | null {
  return explorerTransactionUrl("https://chainscan.0g.ai", transactionHash);
}

type InventoryValues = Readonly<{ identity: ReactNode; coverage: string; seal: string; lease: string;
  leaseStatus: ObservationStatus; gate: string; gateStatus: ObservationStatus; last: string; action: ReactNode }>;

function short(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
