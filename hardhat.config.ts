// File: hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // 0G Galileo Testnet (use for dev)
    zerogTestnet: {
      url: "https://evmrpc-testnet.0g.ai",
      chainId: 16602, // VERIFIED: live eth_chainId call returned 0x40da = 16602
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    // 0G Aristotle Mainnet (required for submission)
    zerogMainnet: {
      url: "https://evmrpc.0g.ai",
      chainId: 16661, // VERIFIED: live eth_chainId call returned 0x4115 = 16661
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      timeout: 120000,
    },
    hardhat: {
      chainId: 31337,
    },
  },
  gasReporter: {
    enabled: false,
  },
  paths: {
    tests: "./tests",
  },
};

export default config;
