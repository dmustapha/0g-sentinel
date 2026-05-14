// File: contracts/AgentGate.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAttestationRegistry {
    struct Attestation {
        uint8 behavioral_score;
        uint8 threat_level;
        uint8 code_risk;
        string code_findings;
        bytes32 behavioral_receipt_hash;
        bytes32 code_receipt_hash;
        bytes32 evidence_hash;
        uint256 attestation_timestamp;
    }
    function getAttestation(address agentAddress) external view returns (Attestation memory);
    function hasAttestation(address agentAddress) external view returns (bool);
}

/**
 * @title AgentGate
 * @dev Composability demo: reads 0G Sentinel attestation and gates agent execution.
 * Any DeFi protocol integrates this to ensure only safe agents are trusted.
 * AgentGate.sol enforces risk-management gating for DeFi agents — a composable trust rail for any trading protocol on 0G.
 */
contract AgentGate {
    IAttestationRegistry public immutable registry;

    // Max allowed: threat_level <= 1 (SAFE or CAUTION), code_risk <= 1 (CLEAN or WARNING)
    uint8 public constant MAX_THREAT_LEVEL = 1;
    uint8 public constant MAX_CODE_RISK = 1;

    event AgentBlocked(address indexed agentAddress, string reason);
    event AgentAllowed(address indexed agentAddress);

    constructor(address registryAddress) {
        registry = IAttestationRegistry(registryAddress);
    }

    function isSafe(address agentAddress)
        public
        view
        returns (bool safe, string memory reason)
    {
        if (!registry.hasAttestation(agentAddress)) {
            return (false, "Agent has no attestation from 0G Sentinel");
        }

        IAttestationRegistry.Attestation memory att = registry.getAttestation(agentAddress);

        if (att.threat_level > MAX_THREAT_LEVEL) {
            return (false, "Agent behavioral risk: FLAGGED");
        }
        if (att.code_risk > MAX_CODE_RISK) {
            return (false, "Agent code_risk: VULNERABLE");
        }

        return (true, "");
    }

    /**
     * @dev Execute a call to target on behalf of a verified-safe agent.
     * Reverts if agent fails safety check. For demo: passes target call through.
     */
    function executeIfSafe(
        address agentAddress,
        address target,
        bytes calldata data
    ) external returns (bytes memory) {
        (bool safe, string memory reason) = isSafe(agentAddress);
        if (!safe) {
            emit AgentBlocked(agentAddress, reason);
            revert(reason);
        }

        emit AgentAllowed(agentAddress);
        (bool success, bytes memory returnData) = target.call(data);
        require(success, "Agent execution failed");
        return returnData;
    }
}
