// File: scanner/storage.ts
import { createHash } from "crypto";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface EvidenceArchive {
  agent_address: string;
  scan_timestamp: number;
  behavioral_data: {
    activity_summary: Record<string, unknown>;
    verdict: string;
    reasoning: string;
  };
  behavioral_receipt: string;
  code_findings: string;
  code_receipt: string;
}

export async function uploadEvidence(evidence: EvidenceArchive): Promise<string> {
  const evidenceJson = JSON.stringify(evidence, null, 2);
  const evidenceBuffer = Buffer.from(evidenceJson, "utf-8");

  let tmpPath: string | null = null;

  try {
    const { ZgFile, Indexer } = await import("@0glabs/0g-ts-sdk");
    const { ethers } = await import("ethers");

    const rpcEndpoint = process.env.ZERO_G_RPC || "https://evmrpc.0g.ai";
    const indexerRpc =
      process.env.ZERO_G_STORAGE_INDEXER ||
      "https://indexer-storage-testnet-standard.0g.ai";
    const privateKey = process.env.ZERO_G_PRIVATE_KEY || process.env.SCANNER_PRIVATE_KEY || "";

    // Write evidence to temp file — ZgFile only supports fromFilePath/fromNodeFileHandle
    tmpPath = join(tmpdir(), `0g-evidence-${Date.now()}.json`);
    writeFileSync(tmpPath, evidenceBuffer);

    const zgFile = await ZgFile.fromFilePath(tmpPath);
    const provider = new ethers.JsonRpcProvider(rpcEndpoint);
    const signer = new ethers.Wallet(privateKey, provider);

    const indexer = new Indexer(indexerRpc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [result, uploadErr] = await indexer.upload(zgFile, rpcEndpoint, signer as any);

    await zgFile.close();

    if (uploadErr) throw new Error(`Upload error: ${uploadErr}`);

    console.log(`[StorageClient] Evidence uploaded. tx=${result.txHash} root=${result.rootHash}`);
    return result.rootHash.startsWith("0x") ? result.rootHash : "0x" + result.rootHash;
  } catch (err) {
    // FALLBACK: if SDK upload fails, return SHA256 of evidence as proof of content
    console.error("[StorageClient] 0G Storage upload failed, using content hash as fallback:", err);
    const fallbackHash =
      "0x" + createHash("sha256").update(evidenceBuffer).digest("hex");
    console.warn(`[StorageClient] Evidence hash (fallback SHA256): ${fallbackHash}`);
    return fallbackHash;
  } finally {
    if (tmpPath) {
      try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    }
  }
}
