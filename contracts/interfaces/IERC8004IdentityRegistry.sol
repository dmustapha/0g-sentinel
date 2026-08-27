// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC8004IdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}
