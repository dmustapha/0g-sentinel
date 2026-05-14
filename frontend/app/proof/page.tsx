// File: frontend/app/proof/page.tsx
export default function ProofPage() {
  const attestationAddr = process.env.NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS ?? "Not deployed";
  const agentRegistryAddr = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ?? "Not deployed";
  const gateAddr = process.env.NEXT_PUBLIC_AGENT_GATE_ADDRESS ?? "Not deployed";
  const explorerBase = "https://chainscan.0g.ai/address";

  const contracts = [
    {
      name: "AgentRegistry",
      address: agentRegistryAddr,
      description: "Registers AI agents on-chain",
    },
    {
      name: "AttestationRegistry",
      address: attestationAddr,
      description: "Stores immutable security attestations",
    },
    {
      name: "AgentGate",
      address: gateAddr,
      description: "Composability primitive for gated execution",
    },
  ];

  const integrations = [
    {
      label: "0G Compute",
      status: "live",
      detail: "Two independent inference pipelines — behavioral analysis + code vulnerability scan. Each returns a verifiable receipt hash via zg-res-key UUID header.",
    },
    {
      label: "0G Storage",
      status: "degraded",
      detail: "Evidence archive via @0glabs/0g-ts-sdk. SHA256 fallback active (storage DNS unavailable on mainnet). Root hash stored in attestation.evidenceHash.",
    },
    {
      label: "0G Chain",
      status: "live",
      detail: "ERC-7857 attestations written to AttestationRegistry on 0G Aristotle mainnet (chain ID: 16661). All 8 fields on-chain, immutable, verifiable.",
    },
    {
      label: "AgentGate",
      status: "live",
      detail: "Composability primitive — any protocol can require attestation before execution. isSafe() reads directly from AttestationRegistry.",
    },
  ];

  const statusBadge = (status: string) => {
    if (status === "live")
      return <span className="sg-badge sg-badge-safe">Live</span>;
    if (status === "degraded")
      return <span className="sg-badge sg-badge-caution">Degraded</span>;
    return <span className="sg-badge sg-badge-neutral">—</span>;
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", minHeight: "calc(100vh - 44px)" }}>

      {/* ── LEFT: Contracts + Integrations ── */}
      <div style={{ flex: "1 1 480px", padding: "2.5rem clamp(1.5rem, 4vw, 3rem)", minWidth: 0 }}>

        {/* Header */}
        <div className="sg-reveal-fade" style={{ marginBottom: "2.75rem" }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "1.25rem",
          }}>
            <div style={{ width: 32, height: 1, background: "rgba(0,212,255,0.3)" }} />
            <span className="sg-label" style={{ color: "rgba(0,212,255,0.6)" }}>Integration Proof</span>
          </div>
          <div className="sg-display" style={{
            fontSize: "clamp(2rem, 5vw, 3.5rem)",
            color: "#e2e8f0",
            lineHeight: 0.92,
            marginBottom: "0.75rem",
          }}>
            Live on 0G Aristotle
          </div>
          <div className="sg-mono" style={{ color: "#334155", marginTop: 8, fontSize: "0.75rem" }}>
            Chain ID: 16661 · 3 contracts deployed · 4 integrations active
          </div>
        </div>

        {/* Contracts table */}
        <div className="sg-reveal-up sg-delay-1" style={{ marginBottom: "2.5rem" }}>
          <div className="sg-label" style={{ marginBottom: "1rem" }}>Deployed Contracts</div>
          <div className="sg-glass-card" style={{ overflow: "hidden" }}>
            {contracts.map((c, i) => (
              <div
                key={c.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 140px) 1fr auto",
                  gap: "0.75rem",
                  padding: "0.875rem 1.25rem",
                  borderBottom: i < contracts.length - 1 ? "1px solid rgba(0,212,255,0.06)" : "none",
                  alignItems: "center",
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <div>
                  <div style={{
                    fontFamily: "Space Grotesk, sans-serif",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: "#c8d3e8",
                  }}>
                    {c.name}
                  </div>
                  <div style={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: "0.6875rem",
                    color: "#334155",
                    marginTop: 2,
                  }}>
                    {c.description}
                  </div>
                </div>
                <div className="sg-mono" style={{ color: "#64748b", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.address}
                </div>
                {c.address !== "Not deployed" ? (
                  <a
                    href={`${explorerBase}/${c.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sg-mono"
                    style={{ color: "#00d4ff", whiteSpace: "nowrap", fontSize: "0.6875rem" }}
                  >
                    Explorer ↗
                  </a>
                ) : (
                  <span className="sg-mono" style={{ color: "#334155" }}>—</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Integration status */}
        <div className="sg-reveal-up sg-delay-2">
          <div className="sg-label" style={{ marginBottom: "1rem" }}>0G Integration Status</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {integrations.map((intg) => (
              <div
                key={intg.label}
                className={intg.status === "degraded" ? "sg-glass-card-caution" : "sg-glass-card"}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 120px) auto 1fr",
                  gap: "0.75rem",
                  padding: "1rem 1.25rem",
                  alignItems: "start",
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <div style={{
                  fontFamily: "Space Grotesk, sans-serif",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "#e2e8f0",
                }}>
                  {intg.label}
                </div>
                <div>{statusBadge(intg.status)}</div>
                <div style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: "0.8125rem",
                  color: "#64748b",
                  lineHeight: 1.5,
                }}>
                  {intg.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── DIVIDER ── */}
      <div className="sg-divider" />

      {/* ── RIGHT: Key facts ── */}
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
        overflowY: "auto",
      }}>

        <div>
          <div className="sg-label" style={{ marginBottom: "0.75rem" }}>Why On-Chain?</div>
          <p style={{
            fontFamily: "Inter, sans-serif",
            fontSize: "0.75rem",
            color: "#64748b",
            lineHeight: 1.6,
          }}>
            Off-chain attestations can be forged. On-chain attestations are immutable, verifiable by any smart contract,
            and composable — AgentGate can require them without trusting a centralized oracle.
          </p>
        </div>

        <div className="sg-rule" />

        <div>
          <div className="sg-label" style={{ marginBottom: "0.75rem" }}>Receipt Hash Uniqueness</div>
          <p style={{
            fontFamily: "Inter, sans-serif",
            fontSize: "0.75rem",
            color: "#64748b",
            lineHeight: 1.6,
          }}>
            0G Compute returns a unique <span className="sg-mono" style={{ color: "#94a3b8" }}>zg-res-key</span> UUID per
            inference call. Behavioral and code scans produce independent hashes — identical hashes would indicate
            a non-compliant integration.
          </p>
        </div>

        <div className="sg-rule" />

        <div>
          <div className="sg-label" style={{ marginBottom: "0.5rem" }}>AgentMesh Track</div>
          <p style={{
            fontFamily: "Inter, sans-serif",
            fontSize: "0.75rem",
            color: "#64748b",
            lineHeight: 1.5,
          }}>
            AgentGate.sol enforces risk-management gating for DeFi agents — a composable trust rail for any trading
            protocol on 0G.
          </p>
        </div>

        <div className="sg-rule" />

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <a
            href="https://chainscan.0g.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="sg-btn-primary"
            style={{ textDecoration: "none" }}
          >
            0G Explorer ↗
          </a>
          <a href="/agents" className="sg-btn-ghost" style={{ textAlign: "center", textDecoration: "none" }}>
            ← Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
