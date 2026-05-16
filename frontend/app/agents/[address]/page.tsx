// File: frontend/app/agents/[address]/page.tsx
import { getAttestationRegistry } from "@/lib/contracts";
import { AttestationData, THREAT_LABELS, CODE_RISK_LABELS } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimatedScoreBar } from "@/components/AnimatedScoreBar";
import { ScanInput } from "@/components/ScanInput";
import { VerifyEvidenceButton } from "@/components/VerifyEvidenceButton";
import { FineTuneButton } from "@/components/FineTuneButton";

export const revalidate = 30;

// Display a receipt hash (bytes32) as a short identifier without discarding any of the 32 bytes.
// UUID formatting was previously used but silently truncated the second half of the hash.
function formatReceiptHash(bytes32: string): string {
  if (!bytes32 || bytes32 === "0x" + "0".repeat(64)) return "—";
  // Show first 12 chars + ... + last 8 chars (retains uniqueness, no data loss)
  return `${bytes32.slice(0, 14)}…${bytes32.slice(-8)}`;
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

function threatBadgeClass(level: number) {
  if (level === 2) return "sg-badge sg-badge-danger";
  if (level === 1) return "sg-badge sg-badge-caution";
  return "sg-badge sg-badge-safe";
}


export default async function AgentDetailPage({ params }: Props) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.address)) notFound();

  // Fetch attestation and bytecode in parallel.
  // Only check ERC-7857 if the address has bytecode — saves 2 RPC calls for EOAs.
  const { ethers } = await import("ethers");
  // Normalize to EIP-55 checksum — ethers v6 throws INVALID_ARGUMENT for mixed-case
  // addresses with wrong checksum when encoding them as Solidity `address` parameters.
  const address = ethers.getAddress(params.address.toLowerCase());
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc.0g.ai";
  const [attestation, bytecode] = await Promise.all([
    getAttestation(address),
    new ethers.JsonRpcProvider(rpcUrl).getCode(address),
  ]);
  const isERC7857 = bytecode !== "0x" ? await checkIsERC7857(address) : false;
  const explorerBase = "https://chainscan.0g.ai";
  const shortAddr = `${address.slice(0, 8)}…${address.slice(-6)}`;

  const threatColor = attestation
    ? attestation.threatLevel === 2
      ? "#ef4444"
      : attestation.threatLevel === 1
      ? "#f59e0b"
      : "#10b981"
    : "#334155";

  return (
    <div style={{ minHeight: "calc(100vh - 44px)", display: "flex", flexDirection: "column" }}>

      {/* Back nav */}
      <div style={{
        padding: "1rem 2rem",
        borderBottom: "1px solid #0f1c30",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        background: "rgba(8,1,14,0.6)",
        backdropFilter: "blur(8px)",
      }}>
        <Link href="/agents" style={{
          fontFamily: "Space Grotesk, sans-serif",
          fontSize: "0.8rem",
          color: "#334155",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          transition: "color 0.2s",
        }}
        >
          ← Dashboard
        </Link>
        {isERC7857 && (
          <span style={{
            fontFamily: "var(--font-jetbrains-mono, monospace)",
            fontSize: "0.5625rem",
            color: "#a78bfa",
            border: "1px solid rgba(167,139,250,0.35)",
            borderRadius: "4px",
            padding: "0.2rem 0.5rem",
            letterSpacing: "0.08em",
          }}>
            iNFT ERC-7857
          </span>
        )}
        <div style={{ width: 1, height: 14, background: "#0f1c30" }} />
        <span className="sg-mono" style={{ color: "#334155" }}>{shortAddr}</span>
        <a
          href={`${explorerBase}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="sg-mono"
          style={{ color: "#00d4ff", fontSize: "0.6875rem", marginLeft: "auto" }}
        >
          View on 0G Explorer ↗
        </a>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", flex: 1, overflow: "hidden" }}>

        {/* ── LEFT: Report ── */}
        <div style={{
          flex: "1 1 480px",
          padding: "2.5rem clamp(1.5rem, 4vw, 3rem)",
          minWidth: 0,
          overflowY: "auto",
        }}>

          <div className="sg-label sg-reveal-fade" style={{ marginBottom: "1.75rem" }}>
            Agent Security Report
          </div>

          {!attestation ? (
            <div className="sg-glass-card sg-reveal-up" style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <div style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "0.8125rem",
                  color: "#475569",
                  marginBottom: "0.5rem",
                }}>
                  No attestation found on-chain for this agent address.
                </div>
                <div style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: "0.75rem",
                  color: "#334155",
                  lineHeight: 1.6,
                }}>
                  Run a full scan to generate a behavioral risk score, code vulnerability report, and immutable on-chain attestation via 0G Compute + 0G Chain.
                </div>
              </div>
              <div>
                <div className="sg-label" style={{ marginBottom: "0.625rem", fontSize: "0.5625rem" }}>
                  Scan this agent
                </div>
                <ScanInput defaultAddress={address} />
              </div>
            </div>
          ) : (
            <>
              {/* Score cards */}
              <div className="sg-reveal-up sg-delay-1" style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
                marginBottom: "1.5rem",
              }}>
                {/* Behavioral */}
                <div
                  className={
                    attestation.threatLevel === 2 ? "sg-threat-danger" :
                    attestation.threatLevel === 1 ? "sg-threat-caution" :
                    "sg-threat-safe"
                  }
                  style={{ padding: "1.5rem" }}
                >
                  <div className="sg-label" style={{ marginBottom: 12 }}>Behavioral Risk</div>
                  <div className="sg-display" style={{
                    fontSize: "3.5rem",
                    color: threatColor,
                    lineHeight: 1,
                    marginBottom: 4,
                  }}>
                    {attestation.behavioralScore}
                    <span style={{ fontSize: "1.25rem", color: "#334155", fontWeight: 400 }}>/100</span>
                  </div>
                  <AnimatedScoreBar score={attestation.behavioralScore} />
                  <div style={{ marginTop: 12 }}>
                    <span className={threatBadgeClass(attestation.threatLevel)}>
                      {THREAT_LABELS[attestation.threatLevel] ?? "UNKNOWN"}
                    </span>
                  </div>
                </div>

                {/* Code vulnerability */}
                <div
                  className={
                    attestation.codeRisk === 2 ? "sg-threat-danger" :
                    attestation.codeRisk === 1 ? "sg-threat-caution" :
                    "sg-threat-safe"
                  }
                  style={{ padding: "1.5rem" }}
                >
                  <div className="sg-label" style={{ marginBottom: 12 }}>Code Vulnerability</div>
                  <div className="sg-display" style={{
                    fontSize: "2.25rem",
                    color: attestation.codeRisk === 2 ? "#ef4444" : attestation.codeRisk === 1 ? "#f59e0b" : "#10b981",
                    lineHeight: 1,
                    marginBottom: 12,
                  }}>
                    {RISK_LABELS[attestation.codeRisk] ?? "UNKNOWN"}
                  </div>
                  <span className={threatBadgeClass(attestation.codeRisk)}>
                    {attestation.codeRisk === 0 ? "No issues found" : "Issues detected"}
                  </span>
                </div>
              </div>

              {/* Code findings */}
              {attestation.codeFindings && (
                <div className="sg-glass-card-danger sg-reveal-up sg-delay-2" style={{
                  padding: "1.25rem",
                  marginBottom: "1.5rem",
                }}>
                  <div className="sg-label" style={{ color: "#ef4444", marginBottom: 10 }}>Code Findings</div>
                  <pre style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "0.8125rem",
                    color: "#94a3b8",
                    whiteSpace: "pre-wrap",
                    margin: 0,
                    lineHeight: 1.6,
                  }}>
                    {attestation.codeFindings}
                  </pre>
                </div>
              )}

              {/* On-chain data */}
              <div className="sg-glass-card sg-reveal-up sg-delay-3" style={{ overflow: "hidden" }}>
                <div style={{
                  padding: "0.75rem 1.25rem",
                  borderBottom: "1px solid rgba(0,212,255,0.08)",
                  background: "rgba(0,212,255,0.02)",
                }}>
                  <span className="sg-label">On-Chain Attestation Data</span>
                </div>
                <div style={{ padding: "0.25rem 1.25rem" }}>
                  <div className="sg-data-field">
                    <span className="sg-data-label">Behavioral Hash</span>
                    <span className="sg-data-value" title={attestation.behavioralReceiptHash}>
                      {attestation.behavioralReceiptHash
                        ? `${attestation.behavioralReceiptHash.slice(0, 14)}…${attestation.behavioralReceiptHash.slice(-8)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="sg-data-field">
                    <span className="sg-data-label">Code Hash</span>
                    <span className="sg-data-value" title={attestation.codeReceiptHash}>
                      {attestation.codeReceiptHash
                        ? `${attestation.codeReceiptHash.slice(0, 14)}…${attestation.codeReceiptHash.slice(-8)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="sg-data-field">
                    <span className="sg-data-label">Evidence Hash</span>
                    <span className="sg-data-value" title={attestation.evidenceHash}>
                      {attestation.evidenceHash
                        ? `${attestation.evidenceHash.slice(0, 14)}…${attestation.evidenceHash.slice(-8)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="sg-data-field">
                    <span className="sg-data-label">Attested</span>
                    <span className="sg-data-value">
                      {new Date(attestation.attestationTimestamp * 1000).toLocaleString()}
                    </span>
                  </div>
                  <div className="sg-data-field">
                    <span className="sg-data-label">Agent Address</span>
                    <span className="sg-data-value" style={{ color: "#00d4ff" }}>
                      {address}
                    </span>
                  </div>
                  <div className="sg-data-field">
                    <span className="sg-data-label">On-Chain Record</span>
                    <a
                      href={`${explorerBase}/address/${address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sg-data-value"
                      style={{ color: "#00d4ff", fontSize: "0.625rem" }}
                      title="View agent transactions on 0G Explorer"
                    >
                      View on Explorer ↗
                    </a>
                  </div>
                  {attestation.evidenceHash && attestation.evidenceHash !== "0x" + "0".repeat(64) && (
                    <div className="sg-data-field">
                      <span className="sg-data-label">Evidence Integrity</span>
                      <VerifyEvidenceButton evidenceHash={attestation.evidenceHash} />
                    </div>
                  )}
                </div>
              </div>

              {/* TEE Verification */}
              {(attestation.behavioralReceiptHash || attestation.codeReceiptHash) && (
                <div className="sg-glass-card sg-reveal-up" style={{ marginTop: "1.5rem", padding: "1.25rem" }}>
                  <div className="sg-section-label" style={{ marginBottom: "1rem" }}>
                    0G Sealed Inference Receipts
                  </div>
                  <div style={{ fontSize: "0.625rem", color: "#94a3b8", marginBottom: "1rem", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                    Hardware-attested via Intel TDX + H100/H200. Each receipt is a chatID linking this inference to a specific TEE execution.
                  </div>
                  {attestation.behavioralReceiptHash && attestation.behavioralReceiptHash !== "0x" + "0".repeat(64) && (
                    <div className="sg-data-field" style={{ marginBottom: "0.5rem" }}>
                      <span className="sg-data-label">Behavioral ChatID</span>
                      <span className="sg-data-value" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.625rem" }}>
                        {formatReceiptHash(attestation.behavioralReceiptHash)}
                      </span>
                    </div>
                  )}
                  {attestation.codeReceiptHash && attestation.codeReceiptHash !== "0x" + "0".repeat(64) && (
                    <div className="sg-data-field" style={{ marginBottom: "0.75rem" }}>
                      <span className="sg-data-label">Code Audit ChatID</span>
                      <span className="sg-data-value" style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.625rem" }}>
                        {formatReceiptHash(attestation.codeReceiptHash)}
                      </span>
                    </div>
                  )}
                  <a
                    href="https://pc.0g.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block",
                      marginTop: "0.25rem",
                      padding: "0.375rem 0.75rem",
                      background: "rgba(0, 212, 255, 0.08)",
                      border: "1px solid rgba(0, 212, 255, 0.25)",
                      borderRadius: "4px",
                      color: "#00d4ff",
                      fontFamily: "var(--font-jetbrains-mono, monospace)",
                      fontSize: "0.5625rem",
                      textDecoration: "none",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Verify on 0G Proof Cloud →
                  </a>
                </div>
              )}

              {/* Fine-tuning dataset */}
              <div className="sg-glass-card sg-reveal-up" style={{ marginTop: "1.5rem", padding: "1.25rem" }}>
                <div className="sg-section-label" style={{ marginBottom: "0.75rem" }}>
                  0G Compute Fine-Tuning
                </div>
                <div style={{ fontSize: "0.625rem", color: "#94a3b8", marginBottom: "0.75rem", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                  Upload attestation data as a training dataset to 0G Storage and get the CLI command to submit a fine-tuning task.
                </div>
                <FineTuneButton agentAddress={address} />
              </div>
            </>
          )}
        </div>

        {/* ── DIVIDER ── */}
        <div className="sg-divider" />

        {/* ── RIGHT: Actions ── */}
        <div style={{
          flex: "1 1 260px",
          maxWidth: 300,
          background: "rgba(8,1,14,0.92)",
          borderTop: "1px solid #0f1c30",
          backdropFilter: "blur(8px)",
          padding: "2rem 1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
        }}>
          {attestation?.reasoning ? (
            <>
              <div>
                <div className="sg-label" style={{ marginBottom: "0.75rem" }}>AI Reasoning</div>
                <p style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: "0.75rem",
                  color: "#94a3b8",
                  lineHeight: 1.65,
                  fontStyle: "italic",
                }}>
                  &ldquo;{attestation.reasoning}&rdquo;
                </p>
              </div>
              <div className="sg-rule" />
            </>
          ) : (
            <>
              <div>
                <div className="sg-label" style={{ marginBottom: "0.75rem" }}>0G Compute Receipts</div>
                <p style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: "0.75rem",
                  color: "#334155",
                  lineHeight: 1.6,
                }}>
                  Two independent inference calls: behavioral analysis and code audit. Each generates a
                  unique receipt hash stored immutably on 0G Aristotle.
                </p>
              </div>
              <div className="sg-rule" />
            </>
          )}

          <div>
            <div className="sg-label" style={{ marginBottom: "0.5rem" }}>Scan Metadata</div>
            {attestation ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {[
                  { label: "Verdict", value: THREAT_LABELS[attestation.threatLevel] ?? "—" },
                  { label: "Score", value: `${attestation.behavioralScore}/100` },
                  { label: "Code", value: RISK_LABELS[attestation.codeRisk] ?? "—" },
                  { label: "Network", value: "0G Aristotle (16661)" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                    <span style={{ fontFamily: "Inter, sans-serif", fontSize: "0.6875rem", color: "#334155" }}>{label}</span>
                    <span className="sg-mono" style={{ fontSize: "0.6875rem", color: "#64748b" }}>{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontFamily: "Inter, sans-serif", fontSize: "0.75rem", color: "#334155", lineHeight: 1.6 }}>
                No attestation on-chain for this address.
              </p>
            )}
          </div>

          <div className="sg-rule" />

          <a
            href={`${explorerBase}/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="sg-btn-primary"
            style={{ textDecoration: "none" }}
          >
            0G Explorer ↗
          </a>
          <Link href="/agents" className="sg-btn-ghost" style={{ textAlign: "center", textDecoration: "none" }}>
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
