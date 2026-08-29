import Link from "next/link";
import { canonicalProofHref } from "@/lib/prooflock-routes";
import { isCanonicalAgentId, parseNonZeroBytes32 } from "@/lib/prooflock-validation";

type FeaturedProofConfig = Readonly<{
  proofId?: string;
  identityKey?: string;
  sourceTxHash?: string;
  agentId?: string;
  verifiedAt?: string;
}>;

type FeaturedProofLinkProps = Readonly<{
  config?: FeaturedProofConfig;
}>;

export function FeaturedProofLink({ config = serverConfig() }: FeaturedProofLinkProps) {
  const featured = featuredProof(config);
  return featured
    ? <div className="trust-copy"><Link href={featured.href} className="button primary">
        Open featured real ProofLock
      </Link><span className="fnet">Canonical Agent #{featured.agentId} · verified <time
        dateTime={featured.verifiedAt}>{featured.verifiedAt}</time></span></div>
    : <Link href="/agents" className="button primary">Browse recent ProofLocks</Link>;
}

function featuredProof(config: FeaturedProofConfig) {
  const proofId = parseNonZeroBytes32(config.proofId ?? "");
  const identityKey = parseNonZeroBytes32(config.identityKey ?? "");
  const sourceTxHash = parseNonZeroBytes32(config.sourceTxHash ?? "");
  const agentId = isCanonicalAgentId(config.agentId ?? "") ? config.agentId! : null;
  const verifiedAt = canonicalTimestamp(config.verifiedAt ?? "");
  return proofId && identityKey && sourceTxHash && agentId && verifiedAt ? {
    href: canonicalProofHref(proofId, identityKey, sourceTxHash), agentId, verifiedAt,
  } : null;
}

function serverConfig(): FeaturedProofConfig {
  return {
    proofId: process.env.PROOFLOCK_FEATURED_PROOF_ID,
    identityKey: process.env.PROOFLOCK_FEATURED_IDENTITY_KEY,
    sourceTxHash: process.env.PROOFLOCK_FEATURED_SOURCE_TX_HASH,
    agentId: process.env.PROOFLOCK_FEATURED_AGENT_ID,
    verifiedAt: process.env.PROOFLOCK_FEATURED_VERIFIED_AT,
  };
}

function canonicalTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.valueOf()) && timestamp.toISOString() === value ? value : null;
}
