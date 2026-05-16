import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
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
    return NextResponse.json({ verified: false, reason: "Evidence hash is zero — no storage upload" });
  }

  const tmpPath = join(tmpdir(), `0g-verify-${Date.now()}.json`);
  try {
    const { Indexer } = await import("@0gfoundation/0g-ts-sdk");
    const indexerRpc = process.env.ZERO_G_STORAGE_INDEXER || "https://indexer-storage-turbo.0g.ai";
    const indexer = new Indexer(indexerRpc);

    const err = await Promise.race([
      indexer.download(evidenceHash, tmpPath, true),
      new Promise<Error>((_, rej) =>
        setTimeout(() => rej(new Error("Download timeout (30s)")), VERIFICATION_TIMEOUT_MS)
      ),
    ]);

    if (err) {
      return NextResponse.json({ verified: false, reason: (err as Error).message });
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
