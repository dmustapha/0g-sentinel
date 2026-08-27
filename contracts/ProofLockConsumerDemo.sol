// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentGateV2 {
    function requireAgent(uint256 agentId) external view returns (address subject, uint64 version);
}

contract ProofLockConsumerDemo {
    IAgentGateV2 public immutable gate;
    uint256 public acceptedCount;
    address public lastAcceptedAgent;
    uint64 public lastAcceptedVersion;

    event AgentAccepted(uint256 indexed agentId, address indexed subject, uint64 indexed version);

    constructor(address gateAddress) {
        require(gateAddress != address(0), "Invalid gate");
        gate = IAgentGateV2(gateAddress);
    }

    function acceptAgent(uint256 agentId) external {
        (address subject, uint64 version) = gate.requireAgent(agentId);
        acceptedCount += 1;
        lastAcceptedAgent = subject;
        lastAcceptedVersion = version;
        emit AgentAccepted(agentId, subject, version);
    }
}
