// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC8004IdentityRegistry.sol";

interface ISentinelRegistryV2 {
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

    function getProofLock(bytes32 identityKey) external view returns (ProofLock memory);
}

contract AgentGateV2 {
    uint256 public constant IDENTITY_CHAIN_ID = 16661;
    uint8 public constant FIXED_COVERAGE = 0x7f;
    uint48 public constant MAXIMUM_CONFIGURED_AGE = 30 days;
    uint8 public constant ALLOWED = 0;
    uint8 public constant NO_PROOF = 1;
    uint8 public constant REVOKED = 2;
    uint8 public constant DRIFTED = 3;
    uint8 public constant EXPIRED = 4;
    uint8 public constant SUBJECT_CHANGED = 5;
    uint8 public constant RUNTIME_CODE_DRIFT = 6;
    uint8 public constant POLICY_TOO_OLD = 7;
    uint8 public constant COVERAGE_INCOMPLETE = 8;
    uint8 public constant COMPUTE_UNVERIFIED = 9;
    uint8 public constant STORAGE_UNVERIFIED = 10;
    uint8 public constant BEHAVIORAL_RISK = 11;
    uint8 public constant CODE_RISK = 12;
    uint8 public constant IDENTITY_UNAVAILABLE = 13;
    uint8 public constant AGENT_NOT_FOUND = 14;
    uint8 public constant AGENT_WALLET_UNSET = 15;
    uint8 public constant IDENTITY_MISMATCH = 16;

    uint8 private constant STATE_ACTIVE = 1;
    uint8 private constant STATE_REVOKED = 2;
    uint8 private constant STATE_DRIFTED = 3;
    uint8 private constant BEHAVIORAL_COMPUTE_BIT = 0x08;
    uint8 private constant STORAGE_BIT = 0x20;

    ISentinelRegistryV2 public immutable registry;
    IERC8004IdentityRegistry public immutable identityRegistry;
    uint8 public immutable maxBehavioralScore;
    uint8 public immutable maxCodeRisk;
    uint8 public immutable requiredCoverage;
    uint32 public immutable minimumPolicyVersion;
    uint48 public immutable maximumAge;

    error InvalidConfiguration();
    error AgentRejected(uint8 reason);

    constructor(
        address registryAddress,
        address identityRegistryAddress,
        uint8 behavioralLimit,
        uint8 codeRiskLimit,
        uint8 coverageMask,
        uint32 policyFloor,
        uint48 ageLimit
    ) {
        _validateConfiguration(registryAddress, identityRegistryAddress, behavioralLimit,
            codeRiskLimit, coverageMask, policyFloor, ageLimit);
        registry = ISentinelRegistryV2(registryAddress);
        identityRegistry = IERC8004IdentityRegistry(identityRegistryAddress);
        maxBehavioralScore = behavioralLimit;
        maxCodeRisk = codeRiskLimit;
        requiredCoverage = coverageMask;
        minimumPolicyVersion = policyFloor;
        maximumAge = ageLimit;
    }

    function _validateConfiguration(
        address registryAddress,
        address identityRegistryAddress,
        uint8 behavioralLimit,
        uint8 codeRiskLimit,
        uint8 coverageMask,
        uint32 policyFloor,
        uint48 ageLimit
    ) private view {
        if (registryAddress == address(0) || registryAddress.code.length == 0) revert InvalidConfiguration();
        if (identityRegistryAddress == address(0) || identityRegistryAddress.code.length == 0) {
            revert InvalidConfiguration();
        }
        if (behavioralLimit > 100 || codeRiskLimit > 2) revert InvalidConfiguration();
        if (coverageMask != FIXED_COVERAGE || policyFloor == 0) revert InvalidConfiguration();
        if (ageLimit == 0 || ageLimit > MAXIMUM_CONFIGURED_AGE) revert InvalidConfiguration();
    }

    function checkAgent(uint256 agentId)
        public
        view
        returns (bool allowed, uint8 reason, address subject, uint64 version)
    {
        (uint8 identityReason, address wallet) = _resolveIdentity(agentId);
        if (identityReason != ALLOWED) return (false, identityReason, wallet, 0);
        bytes32 identityKey = keccak256(abi.encode(IDENTITY_CHAIN_ID, address(identityRegistry), agentId));
        ISentinelRegistryV2.ProofLock memory proof = registry.getProofLock(identityKey);
        reason = _evaluate(identityKey, wallet, proof);
        return (reason == ALLOWED, reason, wallet, proof.version);
    }

    function requireAgent(uint256 agentId) external view returns (address subject, uint64 version) {
        (bool allowed, uint8 reason, address wallet, uint64 proofVersion) = checkAgent(agentId);
        if (!allowed) revert AgentRejected(reason);
        return (wallet, proofVersion);
    }

    function _resolveIdentity(uint256 agentId) private view returns (uint8 reason, address wallet) {
        reason = _readOwner(agentId);
        if (reason != ALLOWED) return (reason, address(0));
        return _readWallet(agentId);
    }

    function _readOwner(uint256 agentId) private view returns (uint8) {
        (bool success, bytes memory data) = address(identityRegistry).staticcall(
            abi.encodeCall(IERC8004IdentityRegistry.ownerOf, (agentId))
        );
        if (!success) return data.length == 0 ? IDENTITY_UNAVAILABLE : AGENT_NOT_FOUND;
        (bool valid, address owner) = _decodeAddress(data);
        if (!valid) return IDENTITY_UNAVAILABLE;
        return owner == address(0) ? AGENT_NOT_FOUND : ALLOWED;
    }

    function _readWallet(uint256 agentId) private view returns (uint8, address) {
        (bool success, bytes memory data) = address(identityRegistry).staticcall(
            abi.encodeCall(IERC8004IdentityRegistry.getAgentWallet, (agentId))
        );
        if (!success) return (IDENTITY_UNAVAILABLE, address(0));
        (bool valid, address wallet) = _decodeAddress(data);
        if (!valid) return (IDENTITY_UNAVAILABLE, address(0));
        return wallet == address(0) ? (AGENT_WALLET_UNSET, address(0)) : (ALLOWED, wallet);
    }

    function _decodeAddress(bytes memory data) private pure returns (bool valid, address decoded) {
        if (data.length != 32) return (false, address(0));
        uint256 word;
        assembly {
            word := mload(add(data, 32))
        }
        if (word > type(uint160).max) return (false, address(0));
        return (true, address(uint160(word)));
    }

    function _evaluate(
        bytes32 identityKey,
        address wallet,
        ISentinelRegistryV2.ProofLock memory proof
    ) private view returns (uint8) {
        if (proof.version == 0) return NO_PROOF;
        if (proof.identityKey != identityKey) return IDENTITY_MISMATCH;
        if (proof.subject != wallet) return SUBJECT_CHANGED;
        if (proof.state == STATE_REVOKED) return REVOKED;
        if (proof.state == STATE_DRIFTED) return DRIFTED;
        if (proof.state != STATE_ACTIVE) return IDENTITY_MISMATCH;
        if (_isExpired(proof)) return EXPIRED;
        if ((proof.coverage & BEHAVIORAL_COMPUTE_BIT) == 0) return COMPUTE_UNVERIFIED;
        if ((proof.coverage & STORAGE_BIT) == 0) return STORAGE_UNVERIFIED;
        if ((proof.coverage & requiredCoverage) != requiredCoverage) return COVERAGE_INCOMPLETE;
        if (proof.policyVersion < minimumPolicyVersion) return POLICY_TOO_OLD;
        if (proof.behavioralScore > maxBehavioralScore) return BEHAVIORAL_RISK;
        if (proof.codeRisk > maxCodeRisk) return CODE_RISK;
        if (proof.runtimeCodeHash != _runtimeCodeHash(wallet)) return RUNTIME_CODE_DRIFT;
        return ALLOWED;
    }

    function _isExpired(ISentinelRegistryV2.ProofLock memory proof) private view returns (bool) {
        if (proof.issuedAt > block.timestamp || proof.validUntil <= block.timestamp) return true;
        return maximumAge != 0 && block.timestamp - proof.issuedAt > maximumAge;
    }

    /// @dev Detects direct runtime bytecode drift only. Proxy implementation or configuration
    ///      drift requires guardian monitoring and an explicit lifecycle transition.
    function _runtimeCodeHash(address subject) private view returns (bytes32) {
        return subject.code.length == 0 ? bytes32(0) : subject.codehash;
    }
}
