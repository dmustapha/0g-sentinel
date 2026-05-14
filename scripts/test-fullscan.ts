// Full end-to-end scan test
import * as dotenv from "dotenv";
dotenv.config();

import { runFullScan } from "../scanner/scanner";

const address = "0xAAAA000000000000000000000000000000000001";
process.env.KNOWN_CONTRACT_SOURCES = JSON.stringify({
  [address.toLowerCase()]: `pragma solidity ^0.8.0;
contract AgentA {
  address owner;
  constructor() { owner = msg.sender; }
  function execute(address target, bytes calldata data) external {
    (bool ok,) = target.call(data);
    require(ok);
  }
}`,
});

console.log("=== Running full end-to-end scan ===");
console.log("Target:", address);

runFullScan(address)
  .then((result) => {
    console.log("\n=== FULL SCAN RESULT ===");
    console.log(JSON.stringify(result, null, 2));
    console.log("\n=== KEY CHECKS ===");
    console.log("behavioral_receipt_hash:", result.behavioral_receipt_hash);
    console.log("code_receipt_hash:", result.code_receipt_hash);
    console.log(
      "Hashes different:",
      result.behavioral_receipt_hash !== result.code_receipt_hash ? "✅ YES" : "❌ NO (CRITICAL!)"
    );
    console.log("attestation_tx_hash:", result.attestation_tx_hash);
  })
  .catch((err) => {
    console.error("SCAN FAILED:", err);
    process.exit(1);
  });
