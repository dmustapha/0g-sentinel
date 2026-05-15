// File: contracts/AgentRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentRegistry
 * @dev Index of AI agent addresses monitored by 0G Sentinel on 0G mainnet.
 *      Pre-populated with known demo agents via registerAgentsBatch().
 *
 *      Note: Registration is intentionally owner-only for this demo. In production,
 *      this would be replaced by a permissionless ERC-7857 iNFT registration flow.
 *
 *      Note: tokenId is accepted in the interface for ERC-7857 compatibility signaling
 *      but is not stored — the AgentRegistry tracks addresses, not token ownership.
 *      Full NFT binding is a post-hackathon integration point.
 */
contract AgentRegistry is Ownable {
    struct Agent {
        address agentAddress;
        bool active;
    }

    mapping(address => Agent) private agents;
    address[] private agentList;

    event AgentRegistered(address indexed agentAddress);
    event AgentDeactivated(address indexed agentAddress);

    constructor() Ownable(msg.sender) {}

    /// @param tokenId Accepted for ERC-7857 compatibility but not stored in this demo version.
    function registerAgent(address agentAddress, uint256 tokenId) external onlyOwner {
        tokenId; // unused — accepted for interface compatibility
        require(agentAddress != address(0), "Invalid address");
        if (agents[agentAddress].agentAddress == address(0)) {
            agents[agentAddress] = Agent({
                agentAddress: agentAddress,
                active: true
            });
            agentList.push(agentAddress);
            emit AgentRegistered(agentAddress);
        }
    }

    /// @param tokenIds Accepted for ERC-7857 compatibility but not stored in this demo version.
    function registerAgentsBatch(address[] calldata addresses, uint256[] calldata tokenIds) external onlyOwner {
        require(addresses.length == tokenIds.length, "Length mismatch");
        for (uint256 i = 0; i < addresses.length; i++) {
            if (addresses[i] != address(0) && agents[addresses[i]].agentAddress == address(0)) {
                agents[addresses[i]] = Agent({
                    agentAddress: addresses[i],
                    active: true
                });
                agentList.push(addresses[i]);
                emit AgentRegistered(addresses[i]);
            }
        }
    }

    function deactivateAgent(address agentAddress) external onlyOwner {
        require(agents[agentAddress].agentAddress != address(0), "Agent not registered");
        agents[agentAddress].active = false;
        emit AgentDeactivated(agentAddress);
    }

    /// @notice Returns all registered agent addresses (including deactivated ones).
    function getAllAgents() external view returns (address[] memory) {
        return agentList;
    }

    /// @notice Returns the total number of registered agents.
    function getAgentCount() external view returns (uint256) {
        return agentList.length;
    }

    /// @notice Returns true if the address has ever been registered (active or deactivated).
    function isRegistered(address agentAddress) external view returns (bool) {
        return agents[agentAddress].agentAddress != address(0);
    }

    /// @notice Returns true if the agent is registered and has not been deactivated.
    function isActive(address agentAddress) external view returns (bool) {
        return agents[agentAddress].active;
    }
}
