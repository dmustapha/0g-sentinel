import { keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "json-canonicalize";
import { z } from "zod";

import { EvidenceValidationError } from "./errors";
import { ERC8004_IDENTITY_REGISTRY } from "./types";
import type { Bytes32, EvidenceEnvelopeV1, StorageCommitment } from "./types";

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const UINT32_MAX = 4_294_967_295;
const MAX_NODES = 10_000;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const decimalPattern = /^(0|[1-9]\d*)$/;
const safeInteger = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger)
  .refine((value) => !Object.is(value, -0), "negative zero is not canonical");
const policyVersion = safeInteger.refine((value) => value >= 1 && value <= UINT32_MAX, "policyVersion must fit uint32");
// Hex values are normalized to lowercase before JCS so casing cannot alter proof bytes.
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((value) => !/^0x0{40}$/i.test(value), "zero address is not allowed")
  .transform((value) => value.toLowerCase() as `0x${string}`);
const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase() as Bytes32);
const nonZeroBytes32 = bytes32.refine((value) => value !== ZERO_BYTES32, "zero bytes32 is not allowed");
const eip191Signature = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/)
  .transform((value) => value.toLowerCase());
const uint64String = boundedDecimal(UINT64_MAX, "uint64 block number");
const uint256String = boundedDecimal(UINT256_MAX, "uint256 agent ID");
const identityRegistry = address.refine((value) => value === ERC8004_IDENTITY_REGISTRY, "identity registry mismatch");

const deterministicCheckSchema = z
  .object({
    id: boundedString(128),
    version: boundedString(128),
    status: z.enum(["PASS", "WARN", "FAIL", "NOT_APPLICABLE"]),
    inputDigest: nonZeroBytes32,
    outputDigest: nonZeroBytes32,
    findings: z.array(boundedString(2048)).max(100),
  })
  .strict();

const usageSchema = z
  .object({
    promptTokens: safeInteger,
    completionTokens: safeInteger,
    totalTokens: safeInteger,
  })
  .strict()
  .superRefine((usage, context) => {
    const total = usage.promptTokens + usage.completionTokens;
    if (!Number.isSafeInteger(total)) addIssue(context, "token count overflow");
    else if (usage.totalTokens !== total) addIssue(context, "totalTokens mismatch");
  });

