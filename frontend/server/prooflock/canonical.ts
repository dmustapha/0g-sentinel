import { keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "json-canonicalize";
import { z } from "zod";

import { EvidenceValidationError } from "./errors";
import type {
  Bytes32,
  EvidenceEnvelopeV1,
  StorageCommitment,
} from "./types";

const nonEmpty = z.string().refine((value) => value.trim().length > 0);
const decimalString = z.string().regex(/^(0|[1-9]\d*)$/);
const safeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger);
const positiveInteger = safeInteger.refine((value) => value > 0);
// Hex values are normalized to lowercase before JCS so casing cannot alter proof bytes.
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase() as `0x${string}`);
const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase() as Bytes32);

const deterministicCheckSchema = z
  .object({
    id: nonEmpty,
    version: nonEmpty,
    status: z.enum(["PASS", "WARN", "FAIL", "NOT_APPLICABLE"]),
    inputDigest: bytes32,
    outputDigest: bytes32,
    findings: z.array(nonEmpty),
  })
  .strict();

const computeProofSchema = z
  .object({
    purpose: z.enum(["behavioral-risk", "contract-risk"]),
    provider: nonEmpty,
    model: nonEmpty,
    chatId: nonEmpty,
    receiptDigest: bytes32,
    requestDigest: bytes32,
    responseDigest: bytes32,
    usage: z
      .object({
        promptTokens: safeInteger,
        completionTokens: safeInteger,
        totalTokens: safeInteger,
      })
      .strict(),
    processResponseVerified: z.literal(true),
  })
  .strict()
  .superRefine((proof, context) => {
    if (proof.receiptDigest !== receiptDigest(proof.chatId)) {
      context.addIssue({ code: "custom", message: "receipt digest mismatch" });
    }
  });

const evidenceEnvelopeSchema = z
  .object({
    schema: z.literal("sentinel.prooflock/evidence-v1"),
    proofClass: z.literal("COMPUTE_VERIFIED"),
    schemaVersion: positiveInteger,
    policyVersion: positiveInteger,
    identity: z
      .object({
        namespace: z.literal("eip155"),
        chainId: z.literal(16661),
        registryAddress: address,
        agentId: decimalString,
        owner: address,
        agentWallet: address,
        registrationUri: nonEmpty,
        registrationDigest: bytes32,
      })
      .strict(),
    source: z
      .object({ blockNumber: decimalString, blockHash: bytes32 })
      .strict(),
    subject: z
      .object({
        address,
        kind: z.enum(["EOA", "EIP7702_DELEGATED_EOA", "CONTRACT"]),
        runtimeCodeHash: bytes32,
        delegationCodeHash: bytes32.optional(),
        proxyImplementationCodeHash: bytes32.optional(),
      })
      .strict(),
    deterministicChecks: z.array(deterministicCheckSchema).min(1),
    computeProofs: z.array(computeProofSchema).min(1),
    verdict: z
      .object({
        riskScore: safeInteger.max(100),
        label: z.enum(["SAFE", "CAUTION", "FLAGGED"]),
      })
      .strict(),
    omissions: z.array(nonEmpty),
    scanner: z.object({ address, softwareVersion: nonEmpty }).strict(),
    previousProofId: bytes32.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateIssue(value.deterministicChecks.map((check) => check.id), "check", context);
    addDuplicateIssue(value.computeProofs.map((proof) => proof.receiptDigest), "receipt", context);
  });

const storageCommitmentSchema = z
  .object({
    envelopeDigest: bytes32,
    rootHash: bytes32,
    uploadTxHash: bytes32,
    retrievedDigest: bytes32,
    finalizedAtBlock: decimalString,
    retrievalVerified: z.literal(true),
  })
  .strict();

export function validateEvidenceEnvelope(value: unknown): EvidenceEnvelopeV1 {
  rejectNonCanonicalValues(value);
  return parse(evidenceEnvelopeSchema, value) as EvidenceEnvelopeV1;
}

export function canonicalizeEvidence(value: unknown): string {
  return serialize(validateEvidenceEnvelope(value));
}

export function hashCanonical(value: unknown): Bytes32 {
  return keccak256(toUtf8Bytes(canonicalizeEvidence(value))) as Bytes32;
}

export function receiptDigest(chatId: string): Bytes32 {
  if (chatId.trim().length === 0) throw new EvidenceValidationError("empty chat ID");
  return keccak256(toUtf8Bytes(chatId)) as Bytes32;
}

export function validateStorageCommitment(value: unknown): StorageCommitment {
  rejectNonCanonicalValues(value);
  return parse(storageCommitmentSchema, value) as StorageCommitment;
}

export function canonicalizeStorageCommitment(value: unknown): string {
  return serialize(validateStorageCommitment(value));
}

function parse(schema: z.ZodType, value: unknown): unknown {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.message).join("; ");
    throw new EvidenceValidationError(`invalid ProofLock evidence: ${details}`, result.error);
  }
  return result.data;
}

function serialize(value: unknown): string {
  const result = canonicalize(value);
  if (typeof result !== "string") throw new EvidenceValidationError("cannot canonicalize evidence");
  return result;
}

function addDuplicateIssue(values: readonly string[], label: string, context: z.RefinementCtx) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: `duplicate ${label}` });
  }
}

function rejectNonCanonicalValues(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === "bigint" || (typeof value === "number" && !Number.isFinite(value))) {
    throw new EvidenceValidationError("non-canonical numeric value");
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new EvidenceValidationError("cyclic evidence");
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) throw new EvidenceValidationError(`undefined value at ${key}`);
    rejectNonCanonicalValues(child, seen);
  }
  seen.delete(value);
}
