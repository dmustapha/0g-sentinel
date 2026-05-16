// File: frontend/app/page.tsx
import Link from "next/link";
import { getAttestationRegistry } from "@/lib/contracts";

// Revalidate every 60s so stats stay fresh without blocking initial load
export const revalidate = 60;

interface LiveStats {
  totalAgents: number;
  totalAttested: number;
  threatsDetected: number;
  statsUnavailable?: boolean;
}

async function getLiveStats(): Promise<LiveStats> {
  try {
    const attestationRegistry = getAttestationRegistry();
    // All stats derived from AttestationRegistry — the chain IS the registry.
    const [attestedAddresses, attestedCount] = await Promise.all([
      attestationRegistry.getAllAttestedAgents() as Promise<string[]>,
      attestationRegistry.getAttestedCount() as Promise<bigint>,
    ]);
    // Fetch all attestations to count threats
    const attestations = await Promise.all(
      attestedAddresses.map((addr) => attestationRegistry.getAttestation(addr))
    );
    const threatsDetected = attestations.filter(
      (a) => BigInt(a.attestation_timestamp) > 0n &&
             (Number(a.threat_level) === 2 || Number(a.code_risk) === 2)
    ).length;
    return {
      totalAgents: Number(attestedCount),
      totalAttested: Number(attestedCount),
      threatsDetected,
    };
  } catch {
    // Return zeros — never show fabricated stats on RPC failure
    return { totalAgents: 0, totalAttested: 0, threatsDetected: 0, statsUnavailable: true };
  }
}

export default async function Home() {
  const stats = await getLiveStats();
  return (
    <div className="sg-landing">

      {/* Hero */}
      <div className="sg-hero-left sg-reveal-up">
        <div className="sg-hero-kicker">Attestation infrastructure · 0G Aristotle</div>
        <h1 className="sg-hero-headline">
          Every AI agent, <em>verified</em>. Behavioral audit, code scan, on-chain proof.
        </h1>
        <p className="sg-hero-body">
          0G Sentinel monitors agent behavior, audits code via 0G Compute, and writes immutable
          ERC-7857 attestations to chain. AgentGate lets any protocol act on the result.
        </p>
        <div className="sg-hero-ctas">
          <Link href="/agents" className="sg-btn-fill">Open Dashboard →</Link>
          <Link href="/proof" className="sg-btn-outline">Integration Proof →</Link>
        </div>
      </div>

      {/* Features grid */}
      <div className="sg-feat-section sg-reveal-up sg-delay-1">
        <div className="sg-feat-header">
          <div className="sg-feat-label">Core Capabilities</div>
          <div className="sg-feat-title">Four layers of protection, one composable stack</div>
        </div>
        <div className="sg-feat-grid">
          <div className="sg-feat-cell">
            <div className="sg-feat-num">[01]</div>
            <div className="sg-feat-name">Behavioral Analysis</div>
            <div className="sg-feat-desc">LLM-powered risk scoring per agent. Every action pattern scored and hashed on-chain.</div>
          </div>
          <div className="sg-feat-cell">
            <div className="sg-feat-num">[02]</div>
            <div className="sg-feat-name">Code Audit</div>
            <div className="sg-feat-desc">Vulnerability detection via 0G Compute. Two independent inference pipelines, verifiable receipts.</div>
          </div>
          <div className="sg-feat-cell">
            <div className="sg-feat-num">[03]</div>
            <div className="sg-feat-name">On-Chain Attestation</div>
            <div className="sg-feat-desc">ERC-7857 structs. All 9 fields immutable on 0G Chain, verifiable by any smart contract.</div>
          </div>
          <div className="sg-feat-cell">
            <div className="sg-feat-num">[04]</div>
            <div className="sg-feat-name">AgentGate</div>
            <div className="sg-feat-desc">
              Any protocol can gate execution on{" "}
              <code style={{ fontFamily: "var(--font-dm-mono, monospace)", color: "#06b6d4", fontSize: "0.75rem" }}>
                isSafe()
              </code>{" "}
              . No centralized oracle required.
            </div>
          </div>
        </div>
      </div>

      {/* Live stats strip */}
      <div className="sg-reveal-up sg-delay-2" style={{
        display: "flex",
        gap: "2rem",
        flexWrap: "wrap",
        padding: "1.25rem 0",
        borderTop: "1px solid rgba(6,182,212,0.08)",
        borderBottom: "1px solid rgba(6,182,212,0.08)",
        marginBottom: "0.5rem",
      }}>
        {[
          { label: "Agents Monitored", value: stats.statsUnavailable ? "—" : stats.totalAgents.toString() },
          { label: "Attestations On-Chain", value: stats.statsUnavailable ? "—" : stats.totalAttested.toString() },
          { label: "Threats Detected", value: stats.statsUnavailable ? "—" : stats.threatsDetected.toString() },
          { label: "Network", value: "0G Aristotle" },
        ].map(({ label, value }) => (
          <div key={label} style={{ flex: "1 1 120px", minWidth: 0 }}>
            <div style={{
              fontFamily: "var(--font-dm-mono, monospace)",
              fontSize: "clamp(1.25rem, 3vw, 2rem)",
              fontWeight: 700,
              color: "#06b6d4",
              lineHeight: 1,
            }}>
              {value}
            </div>
            <div style={{
              fontFamily: "DM Mono, monospace",
              fontSize: "0.6875rem",
              color: "rgba(255,255,255,0.15)",
              marginTop: "0.25rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Pull quote */}
      <div className="sg-pullquote-section sg-reveal-fade sg-delay-2">
        <div className="sg-pq-line" />
        <div className="sg-pq-text">
          AI agents are operating without behavioral audits, code verification, or on-chain proof of safety.
          0G Sentinel brings attestation infrastructure to every agent on 0G Aristotle mainnet,
          giving protocols a composable trust layer they can act on.
        </div>
      </div>

      {/* CTA strip */}
      <div className="sg-cta-strip sg-reveal-up sg-delay-3">
        <div>
          <div className="sg-cta-title">Ready to secure your agents?</div>
          <div className="sg-cta-sub">Live on 0G Aristotle. Behavioral analysis + code audit + on-chain proof.</div>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link href="/agents" className="sg-btn-fill">Open Dashboard →</Link>
          <Link href="/proof" className="sg-btn-outline">Integration Proof →</Link>
        </div>
      </div>

    </div>
  );
}
