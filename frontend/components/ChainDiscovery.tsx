"use client";
// File: frontend/components/ChainDiscovery.tsx
//
// Async client component that discovers active contracts directly from the 0G
// Aristotle chain via eth_getLogs, then shows unscanned ones as scan targets.
// Runs entirely client-side so it never blocks the initial server render.
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { agentDisplayName } from "@/lib/constants";

const PAGE_SIZE = 20;

interface Discovered {
  address: string;
  logCount: number;
}

interface ScanState {
  scanning: boolean;
  elapsed: number;
  error: string | null;
}

function ScanButton({ address }: { address: string }) {
  const router = useRouter();
  const [state, setState] = useState<ScanState>({
    scanning: false,
    elapsed: 0,
    error: null,
  });

  useEffect(() => {
    if (!state.scanning) return;
    const t = setInterval(() => setState((s) => ({ ...s, elapsed: s.elapsed + 1 })), 1000);
    return () => clearInterval(t);
  }, [state.scanning]);

  async function handleScan() {
    setState({ scanning: true, elapsed: 0, error: null });
    try {
      const res = await fetch("/api/scan/behavioral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentAddress: address }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState((s) => ({ ...s, scanning: false, error: data.error || `Scan failed (${res.status})` }));
      } else {
        router.push(`/agents/${address}`);
      }
    } catch {
      setState((s) => ({ ...s, scanning: false, error: "Scan failed — network error" }));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
      {state.error && (
        <div style={{ fontFamily: "var(--font-jetbrains-mono,monospace)", fontSize: "0.5625rem", color: "#ef4444", maxWidth: 130, textAlign: "right", lineHeight: 1.3 }}>
          {state.error}
        </div>
      )}
      <button
        className="sg-btn-refresh"
        disabled={state.scanning}
        onClick={handleScan}
        style={{ fontSize: "0.625rem", padding: "0.25rem 0.625rem" }}
      >
        {state.scanning ? `Scanning… ${state.elapsed}s` : "Scan"}
      </button>
    </div>
  );
}

export function ChainDiscovery({ attestedAddresses }: { attestedAddresses: string[] }) {
  const [contracts, setContracts] = useState<Discovered[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [latestBlock, setLatestBlock] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const attestedSet = new Set(attestedAddresses.map((a) => a.toLowerCase()));

    fetch("/api/discover")
      .then((r) => r.json())
      .then((data) => {
        const unscanned: Discovered[] = (data.contracts || []).filter(
          (c: Discovered) => !attestedSet.has(c.address.toLowerCase())
        );
        setContracts(unscanned);
        setLatestBlock(data.latestBlock ?? null);
        setLoading(false);
      })
      .catch(() => {
        setError("Chain discovery unavailable");
        setLoading(false);
      });
  }, [attestedAddresses]);

  const filtered = filter
    ? contracts.filter((c) => c.address.toLowerCase().includes(filter.toLowerCase()))
    : contracts;
  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  return (
    <div style={{ marginTop: "2.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1rem" }}>
        <h2 className="sg-dash-title" style={{ fontSize: "0.9375rem", margin: 0 }}>
          Live on 0G Chain
        </h2>
        {latestBlock !== null && (
          <span style={{ fontFamily: "var(--font-jetbrains-mono,monospace)", fontSize: "0.5625rem", color: "#475569" }}>
            block #{latestBlock.toLocaleString()} · last 10k blocks · sorted by activity
          </span>
        )}
      </div>
      <div className="sg-dash-subtitle" style={{ marginBottom: "1.25rem" }}>
        Active contracts discovered from chain logs — not pre-registered. Scan any to attest.
      </div>

      {/* Filter input */}
      {!loading && !error && contracts.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(1); }}
            placeholder="Filter by address…"
            style={{
              fontFamily: "var(--font-jetbrains-mono, monospace)",
              fontSize: "0.75rem",
              color: "#c8d3e8",
              background: "rgba(0,212,255,0.03)",
              border: "1px solid rgba(0,212,255,0.12)",
              borderRadius: 2,
              padding: "0.375rem 0.75rem",
              outline: "none",
              width: "100%",
              maxWidth: 340,
            }}
          />
          {filter && (
            <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "0.625rem", color: "#475569", marginLeft: "0.75rem" }}>
              {filtered.length} of {contracts.length}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ fontFamily: "var(--font-jetbrains-mono,monospace)", fontSize: "0.75rem", color: "#475569", padding: "2rem 0" }}>
          Indexing chain logs…
        </div>
      ) : error ? (
        <div style={{ fontFamily: "var(--font-jetbrains-mono,monospace)", fontSize: "0.75rem", color: "#ef4444", padding: "2rem 0" }}>
          {error}
        </div>
      ) : contracts.length === 0 ? (
        <div style={{ fontFamily: "var(--font-jetbrains-mono,monospace)", fontSize: "0.75rem", color: "#334155", padding: "2rem 0" }}>
          All active contracts in this window have already been attested.
        </div>
      ) : (
        <>
          <table className="sg-agent-table">
            <thead>
              <tr>
                <th>CONTRACT</th>
                <th>ADDRESS</th>
                <th className="sg-score-cell" title="Number of on-chain events emitted — higher means more active">ACTIVITY</th>
                <th>STATUS</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => (
                <tr key={c.address} className="sg-agent-tr" style={{ animationDelay: `${i * 30}ms` }}>
                  <td>
                    <Link href={`/agents/${c.address}`} style={{ textDecoration: "none" }}>
                      <div className="sg-tbl-agent-name" style={{ cursor: "pointer" }}>{agentDisplayName(c.address)}</div>
                    </Link>
                  </td>
                  <td>
                    <a
                      href={`https://chainscan.0g.ai/address/${c.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sg-tbl-agent-addr"
                      style={{ color: "#00d4ff", textDecoration: "none" }}
                    >
                      {c.address.slice(0, 8)}…{c.address.slice(-6)}
                    </a>
                  </td>
                  <td className="sg-score-cell">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span style={{ fontFamily: "var(--font-jetbrains-mono,monospace)", fontSize: "0.75rem", color: "#94a3b8", minWidth: "2.5rem", textAlign: "right" }}>
                        {c.logCount}
                      </span>
                      <div className="sg-tbl-score-track" style={{ width: 60 }}>
                        <div
                          className="sg-tbl-score-fill"
                          style={{
                            width: `${Math.min(100, (c.logCount / (contracts[0]?.logCount || 1)) * 100)}%`,
                            background: "#334155",
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="sg-tbl-badge sg-tbl-badge-neutral">NOT SCANNED</span>
                  </td>
                  <td>
                    <ScanButton address={c.address} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasMore && (
            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <button
                className="sg-btn-refresh"
                onClick={() => setPage((p) => p + 1)}
                style={{ fontSize: "0.625rem", padding: "0.375rem 1rem" }}
              >
                Show more ({filtered.length - visible.length} remaining)
              </button>
            </div>
          )}

          <div style={{ marginTop: "0.75rem", fontFamily: "var(--font-jetbrains-mono,monospace)", fontSize: "0.5625rem", color: "#334155" }}>
            {filter ? `${filtered.length} matching · ` : ""}{contracts.length} unscanned contracts discovered · source: eth_getLogs · auto-scanning in background
          </div>
        </>
      )}
    </div>
  );
}
