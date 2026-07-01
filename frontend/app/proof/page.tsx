// File: frontend/app/proof/page.tsx
import { checkSystemPulse } from "@/lib/pulse";

export const revalidate = 60;

export default async function ProofPage() {
  const attestationAddr = process.env.NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS ?? "Not deployed";
  const agentRegistryAddr = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ?? "Not deployed";
  const gateAddr = process.env.NEXT_PUBLIC_AGENT_GATE_ADDRESS ?? "Not deployed";
  const explorerBase = "https://chainscan.0g.ai/address";

  const pulse = await checkSystemPulse();

  const contracts = [
    { name: "AttestationRegistry", address: attestationAddr },
    { name: "AgentRegistry", address: agentRegistryAddr },
    { name: "AgentGate", address: gateAddr },
  ];

  const integrations = [
    {
      name: "0G Compute",
      live: pulse.compute,
      detail: "Behavioral analysis and code vulnerability scan run as two independent, verifiable inferences on 0G Compute (TEE-attested, on-chain-settled via the broker). Each returns a receipt hash stored on-chain.",
    },
    {
      name: "0G Storage",
      live: pulse.storage,
      detail: "Evidence JSON archived to 0G distributed storage. The content-addressed root hash is stored in attestation.evidence_hash, permanently retrievable from the 0G storage network.",
    },
    {
      name: "0G Chain",
      live: pulse.chain,
      detail: "ERC-7857 attestations written to AttestationRegistry on 0G Aristotle (chain ID 16661). All 9 fields on-chain, immutable, verifiable.",
    },
    {
      name: "AgentGate",
      live: pulse.gate,
      detail: "Composability primitive: any protocol can require attestation before execution. isSafe() and isSafeWithAge() read directly from AttestationRegistry.",
    },
  ];

  return (
    <section className="pad" id="proof">
      <div className="wrap">
        <div className="sec-head rise">
          <span className="eyebrow">On-chain proof</span>
          <h2>Every verdict is a real transaction.</h2>
          <p>
            No off-chain attestations to forge. Every verdict is written to 0G Aristotle, immutable and
            verifiable by any smart contract, and composable through AgentGate, with no centralized oracle.
          </p>
        </div>

        <p className="proof-stat rise">
          Live on <b>0G Aristotle</b> · Chain ID <b>16661</b> · <b>3 contracts</b> deployed · <b>4 integrations</b> active
        </p>

        <div className="contracts">
          {contracts.map((c) => (
            <div key={c.name} className="contract clip-in">
              <span className="cname">{c.name}</span>
              <span className="caddr">{c.address}</span>
              {c.address !== "Not deployed" ? (
                <a className="clink" href={`${explorerBase}/${c.address}`} target="_blank" rel="noopener noreferrer">
                  View ↗
                </a>
              ) : (
                <span className="clink" style={{ color: "var(--tx-dim)" }}>n/a</span>
              )}
            </div>
          ))}
        </div>

        <div className="integrations">
          {integrations.map((i) => (
            <div key={i.name} className="integ scale-in" style={{ textAlign: "left" }}>
              <div className="in-name">{i.name}</div>
              <span className={`live-badge${i.live ? "" : " degraded"}`}>
                <span className="d" />{i.live ? "Live" : "Degraded"}
              </span>
              <div className="in-detail">{i.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
