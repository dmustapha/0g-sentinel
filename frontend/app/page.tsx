// File: frontend/app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <div className="sg-landing">

      {/* Hero */}
      <div className="sg-hero-left sg-reveal-up">
        <div className="sg-hero-kicker">Attestation infrastructure · 0G Aristotle</div>
        <h1 className="sg-hero-headline">
          Every AI agent, <em>verified</em> — behavioral audit, code scan, on-chain proof.
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
            <div className="sg-feat-desc">LLM-powered risk scoring per agent — every action pattern scored and hashed on-chain.</div>
          </div>
          <div className="sg-feat-cell">
            <div className="sg-feat-num">[02]</div>
            <div className="sg-feat-name">Code Audit</div>
            <div className="sg-feat-desc">Vulnerability detection via 0G Compute — two independent inference pipelines, verifiable receipts.</div>
          </div>
          <div className="sg-feat-cell">
            <div className="sg-feat-num">[03]</div>
            <div className="sg-feat-name">On-Chain Attestation</div>
            <div className="sg-feat-desc">ERC-7857 structs — all 8 fields immutable on 0G Chain, verifiable by any smart contract.</div>
          </div>
          <div className="sg-feat-cell">
            <div className="sg-feat-num">[04]</div>
            <div className="sg-feat-name">AgentGate</div>
            <div className="sg-feat-desc">
              Any protocol can gate execution on{" "}
              <code style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", color: "#00d4ff", fontSize: "0.75rem" }}>
                isSafe()
              </code>{" "}
              — no centralized oracle required.
            </div>
          </div>
        </div>
      </div>

      {/* Pull quote */}
      <div className="sg-pullquote-section sg-reveal-fade sg-delay-2">
        <div className="sg-pq-line" />
        <blockquote className="sg-pq-text">
          &ldquo;Every AI agent operating <em>blind</em> — no behavioral audit, no code verification, no on-chain proof.
          0G Sentinel brings attestation infrastructure to every agent on 0G Aristotle mainnet.&rdquo;
        </blockquote>
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
