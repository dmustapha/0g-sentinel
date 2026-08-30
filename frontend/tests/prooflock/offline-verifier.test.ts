import { describe, expect, it } from "vitest";
import { Wallet, keccak256, sha256, toUtf8Bytes } from "ethers";

import { receiptDigest, canonicalizeStorageCommitment } from "../../server/prooflock/canonical";
import { responseHeadersSha256 } from "../../server/prooflock/compute/transcript";
import { verifyOfflineComputeProof, verifyStorageArtifactBinding } from "../../server/prooflock/offline-verifier";
import type { ComputeProof, StorageCommitment } from "../../server/prooflock/types";

const provider = "0x1111111111111111111111111111111111111111" as const;

async function proofFixture(models: { registered?: string; served?: string } = {}) {
  const wallet = Wallet.createRandom();
  const registeredModel = models.registered ?? "model-tee";
  const servedModel = models.served ?? registeredModel;
  const model = servedModel;
  const chatId = "chat-offline-1";
  const request = new TextEncoder().encode(JSON.stringify({ model: registeredModel, messages: [{ role: "user", content: "audit" }] }));
  const content = JSON.stringify({ riskScore: 12 });
  const response = new TextEncoder().encode(JSON.stringify({
    id: chatId, model: servedModel, choices: [{ message: { content } }],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    x_0g_trace: { provider },
  }));
  const signedText = `${sha256(request).slice(2)}:${sha256(response).slice(2)}`;
  const signature = await wallet.signMessage(signedText);
  const headers = [["content-type", "application/json"], ["zg-res-key", chatId]] as const;
  const serviceSnapshot = {
    provider, url: "https://compute.example", model: registeredModel,
    additionalInfo: JSON.stringify({ ProviderType: "centralized", TargetSeparated: true, TEEVerifier: "dstack", TargetTeeAddress: "" }),
    verifiability: "TeeML",
    teeSignerAddress: wallet.address as `0x${string}`, teeSignerAcknowledged: true,
  } as const;
  const proof: ComputeProof = {
    proofClass: "DECENTRALIZED_MODEL_TEE", purpose: "behavioral-risk", provider, model, chatId,
    receiptDigest: receiptDigest(chatId), requestDigest: sha256(request) as `0x${string}`,
    responseDigest: keccak256(toUtf8Bytes(content)) as `0x${string}`, signatureScheme: "EIP191",
    expectedSigner: wallet.address.toLowerCase() as `0x${string}`, signature,
    signedTextSha256: sha256(toUtf8Bytes(signedText)) as `0x${string}`,
    requestSha256: sha256(request) as `0x${string}`, rawResponseSha256: sha256(response) as `0x${string}`,
    receiptSource: "ZG-Res-Key", responseHeadersSha256: responseHeadersSha256(headers),
    usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 }, processResponseVerified: true,
    requestBodyBase64: Buffer.from(request).toString("base64"),
    rawResponseBodyBase64: Buffer.from(response).toString("base64"), signedText,
    normalizedResponseHeaders: headers, serviceSnapshot,
  };
  return { proof, serviceSnapshot };
}

describe("offline Compute verifier", () => {
  it("re-verifies exact transcript bytes, EIP-191 signer, response, and live service snapshot", async () => {
    const { proof, serviceSnapshot } = await proofFixture();
    expect(verifyOfflineComputeProof(proof, serviceSnapshot)).toEqual({
      proofClass: "DECENTRALIZED_MODEL_TEE", signatureVerified: true,
      transcriptVerified: true, serviceSnapshotVerified: true,
    });
  });

  it("verifies when the served runtime model differs from the registered catalog model", async () => {
    const { proof, serviceSnapshot } = await proofFixture({ registered: "0GM-1.0-35B-A3B", served: "z-ai/glm-5" });
    expect(proof.model).toBe("z-ai/glm-5");
    expect(serviceSnapshot.model).toBe("0GM-1.0-35B-A3B");
    expect(verifyOfflineComputeProof(proof, serviceSnapshot)).toMatchObject({
      transcriptVerified: true, serviceSnapshotVerified: true,
    });
  });

  it("rejects a forged signature", async () => {
    const { proof, serviceSnapshot } = await proofFixture();
    const forged = { ...proof, signature: `0x${"11".repeat(65)}` } as ComputeProof;
    expect(() => verifyOfflineComputeProof(forged, serviceSnapshot)).toThrow();
  });

  it("rejects a changed service snapshot", async () => {
    const { proof, serviceSnapshot } = await proofFixture();
    expect(() => verifyOfflineComputeProof(proof, { ...serviceSnapshot, model: "other" })).toThrow();
  });

  it("rejects legacy proofs that omitted exact transcript provenance", async () => {
    const { proof, serviceSnapshot } = await proofFixture();
    const legacy = { ...proof, requestBodyBase64: undefined, rawResponseBodyBase64: undefined } as unknown as ComputeProof;
    expect(() => verifyOfflineComputeProof(legacy, serviceSnapshot)).toThrow("provenance");
  });
});

describe("Storage artifact binding", () => {
  it("requires canonical StorageCommitment keccak to equal artifactHash", () => {
    const commitment: StorageCommitment = {
      envelopeDigest: `0x${"11".repeat(32)}`, storageRoot: `0x${"22".repeat(32)}`,
      uploadTxHash: `0x${"33".repeat(32)}`, retrievedDigest: `0x${"11".repeat(32)}`,
      finalizedAtBlock: "102", retrievalVerified: true, networkProofVerified: false,
    };
    const artifactHash = keccak256(toUtf8Bytes(canonicalizeStorageCommitment(commitment)));
    expect(verifyStorageArtifactBinding(artifactHash, commitment)).toBe(true);
    expect(() => verifyStorageArtifactBinding(`0x${"99".repeat(32)}`, commitment)).toThrow();
  });
});
