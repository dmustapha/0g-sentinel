// File: frontend/app/agents/[address]/page.tsx
import { getAttestationRegistry } from "@/lib/contracts";
import { AttestationData, THREAT_LABELS, CODE_RISK_LABELS } from "@/lib/types";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimatedScoreBar } from "@/components/AnimatedScoreBar";
import { ScanInput } from "@/components/ScanInput";
import { VerifyEvidenceButton } from "@/components/VerifyEvidenceButton";
import { FineTuneButton } from "@/components/FineTuneButton";
import { ShareCard } from "@/components/ShareCard";
import { agentDisplayName } from "@/lib/constants";

export const revalidate = 30;

// First sentence of the AI reasoning — the "damning one-line reason" used in the share card + meta.
function oneLineReason(reasoning: string, max = 150): string {
  if (!reasoning) return "";
  const first = reasoning.split(/(?<=[.!?])\s/)[0] || reasoning;
  return first.length > max ? first.slice(0, max - 1).trimEnd() + "…" : first;
}

// Per-agent social metadata. Next auto-attaches the dynamic OG image (opengraph-image.tsx) as
// og:image + twitter:image; this sets a large-image Twitter card and agent-specific title/desc.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.address)) return { title: "0G Agent Watch" };
  const { ethers } = await import("ethers");
  const address = ethers.getAddress(params.address.toLowerCase());
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const att = await getAttestation(address);
  const title = att
    ? `${THREAT_LABELS[att.threatLevel] ?? "UNKNOWN"} · ${short} · 0G Agent Watch`
    : `Scan ${short} · 0G Agent Watch`;
  const description = att
    ? `${THREAT_LABELS[att.threatLevel]} (score ${att.behavioralScore}/100), code ${CODE_RISK_LABELS[att.codeRisk]}. Verified on 0G with two independent audits.`
    : "Live threat intelligence for the agent economy. Generate a verified on-chain security verdict for any 0G agent.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

// Display a receipt hash (bytes32) as a short identifier without discarding any of the 32 bytes.
function formatReceiptHash(bytes32: string): string {
  if (!bytes32 || bytes32 === "0x" + "0".repeat(64)) return "–";
  return `${bytes32.slice(0, 14)}…${bytes32.slice(-8)}`;
}

// Short hash form for the attestation panel key/value rows.
function shortHash(h: string): string {
  if (!h || h === "0x" + "0".repeat(64)) return "–";
  return `${h.slice(0, 14)}…${h.slice(-8)}`;
}

async function checkIsERC7857(address: string): Promise<boolean> {
  try {
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai");
    const abi = [
      "function supportsInterface(bytes4 interfaceId) external view returns (bool)",
      "function dataHashesOf(uint256 tokenId) external view returns (bytes32[] memory)",
    ];
    const contract = new ethers.Contract(address, abi, provider);
    try {
      const supported = await contract.supportsInterface("0x4f694152");
      if (supported) return true;
    } catch { /* no ERC-165 */ }
    try {
      await contract.dataHashesOf(1n);
      return true;
    } catch { /* not ERC-7857 */ }
    return false;
  } catch {
    return false;
  }
}

interface Props {
  params: { address: string };
}

async function getAttestation(address: string): Promise<AttestationData | null> {
  try {
    const registry = getAttestationRegistry();
    const has = await registry.hasAttestation(address);
    if (!has) return null;
    const raw = await registry.getAttestation(address);
    return {
      agentAddress: address,
      behavioralScore: Number(raw.behavioral_score),
      threatLevel: Number(raw.threat_level),
      codeRisk: Number(raw.code_risk),
      codeFindings: raw.code_findings,
      reasoning: raw.reasoning || "",
      behavioralReceiptHash: raw.behavioral_receipt_hash,
      codeReceiptHash: raw.code_receipt_hash,
      evidenceHash: raw.evidence_hash,
      attestationTimestamp: Number(raw.attestation_timestamp),
    };
  } catch {
    return null;
  }
}

