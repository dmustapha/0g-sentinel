// File: frontend/app/agents/page.tsx
// Server component with ISR — no loading spinner on initial render.
// Rescan / scan interactivity is isolated to the client child components.
import Link from "next/link";
import { AgentWithAttestation } from "@/lib/types";
import { ScanInput } from "@/components/ScanInput";
import { ChainDiscovery } from "@/components/ChainDiscovery";
import { AgentsTable } from "@/components/AgentsTable";
import { QueueBanner } from "@/components/QueueBanner";
import { RadarHero } from "@/components/RadarHero";
import { fetchRankedAgents } from "@/lib/agents";

export const revalidate = 30;

export default async function AgentsPage() {
  let agents: AgentWithAttestation[] = [];
  let attestedAddresses: string[] = [];
  let fetchError = false;

  try {
    const result = await fetchRankedAgents();
    agents = result.agents;
    attestedAddresses = result.addresses;
  } catch {
    fetchError = true;
  }

  const safeCount = agents.filter((a) => a.has_attestation && a.threat_level === 0 && a.code_risk === 0).length;
  const threatCount = agents.filter((a) => a.has_attestation && (a.threat_level === 2 || a.code_risk === 2)).length;

  return (
    <>
      {/* ============ COMPACT HERO ============ */}
      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-inner" style={{ padding: "48px 24px 52px" }}>
          <div className="hero-copy">
            <span className="eyebrow rise">Watchlist · riskiest first · 0G Aristotle</span>
            <h1 className="rise" style={{ fontSize: "var(--fs-h2)", marginTop: 12 }}>
              Verify every AI agent <span className="accent">on-chain.</span>
            </h1>
            <p className="identity-sub rise" style={{ marginTop: 10 }}>
              Behavioral audit · Code scan · AttestationRegistry · every row a real on-chain attestation
            </p>
            <div className="rise" style={{ marginTop: 20 }}>
              <ScanInput />
            </div>
          </div>
          <RadarHero compact />
        </div>
      </section>

      {/* ============ RISK BOARD ============ */}
      <section className="pad" id="board">
        <div className="wrap">
          <QueueBanner />

          {fetchError ? (
            <div className="board"><div className="board-empty" style={{ color: "var(--bad)" }}>Failed to load agents. Check RPC connection.</div></div>
          ) : (
            <AgentsTable agents={agents} />
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginTop: 18 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)", color: "var(--tx-lo)" }}>
              {agents.length} attested · {safeCount} verified safe · {threatCount} threats detected
            </span>
            <Link href="/proof" className="explorer-link">Integration Proof →</Link>
          </div>

          {/* Chain-discovered contracts — client-rendered, non-blocking */}
          <ChainDiscovery attestedAddresses={attestedAddresses} />
        </div>
      </section>
    </>
  );
}
