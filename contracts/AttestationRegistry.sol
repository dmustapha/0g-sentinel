// File: contracts/AttestationRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AttestationRegistry
 * @dev Stores ERC-7857 agent security attestations from two 0G Compute pipelines.
 * Adapted from AgentMesh AuditAttestation.sol (ETHGlobal 0G Labs track winner).
 * Key difference: audits live agents on mainnet, not developer code.
 */
contract AttestationRegistry is Ownable {

    // Threat levels: 0 = SAFE, 1 = CAUTION, 2 = FLAGGED
    uint8 public constant SAFE = 0;
    uint8 public constant CAUTION = 1;
    uint8 public constant FLAGGED = 2;

    // Code risk levels: 0 = CLEAN, 1 = WARNING, 2 = VULNERABLE
    uint8 public constant CLEAN = 0;
    uint8 public constant WARNING = 1;
    uint8 public constant VULNERABLE = 2;

    struct Attestation {
        uint8 behavioral_score;          // 0-100 risk score from Pipeline 1
        uint8 threat_level;              // 0=SAFE, 1=CAUTION, 2=FLAGGED
        uint8 code_risk;                 // 0=CLEAN, 1=WARNING, 2=VULNERABLE
        string code_findings;            // e.g. "reentrancy at withdraw()"
        bytes32 behavioral_receipt_hash; // 0G Compute receipt hash, Pipeline 1
        bytes32 code_receipt_hash;       // 0G Compute receipt hash, Pipeline 2
        bytes32 evidence_hash;           // 0G Storage archive hash
        uint256 attestation_timestamp;   // block.timestamp at write time
    }

    mapping(address => Attestation) private attestations;
    mapping(address => bool) private authorizedScanners;
    address[] private attestedAgents;

    event AttestationWritten(
        address indexed agentAddress,
        uint8 threat_level,
        uint8 code_risk,
        bytes32 behavioral_receipt_hash,
        bytes32 code_receipt_hash,
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
        bytes32 behavioral_receipt_hash,
        bytes32 code_receipt_hash,
        bytes32 evidence_hash
    ) external onlyAuthorized {
        require(agentAddress != address(0), "Invalid agent address");
        require(behavioral_score <= 100, "Score must be 0-100");
        require(threat_level <= 2, "Invalid threat_level");
        require(code_risk <= 2, "Invalid code_risk");

        bool isNew = attestations[agentAddress].attestation_timestamp == 0;

        attestations[agentAddress] = Attestation({
            behavioral_score: behavioral_score,
            threat_level: threat_level,
            code_risk: code_risk,
            code_findings: code_findings,
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
            threat_level,
            code_risk,
            behavioral_receipt_hash,
            code_receipt_hash,
            block.timestamp
        );
    }

    function getAttestation(address agentAddress)
        external
        view
        returns (Attestation memory)
    {
        return attestations[agentAddress];
    }

    function hasAttestation(address agentAddress) external view returns (bool) {
        return attestations[agentAddress].attestation_timestamp > 0;
    }

    function getAllAttestedAgents() external view returns (address[] memory) {
        return attestedAgents;
    }

    function getAttestedCount() external view returns (uint256) {
        return attestedAgents.length;
    }
}
