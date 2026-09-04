import type { Metadata } from "next";
import { DataRow } from "@/components/ui/DataRow";
import { gateReasonMeta } from "@/lib/prooflock-status";
import { explorerAddressUrl } from "@/lib/explorer-url";

export const metadata: Metadata = {
  title: "0G Sentinel — Developers",
  description:
    "Gate any 0G contract on a provable admission verdict. ProofLock issues a versioned, revocable verdict on-chain that any contract reads at its own door in one line.",
};

const EXPLORER_BASE = process.env.NEXT_PUBLIC_ZERO_G_EXPLORER ?? "https://chainscan.0g.ai";

const REQUIRE_SNIPPET = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentGateV2 {
    // reverts AgentRejected(reason) if the agent is not currently admitted
    function requireAgent(uint256 agentId)
        external view returns (address subject, uint64 version);
}

contract MyProtocol {
    IAgentGateV2 public immutable gate;

    constructor(address gateAddress) {
        gate = IAgentGateV2(gateAddress); // AgentGateV2 on 0G mainnet
    }

    function doSomethingForAgent(uint256 agentId) external {
        // one line: admits or reverts
        (address subject, uint64 version) = gate.requireAgent(agentId);
        require(msg.sender == subject, "caller is not the bound agent wallet");
        // ... your logic runs only for a currently-admitted agent
    }
}`;

const CHECK_SNIPPET = `// Non-reverting variant: branch on the reason code instead of reverting.
interface IAgentGateV2Check {
    function checkAgent(uint256 agentId)
        external view
        returns (bool allowed, uint8 reason, address subject, uint64 version);
}`;

const CONTRACTS = [
  { label: "AgentGateV2 · the gate you call", address: "0x32Ae81B1150AA7E91d8341E59b3810950e7A1171" },
  { label: "ProofLockConsumerDemo · live integrator", address: "0x71823afFA086f6a4Be64B67142480Fa889Cd0773" },
  { label: "SentinelRegistryV2 · where verdicts are sealed", address: "0x1d802114cfAFFd179f49E2F6fa8e11207c118944" },
  { label: "ERC-8004 Identity Registry · canonical", address: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" },
] as const;

const REASON_CODES = Array.from({ length: 17 }, (_, reason) => {
  const meta = gateReasonMeta(reason);
  return { reason, code: meta.code, label: meta.label } as const;
});

const CAPABILITIES = [
  {
    title: "TEE-attested inference, verified on-chain",
    body: "Risk inference runs on 0G Compute inside a hardware TEE (Intel TDX / dstack). The paid inference settles on-chain, and the verdict is bound to the exact response bytes and checked against the enclave's EIP-191 signature before it is sealed.",
  },
  {
    title: "Deep identity + code analysis",
    body: "Every agent is classified as an EOA, an EIP-7702 delegated EOA, or a contract with EIP-1967/1167 proxy unwrapping. Contract bytecode is disassembled opcode-by-opcode to flag selfdestruct, delegatecall, mint, pause, and blacklist patterns.",
  },
  {
    title: "Live threat intelligence",
    body: "Sanctions and scam screening runs live against ScamSniffer, alongside an OFAC sanctions set.",
  },
] as const;

export default function DevelopersPage() {
  return <section className="workspace-section developers-page"><div className="wrap">
    <div className="page-heading">
      <span className="eyebrow">For developers · 0G Aristotle · Chain ID 16661</span>
      <h1>Gate your contract on a provable verdict.</h1>
      <p>ProofLock issues a versioned, revocable admission verdict on-chain. Any contract reads it
        at its own door in one line.</p>
    </div>

    <section className="dev-block" aria-labelledby="dev-integration-title">
      <div className="section-heading"><span className="eyebrow">One-line integration</span>
        <h2 id="dev-integration-title">Import the interface. Call it at your door.</h2>
        <p><code>AgentGateV2</code> is the whole integration surface. <code>requireAgent</code> is a
          pure view function: it admits or reverts, costs no gas beyond your own call, and cannot
          alter state.</p></div>
      <div className="evidence-card bp-bracket">
        <span className="bp-corners" aria-hidden="true" />
        <span className="card-kicker">Solidity · requireAgent</span>
        <pre className="dev-code"><code>{REQUIRE_SNIPPET}</code></pre>
        <p className="dev-code-note">Prefer a non-reverting branch? Call <code>checkAgent</code>
          instead and read the stable reason code.</p>
        <pre className="dev-code"><code>{CHECK_SNIPPET}</code></pre>
      </div>
    </section>

    <section className="dev-block" aria-labelledby="dev-contracts-title">
      <div className="section-heading"><span className="eyebrow">Live contracts</span>
        <h2 id="dev-contracts-title">Deployed on 0G mainnet.</h2>
        <p>Every address is live and readable on the public explorer. A live demo consumer,
          <code> ProofLockConsumerDemo</code>, already gates on the verdict on mainnet.</p></div>
      <div className="evidence-card bp-bracket">
        <span className="bp-corners" aria-hidden="true" />
        <span className="card-kicker">0G Aristotle · Chain ID 16661</span>
        <dl className="micro-grid">
          {CONTRACTS.map((contract) => <DataRow key={contract.address} label={contract.label}
            value={contract.address} href={explorerAddressUrl(EXPLORER_BASE, contract.address) ?? undefined}
            external copyable />)}
        </dl>
      </div>
    </section>

    <section className="dev-block" aria-labelledby="dev-reasons-title">
      <div className="section-heading"><span className="eyebrow">Reason codes</span>
        <h2 id="dev-reasons-title">Every rejection has a name.</h2>
        <p><code>checkAgent</code> returns a stable reason code. 0 is admitted; every non-zero value
          names the exact rejection.</p></div>
      <div className="evidence-card bp-bracket">
        <span className="bp-corners" aria-hidden="true" />
        <span className="card-kicker">AgentGateV2 · uint8 reason</span>
        <table className="dev-reason-table">
          <caption className="sr-only">Gate reason codes returned by checkAgent</caption>
          <thead><tr>
            <th scope="col">Code</th><th scope="col">Name</th><th scope="col">Meaning</th>
          </tr></thead>
          <tbody>
            {REASON_CODES.map((row) => <tr key={row.reason} data-admitted={row.reason === 0}>
              <td className="dev-reason-num">{row.reason}</td>
              <td className="mono">{row.code}</td>
              <td>{row.label}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="dev-block" aria-labelledby="dev-engines-title">
      <div className="section-heading"><span className="eyebrow">Under the verdict</span>
        <h2 id="dev-engines-title">What the seal is backed by.</h2>
        <p>Three engines run before any verdict is sealed. Each is honest about its limits.</p></div>
      <ul className="dev-capabilities">
        {CAPABILITIES.map((capability) => <li key={capability.title}
          className="dev-capability evidence-card bp-bracket">
          <span className="bp-corners" aria-hidden="true" />
          <h3>{capability.title}</h3>
          <p>{capability.body}</p>
        </li>)}
      </ul>
    </section>
  </div></section>;
}
