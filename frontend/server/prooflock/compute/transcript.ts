import { InferenceVerifier } from "@0gfoundation/0g-compute-ts-sdk";
import { sha256, toUtf8Bytes } from "ethers";
import { z } from "zod";

import type { HexAddress } from "../types";
import type { ComputeHttpResponse } from "./safe-https";
import { computeFailure } from "./strict-error";

export type SignatureVerifier = Readonly<{
  verifySignature(text: string, signature: string, expectedSigner: string): boolean;
}>;

export type FetchedSignature = Readonly<{
  parsed: SignatureResponse;
  rawBody: Uint8Array;
  url: string;
}>;

export type ContentBinding = Readonly<{
  expectedSigner: HexAddress;
  signedText: string;
  requestSha256: `0x${string}`;
  responseSha256: `0x${string}`;
  signature: string;
  signedTextSha256: `0x${string}`;
  signatureVerified: true;
}>;

const signatureSchema = z
  .object({
    text: z.string().trim().min(1).max(256),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    signing_address: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
  })
  .passthrough();
type SignatureResponse = z.infer<typeof signatureSchema>;

export function parseSignature(bytes: Uint8Array): SignatureResponse {
  try {
    const parsed = signatureSchema.safeParse(JSON.parse(decodeUtf8(bytes)));
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } catch (error) {
    throw computeFailure("COMPUTE_SIGNATURE_INVALID", "signature response is malformed", error);
  }
}

export function verifyContentBinding(
  signature: SignatureResponse,
  expectedSigner: HexAddress,
  requestBytes: Uint8Array,
  responseBytes: Uint8Array,
  verifier: SignatureVerifier = InferenceVerifier,
): ContentBinding {
  assertNamedSigner(signature.signing_address, expectedSigner);
  verifyEip191(signature, expectedSigner, verifier);
  const hashes = parseSignedText(signature.text);
  const requestSha256 = sha256(requestBytes) as `0x${string}`;
  const responseSha256 = sha256(responseBytes) as `0x${string}`;
  if (hashes.request !== requestSha256.slice(2)) bindingFailure("COMPUTE_REQUEST_BINDING_FAILED");
  if (hashes.response !== responseSha256.slice(2))
    bindingFailure("COMPUTE_RESPONSE_BINDING_FAILED");
  return {
    expectedSigner,
    signedText: signature.text,
    requestSha256,
    responseSha256,
    signature: signature.signature.toLowerCase(),
    signedTextSha256: sha256(toUtf8Bytes(signature.text)) as `0x${string}`,
    signatureVerified: true,
  };
}

export function responseHeadersSha256(headers: ComputeHttpResponse["headers"]): `0x${string}` {
  return sha256(toUtf8Bytes(JSON.stringify(normalizeResponseHeaders(headers)))) as `0x${string}`;
}

export function normalizeResponseHeaders(headers: ComputeHttpResponse["headers"]): readonly (readonly [string, string])[] {
  const sensitive = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);
  return headers
    .map(([name, value]) => [name.trim().toLowerCase(), value.trim()] as const)
    .filter(([name]) => !sensitive.has(name))
    .sort(compareHeaders);
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw computeFailure("COMPUTE_RESPONSE_INVALID", "bytes are not valid UTF-8", error);
  }
}

function assertNamedSigner(named: string | undefined, expected: string): void {
  if (named && !sameAddress(named, expected)) {
    throw computeFailure("COMPUTE_SIGNER_MISMATCH", "signature response names another signer");
  }
}

function verifyEip191(
  signature: SignatureResponse,
  expectedSigner: string,
  verifier: SignatureVerifier,
): void {
  try {
    if (verifier.verifySignature(signature.text, signature.signature, expectedSigner)) return;
  } catch (error) {
    throw computeFailure("COMPUTE_SIGNATURE_INVALID", "provider signature is malformed", error);
  }
  throw computeFailure("COMPUTE_SIGNATURE_INVALID", "signature does not match expected signer");
}

function parseSignedText(text: string) {
  const parts = /^([0-9a-f]{64}):([0-9a-f]{64})$/.exec(text);
  if (!parts) {
    throw computeFailure("COMPUTE_SIGNED_TEXT_INVALID", "signed text is not two SHA-256 hashes");
  }
  return { request: parts[1], response: parts[2] };
}

function bindingFailure(
  code: "COMPUTE_REQUEST_BINDING_FAILED" | "COMPUTE_RESPONSE_BINDING_FAILED",
): never {
  throw computeFailure(code, "provider signature does not bind the exact HTTP bytes");
}

function sameAddress(left: string, right: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(left) && left.toLowerCase() === right.toLowerCase();
}

function compareHeaders(left: readonly string[], right: readonly string[]) {
  return left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0]);
}