const serviceSnapshotSchema = z.object({
  provider: address,
  url: boundedString(4096),
  model: boundedString(256),
  additionalInfo: boundedString(65_536),
  teeSignerAddress: address,
  teeSignerAcknowledged: z.boolean(),
}).strict();
const transcriptHeaderSchema = z.tuple([boundedString(256), boundedString(8192)]);
const base64 = boundedString(700_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

const computeProofSchema = z
  .object({
    proofClass: z.literal("DECENTRALIZED_MODEL_TEE"),
    purpose: z.enum(["behavioral-risk", "contract-risk"]),
    provider: address,
    model: boundedString(256),
    chatId: boundedString(512),
    receiptDigest: nonZeroBytes32,
    requestDigest: nonZeroBytes32,
    responseDigest: nonZeroBytes32,
    signatureScheme: z.literal("EIP191"),
    expectedSigner: address,
    signature: eip191Signature,
    signedTextSha256: nonZeroBytes32,
    requestSha256: nonZeroBytes32,
    rawResponseSha256: nonZeroBytes32,
    receiptSource: z.enum(["ZG-Res-Key", "body-id-fallback"]),
    responseHeadersSha256: nonZeroBytes32,
    usage: usageSchema,
    processResponseVerified: z.literal(true),
    requestBodyBase64: base64.optional(),
    rawResponseBodyBase64: base64.optional(),
    signedText: boundedString(256).optional(),
    normalizedResponseHeaders: z.array(transcriptHeaderSchema).max(100).optional(),
    serviceSnapshot: serviceSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((proof, context) => {
    if (proof.receiptDigest !== receiptDigest(proof.chatId)) {
      context.addIssue({ code: "custom", message: "receipt digest mismatch" });
    }
    const extension = [proof.requestBodyBase64, proof.rawResponseBodyBase64, proof.signedText,
      proof.normalizedResponseHeaders, proof.serviceSnapshot];
    const count = extension.filter((value) => value !== undefined).length;
    if (count !== 0 && count !== extension.length) addIssue(context, "Compute provenance extension must be complete");
  });

const evidenceEnvelopeSchema = z
  .object({
    schema: z.literal("sentinel.prooflock/evidence-v1"),
    proofClass: z.literal("COMPUTE_VERIFIED"),
    schemaVersion: z.literal(1),
    policyVersion,
    coverage: z
      .object({
        preStorageMask: z.literal(0x5f),
        requiredSealMask: z.literal(0x7f),
        identityValidated: z.literal(true),
        subjectClassified: z.literal(true),
        deterministicChecksRun: z.literal(true),
        behavioralComputeVerified: z.literal(true),
        codeCompute: z.discriminatedUnion("status", [
          z.object({ status: z.literal("VERIFIED") }).strict(),
          z
            .object({
              status: z.literal("NOT_APPLICABLE"),
              reason: boundedString(2048),
            })
            .strict(),
        ]),
        evidenceStorage: z.literal("PENDING_EXTERNAL_COMMITMENT"),
        policyEvaluated: z.literal(true),
      })
      .strict(),
    identity: z
      .object({
        namespace: z.literal("eip155"),
        chainId: z.literal(16661),
        registryAddress: identityRegistry,
        agentId: uint256String,
        owner: address,
        agentWallet: address,
        registrationUri: boundedString(4096),
        registrationDigest: nonZeroBytes32,
      })
      .strict(),
    source: z.object({ blockNumber: uint64String, blockHash: nonZeroBytes32 }).strict(),
    subject: z
      .object({
        address,
        kind: z.enum(["EOA", "EIP7702_DELEGATED_EOA", "CONTRACT"]),
        runtimeCodeHash: bytes32,
        delegationTarget: address.optional(),
        delegationCodeHash: nonZeroBytes32.optional(),
        proxyImplementation: address.optional(),
        proxyImplementationCodeHash: nonZeroBytes32.optional(),
      })
      .strict(),
    deterministicChecks: z.array(deterministicCheckSchema).min(1).max(64),
    computeProofs: z.array(computeProofSchema).min(1).max(2),
    verdict: z
      .object({
        riskScore: safeInteger.max(100),
        label: z.enum(["SAFE", "CAUTION", "FLAGGED"]),
      })
      .strict(),
    omissions: z.array(boundedString(2048)).max(100),
    scanner: z.object({ address, softwareVersion: boundedString(128) }).strict(),
    previousProofId: nonZeroBytes32.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateIssue(
      value.deterministicChecks.map((check) => check.id),
      "check",
      context,
    );
    addDuplicateIssue(
      value.computeProofs.map((proof) => proof.receiptDigest),
      "receipt",
      context,
    );
    addDuplicateIssue(
      value.computeProofs.map((proof) => proof.purpose),
      "purpose",
      context,
    );
    addComputeIssues(value, context);
    addSubjectIssues(value.subject, context);
    if (value.identity.agentWallet !== value.subject.address) {
      addIssue(context, "identity agent wallet must equal subject address");
    }
  });

const storageCommitmentSchema = z
  .object({
    envelopeDigest: nonZeroBytes32,
    storageRoot: nonZeroBytes32,
    uploadTxHash: nonZeroBytes32,
    retrievedDigest: nonZeroBytes32,
    finalizedAtBlock: uint64String,
    retrievalVerified: z.literal(true),
    networkProofVerified: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.retrievedDigest !== value.envelopeDigest) {
      addIssue(context, "retrieved digest must equal envelope digest");
    }
  });

export function validateEvidenceEnvelope(value: unknown): EvidenceEnvelopeV1 {
  rejectNonCanonicalValues(value);
  return parse(evidenceEnvelopeSchema, value);
}

export function canonicalizeEvidence(value: unknown): string {
  return serialize(validateEvidenceEnvelope(value));
}

export function hashCanonical(value: unknown): Bytes32 {
  return keccak256(toUtf8Bytes(canonicalizeEvidence(value))) as Bytes32;
}

export function receiptDigest(chatId: string): Bytes32 {
  if (chatId.trim().length === 0) throw new EvidenceValidationError("empty chat ID");
  if (chatId.length > 512) throw new EvidenceValidationError("chat ID exceeds 512 characters");
  assertWellFormedUnicode(chatId);
  return keccak256(toUtf8Bytes(chatId)) as Bytes32;
}

export function validateStorageCommitment(value: unknown): StorageCommitment {
  rejectNonCanonicalValues(value);
  return parse(storageCommitmentSchema, value);
}

export function canonicalizeStorageCommitment(value: unknown): string {
  return serialize(validateStorageCommitment(value));
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
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

type ComputeInvariantInput = {
  coverage: { codeCompute: { status: "VERIFIED" | "NOT_APPLICABLE" } };
  subject: { kind: "EOA" | "EIP7702_DELEGATED_EOA" | "CONTRACT" };
  computeProofs: readonly { purpose: "behavioral-risk" | "contract-risk" }[];
};

function addComputeIssues(value: ComputeInvariantInput, context: z.RefinementCtx) {
  const behavioral = countPurpose(value, "behavioral-risk");
  const contract = countPurpose(value, "contract-risk");
  if (behavioral !== 1) addIssue(context, "exactly one behavioral-risk proof required");
  if (value.coverage.codeCompute.status === "VERIFIED" && contract !== 1) {
    addIssue(context, "exactly one contract-risk proof required when code Compute is verified");
  }
  if (value.coverage.codeCompute.status === "NOT_APPLICABLE") {
    if (value.subject.kind !== "EOA") {
      addIssue(context, "code Compute is not applicable only to EOA subjects");
    }
    if (contract !== 0) {
      addIssue(context, "contract-risk proof forbidden when code Compute is not applicable");
    }
  }
}

function countPurpose(value: ComputeInvariantInput, purpose: string): number {
  return value.computeProofs.filter((proof) => proof.purpose === purpose).length;
}

type SubjectInvariantInput = {
  kind: "EOA" | "EIP7702_DELEGATED_EOA" | "CONTRACT";
  runtimeCodeHash: string;
  delegationTarget?: string;
  delegationCodeHash?: string;
  proxyImplementation?: string;
  proxyImplementationCodeHash?: string;
};

function addSubjectIssues(subject: SubjectInvariantInput, context: z.RefinementCtx) {
  const delegation = Boolean(subject.delegationTarget || subject.delegationCodeHash);
  const proxyAddress = Boolean(subject.proxyImplementation);
  const proxyHash = Boolean(subject.proxyImplementationCodeHash);
  if (subject.kind === "EOA" && subject.runtimeCodeHash !== ZERO_BYTES32) {
    addIssue(context, "EOA runtime code hash must be zero");
  }
  if (subject.kind !== "EOA" && subject.runtimeCodeHash === ZERO_BYTES32) {
    addIssue(context, "contract and EIP-7702 runtime code hash must be nonzero");
  }
  if (subject.kind === "EOA" && (delegation || proxyAddress || proxyHash)) {
    addIssue(context, "EOA subject cannot carry delegation or proxy provenance");
  }
  if (subject.kind === "EIP7702_DELEGATED_EOA") {
    if (!subject.delegationTarget || !subject.delegationCodeHash) {
      addIssue(context, "EIP-7702 subject requires delegation target and code hash");
    }
    if (proxyAddress || proxyHash) addIssue(context, "EIP-7702 subject cannot carry proxy provenance");
  }
  if (subject.kind === "CONTRACT") {
    if (delegation) addIssue(context, "contract subject cannot carry delegation provenance");
    if (proxyAddress !== proxyHash) {
      addIssue(context, "contract proxy address and hash must occur together");
    }
  }
}

function addIssue(context: z.RefinementCtx, message: string) {
  context.addIssue({ code: "custom", message });
}

function boundedString(maximum: number) {
  return z
    .string()
    .max(maximum)
    .refine((value) => value.trim().length > 0, "string must not be empty");
}

function boundedDecimal(maximum: bigint, label: string) {
  return z
    .string()
    .regex(decimalPattern)
    .refine((value) => decimalPattern.test(value) && BigInt(value) <= maximum, `${label} overflow`);
}

type TraversalState = {
  stack: WeakSet<object>;
  nodes: number;
  stringUnits: number;
};

function rejectNonCanonicalValues(value: unknown): void {
  visitCanonicalValue(value, 0, {
    stack: new WeakSet<object>(),
    nodes: 0,
    stringUnits: 0,
  });
}

function visitCanonicalValue(value: unknown, depth: number, state: TraversalState): void {
  if (depth > 16) throw new EvidenceValidationError("evidence exceeds maximum depth");
  state.nodes += 1;
  if (state.nodes > MAX_NODES) throw new EvidenceValidationError("evidence node limit exceeded");
  if (value === undefined) throw new EvidenceValidationError("undefined evidence value");
  if (typeof value === "string") return visitString(value, state);
  if (typeof value === "bigint" || (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))) {
    throw new EvidenceValidationError("non-canonical numeric value");
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value) && value.length > MAX_NODES) {
    throw new EvidenceValidationError("evidence array length exceeds node limit");
  }
  if (state.stack.has(value)) throw new EvidenceValidationError("cyclic evidence");
  state.stack.add(value);
  for (const [key, child] of Object.entries(value)) {
    visitString(key, state);
    visitCanonicalValue(child, depth + 1, state);
  }
  state.stack.delete(value);
}

function visitString(value: string, state: TraversalState): void {
  state.stringUnits += value.length;
  if (state.stringUnits > 262_144) {
    throw new EvidenceValidationError("evidence string payload limit exceeded");
  }
  assertWellFormedUnicode(value);
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throwInvalidSurrogate();
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throwInvalidSurrogate();
    }
  }
}

function throwInvalidSurrogate(): never {
  throw new EvidenceValidationError("invalid lone Unicode surrogate");
}
