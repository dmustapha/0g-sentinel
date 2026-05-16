// File: contracts/AgentGate.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAttestationRegistry {
    struct Attestation {
        uint8 behavioral_score;
        uint8 threat_level;
        uint8 code_risk;
        string code_findings;
        string reasoning;
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
 * @dev Composability primitive — reads 0G Sentinel attestations and gates agent execution.
 *      Any DeFi protocol integrates this to ensure only attested-safe agents are trusted.
 *
 *      Note: executeIfSafe() forwards arbitrary calls for this demo. Production use should
 *      add a function-selector whitelist to prevent abuse of the forwarding mechanism.
 *      MAX_THREAT_LEVEL and MAX_CODE_RISK are currently protocol-wide constants; production
 *      integrators may want per-deployment configurability via constructor parameters.
 */
contract AgentGate {
    string public constant VERSION = "1.0.0";

    IAttestationRegistry public immutable registry;

    // Max allowed: threat_level <= 1 (SAFE or CAUTION), code_risk <= 1 (CLEAN or WARNING)
    uint8 public constant MAX_THREAT_LEVEL = 1;
    uint8 public constant MAX_CODE_RISK = 1;

    event AgentBlocked(address indexed agentAddress, string reason);
    event AgentAllowed(address indexed agentAddress);
    event SentinelChecked(address indexed agent, bool safe, uint256 score, uint256 timestamp);

    constructor(address registryAddress) {
        registry = IAttestationRegistry(registryAddress);
    }

    /// @notice Check if an agent passes the safety threshold.
    function isSafe(address agentAddress)
        public
        returns (bool safe, string memory reason)
    {
        return isSafeWithAge(agentAddress, 0);
    }

    /// @notice Check safety with an attestation freshness requirement.
    /// @param maxAgeSeconds Maximum seconds since attestation_timestamp. Pass 0 to skip expiry check.
    function isSafeWithAge(address agentAddress, uint256 maxAgeSeconds)
        public
        returns (bool safe, string memory reason)
    {
        if (!registry.hasAttestation(agentAddress)) {
            emit SentinelChecked(agentAddress, false, 0, block.timestamp);
            return (false, "Agent has no attestation from 0G Sentinel");
        }

        IAttestationRegistry.Attestation memory att = registry.getAttestation(agentAddress);

        if (maxAgeSeconds > 0 && block.timestamp - att.attestation_timestamp > maxAgeSeconds) {
            emit SentinelChecked(agentAddress, false, 0, block.timestamp);
            return (false, "Attestation expired: rescan required");
        }

        if (att.threat_level > MAX_THREAT_LEVEL) {
            emit SentinelChecked(agentAddress, false, att.behavioral_score, block.timestamp);
            return (false, "Agent behavioral risk: FLAGGED");
        }
        if (att.code_risk > MAX_CODE_RISK) {
            emit SentinelChecked(agentAddress, false, att.behavioral_score, block.timestamp);
            return (false, "Agent code_risk: VULNERABLE");
        }

        emit SentinelChecked(agentAddress, true, att.behavioral_score, block.timestamp);
        return (true, "");
    }

    /**
     * @dev Execute a call to target on behalf of a verified-safe agent.
     *      Reverts with the original revert reason if the inner call fails.
     *
     *      Design note: msg.sender is NOT required to equal agentAddress by design.
     *      This implements a delegated-call model: any orchestrator or protocol contract
     *      can submit a call on behalf of an attested agent. The gate enforces that the
     *      declared agentAddress holds a valid 0G Sentinel attestation — it does not
     *      enforce that the caller IS that agent. Production integrations that require
     *      strict caller identity should add `require(msg.sender == agentAddress)`.
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
        if (!success) {
            // Bubble the inner revert reason rather than swallowing it
            if (returnData.length > 0) {
                assembly {
                    revert(add(32, returnData), mload(returnData))
                }
            }
            revert("Agent execution failed");
        }
        return returnData;
    }
}
