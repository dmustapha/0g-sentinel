// File: contracts/AgentRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentRegistry
 * @dev Index of ERC-7857 iNFT agent addresses on 0G mainnet.
 * Pre-populated with known AIverse agents. Also accepts new registrations.
 */
contract AgentRegistry is Ownable {
    struct Agent {
        address agentAddress;
        uint256 tokenId;
        bool active;
    }

    mapping(address => Agent) private agents;
    address[] private agentList;

    event AgentRegistered(address indexed agentAddress, uint256 tokenId);
    event AgentDeactivated(address indexed agentAddress);

    constructor() Ownable(msg.sender) {}

    function registerAgent(address agentAddress, uint256 tokenId) external onlyOwner {
        require(agentAddress != address(0), "Invalid address");
        if (agents[agentAddress].agentAddress == address(0)) {
            agents[agentAddress] = Agent({
                agentAddress: agentAddress,
                tokenId: tokenId,
                active: true
            });
            agentList.push(agentAddress);
            emit AgentRegistered(agentAddress, tokenId);
        }
    }

    function registerAgentsBatch(address[] calldata addresses, uint256[] calldata tokenIds) external onlyOwner {
        require(addresses.length == tokenIds.length, "Length mismatch");
        for (uint256 i = 0; i < addresses.length; i++) {
            if (addresses[i] != address(0) && agents[addresses[i]].agentAddress == address(0)) {
                agents[addresses[i]] = Agent({
                    agentAddress: addresses[i],
                    tokenId: tokenIds[i],
                    active: true
                });
                agentList.push(addresses[i]);
                emit AgentRegistered(addresses[i], tokenIds[i]);
            }
        }
    }

    function getAllAgents() external view returns (address[] memory) {
        return agentList;
    }

    function getAgentCount() external view returns (uint256) {
        return agentList.length;
    }

    function isRegistered(address agentAddress) external view returns (bool) {
        return agents[agentAddress].agentAddress != address(0);
    }
}
