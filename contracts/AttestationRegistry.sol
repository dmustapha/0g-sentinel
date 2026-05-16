// File: contracts/AttestationRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AttestationRegistry
 * @dev Stores immutable AI agent security attestations produced by two independent
 *      0G Compute inference pipelines (behavioral analysis + code vulnerability scan).
 *      Each attestation carries cryptographic proof of both AI runs via unique receipt hashes.
 *
 *      Attestation struct stores LLM reasoning on-chain so any integrator can read
 *      not just the verdict but the evidence behind it — no off-chain lookup required.
 *
 *      Changes from v1.0.0:
 *      - MAX_REASONING_BYTES and MAX_FINDINGS_BYTES caps enforce bounded on-chain storage
 *      - writeAttestation validates score/threat_level consistency (prevents contradictory verdict/score pairs)
 *      - getAttestationHistory returns most-recent-first (descending) order
 *      - isAttestationFresh() added for expiry queries without deploying AgentGate
 */
contract AttestationRegistry is Ownable {

    string public constant VERSION = "1.1.0";

    // Threat levels: 0 = SAFE, 1 = CAUTION, 2 = FLAGGED
    uint8 public constant SAFE = 0;
    uint8 public constant CAUTION = 1;
    uint8 public constant FLAGGED = 2;

    // Code risk levels: 0 = CLEAN, 1 = WARNING, 2 = VULNERABLE
    uint8 public constant CLEAN = 0;
    uint8 public constant WARNING = 1;
    uint8 public constant VULNERABLE = 2;

    /// @notice Maximum byte length for the LLM reasoning string stored on-chain.
    uint256 public constant MAX_REASONING_BYTES = 1000;
    /// @notice Maximum byte length for code findings string stored on-chain.
    uint256 public constant MAX_FINDINGS_BYTES = 500;

    struct Attestation {
        uint8 behavioral_score;          // 0-100 risk score from Pipeline 1
        uint8 threat_level;              // 0=SAFE, 1=CAUTION, 2=FLAGGED
        uint8 code_risk;                 // 0=CLEAN, 1=WARNING, 2=VULNERABLE
        string code_findings;            // e.g. "reentrancy at withdraw()"
        string reasoning;                // LLM behavioral reasoning (Pipeline 1 explanation)
        bytes32 behavioral_receipt_hash; // 0G Compute receipt hash, Pipeline 1
        bytes32 code_receipt_hash;       // 0G Compute receipt hash, Pipeline 2
        bytes32 evidence_hash;           // 0G Storage archive hash (full evidence JSON)
        uint256 attestation_timestamp;   // block.timestamp at write time
    }

    mapping(address => Attestation) private attestations;
    mapping(address => Attestation[]) private attestationHistory;
    mapping(address => bool) private authorizedScanners;
    address[] private attestedAgents;

    event AttestationWritten(
        address indexed agentAddress,
        uint8 behavioral_score,
        uint8 threat_level,
        uint8 code_risk,
        bytes32 behavioral_receipt_hash,
        bytes32 code_receipt_hash,
        bytes32 evidence_hash,
        uint256 timestamp
    );
    event ScannerAuthorized(address indexed scanner);
    event ScannerRevoked(address indexed scanner);

    constructor() Ownable(msg.sender) {}

    modifier onlyAuthorized() {
        require(
            msg.sender == owner() || authorizedScanners[msg.sender],
            "Not authorized scanner"
        );
        _;
    }

    function authorizeScanner(address scanner) external onlyOwner {
        authorizedScanners[scanner] = true;
        emit ScannerAuthorized(scanner);
    }

    function revokeScanner(address scanner) external onlyOwner {
        authorizedScanners[scanner] = false;
        emit ScannerRevoked(scanner);
    }

    function writeAttestation(
        address agentAddress,
        uint8 behavioral_score,
        uint8 threat_level,
        uint8 code_risk,
        string calldata code_findings,
        string calldata reasoning,
        bytes32 behavioral_receipt_hash,
        bytes32 code_receipt_hash,
        bytes32 evidence_hash
    ) external onlyAuthorized {
        require(agentAddress != address(0), "Invalid agent address");
        require(behavioral_score <= 100, "Score must be 0-100");
        require(threat_level <= 2, "Invalid threat_level");
        require(code_risk <= 2, "Invalid code_risk");

        // Enforce score/threat_level consistency — prevents contradictory verdicts
        // such as SAFE label with score 90, or FLAGGED label with score 10.
        if (threat_level == FLAGGED) {
            require(behavioral_score >= 60, "FLAGGED requires score >= 60");
        } else if (threat_level == CAUTION) {
            require(behavioral_score >= 30 && behavioral_score < 60, "CAUTION requires score 30-59");
        } else {
            // SAFE
            require(behavioral_score < 60, "SAFE requires score < 60");
        }

        // Enforce on-chain storage bounds — the off-chain scanner truncates before sending,
        // but the contract validates independently for belt-and-suspenders security.
        require(bytes(reasoning).length <= MAX_REASONING_BYTES, "Reasoning exceeds MAX_REASONING_BYTES");
        require(bytes(code_findings).length <= MAX_FINDINGS_BYTES, "Findings exceed MAX_FINDINGS_BYTES");

        bool isNew = attestations[agentAddress].attestation_timestamp == 0;

        if (!isNew) {
            attestationHistory[agentAddress].push(attestations[agentAddress]);
        }

        attestations[agentAddress] = Attestation({
            behavioral_score: behavioral_score,
            threat_level: threat_level,
            code_risk: code_risk,
            code_findings: code_findings,
            reasoning: reasoning,
            behavioral_receipt_hash: behavioral_receipt_hash,
            code_receipt_hash: code_receipt_hash,
            evidence_hash: evidence_hash,
            attestation_timestamp: block.timestamp
        });

        if (isNew) {
            attestedAgents.push(agentAddress);
        }

        emit AttestationWritten(
            agentAddress,
            behavioral_score,
            threat_level,
            code_risk,
            behavioral_receipt_hash,
            code_receipt_hash,
            evidence_hash,
            block.timestamp
        );
    }

    /// @notice Returns the full attestation struct for an agent. Returns zeroed struct if not attested.
    function getAttestation(address agentAddress)
        external
        view
        returns (Attestation memory)
    {
        return attestations[agentAddress];
    }

    /// @notice Returns true if the agent has at least one attestation on record.
    function hasAttestation(address agentAddress) external view returns (bool) {
        return attestations[agentAddress].attestation_timestamp > 0;
    }

    /// @notice Returns true if the agent's most recent attestation is within maxAgeSeconds.
    /// @param agentAddress  The agent to check.
    /// @param maxAgeSeconds Maximum allowed age in seconds. Pass 0 to skip expiry check.
    function isAttestationFresh(address agentAddress, uint256 maxAgeSeconds)
        external
        view
        returns (bool)
    {
        uint256 ts = attestations[agentAddress].attestation_timestamp;
        if (ts == 0) return false;
        if (maxAgeSeconds == 0) return true;
        return block.timestamp - ts <= maxAgeSeconds;
    }

    /// @notice Returns all attested agent addresses. Use getAttestedAgentsPaged for large registries.
    function getAllAttestedAgents() external view returns (address[] memory) {
        return attestedAgents;
    }

    /// @notice Paginated agent list — avoids unbounded gas cost as registry grows.
    function getAttestedAgentsPaged(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory)
    {
        uint256 total = attestedAgents.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        address[] memory page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = attestedAgents[i];
        }
        return page;
    }

    /// @notice Returns the total number of unique attested agents.
    function getAttestedCount() external view returns (uint256) {
        return attestedAgents.length;
    }

    /// @notice Returns the most recent `limit` historical attestations for an agent,
    ///         ordered most-recent-first (descending). Does not include the current attestation.
    function getAttestationHistory(address agentAddress, uint256 limit)
        external view returns (Attestation[] memory)
    {
        Attestation[] storage history = attestationHistory[agentAddress];
        uint256 len = history.length;
        if (limit == 0 || limit > len) limit = len;
        Attestation[] memory result = new Attestation[](limit);
        // Iterate backwards so index 0 = most recent historical entry
        for (uint256 i = 0; i < limit; i++) {
            result[i] = history[len - 1 - i];
        }
        return result;
    }

    /// @notice Returns the number of historical attestations (rescans) for an agent.
    function getAttestationHistoryCount(address agentAddress) external view returns (uint256) {
        return attestationHistory[agentAddress].length;
    }
}
