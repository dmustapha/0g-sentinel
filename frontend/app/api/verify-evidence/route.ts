import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const VERIFICATION_TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  let body: { evidenceHash?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { evidenceHash } = body;
  if (!evidenceHash || typeof evidenceHash !== "string" || !evidenceHash.match(/^0x[0-9a-fA-F]{64}$/)) {
    return NextResponse.json({ error: "Invalid evidenceHash (must be bytes32 hex)" }, { status: 400 });
  }

  if (evidenceHash === "0x" + "0".repeat(64)) {
    return NextResponse.json({ verified: false, reason: "Evidence hash is zero (no storage upload)" });
  }

  const tmpPath = join(tmpdir(), `0g-verify-${Date.now()}.json`);
  try {
    const { Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
    const indexerRpc = process.env.ZERO_G_STORAGE_INDEXER || "https://indexer-storage-turbo.0g.ai";
    const indexer = new Indexer(indexerRpc);

    const err = await Promise.race([
      indexer.download(evidenceHash, tmpPath, true),
      new Promise<Error>((_, rej) =>
        setTimeout(() => rej(new Error("Download timeout (30s)")), VERIFICATION_TIMEOUT_MS)
      ),
    ]);

    if (err) {
      // Honest failure: a hash that cannot be downloaded is either a content-hash fallback
      // (0G Storage upload failed at scan time) or a genuinely unretrievable root.
      return NextResponse.json({
        verified: false,
        reason: `Not retrievable from 0G Storage (${(err as Error).message}). If 0G Storage was unavailable at scan time, evidence was anchored on-chain as a content hash rather than uploaded.`,
      });
    }

    const content = readFileSync(tmpPath);
    const contentHash = "0x" + createHash("sha256").update(content).digest("hex");

    return NextResponse.json({
      verified: true,
      evidenceHash,
      contentHash,
      contentSize: content.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ verified: false, reason: message });
  } finally {
    if (existsSync(tmpPath)) { try { unlinkSync(tmpPath); } catch { /* ignore */ } }
  }
}