const RISK_LABELS = CODE_RISK_LABELS;
const ZERO_HASH = "0x" + "0".repeat(64);

function badgeClass(level: number): string {
  if (level === 2) return "badge b-flag";
  if (level === 1) return "badge b-caut";
  return "badge b-safe";
}

function verdictColor(level: number): string {
  return level === 2 ? "var(--bad)" : level === 1 ? "var(--warn)" : "var(--good)";
}

export default async function AgentDetailPage({ params }: Props) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.address)) notFound();

  const { ethers } = await import("ethers");
  // Normalize to EIP-55 checksum — ethers v6 throws for mixed-case addresses with wrong checksum.
  const address = ethers.getAddress(params.address.toLowerCase());
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
  const [attestation, bytecode] = await Promise.all([
    getAttestation(address),
    new ethers.JsonRpcProvider(rpcUrl).getCode(address),
  ]);
  const isERC7857 = bytecode !== "0x" ? await checkIsERC7857(address) : false;
  const explorerBase = "https://chainscan.0g.ai";
  const name = agentDisplayName(address);
  const hasBehavioralReceipt = !!attestation?.behavioralReceiptHash && attestation.behavioralReceiptHash !== ZERO_HASH;
  const hasCodeReceipt = !!attestation?.codeReceiptHash && attestation.codeReceiptHash !== ZERO_HASH;
  const hasEvidence = !!attestation?.evidenceHash && attestation.evidenceHash !== ZERO_HASH;

  return (
    <section className="report-shell" id="report">
      <div className="wrap pad">
        <div className="sec-head rise">
          <span className="eyebrow">
            Verdict detail · {name}
          </span>
          {isERC7857 && (
            <span className="inft-badge" style={{ marginLeft: 12 }}>iNFT ERC-7857</span>
          )}
          <h2>Two independent audits, one on-chain verdict.</h2>
          <p>
            A deterministic behavioral audit and a separate code audit, both settled to chain as an
            immutable ERC-7857 attestation.
          </p>
        </div>

        {!attestation ? (
          /* ── No attestation on-chain — offer a scan ── */
          <div className="attest-panel scale-in" style={{ background: "var(--ink-1)", padding: 0 }}>
            <div className="ap-head">No attestation on-chain</div>
            <div style={{ padding: "22px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
              <p className="mini-note">
                No attestation found on-chain for {address.slice(0, 8)}…{address.slice(-6)}. Run a full scan to
                generate a behavioral risk score, a code vulnerability report, and an immutable on-chain
                attestation via 0G Compute + 0G Chain.
              </p>
              <ScanInput defaultAddress={address} />
              <div className="share-row">
                <Link href="/agents" className="share-btn">← Back to Dashboard</Link>
                <a
                  className="explorer-link"
                  href={`${explorerBase}/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on 0G Explorer ↗
                </a>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* ── Two score cards ── */}
            <div className="report-grid">
              <div className={`score-card rise${attestation.threatLevel === 2 ? " bad-card" : ""}`}>
                <div className="k">Behavioral Risk</div>
                <div className="score-big" style={{ color: verdictColor(attestation.threatLevel) }}>
                  {attestation.behavioralScore}
                  <span className="max">/100</span>
                </div>
                <div className="score-tag">
                  <span className={badgeClass(attestation.threatLevel)}>
                    {THREAT_LABELS[attestation.threatLevel] ?? "UNKNOWN"}
                  </span>
                </div>
                <AnimatedScoreBar score={attestation.behavioralScore} />
              </div>

              <div className={`score-card rise${attestation.codeRisk === 2 ? " bad-card" : ""}`}>
                <div className="k">Code Vulnerability</div>
                <div className="code-verdict" style={{ color: verdictColor(attestation.codeRisk) }}>
                  {RISK_LABELS[attestation.codeRisk] ?? "UNKNOWN"}
                </div>
                <div className="code-sub">
                  {attestation.codeFindings
                    ? attestation.codeFindings
                    : attestation.codeRisk === 0
                    ? "No issues found."
                    : "Issues detected."}
                </div>
                <div className="score-tag" style={{ marginTop: 22 }}>
                  <span className={badgeClass(attestation.codeRisk)}>
                    {attestation.codeRisk === 0 ? "CODE CLEAN" : `CODE RISK ${attestation.codeRisk}`}
                  </span>
                </div>
              </div>
            </div>

            {/* ── On-chain attestation data ── */}
            <div className="attest-panel scale-in">
              <div className="ap-head">On-Chain Attestation Data</div>
              <div className="kv"><span className="kk">Behavioral Hash</span><span className="vv" title={attestation.behavioralReceiptHash}>{shortHash(attestation.behavioralReceiptHash)}</span></div>
              <div className="kv"><span className="kk">Code Hash</span><span className="vv" title={attestation.codeReceiptHash}>{shortHash(attestation.codeReceiptHash)}</span></div>
              <div className="kv"><span className="kk">Evidence Hash</span><span className="vv" title={attestation.evidenceHash}>{shortHash(attestation.evidenceHash)}</span></div>
              <div className="kv"><span className="kk">Attested</span><span className="vv">{new Date(attestation.attestationTimestamp * 1000).toLocaleString()}</span></div>
              <div className="kv"><span className="kk">Agent Address</span><span className="vv cy">{address}</span></div>
              <div className="kv">
                <span className="kk">On-Chain Record</span>
                <span className="vv">
                  <a href={`${explorerBase}/address/${address}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cy)" }}>
                    View on Explorer ↗
                  </a>
                </span>
              </div>
              {hasEvidence && (
                <div className="kv">
                  <span className="kk">Evidence Integrity</span>
                  <span className="vv" style={{ textAlign: "right" }}>
                    <VerifyEvidenceButton evidenceHash={attestation.evidenceHash} />
                  </span>
                </div>
              )}
            </div>

            {/* ── AI reasoning ── */}
            {attestation.reasoning && (
              <div className="reasoning rise">
                <span className="lab">AI Reasoning</span>
                {attestation.reasoning}
              </div>
            )}

            {/* ── 0G Compute inference receipts ── */}
            {(hasBehavioralReceipt || hasCodeReceipt) && (
              <div className="receipts rise">
                <span className="r-lab">0G Compute Inference Receipts</span>
                {hasBehavioralReceipt && (
                  <span className="r-item"><b>Behavioral ChatID</b> <span className="mono">{formatReceiptHash(attestation.behavioralReceiptHash)}</span></span>
                )}
                {hasCodeReceipt && (
                  <span className="r-item"><b>Code Audit ChatID</b> <span className="mono">{formatReceiptHash(attestation.codeReceiptHash)}</span></span>
                )}
              </div>
            )}

            {/* ── Share row ── */}
            <div className="share-row rise" style={{ marginBottom: 26 }}>
              <ShareCard
                address={address}
                verdict={THREAT_LABELS[attestation.threatLevel] ?? "UNKNOWN"}
                score={attestation.behavioralScore}
                reason={oneLineReason(attestation.reasoning)}
              />
              <a className="explorer-link" href={`${explorerBase}/address/${address}`} target="_blank" rel="noopener noreferrer">
                View on 0G Explorer ↗
              </a>
            </div>

            {/* ── 0G Compute fine-tuning ── */}
            <div className="attest-panel scale-in">
              <div className="ap-head">0G Compute Fine-Tuning</div>
              <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                <p className="mini-note">
                  Upload this attestation as a training dataset to 0G Storage and get the CLI command to
                  submit a fine-tuning task.
                </p>
                <FineTuneButton agentAddress={address} />
              </div>
            </div>

            <div style={{ marginTop: 22 }}>
              <Link href="/agents" className="share-btn">← Back to Dashboard</Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
