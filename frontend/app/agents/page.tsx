"use client";
// File: frontend/app/agents/page.tsx
import { useEffect, useState } from "react";
import { AgentWithAttestation } from "@/lib/types";
import { AgentRow } from "@/components/AgentRow";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentWithAttestation[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);

  async function fetchAgents() {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setAgents(data.agents || []);
      setFetchError(false);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleRescan(address: string) {
    setScanning(address);
    setScanError(null);
    try {
      const res = await fetch("/api/scan/behavioral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentAddress: address }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setScanError(data.error || `Scan failed (HTTP ${res.status})`);
      } else {
        await fetchAgents();
      }
    } catch {
      setScanError("Scan request failed — check network connection");
    } finally {
      setScanning(null);
    }
  }

  useEffect(() => {
    fetchAgents();
  }, []);

  const flagged = agents.filter((a) => a.threat_level === 2 || a.code_risk === 2).length;
  const safe = agents.filter((a) => a.threat_level === 0 && a.code_risk === 0).length;
  const caution = agents.filter(
    (a) => (a.threat_level === 1 || a.code_risk === 1) && a.threat_level < 2 && a.code_risk < 2
  ).length;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", minHeight: "calc(100vh - 44px)" }}>

      {/* ── LEFT: Hero Panel ── */}
      <div style={{
        flex: "1 1 480px",
        padding: "clamp(2rem, 4vw, 3.5rem) clamp(1.5rem, 4vw, 3rem) 3rem clamp(1.5rem, 5vw, 4rem)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minWidth: 0,
        overflow: "hidden",
        position: "relative",
      }}>

        {/* Hero content */}
        <div>
          {/* Axis label */}
          <div className="sg-reveal-fade sg-delay-1" style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "2.75rem",
          }}>
            <div style={{ width: 32, height: 1, background: "rgba(0,212,255,0.3)" }} />
            <span className="sg-label" style={{ color: "rgba(0,212,255,0.6)" }}>
              0G ecosystem at risk
            </span>
          </div>

          {/* Massive display number */}
          <div className="sg-reveal-up sg-delay-1" style={{ marginBottom: "0.75rem" }}>
            <div className="sg-display sg-gradient-text" style={{
              fontSize: "clamp(4.5rem, 13vw, 9.5rem)",
              lineHeight: 0.85,
              letterSpacing: "-0.05em",
            }}>
              $88.88M
            </div>
          </div>

          {/* Sub-heading */}
          <div className="sg-reveal-up sg-delay-2" style={{ marginBottom: "2rem" }}>
            <div style={{
              fontFamily: "Space Grotesk, sans-serif",
              fontSize: "clamp(1.125rem, 2.5vw, 1.75rem)",
              color: "#334155",
              letterSpacing: "-0.02em",
              fontWeight: 500,
            }}>
              in ecosystem grants
            </div>
          </div>

          {/* Pull quote */}
          <div className="sg-reveal-fade sg-delay-3" style={{ maxWidth: 520, marginBottom: "3.5rem" }}>
            <div className="sg-pull-quote">
              Every AI agent operating blind — no behavioral audit, no code verification,
              no on-chain proof. 0G Sentinel brings attestation infrastructure to every
              agent on 0G Aristotle mainnet.
            </div>
          </div>

          {/* Metric strip */}
          <div className="sg-reveal-up sg-delay-4" style={{
            display: "flex",
            gap: "0",
            paddingTop: "2rem",
            borderTop: "1px solid #0f1c30",
          }}>
            <div style={{ flex: 1, paddingRight: "2rem" }}>
              <div className="sg-stat__number" style={{ color: "#e2e8f0" }}>
                {loading ? "—" : agents.length}
              </div>
              <div className="sg-stat__label" style={{ marginTop: 6 }}>Monitored</div>
            </div>
            <div style={{ width: 1, background: "#0f1c30", flexShrink: 0 }} />
            <div style={{ flex: 1, paddingLeft: "2rem", paddingRight: "2rem" }}>
              <div className="sg-stat__number" style={{ color: "#10b981" }}>
                {loading ? "—" : safe}
              </div>
              <div className="sg-stat__label" style={{ marginTop: 6 }}>Verified safe</div>
            </div>
            <div style={{ width: 1, background: "#0f1c30", flexShrink: 0 }} />
            <div style={{ flex: 1, paddingLeft: "2rem", paddingRight: "2rem" }}>
              <div className="sg-stat__number" style={{ color: "#f59e0b" }}>
                {loading ? "—" : caution}
              </div>
              <div className="sg-stat__label" style={{ marginTop: 6 }}>Caution</div>
            </div>
            <div style={{ width: 1, background: "#0f1c30", flexShrink: 0 }} />
            <div style={{ flex: 1, paddingLeft: "2rem" }}>
              <div className="sg-stat__number" style={{ color: "#ef4444" }}>
                {loading ? "—" : flagged}
              </div>
              <div className="sg-stat__label" style={{ marginTop: 6 }}>Threats</div>
            </div>
          </div>
        </div>

        {/* Bottom: chain info */}
        <div className="sg-reveal-fade sg-delay-5" style={{
          display: "flex",
          gap: "2rem",
          paddingTop: "1.5rem",
          borderTop: "1px solid #0f1c30",
          marginTop: "2rem",
        }}>
          <div className="sg-data-field" style={{ gridTemplateColumns: "auto 1fr", paddingBottom: 0, borderBottom: "none" }}>
            <span className="sg-data-label">Chain</span>
            <span className="sg-mono" style={{ color: "#00d4ff" }}>0G Aristotle Mainnet · 16661</span>
          </div>
          <div className="sg-data-field" style={{ gridTemplateColumns: "auto 1fr", paddingBottom: 0, borderBottom: "none" }}>
            <span className="sg-data-label">Explorer</span>
            <a
              href="https://chainscan.0g.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="sg-mono"
              style={{ color: "#334155", textDecoration: "none", transition: "color 0.2s" }}
              onMouseOver={(e) => (e.currentTarget.style.color = "#e2e8f0")}
              onMouseOut={(e) => (e.currentTarget.style.color = "#334155")}
            >
              chainscan.0g.ai ↗
            </a>
          </div>
        </div>
      </div>

      {/* ── DIVIDER ── */}
      <div className="sg-divider" />

      {/* ── RIGHT: Data Panel ── */}
      <div style={{
        flex: "1 1 360px",
        maxWidth: 420,
        display: "flex",
        flexDirection: "column",
        background: "rgba(8,1,14,0.92)",
        backdropFilter: "blur(8px)",
        overflow: "hidden",
        borderTop: "1px solid #0f1c30",
      }}>

        {/* Panel header */}
        <div style={{
          padding: "1rem 1.25rem",
          borderBottom: "1px solid #0f1c30",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <span className="sg-label">Registered Agents</span>
          <button
            onClick={fetchAgents}
            className="sg-btn-ghost"
            style={{ padding: "0.25rem 0.625rem", fontSize: "0.625rem" }}
          >
            Refresh
          </button>
        </div>

        {/* Scan error banner */}
        {scanError && (
          <div style={{
            padding: "0.625rem 1.25rem",
            background: "rgba(239,68,68,0.08)",
            borderBottom: "1px solid rgba(239,68,68,0.2)",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "0.6875rem",
            color: "#ef4444",
          }}>
            {scanError}
          </div>
        )}

        {/* Agent list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{
              padding: "3rem 1.25rem",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "0.75rem",
              color: "#334155",
              textAlign: "center",
            }}>
              Loading from 0G Chain...
            </div>
          ) : fetchError ? (
            <div style={{
              padding: "3rem 1.25rem",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "0.75rem",
              color: "#ef4444",
              textAlign: "center",
            }}>
              Failed to load agents — check RPC connection
            </div>
          ) : agents.length === 0 ? (
            <div style={{
              padding: "3rem 1.25rem",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "0.75rem",
              color: "#334155",
              textAlign: "center",
            }}>
              No agents registered
            </div>
          ) : (
            agents.map((agent) => (
              <AgentRow
                key={agent.address}
                agent={agent}
                scanning={scanning === agent.address}
                onRescan={scanning ? undefined : handleRescan}
              />
            ))
          )}
        </div>

        {/* Panel footer: scan CTA */}
        <div style={{
          padding: "1.25rem",
          borderTop: "1px solid #0f1c30",
          background: "rgba(5,8,16,0.8)",
        }}>
          <div className="sg-label" style={{ marginBottom: "0.5rem" }}>
            Run Security Scan
          </div>
          <p style={{
            fontFamily: "Inter, sans-serif",
            fontSize: "0.75rem",
            color: "#334155",
            marginBottom: "0.875rem",
            lineHeight: 1.5,
          }}>
            Behavioral analysis + code audit via 0G Compute. Receipt hash stored on-chain.
          </p>
          <a href="/proof" className="sg-btn-primary" style={{ width: "100%", textDecoration: "none" }}>
            View Integration Proof →
          </a>
        </div>
      </div>
    </div>
  );
}
