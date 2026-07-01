"use client";
// File: frontend/components/ChainDiscovery.tsx
//
// Async client component that discovers active contracts directly from the 0G
// Aristotle chain via eth_getLogs, then shows unscanned ones as scan targets.
// Runs entirely client-side so it never blocks the initial server render.
// Presented in the prototype `.board` shell.
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
  const [state, setState] = useState<ScanState>({ scanning: false, elapsed: 0, error: null });

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
      setState((s) => ({ ...s, scanning: false, error: "Scan failed. Network error." }));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
      {state.error && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--bad)", maxWidth: 130, textAlign: "right", lineHeight: 1.3 }}>
          {state.error}
        </span>
      )}
      <button className="rescan" disabled={state.scanning} onClick={handleScan}>
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
  const topLog = contracts[0]?.logCount || 1;

  return (
    <section className="pad" style={{ paddingTop: 40 }}>
      <div className="sec-head rise">
        <span className="eyebrow">Live on 0G Chain</span>
        <h2>Discovered from chain logs.</h2>
        <p>
          Active contracts pulled straight from chain events, not pre-registered.
          {latestBlock !== null && ` Block #${latestBlock.toLocaleString()} · last 10k blocks · sorted by activity.`}
          {" "}Scan any to attest.
        </p>
      </div>

      {!loading && !error && contracts.length > 0 && (
        <div className="board-filter">
          <input
            type="text"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(1); }}
            placeholder="Filter by address…"
            aria-label="Filter contracts by address"
          />
          {filter && <span className="count">{filtered.length} of {contracts.length}</span>}
        </div>
      )}

      {loading ? (
        <div className="board"><div className="board-empty">Indexing chain logs…</div></div>
      ) : error ? (
        <div className="board"><div className="board-empty" style={{ color: "var(--bad)" }}>{error}</div></div>
      ) : contracts.length === 0 ? (
        <div className="board"><div className="board-empty">All active contracts in this window have already been attested.</div></div>
      ) : (
        <>
          <div className="board">
            <table>
              <colgroup>
                <col className="col-agent" />
                <col className="col-score" />
                <col className="col-status" />
                <col className="col-attest" />
                <col className="col-act" />
              </colgroup>
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Activity</th>
                  <th>Status</th>
                  <th>Address</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.address}>
                    <td>
                      <div className="agent-cell">
                        <span className="nm">
                          <Link href={`/agents/${c.address}`}>{agentDisplayName(c.address)}</Link>
                        </span>
                        <span className="ad">{c.address.slice(0, 6)}…{c.address.slice(-4)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="score-wrap">
                        <span className="score-num">{c.logCount}</span>
                        <div className="score-track">
                          <div
                            className="score-fill"
                            style={{ width: `${Math.min(100, (c.logCount / topLog) * 100)}%`, background: "var(--tx-lo)" }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge b-none">NOT SCANNED</span>
                    </td>
                    <td className="attest-cell">
                      <a href={`https://chainscan.0g.ai/address/${c.address}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cy)" }}>
                        {c.address.slice(0, 8)}…{c.address.slice(-6)} ↗
                      </a>
                    </td>
                    <td className="col-act">
                      <ScanButton address={c.address} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="board-page">
              <button className="rescan" onClick={() => setPage((p) => p + 1)}>
                Show more ({filtered.length - visible.length} remaining)
              </button>
            </div>
          )}

          <div style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: "0.66rem", color: "var(--tx-dim)" }}>
            {filter ? `${filtered.length} matching · ` : ""}{contracts.length} unscanned contracts discovered · source: eth_getLogs · auto-scanning in background
          </div>
        </>
      )}
    </section>
  );
}
