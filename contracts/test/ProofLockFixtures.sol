// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC8004IdentityRegistry {
    mapping(uint256 => address) private owners;
    mapping(uint256 => address) private wallets;

    function setAgent(uint256 agentId, address owner, address wallet) external {
        owners[agentId] = owner;
        wallets[agentId] = wallet;
    }

    function setAgentWallet(uint256 agentId, address wallet) external {
        wallets[agentId] = wallet;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        require(owners[agentId] != address(0), "ERC721NonexistentToken");
        return owners[agentId];
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return wallets[agentId];
    }
}

contract MutableSubjectV1 {
    function marker() external pure returns (uint256) {
        return 1;
    }
}

contract MutableSubjectV2 {
    function marker() external pure returns (uint256) {
        return 2;
    }
}
