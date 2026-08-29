import type { ApiErrorShape, CanonicalIdentity } from "@/lib/prooflock-types";
import { configuredDisplayText } from "@/lib/safe-display";
import { isCanonicalAgentId } from "@/lib/prooflock-validation";

type ResolutionStatus = "idle" | "resolving" | "resolved" | "error";
export type IdentityUiState = "EMPTY" | "INVALID" | "RESOLVING" | "MISSING" | "MISMATCH" | "VALID" | "ERROR";

export function identityInputState(value: string, status: ResolutionStatus, errorCode?: string): IdentityUiState {
  if (!value) return "EMPTY";
  if (!isCanonicalAgentId(value)) return "INVALID";
  if (status === "resolving") return "RESOLVING";
  if (status === "resolved") return "VALID";
  if (errorCode === "AGENT_NOT_FOUND") return "MISSING";
  if (errorCode === "IDENTITY_MISMATCH") return "MISMATCH";
  return status === "error" ? "ERROR" : "EMPTY";
}

export function IdentityResolver({ value, status, identity, error }: Readonly<{
  value: string; status: ResolutionStatus; identity: CanonicalIdentity | null; error?: ApiErrorShape;
}>) {
  const state = identityInputState(value, status, error?.code);
  if (state === "EMPTY") return <div className="identity-placeholder">Enter a canonical ERC-8004 Agent ID. An address alone is not an identity.</div>;
  if (state === "INVALID") return <div className="inline-state state-bad">Invalid Agent ID · use an unsigned decimal token ID.</div>;
  if (state === "RESOLVING") return <div className="identity-skeleton" aria-live="polite">Resolving finalized ERC-8004 state…</div>;
  if (!identity) return <div className="inline-state state-bad"><b>{state}</b> · <bdi>{configuredDisplayText(
    error?.message, "Identity resolution failed.", { maxGraphemes: 256 })}</bdi></div>;
  return <section className="evidence-card identity-card" aria-labelledby="identity-title">
    <div className="card-row"><div><span className="card-kicker">Canonical identity · finalized</span><h3 id="identity-title"><bdi dir="ltr">ERC-8004 Agent #{identity.identity.agentId}</bdi></h3></div>
      <span className="verified-stamp">Verified identity</span></div>
    <dl className="proof-list">
      <div><dt>Current agent wallet</dt><dd className="mono break"><bdi dir="ltr">{identity.agentWallet}</bdi></dd></div>
      <div><dt>Owner</dt><dd className="mono break"><bdi dir="ltr">{identity.owner}</bdi></dd></div>
      <div><dt>Registry</dt><dd className="mono break"><bdi dir="ltr">{identity.identity.registryAddress}</bdi></dd></div>
      <div><dt>Resolution block</dt><dd className="mono">#<bdi dir="ltr">{identity.sourceBlockNumber}</bdi></dd></div>
      <div><dt>Registration digest</dt><dd className="mono break"><bdi dir="ltr">{identity.registrationDigest}</bdi></dd></div>
    </dl>
  </section>;
}
