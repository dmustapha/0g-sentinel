// File: contracts/AgentRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentRegistry
 * @dev Index of AI agent addresses monitored by 0G Sentinel on 0G mainnet.
 *      Pre-populated with known demo agents via registerAgentsBatch().
 *
 *      Changes from v1.0.0:
 *      - tokenId now stored in agentTokenIds mapping (full ERC-7857 binding)
 *      - AgentRegistered event now emits tokenId
 *      - getAgentsPaged() added to mirror AttestationRegistry paged API
 */
contract AgentRegistry is Ownable {
    string public constant VERSION = "1.1.0";

    struct Agent {
        address agentAddress;
        bool active;
    }

    mapping(address => Agent) private agents;
    /// @notice Maps agent address to its ERC-7857 tokenId (0 if not an iNFT).
    mapping(address => uint256) public agentTokenIds;
    address[] private agentList;

    event AgentRegistered(address indexed agentAddress, uint256 tokenId);
    event AgentDeactivated(address indexed agentAddress);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Register a single agent. Idempotent — re-registering the same address is a no-op.
     * @param agentAddress The agent's wallet or contract address.
     * @param tokenId      ERC-7857 iNFT tokenId. Pass 0 for non-iNFT agents.
     */
    function registerAgent(address agentAddress, uint256 tokenId) external onlyOwner {
        require(agentAddress != address(0), "Invalid address");
        if (agents[agentAddress].agentAddress == address(0)) {
            agents[agentAddress] = Agent({
                agentAddress: agentAddress,
                active: true
            });
            agentList.push(agentAddress);
            agentTokenIds[agentAddress] = tokenId;
            emit AgentRegistered(agentAddress, tokenId);
        }
    }

    /**
     * @notice Register multiple agents atomically. Zero addresses and duplicates are silently skipped.
     * @param addresses  Agent addresses to register.
     * @param tokenIds   Corresponding ERC-7857 tokenIds (0 for non-iNFT agents).
     */
    function registerAgentsBatch(address[] calldata addresses, uint256[] calldata tokenIds) external onlyOwner {
        require(addresses.length == tokenIds.length, "Length mismatch");
        for (uint256 i = 0; i < addresses.length; i++) {
            if (addresses[i] != address(0) && agents[addresses[i]].agentAddress == address(0)) {
                agents[addresses[i]] = Agent({
                    agentAddress: addresses[i],
                    active: true
                });
                agentList.push(addresses[i]);
                agentTokenIds[addresses[i]] = tokenIds[i];
                emit AgentRegistered(addresses[i], tokenIds[i]);
            }
        }
    }

    function deactivateAgent(address agentAddress) external onlyOwner {
        require(agents[agentAddress].agentAddress != address(0), "Agent not registered");
        agents[agentAddress].active = false;
        emit AgentDeactivated(agentAddress);
    }

    /// @notice Returns all registered agent addresses (including deactivated ones).
    /// @dev    For large registries use getAgentsPaged to avoid block gas limits.
    function getAllAgents() external view returns (address[] memory) {
        return agentList;
    }

    /// @notice Returns a page of agent addresses. Safe for large registries.
    /// @param offset Zero-based start index.
    /// @param limit  Maximum number of addresses to return.
    function getAgentsPaged(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory)
    {
        uint256 total = agentList.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        address[] memory page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = agentList[i];
        }
        return page;
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
