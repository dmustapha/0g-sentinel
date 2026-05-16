// File: scanner/storage.ts
import { createHash } from "crypto";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface EvidenceArchive {
  agent_address: string;
  scan_timestamp: number;
  behavioral_data: {
    data_source?: string;
    tx_count_analyzed?: number;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let zgFile: any = null;

  try {
    const { ZgFile, Indexer } = await import("@0gfoundation/0g-ts-sdk");
    const { ethers } = await import("ethers");

    const rpcEndpoint = process.env.ZERO_G_RPC || "https://evmrpc.0g.ai";
    const indexerRpc =
      process.env.ZERO_G_STORAGE_INDEXER ||
      "https://indexer-storage-turbo.0g.ai";
    const privateKey = process.env.ZERO_G_PRIVATE_KEY || process.env.SCANNER_PRIVATE_KEY || "";

    // Write evidence to temp file — ZgFile only supports fromFilePath/fromNodeFileHandle
    tmpPath = join(tmpdir(), `0g-evidence-${Date.now()}.json`);
    writeFileSync(tmpPath, evidenceBuffer);

    zgFile = await ZgFile.fromFilePath(tmpPath);
    const provider = new ethers.JsonRpcProvider(rpcEndpoint);
    const signer = new ethers.Wallet(privateKey, provider);

    const indexer = new Indexer(indexerRpc);
    // Hard 30s timeout — SDK upload can hang indefinitely if the storage node is unresponsive
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [result, uploadErr] = await Promise.race([
      indexer.upload(zgFile, rpcEndpoint, signer as any),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("0G Storage upload timeout (30s)")), 30_000)
      ),
    ]);

    if (uploadErr) throw new Error(`Upload error: ${uploadErr}`);

    // New SDK returns single-file or fragment result — evidence is always single-file
    const rootHash = "rootHash" in result ? result.rootHash : result.rootHashes[0];
    const txHash = "txHash" in result ? result.txHash : result.txHashes[0];
    console.log(`[StorageClient] Evidence uploaded. tx=${txHash} root=${rootHash}`);
    return rootHash.startsWith("0x") ? rootHash : "0x" + rootHash;
  } catch (err) {
    // FALLBACK: if SDK upload fails, return SHA256 of evidence as proof of content
    console.error("[StorageClient] 0G Storage upload failed, using content hash as fallback:", err);
    const fallbackHash =
      "0x" + createHash("sha256").update(evidenceBuffer).digest("hex");
    console.warn(`[StorageClient] Evidence hash (fallback SHA256): ${fallbackHash}`);
    return fallbackHash;
  } finally {
    if (zgFile) {
      try { await zgFile.close(); } catch { /* ignore close errors */ }
    }
    if (tmpPath) {
      try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    }
  }
}
