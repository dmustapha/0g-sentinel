// static-analysis.test.ts
// C3: deterministic Solidity static-analysis spine. These tests pin the fixed-rule
// ground truth that makes the code audit more than "an LLM reading Solidity twice".
// Pure function, no network, no API — runs on the Hardhat network with zero live calls.

import { expect } from "chai";
import { analyzeSolidity } from "../../frontend/scanner/static-analysis";

const CLEAN = `contract AgentAlpha {
  address public immutable owner;
  uint256 public taskCount;
  modifier onlyOwner(){ require(msg.sender==owner,"no"); _; }
  function recordTask(bytes32 d) external onlyOwner returns(uint256 t){ t=++taskCount; }
}`;

const REENTRANT = `contract AgentBeta {
  mapping(address=>uint256) public balances;
  function deposit() external payable { balances[msg.sender]+=msg.value; }
  function withdraw() external {
    uint256 amount = balances[msg.sender];
    (bool ok,) = msg.sender.call{value: amount}("");
    require(ok);
    balances[msg.sender] = 0;
  }
}`;

const OWNER_GATED_CALL = `contract AgentGamma is Ownable {
  constructor() Ownable(msg.sender){}
  function execute(address target, bytes calldata data) external onlyOwner returns(bytes memory){
    (bool ok, bytes memory result)=target.call(data); require(ok,"fail"); return result;
  }
}`;

describe("C3: deterministic static analysis", () => {
  it("clean owner-gated contract → risk 0, no findings", () => {
    const r = analyzeSolidity(CLEAN);
    expect(r.risk).to.equal(0);
    expect(r.findings).to.have.length(0);
  });

  it("detects reentrancy (state write after external value call) → VULNERABLE", () => {
    const r = analyzeSolidity(REENTRANT);
    expect(r.risk).to.equal(2);
    const f = r.findings.find((x) => x.id === "reentrancy");
    expect(f, "reentrancy finding present").to.exist;
    expect(f!.functionName).to.equal("withdraw");
  });

  it("owner-gated call to a dynamic target → WARNING (1), not VULNERABLE", () => {
    const r = analyzeSolidity(OWNER_GATED_CALL);
    expect(r.risk).to.equal(1);
    expect(r.findings.some((x) => x.id === "arbitrary-external-call")).to.equal(true);
  });

  it("unprotected selfdestruct → VULNERABLE", () => {
    const r = analyzeSolidity(`contract E { function kill() public { selfdestruct(payable(msg.sender)); } }`);
    expect(r.risk).to.equal(2);
    expect(r.findings[0].id).to.equal("unprotected-selfdestruct");
  });

  it("tx.origin authorization → flagged", () => {
    const r = analyzeSolidity(`contract E { function a() public { require(tx.origin == owner); } }`);
    expect(r.findings.some((x) => x.id === "tx-origin-auth")).to.equal(true);
  });

  it("reports every rule as run, so a clean result is provable coverage", () => {
    const r = analyzeSolidity(CLEAN);
    expect(r.checksRun).to.include.members([
      "reentrancy",
      "unprotected-selfdestruct",
      "tx-origin-auth",
      "arbitrary-external-call",
      "unchecked-low-level-call",
    ]);
  });

  it("is deterministic: identical input yields identical output", () => {
    expect(JSON.stringify(analyzeSolidity(REENTRANT))).to.equal(JSON.stringify(analyzeSolidity(REENTRANT)));
  });
});
