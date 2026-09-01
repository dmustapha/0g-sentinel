// Layout-matching skeleton loaders. Shimmer + reduced-motion handling live in motion.css; these are
// pure geometry that mirror the real content so there is no layout jump when data arrives.
// aria-hidden + role="status" wrappers keep them silent structurally while the live region announces.

function Bar({ className = "" }: Readonly<{ className?: string }>) {
  return <span className={`skeleton skeleton-line ${className}`} aria-hidden="true" />;
}

// Agent detail: mirrors the trust summary + "what we found" facts + evidence dossier.
export function AgentDetailSkeleton() {
  return (
    <section className="workspace-section detail-page">
      <div className="wrap" role="status" aria-label="Loading ProofLock detail">
        <span className="sr-only">Resolving identity, lease, evidence, and Gate with pinned current access.</span>
        <div className="skeleton-card skeleton-block" aria-hidden="true">
          <Bar className="w-40" /><Bar className="w-80" /><Bar className="w-60" />
        </div>
        <div className="skeleton-card skeleton-block" aria-hidden="true" style={{ animationDelay: "60ms" }}>
          <Bar className="w-40" />
          <div className="skeleton-facts">
            <span className="skeleton skeleton-fact" /><span className="skeleton skeleton-fact" />
            <span className="skeleton skeleton-fact" /><span className="skeleton skeleton-fact" />
          </div>
          <Bar className="w-80" /><Bar className="w-60" />
        </div>
      </div>
    </section>
  );
}

// Leaderboard: mirrors the sealed-agents table rows.
export function LeaderboardSkeleton({ rows = 5 }: Readonly<{ rows?: number }>) {
  return (
    <div className="leaderboard-shell skeleton-block" role="status" aria-label="Reading sealed ProofLocks">
      <span className="sr-only">Reading RegistryV2 and verified identity detail.</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index} aria-hidden="true">
          <span className="skeleton" /><span className="skeleton skeleton-line w-80" />
          <span className="skeleton skeleton-line w-60" /><span className="skeleton" /><span className="skeleton" />
        </div>
      ))}
    </div>
  );
}

// Verify subsystem health grid: mirrors the dependency cells.
export function HealthGridSkeleton({ cells = 5 }: Readonly<{ cells?: number }>) {
  return (
    <div className="skeleton-cells skeleton-block" role="status" aria-label="Probing subsystem health">
      <span className="sr-only">Observing ERC-8004, 0G Compute, 0G Storage, RegistryV2, and AgentGateV2.</span>
      {Array.from({ length: cells }, (_, index) => (
        <span className="skeleton skeleton-cell" key={index} aria-hidden="true" />
      ))}
    </div>
  );
}
