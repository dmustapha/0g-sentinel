import { keccak256, sha256, toUtf8Bytes } from "ethers";

import { canonicalizeStorageCommitment, receiptDigest } from "./canonical";
import { resolveExpectedSigner, validateBaseUrl, type ServiceDetail } from "./compute/service";
import { normalizeResponseHeaders, responseHeadersSha256, verifyContentBinding } from "./compute/transcript";
import type { ComputeProof, ComputeServiceSnapshot, StorageCommitment } from "./types";

const MAX_TRANSCRIPT_BYTES = 524_288;

export function verifyOfflineComputeProof(
  proof: ComputeProof,
  liveServiceInput: ServiceDetail,
) {
  const extension = requireExtension(proof);
  const request = decodeBase64(extension.requestBodyBase64);
  const response = decodeBase64(extension.rawResponseBodyBase64);
  if (request.length + response.length > MAX_TRANSCRIPT_BYTES) invalid("Compute transcript is too large");
  const snapshot = normalizeService(extension.serviceSnapshot);
  const liveService = normalizeService(liveServiceInput);
  assertService(snapshot, liveService, proof);
  const binding = verifyContentBinding({ text: extension.signedText, signature: proof.signature,
    signing_address: proof.expectedSigner }, proof.expectedSigner, request, response);
  if (binding.requestSha256 !== proof.requestSha256 || binding.responseSha256 !== proof.rawResponseSha256
    || binding.signedTextSha256 !== proof.signedTextSha256 || proof.requestDigest !== proof.requestSha256) {
    invalid("Compute transcript digest mismatch");
  }
  assertHeaders(extension.normalizedResponseHeaders, proof);
  assertBodies(request, response, proof);
  return Object.freeze({ proofClass: "DECENTRALIZED_MODEL_TEE" as const, signatureVerified: true as const,
    transcriptVerified: true as const, serviceSnapshotVerified: true as const });
}

export function verifyStorageArtifactBinding(artifactHash: string, commitment: StorageCommitment): true {
  const expected = keccak256(toUtf8Bytes(canonicalizeStorageCommitment(commitment)));
  if (expected.toLowerCase() !== artifactHash.toLowerCase()) invalid("Storage artifact hash mismatch");
  if (commitment.networkProofVerified !== false) invalid("Storage network proof claim is invalid");
  return true;
}

function requireExtension(proof: ComputeProof) {
  if (!proof.requestBodyBase64 || !proof.rawResponseBodyBase64 || !proof.signedText
    || !proof.normalizedResponseHeaders || !proof.serviceSnapshot) {
    invalid("Compute proof lacks exact transcript provenance");
  }
  return { requestBodyBase64: proof.requestBodyBase64, rawResponseBodyBase64: proof.rawResponseBodyBase64,
    signedText: proof.signedText, normalizedResponseHeaders: proof.normalizedResponseHeaders,
    serviceSnapshot: proof.serviceSnapshot };
}

function assertService(snapshot: ServiceDetail, live: ServiceDetail, proof: ComputeProof): void {
  const keys = ["provider", "url", "model", "additionalInfo", "verifiability", "teeSignerAddress", "teeSignerAcknowledged"] as const;
  if (keys.some((key) => snapshot[key] !== live[key])) invalid("Compute service snapshot mismatch");
  validateBaseUrl(live.url);
  const expectedSigner = resolveExpectedSigner(live);
  if (live.provider !== proof.provider.toLowerCase() || live.model !== proof.model
    || expectedSigner !== proof.expectedSigner.toLowerCase()) invalid("Compute proof service binding mismatch");
}

function assertHeaders(headers: readonly (readonly [string, string])[], proof: ComputeProof): void {
  const normalized = normalizeResponseHeaders(headers);
  if (JSON.stringify(normalized) !== JSON.stringify(headers)
    || responseHeadersSha256(headers) !== proof.responseHeadersSha256) invalid("Compute response headers mismatch");
  const receipt = header(headers, "zg-res-key");
  if (proof.receiptSource === "ZG-Res-Key" && receipt !== proof.chatId) invalid("Compute receipt header mismatch");
}

function assertBodies(requestBytes: Uint8Array, responseBytes: Uint8Array, proof: ComputeProof): void {
  const request = parseObject(requestBytes);
  const response = parseObject(responseBytes);
  if (request.model !== proof.model || response.model !== proof.model) invalid("Compute model mismatch");
  const choices = response.choices as readonly { message?: { content?: unknown } }[] | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string" || keccak256(toUtf8Bytes(content)) !== proof.responseDigest) invalid("Compute response content mismatch");
  const usage = response.usage as Record<string, unknown> | undefined;
  if (!usage || usage.prompt_tokens !== proof.usage.promptTokens || usage.completion_tokens !== proof.usage.completionTokens
    || usage.total_tokens !== proof.usage.totalTokens) invalid("Compute usage mismatch");
  const trace = response.x_0g_trace as Record<string, unknown> | undefined;
  if (trace?.provider !== undefined && String(trace.provider).toLowerCase() !== proof.provider.toLowerCase()) invalid("Compute provider mismatch");
  const bodyId = response.id;
  if (proof.receiptSource === "body-id-fallback" && bodyId !== proof.chatId) invalid("Compute body receipt mismatch");
  if (receiptDigest(proof.chatId) !== proof.receiptDigest) invalid("Compute receipt digest mismatch");
  if (sha256(requestBytes) !== proof.requestSha256 || sha256(responseBytes) !== proof.rawResponseSha256) invalid("Compute byte digest mismatch");
}

function parseObject(bytes: Uint8Array): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { invalid("Compute transcript JSON is invalid"); }
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) invalid("Compute transcript base64 is invalid");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) invalid("Compute transcript base64 is noncanonical");
  return bytes;
}

function normalizeService(value: ComputeServiceSnapshot | ServiceDetail): ServiceDetail {
  return { ...value, provider: value.provider.toLowerCase(), teeSignerAddress: value.teeSignerAddress.toLowerCase() };
}

function header(headers: readonly (readonly [string, string])[], name: string): string | undefined {
  return headers.find(([candidate]) => candidate === name)?.[1];
}

function invalid(message: string): never { throw new Error(message); }
