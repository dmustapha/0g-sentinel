// File: contracts/AgentGate.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

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
 *      Changes from v1.0.0:
 *      - DEFAULT_MAX_AGE = 30 days applied by isSafe() (was 0 = no expiry check)
 *      - Target whitelist: when enabled, executeIfSafe() only forwards to approvedTargets
 *      - Caller identity option: requireCallerIsAgent enforces msg.sender == agentAddress
 *      - Ownable: gate configuration is owner-controlled
 */
contract AgentGate is Ownable {
    string public constant VERSION = "1.1.0";

    IAttestationRegistry public immutable registry;

    /// @notice Default attestation freshness window applied by isSafe().
    ///         Attestations older than 30 days are treated as expired.
    uint256 public constant DEFAULT_MAX_AGE = 30 days;

    // Max allowed: threat_level <= 1 (SAFE or CAUTION), code_risk <= 1 (CLEAN or WARNING)
    uint8 public constant MAX_THREAT_LEVEL = 1;
    uint8 public constant MAX_CODE_RISK = 1;

    /// @notice When true, executeIfSafe() only forwards calls to whitelisted target addresses.
    bool public whitelistEnabled;

    /// @notice When true, executeIfSafe() requires msg.sender == agentAddress (strict identity).
    bool public requireCallerIsAgent;

    /// @notice Approved call targets when whitelistEnabled is active.
    mapping(address => bool) public approvedTargets;

    event AgentBlocked(address indexed agentAddress, string reason);
    event AgentAllowed(address indexed agentAddress);
    event SentinelChecked(address indexed agent, bool safe, uint256 score, uint256 timestamp);
    event TargetApproved(address indexed target);
    event TargetRemoved(address indexed target);
    event WhitelistToggled(bool enabled);
    event CallerIdentityToggled(bool required);

    /// @param registryAddress        AttestationRegistry contract address.
    /// @param _whitelistEnabled      True to restrict executeIfSafe() to approvedTargets.
    /// @param _requireCallerIsAgent  True to enforce msg.sender == agentAddress in executeIfSafe().
    constructor(
        address registryAddress,
        bool _whitelistEnabled,
        bool _requireCallerIsAgent
    ) Ownable(msg.sender) {
        registry = IAttestationRegistry(registryAddress);
        whitelistEnabled = _whitelistEnabled;
        requireCallerIsAgent = _requireCallerIsAgent;
    }

    // -------------------------------------------------------------------------
    // Owner configuration
    // -------------------------------------------------------------------------

    /// @notice Add a target address to the call whitelist.
    function approveTarget(address target) external onlyOwner {
        require(target != address(0), "Invalid target");
        approvedTargets[target] = true;
        emit TargetApproved(target);
    }

    /// @notice Remove a target address from the call whitelist.
    function removeTarget(address target) external onlyOwner {
        approvedTargets[target] = false;
        emit TargetRemoved(target);
    }

    /// @notice Enable or disable the target whitelist.
    function setWhitelistEnabled(bool enabled) external onlyOwner {
        whitelistEnabled = enabled;
        emit WhitelistToggled(enabled);
    }

    /// @notice Enable or disable strict caller-identity enforcement.
    function setRequireCallerIsAgent(bool required) external onlyOwner {
        requireCallerIsAgent = required;
        emit CallerIdentityToggled(required);
    }

    // -------------------------------------------------------------------------
    // Safety checks
    // -------------------------------------------------------------------------

    /// @notice Check if an agent passes the safety threshold using DEFAULT_MAX_AGE (30 days).
    function isSafe(address agentAddress)
        public
        returns (bool safe, string memory reason)
    {
        return isSafeWithAge(agentAddress, DEFAULT_MAX_AGE);
    }

    /// @notice Check safety with a custom attestation freshness requirement.
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

    // -------------------------------------------------------------------------
    // Gated execution
    // -------------------------------------------------------------------------

    /**
     * @dev Execute a call to target on behalf of a verified-safe agent.
     *      Reverts with the original revert reason if the inner call fails.
     *
     *      When requireCallerIsAgent is true: msg.sender must equal agentAddress.
     *      When whitelistEnabled is true: target must be in approvedTargets.
     *      Both guards are disabled by default and can be toggled by the owner.
     */
    function executeIfSafe(
        address agentAddress,
        address target,
        bytes calldata data
    ) external returns (bytes memory) {
        // Caller identity guard
        if (requireCallerIsAgent) {
            require(msg.sender == agentAddress, "Caller must be the agent");
        }

        // Target whitelist guard
        if (whitelistEnabled) {
            require(approvedTargets[target], "Target not whitelisted");
        }

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
