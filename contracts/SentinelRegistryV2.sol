// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract SentinelRegistryV2 is AccessControl {
    bytes32 public constant SCANNER_ROLE = keccak256("SCANNER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint8 public constant REQUIRED_COVERAGE = 0x7f;
    uint48 public constant MAX_TTL = 30 days;
    uint8 public constant STATE_ACTIVE = 1;
    uint8 public constant STATE_REVOKED = 2;
    uint8 public constant STATE_DRIFTED = 3;
    uint256 public constant MAX_PAGE_SIZE = 100;

    struct ProofLock {
        bytes32 identityKey;
        address subject;
        bytes32 envelopeDigest;
        bytes32 storageRoot;
        bytes32 computeRoot;
        bytes32 artifactHash;
        bytes32 runtimeCodeHash;
        uint64 version;
        uint48 issuedAt;
        uint48 validUntil;
        uint32 policyVersion;
        uint8 behavioralScore;
        uint8 codeRisk;
        uint8 coverage;
        uint8 state;
        uint8 stateReason;
    }

    struct LockInput {
        bytes32 envelopeDigest;
        bytes32 storageRoot;
        bytes32 computeRoot;
        bytes32 artifactHash;
        uint48 validForSeconds;
        uint32 policyVersion;
        uint8 behavioralScore;
        uint8 codeRisk;
        uint8 coverage;
    }

    mapping(bytes32 => ProofLock) private proofLocks;
    bytes32[] private identityKeys;

    error ZeroAddress();
    error ZeroCommitment();
    error InvalidTTL();
    error InvalidBehavioralScore();
    error InvalidCodeRisk();
    error IncompleteCoverage();
    error ProofAlreadyExists();
    error ProofNotFound();
    error StaleVersion(uint64 expected, uint64 actual);
    error InvalidState(uint8 currentState);
    error InvalidReason();
    error PageLimitExceeded();

    event ProofLocked(
        bytes32 indexed identityKey,
        address indexed subject,
        uint64 indexed version,
        uint48 issuedAt,
        uint48 validUntil,
        bytes32 envelopeDigest,
        bytes32 storageRoot,
        bytes32 computeRoot,
        bytes32 artifactHash,
        bytes32 runtimeCodeHash,
        uint32 policyVersion,
        uint8 behavioralScore,
        uint8 codeRisk,
        uint8 coverage
    );
    event ProofRevoked(bytes32 indexed identityKey, uint64 indexed version, uint8 reason);
    event DriftMarked(bytes32 indexed identityKey, uint64 indexed version, uint8 reason);
    event ProofSuperseded(bytes32 indexed identityKey, uint64 indexed oldVersion, uint64 indexed newVersion);

    constructor(address admin, address scanner, address guardian) {
        if (admin == address(0) || scanner == address(0) || guardian == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SCANNER_ROLE, scanner);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    function seal(bytes32 identityKey, address subject, LockInput calldata input)
        external
        onlyRole(SCANNER_ROLE)
    {
        if (proofLocks[identityKey].version != 0) revert ProofAlreadyExists();
        _validate(identityKey, subject, input);
        proofLocks[identityKey] = _createProof(identityKey, subject, input, 1);
        identityKeys.push(identityKey);
        _emitLocked(proofLocks[identityKey]);
    }

    function reseal(bytes32 identityKey, address subject, LockInput calldata input)
        external
        onlyRole(SCANNER_ROLE)
    {
        uint64 oldVersion = proofLocks[identityKey].version;
        if (oldVersion == 0) revert ProofNotFound();
        _requireResealable(proofLocks[identityKey].state);
        _validate(identityKey, subject, input);
        uint64 newVersion = oldVersion + 1;
        proofLocks[identityKey] = _createProof(identityKey, subject, input, newVersion);
        emit ProofSuperseded(identityKey, oldVersion, newVersion);
        _emitLocked(proofLocks[identityKey]);
    }

    function revoke(bytes32 identityKey, uint8 reason, uint64 expectedVersion)
        external
        onlyRole(GUARDIAN_ROLE)
    {
        ProofLock storage proof = _current(identityKey, expectedVersion);
        _validateReason(reason);
        if (proof.state != STATE_ACTIVE && proof.state != STATE_DRIFTED) revert InvalidState(proof.state);
        proof.state = STATE_REVOKED;
        proof.stateReason = reason;
        emit ProofRevoked(identityKey, proof.version, reason);
    }

    function markDrift(bytes32 identityKey, uint8 reason, uint64 expectedVersion)
        external
        onlyRole(GUARDIAN_ROLE)
    {
        ProofLock storage proof = _current(identityKey, expectedVersion);
        _validateReason(reason);
        if (proof.state != STATE_ACTIVE) revert InvalidState(proof.state);
        proof.state = STATE_DRIFTED;
        proof.stateReason = reason;
        emit DriftMarked(identityKey, proof.version, reason);
    }

    function getProofLock(bytes32 identityKey) external view returns (ProofLock memory) {
        return proofLocks[identityKey];
    }

    function getIdentityKeysPaged(uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory page)
    {
        if (limit > MAX_PAGE_SIZE) revert PageLimitExceeded();
        uint256 total = identityKeys.length;
        if (offset >= total || limit == 0) return new bytes32[](0);
        uint256 size = limit > total - offset ? total - offset : limit;
        page = new bytes32[](size);
        for (uint256 i; i < size; ++i) page[i] = identityKeys[offset + i];
    }

    function getIdentityCount() external view returns (uint256) {
        return identityKeys.length;
    }

    function _validate(bytes32 identityKey, address subject, LockInput calldata input) private pure {
        if (identityKey == bytes32(0) || input.envelopeDigest == bytes32(0)) revert ZeroCommitment();
        if (subject == address(0)) revert ZeroCommitment();
        if (input.storageRoot == bytes32(0) || input.computeRoot == bytes32(0)) revert ZeroCommitment();
        if (input.artifactHash == bytes32(0)) revert ZeroCommitment();
        if (input.validForSeconds == 0 || input.validForSeconds > MAX_TTL) revert InvalidTTL();
        if (input.behavioralScore > 100) revert InvalidBehavioralScore();
        if (input.codeRisk > 2) revert InvalidCodeRisk();
        if ((input.coverage & REQUIRED_COVERAGE) != REQUIRED_COVERAGE) revert IncompleteCoverage();
    }

    function _createProof(bytes32 identityKey, address subject, LockInput calldata input, uint64 version)
        private
        view
        returns (ProofLock memory)
    {
        uint48 issuedAt = uint48(block.timestamp);
        return ProofLock(identityKey, subject, input.envelopeDigest, input.storageRoot, input.computeRoot,
            input.artifactHash, _runtimeCodeHash(subject), version, issuedAt,
            issuedAt + input.validForSeconds, input.policyVersion, input.behavioralScore,
            input.codeRisk, input.coverage, STATE_ACTIVE, 0);
    }

    function _current(bytes32 identityKey, uint64 expectedVersion)
        private
        view
        returns (ProofLock storage proof)
    {
        proof = proofLocks[identityKey];
        if (proof.version == 0) revert ProofNotFound();
        if (proof.version != expectedVersion) revert StaleVersion(expectedVersion, proof.version);
    }

    function _runtimeCodeHash(address subject) private view returns (bytes32) {
        return subject.code.length == 0 ? bytes32(0) : subject.codehash;
    }

    function _validateReason(uint8 reason) private pure {
        if (reason == 0 || reason > 16) revert InvalidReason();
    }

    function _requireResealable(uint8 state) private pure {
        if (state != STATE_ACTIVE && state != STATE_DRIFTED) revert InvalidState(state);
    }

    function _emitLocked(ProofLock storage proof) private {
        emit ProofLocked(proof.identityKey, proof.subject, proof.version, proof.issuedAt,
            proof.validUntil, proof.envelopeDigest, proof.storageRoot, proof.computeRoot,
            proof.artifactHash, proof.runtimeCodeHash, proof.policyVersion,
            proof.behavioralScore, proof.codeRisk, proof.coverage);
    }
}
