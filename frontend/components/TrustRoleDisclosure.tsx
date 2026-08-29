import { configuredDisplayText } from "@/lib/safe-display";

export function TrustRoleDisclosure({ admin, guardian, validator, custodyConstraint }: Readonly<{
  admin?: string; guardian?: string; validator?: string; custodyConstraint?: string;
}>) {
  const configured = [admin, guardian, validator].every(isAddress);
  const distinct = configured && new Set([admin!.toLowerCase(), guardian!.toLowerCase(), validator!.toLowerCase()]).size === 3;
  return <aside className={`trust-disclosure ${distinct ? "state-warn" : "state-bad"}`}><h2>Named trust roles</h2>
    <dl className="proof-list"><Role name="Admin" address={admin} note="Owns deployment administration." />
      <Role name="Guardian" address={guardian} note="May mark on-demand drift lifecycle state." />
      <Role name="Validator" address={validator} note="Is authorized to issue ProofLock leases." /></dl>
    <p>{distinct ? "Deployment enforces three distinct addresses." : "Role handoff is missing or violates the three-distinct-address constraint."} <code><bdi>{configuredDisplayText(
      custodyConstraint, "custody constraint not configured", { maxGraphemes: 160 })}</bdi></code>. Drift detection is on-demand, not continuous.</p></aside>;
}

function Role({ name, address, note }: { name: string; address?: string; note: string }) {
  const configuredAddress = isAddress(address) ? address : undefined;
  return <div><dt>{name}</dt><dd><code className="break"><bdi dir="ltr">{configuredAddress ?? "not configured"}</bdi></code><small>{note}</small></dd></div>;
}
function isAddress(value?: string): value is string { return Boolean(value && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value)); }
