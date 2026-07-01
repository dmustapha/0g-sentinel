// File: scanner/storage.ts
import { createHash, randomBytes } from "crypto";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { StaticAnalysisResult } from "./static-analysis";

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
  // Deterministic static-analysis result, archived alongside the AI verdict so the
  // evidence hash anchors the reproducible ground truth, not just the model opinion.
  code_static_analysis?: StaticAnalysisResult;
}

export interface EvidenceUploadResult {
  /** bytes32 hash written on-chain: a real 0G Storage root when isFallback is false, else a SHA256 of the content. */
  hash: string;
  /** true when the 0G Storage upload failed and hash is a local SHA256 content hash (NOT retrievable from 0G Storage). */
  isFallback: boolean;
}

export async function uploadEvidence(evidence: EvidenceArchive): Promise<EvidenceUploadResult> {
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
    // randomBytes(4) suffix prevents collision when two scans run in the same millisecond
    tmpPath = join(tmpdir(), `0g-evidence-${Date.now()}-${randomBytes(4).toString("hex")}.json`);
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
    const hash = rootHash.startsWith("0x") ? rootHash : "0x" + rootHash;
    return { hash, isFallback: false };
  } catch (err) {
    // FALLBACK: if SDK upload fails, return SHA256 of evidence as proof of content.
    // isFallback flags this so callers/UI never present a local content hash as a 0G Storage root.
    console.error("[StorageClient] 0G Storage upload failed, using content hash as fallback:", err);
    const fallbackHash =
      "0x" + createHash("sha256").update(evidenceBuffer).digest("hex");
    console.warn(`[StorageClient] Evidence hash (fallback SHA256): ${fallbackHash}`);
    return { hash: fallbackHash, isFallback: true };
  } finally {
    if (zgFile) {
      try { await zgFile.close(); } catch { /* ignore close errors */ }
    }
    if (tmpPath) {
      try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    }
  }
}
