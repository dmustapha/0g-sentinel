// File: frontend/app/agents/[address]/page.tsx
import { getAttestationRegistry } from "@/lib/contracts";
import { AttestationData } from "@/lib/types";
import Link from "next/link";
import { AnimatedScoreBar } from "@/components/AnimatedScoreBar";

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
      behavioralReceiptHash: raw.behavioral_receipt_hash,
      codeReceiptHash: raw.code_receipt_hash,
      evidenceHash: raw.evidence_hash,
      attestationTimestamp: Number(raw.attestation_timestamp),
    };
  } catch {
    return null;
  }
}

const THREAT_LABELS = ["SAFE", "CAUTION", "FLAGGED"];
const RISK_LABELS = ["CLEAN", "WARNING", "VULNERABLE"];

function threatBadgeClass(level: number) {
  if (level === 2) return "sg-badge sg-badge-danger";
  if (level === 1) return "sg-badge sg-badge-caution";
  return "sg-badge sg-badge-safe";
}


export default async function AgentDetailPage({ params }: Props) {
  const attestation = await getAttestation(params.address);
  const explorerBase = "https://chainscan.0g.ai";
  const shortAddr = `${params.address.slice(0, 8)}…${params.address.slice(-6)}`;

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
        <div style={{ width: 1, height: 14, background: "#0f1c30" }} />
        <span className="sg-mono" style={{ color: "#334155" }}>{shortAddr}</span>
        <a
          href={`${explorerBase}/address/${params.address}`}
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
            <div className="sg-glass-card sg-reveal-up" style={{ padding: "2rem" }}>
              <div style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "0.8125rem",
                color: "#334155",
              }}>
                No attestation found on-chain for this agent address.
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
                      {params.address}
                    </span>
                  </div>
                </div>
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
          <div>
            <div className="sg-label" style={{ marginBottom: "0.75rem" }}>0G Compute Receipts</div>
            <p style={{
              fontFamily: "Inter, sans-serif",
              fontSize: "0.75rem",
              color: "#334155",
              lineHeight: 1.6,
            }}>
              Two independent inference calls — behavioral analysis and code audit. Each generates a
              unique receipt hash stored immutably on 0G Aristotle.
            </p>
          </div>

          <div className="sg-rule" />

          <div>
            <div className="sg-label" style={{ marginBottom: "0.75rem" }}>AgentGate Composability</div>
            <p style={{
              fontFamily: "Inter, sans-serif",
              fontSize: "0.75rem",
              color: "#334155",
              lineHeight: 1.6,
            }}>
              Any protocol can require attestation before execution. Gate reads directly from
              AttestationRegistry — no trust required.
            </p>
          </div>

          <div className="sg-rule" />

          <a
            href={`${explorerBase}/address/${params.address}`}
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
