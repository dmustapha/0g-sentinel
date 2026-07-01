// File: frontend/app/page.tsx
import Link from "next/link";
import { RadarHero } from "@/components/RadarHero";
import { ScanInput } from "@/components/ScanInput";
import { AgentsTable } from "@/components/AgentsTable";
import { fetchRankedAgents } from "@/lib/agents";
import { checkSystemPulse } from "@/lib/pulse";
import { AgentWithAttestation } from "@/lib/types";

// Revalidate every 60s so the board + pulse stay fresh without blocking initial load.
export const revalidate = 60;

// Demo agent — the known working attested agent on 0G Aristotle (CAUTION, score 62).
const DEMO_AGENT = "0xbbbb000000000000000000000000000000000002";

export default async function Home() {
  let topAgents: AgentWithAttestation[] = [];
  try {
    const { agents } = await fetchRankedAgents();
    topAgents = agents.slice(0, 5);
  } catch {
    topAgents = [];
  }

  const pulse = await checkSystemPulse().catch(() => ({ chain: false, compute: false, storage: false, gate: false }));

  const contracts = [
    { name: "AttestationRegistry", address: process.env.NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS ?? "Not deployed" },
    { name: "AgentRegistry", address: process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ?? "Not deployed" },
    { name: "AgentGate", address: process.env.NEXT_PUBLIC_AGENT_GATE_ADDRESS ?? "Not deployed" },
  ];
  const integrations = [
    { name: "0G Compute", live: pulse.compute },
    { name: "0G Storage", live: pulse.storage },
    { name: "0G Chain", live: pulse.chain },
    { name: "AgentGate", live: pulse.gate },
  ];

  return (
    <>
      {/* ============ HERO ============ */}
      <section className="hero" id="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow rise">Attestation infrastructure · 0G Aristotle</span>
            <p className="identity-line rise">0G Agent Watch</p>
            <p className="identity-sub rise">live threat intelligence for the agent economy</p>
            <h1 className="rise">
              Every AI agent, <span className="accent">verified.</span> Behavioral audit, code scan, on-chain proof.
            </h1>
            <p className="hero-body rise">
              0G Sentinel monitors agent behavior, audits code via 0G Compute, and writes immutable
              ERC-7857 attestations to chain. AgentGate lets any protocol act on the result.
            </p>
            <div className="cta-row rise">
              <Link href="/agents" className="btn btn-primary">Open Dashboard →</Link>
              <Link href="/proof" className="btn btn-ghost">Integration Proof →</Link>
            </div>
          </div>
          <RadarHero />
        </div>
      </section>

      {/* ============ SCAN ============ */}
      <section className="scan-shell" id="scan">
        <div className="wrap pad">
          <div className="sec-head rise">
            <span className="eyebrow">Live audit stream</span>
            <h2>Scan any agent address.</h2>
            <p>
              Five stages land in sequence. Behavioral inference and an independent code audit run on
              0G Compute, evidence archives to 0G Storage, and the verdict settles on 0G Chain.
            </p>
          </div>
          <ScanInput defaultAddress={DEMO_AGENT} />
        </div>
      </section>

      {/* ============ RISK BOARD ============ */}
      <section className="pad" id="board">
        <div className="wrap">
          <div className="sec-head rise">
            <span className="eyebrow">Watchlist · riskiest first</span>
            <h2>The risk board.</h2>
            <p>
              A live status wall ranked by behavioral risk. Riskiest agents surface to the top,
              color-coded by verdict, every row a real attestation on 0G Aristotle.
            </p>
          </div>
          {topAgents.length > 0 ? (
            <AgentsTable agents={topAgents} hideControls />
          ) : (
            <div className="board"><div className="board-empty">No agents attested yet. Auto-scan is indexing the chain.</div></div>
          )}
          <div style={{ marginTop: 18 }}>
            <Link href="/agents" className="explorer-link" style={{ marginLeft: 0 }}>
              View full dashboard →
            </Link>
          </div>
        </div>
      </section>

      {/* ============ PROOF STRIP ============ */}
      <section className="pad" id="proof" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <div className="wrap">
          <div className="sec-head rise">
            <span className="eyebrow">On-chain proof</span>
            <h2>Every verdict is a real transaction.</h2>
          </div>
          <p className="proof-stat rise">
            Live on <b>0G Aristotle</b> · Chain ID <b>16661</b> · <b>3 contracts</b> deployed · <b>4 integrations</b> active
          </p>

          <div className="contracts">
            {contracts.map((c) => (
              <div key={c.name} className="contract clip-in">
                <span className="cname">{c.name}</span>
                <span className="caddr">{c.address}</span>
                {c.address !== "Not deployed" && (
                  <a className="clink" href={`https://chainscan.0g.ai/address/${c.address}`} target="_blank" rel="noopener noreferrer">
                    View ↗
                  </a>
                )}
              </div>
            ))}
          </div>

          <div className="integrations">
            {integrations.map((i) => (
              <div key={i.name} className="integ scale-in">
                <div className="in-name">{i.name}</div>
                <span className={`live-badge${i.live ? "" : " degraded"}`}>
                  <span className="d" />{i.live ? "Live" : "Degraded"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
