import Link from "next/link";
import { canonicalAgentHref, canonicalProofHref } from "@/lib/prooflock-routes";
import { admittedConsumerState, gateReasonMeta, leaseStatus } from "@/lib/prooflock-status";
import type { ProofLockInventoryItem } from "@/lib/prooflock-types";

export function AgentsTable({ items }: { items: readonly ProofLockInventoryItem[] }) {
  return <div className="inventory-shell"><table className="inventory-table"><thead><tr><th>Identity</th><th>Coverage</th><th>Seal</th><th>Lease</th><th>Gate</th><th>Last checked</th></tr></thead>
    <tbody>{items.map((item) => <InventoryRow item={item} key={item.identityKey} />)}</tbody></table>
    <div className="inventory-cards">{items.map((item) => <InventoryCard item={item} key={item.identityKey} />)}</div></div>;
}

function InventoryRow({ item }: { item: ProofLockInventoryItem }) {
  const content = values(item);
  return <tr className={`inventory-row ${content.tone}`}><td>{content.identity}</td><td>{content.coverage}</td><td>{content.seal}</td>
    <td><span className="status-chip">{content.lease}</span></td><td>{content.gate}</td><td>{content.last}</td></tr>;
}

function InventoryCard({ item }: { item: ProofLockInventoryItem }) {
  const content = values(item);
  return <article className={`inventory-card ${content.tone}`}><div className="card-row"><div>{content.identity}</div><span className="status-chip">{content.lease}</span></div>
    <dl className="micro-grid"><div><dt>Coverage</dt><dd>{content.coverage}</dd></div><div><dt>Seal</dt><dd>{content.seal}</dd></div>
      <div><dt>Gate</dt><dd>{content.gate}</dd></div><div><dt>Last checked</dt><dd>{content.last}</dd></div></dl></article>;
}

function values(item: ProofLockInventoryItem) {
  if (item.status === "ENRICHMENT_UNAVAILABLE") return unavailableValues(item);
  const lease = leaseStatus(item.proofLock); const gate = item.detail.gate;
  const gateText = gate.status === "VERIFIED" ? gateReasonMeta(gate.reason) : null;
  const proofHref = historicalProofHref(item);
  const identity = item.detail.status === "VERIFIED"
    ? <Link className="identity-link" href={canonicalAgentHref(item.detail.identity.agentId, item.transactionHash)}><b>Agent #{item.detail.identity.agentId}</b><span className="mono">{short(item.detail.identity.agentWallet)}</span></Link>
    : proofHref ? <Link className="identity-link" href={proofHref}><b>Identity unavailable</b><span className="mono">{short(item.identityKey)}</span><small>{item.detail.code} · verify stored proof</small></Link>
      : <div><b>Identity unavailable</b><span className="mono">{short(item.identityKey)}</span><small>{item.detail.code}</small></div>;
  const admitted = lease === "ACTIVE" && item.detail.status === "VERIFIED" &&
    admittedConsumerState(item.proofLock, gate, item.detail.consumer, item.detail.identity.agentWallet);
  return { identity, coverage: <span className="mono">0x{item.proofLock.coverage.toString(16).padStart(2, "0")} / 0x7f</span>,
    seal: <span>v{item.proofLock.version} · {short(item.proofLock.envelopeDigest)}</span>, lease,
    gate: <span className={admitted ? "state-good" : "state-bad"}>{gateText ? gateText.code : "UNKNOWN"}</span>,
    last: <span className="mono">block {item.blockNumber}</span>, tone: admitted ? "state-good" : lease === "EXPIRING" || lease === "INCOMPLETE" ? "state-warn" : "state-bad" };
}
function unavailableValues(item: Extract<ProofLockInventoryItem, { status: "ENRICHMENT_UNAVAILABLE" }>) {
  return { identity: <div><b>Enrichment unavailable</b><span className="mono">{short(item.identityKey)}</span>
      <small>{item.code}</small></div>, coverage: <span>Unavailable</span>,
    seal: <span className="mono">Registry tx {short(item.transactionHash)}</span>, lease: "UNKNOWN",
    gate: <span className="state-unknown">UNKNOWN</span>, last: <span className="mono">block {item.blockNumber}</span>,
    tone: "state-unknown" };
}
function historicalProofHref(item: Extract<ProofLockInventoryItem, { status: "VERIFIED" }>): string | null {
  try { return canonicalProofHref(item.proofId, item.identityKey, item.transactionHash); }
  catch { return null; }
}
function short(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
