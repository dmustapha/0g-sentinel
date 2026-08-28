import { describe, expect, it, vi } from "vitest";
import { AbiCoder, keccak256 } from "ethers";

import {
  PROOFLOCK_RUNNER_STAGES,
  ProofLockStageError,
  createProofLockRunner,
  type ProofLockRunnerDependencies,
  type RunnerStage,
} from "../../server/prooflock/runner";
import {
  REGISTRY_V2_INTERFACE,
  ChainProofError,
  computeIdentityKey,
  computeProofLockId,
  markProofLockDrift,
  readProofLockBack,
  writeProofLock,
  type RegistryChainAdapter,
  type RegistryProofLockRecord,
} from "../../server/prooflock/chain";
import {
  buildDriftFingerprint,
  compareDriftFingerprints,
  runOnDemandDriftCheck,
  type DriftFingerprint,
} from "../../server/prooflock/drift";
import type { Bytes32, ResolvedAgentIdentity } from "../../server/prooflock/types";
import { hashCanonical, receiptDigest } from "../../server/prooflock/canonical";

const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;
const REGISTRY = "0x3333333333333333333333333333333333333333" as const;
const H1 = `0x${"11".repeat(32)}` as Bytes32;
const H2 = `0x${"22".repeat(32)}` as Bytes32;
const H3 = `0x${"33".repeat(32)}` as Bytes32;
const H4 = `0x${"44".repeat(32)}` as Bytes32;
const H5 = `0x${"55".repeat(32)}` as Bytes32;
const H6 = `0x${"66".repeat(32)}` as Bytes32;
const BLOCK = `0x${"77".repeat(32)}` as Bytes32;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Bytes32;

function identity(): ResolvedAgentIdentity {
  return {
    identity: {
      namespace: "eip155",
      chainId: 16661,
      registryAddress: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
      agentId: "42",
    },
    owner: A,
    agentWallet: B,
    agentURI: "https://agent.example/card.json",
    registrationDigest: H1,
    sourceBlockNumber: "123",
    sourceBlockHash: BLOCK,
    card: {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      registrations: [{ agentId: "42", agentRegistry: "eip155:16661:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" }],
    },
  };
}

function computeProof() {
  return {
    proofClass: "DECENTRALIZED_MODEL_TEE" as const,
    purpose: "behavioral-risk" as const,
    provider: A,
    model: "model-tee",
    chatId: "chat-runner",
    receiptDigest: receiptDigest("chat-runner"),
    requestDigest: H2,
    responseDigest: H3,
    signatureScheme: "EIP191" as const,
    expectedSigner: A,
    signature: `0x${"ab".repeat(65)}`,
    signedTextSha256: H4,
    requestSha256: H2,
    rawResponseSha256: H3,
    receiptSource: "ZG-Res-Key" as const,
    responseHeadersSha256: H5,
    usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
    processResponseVerified: true as const,
  };
}

function runnerEnvelope() {
  return {
    schema: "sentinel.prooflock/evidence-v1" as const,
    proofClass: "COMPUTE_VERIFIED" as const,
    schemaVersion: 1 as const,
    policyVersion: 1,
    coverage: {
      preStorageMask: 0x5f as const, requiredSealMask: 0x7f as const,
      identityValidated: true as const, subjectClassified: true as const,
      deterministicChecksRun: true as const, behavioralComputeVerified: true as const,
      codeCompute: { status: "NOT_APPLICABLE" as const, reason: "EOA has no contract runtime code." },
      evidenceStorage: "PENDING_EXTERNAL_COMMITMENT" as const, policyEvaluated: true as const,
    },
    identity: {
      ...identity().identity, owner: A, agentWallet: B,
      registrationUri: identity().agentURI, registrationDigest: H1,
    },
    source: { blockNumber: "123", blockHash: BLOCK },
    subject: { address: B, kind: "EOA" as const, runtimeCodeHash: `0x${"00".repeat(32)}` as Bytes32 },
    deterministicChecks: [{ id: "eoa-snapshot", version: "1", status: "WARN" as const, inputDigest: H1, outputDigest: H2, findings: ["HISTORY_SOURCE_UNAVAILABLE"] }],
    computeProofs: [computeProof()],
    verdict: { riskScore: 12, label: "SAFE" as const },
    omissions: ["Contract code analysis is not applicable to an EOA."],
    scanner: { address: A, softwareVersion: "sentinel-wave3" },
  };
}

function dependencies(calls: RunnerStage[]): ProofLockRunnerDependencies {
  const envelope = runnerEnvelope();
  const envelopeDigest = hashCanonical(envelope);
  const stage = <T>(name: RunnerStage, value: T) => vi.fn(async () => {
    calls.push(name);
    return value;
  });
  return {
    validateIdentity: stage("VALIDATING_IDENTITY", identity()),
    classifySubject: stage("CLASSIFYING_SUBJECT", {
      address: B,
      kind: "EOA" as const,
      sourceBlockNumber: "123",
      sourceBlockHash: BLOCK,
      runtimeCode: "0x",
      runtimeCodeHash: `0x${"00".repeat(32)}` as Bytes32,
    }),
    runDeterministicChecks: stage("RUNNING_DETERMINISTIC_CHECKS", {
      checks: [{ id: "eoa-snapshot", version: "1", status: "WARN" as const, inputDigest: H1, outputDigest: H2, findings: ["HISTORY_SOURCE_UNAVAILABLE"] }],
      evidenceSubject: { address: B, kind: "EOA" as const, runtimeCodeHash: `0x${"00".repeat(32)}` as Bytes32 },
      artifactHash: H3,
      codeRisk: 0,
      omissions: ["Contract code analysis is not applicable to an EOA."],
    }),
    runCompute: stage("RUNNING_COMPUTE", {
      proofs: [computeProof()],
      behavioralScore: 12,
      verdict: { riskScore: 12, label: "SAFE" as const },
    }),
    buildEvidenceEnvelope: stage("CANONICALIZING_EVIDENCE", envelope),
    uploadStorage: stage("UPLOADING_STORAGE", { opaqueUpload: "real-adapter-result" }),
    verifyStorage: stage("VERIFYING_STORAGE", {
      envelopeDigest,
      storageRoot: H5,
      uploadTxHash: H6,
      retrievedDigest: envelopeDigest,
      finalizedAtBlock: "456",
      retrievalVerified: true as const,
    }),
    writeChain: stage("WRITING_CHAIN", { transactionHash: H6, expectedVersion: 1n }),
    readChainBack: vi.fn(async (input) => {
      calls.push("READING_CHAIN_BACK");
      return {
        identityKey: input.identityKey, subject: input.subject,
        envelopeDigest: input.envelopeDigest, storageRoot: input.storageRoot,
        computeRoot: input.computeRoot, artifactHash: input.artifactHash,
        runtimeCodeHash: input.runtimeCodeHash, version: 1n,
        issuedAt: 1n, validUntil: 604801n, policyVersion: input.policyVersion,
        behavioralScore: input.behavioralScore, codeRisk: input.codeRisk,
        coverage: input.coverage, state: 1, stateReason: 0,
      };
    }),
  };
}

describe("controlled ProofLock runner", () => {
  it("executes the frozen stages in order and seals only after exact readback", async () => {
    const calls: RunnerStage[] = [];
    const reported: RunnerStage[] = [];
    const runner = createProofLockRunner(dependencies(calls));
    const result = await runner.run({
      identity: identity().identity,
      registryAddress: REGISTRY,
      policyVersion: 1,
      scanner: A,
      scannerSoftwareVersion: "sentinel-wave3",
      validForSeconds: 604800,
      mode: "SEAL",
    }, (stage) => reported.push(stage));

    expect(calls).toEqual(PROOFLOCK_RUNNER_STAGES.slice(0, -1));
    expect(reported).toEqual(PROOFLOCK_RUNNER_STAGES);
    expect(result.stage).toBe("SEALED");
    expect(result.chain.transactionHash).toBe(H6);
  });

  for (const [index, stage] of PROOFLOCK_RUNNER_STAGES.slice(0, -1).entries()) {
    it(`stops at ${stage} without calling a later stage`, async () => {
      const calls: RunnerStage[] = [];
      const deps = dependencies(calls);
      const operation = Object.values(deps)[index] as ReturnType<typeof vi.fn>;
      operation.mockRejectedValueOnce(new Error(`failure-${stage}`));

      await expect(createProofLockRunner(deps).run({
        identity: identity().identity,
        registryAddress: REGISTRY,
        policyVersion: 1,
        scanner: A,
        scannerSoftwareVersion: "sentinel-wave3",
        validForSeconds: 604800,
        mode: "SEAL",
      })).rejects.toMatchObject({ name: "ProofLockStageError", stage });
      expect(operation).toHaveBeenCalledOnce();
      expect(calls).toEqual(PROOFLOCK_RUNNER_STAGES.slice(0, index));
    });
  }

  it("rejects invalid operator configuration before any stage is called", async () => {
    const calls: RunnerStage[] = [];
    await expect(createProofLockRunner(dependencies(calls)).run({
      identity: identity().identity,
      registryAddress: REGISTRY,
      policyVersion: 0,
      scanner: A,
      scannerSoftwareVersion: "sentinel-wave3",
      validForSeconds: 604800,
      mode: "SEAL",
    })).rejects.toBeInstanceOf(ProofLockStageError);
    expect(calls).toEqual([]);
  });

  it("rejects an envelope for a different identity before Storage", async () => {
    const calls: RunnerStage[] = [];
    const deps = dependencies(calls);
    vi.mocked(deps.buildEvidenceEnvelope).mockResolvedValueOnce({
      ...runnerEnvelope(),
      identity: { ...runnerEnvelope().identity, owner: B },
    });
    await expect(createProofLockRunner(deps).run({
      identity: identity().identity, registryAddress: REGISTRY, policyVersion: 1,
      scanner: A, scannerSoftwareVersion: "sentinel-wave3", validForSeconds: 604800, mode: "SEAL",
    })).rejects.toMatchObject({ stage: "CANONICALIZING_EVIDENCE" });
    expect(deps.uploadStorage).not.toHaveBeenCalled();
  });

  it("rejects duplicate Compute receipts before canonicalization or Storage", async () => {
    const calls: RunnerStage[] = [];
    const deps = dependencies(calls);
    vi.mocked(deps.runCompute).mockResolvedValueOnce({
      proofs: [computeProof(), { ...computeProof(), purpose: "contract-risk" }],
      behavioralScore: 12, verdict: { riskScore: 12, label: "SAFE" },
    });
    await expect(createProofLockRunner(deps).run({
      identity: identity().identity, registryAddress: REGISTRY, policyVersion: 1,
      scanner: A, scannerSoftwareVersion: "sentinel-wave3", validForSeconds: 604800, mode: "SEAL",
    })).rejects.toMatchObject({ stage: "RUNNING_COMPUTE" });
    expect(deps.buildEvidenceEnvelope).not.toHaveBeenCalled();
  });

  it.each([
    ["fractional score", { behavioralScore: 12.5, verdict: { riskScore: 12.5, label: "SAFE" as const } }],
    ["score mismatch", { behavioralScore: 12, verdict: { riskScore: 13, label: "SAFE" as const } }],
    ["label mismatch", { behavioralScore: 60, verdict: { riskScore: 60, label: "SAFE" as const } }],
  ])("rejects policy-inconsistent Compute output: %s", async (_name, output) => {
    const deps = dependencies([]);
    vi.mocked(deps.runCompute).mockResolvedValueOnce({ proofs: [computeProof()], ...output });
    await expect(createProofLockRunner(deps).run({
      identity: identity().identity, registryAddress: REGISTRY, policyVersion: 1,
      scanner: A, scannerSoftwareVersion: "sentinel-wave3", validForSeconds: 604800, mode: "SEAL",
    })).rejects.toMatchObject({ stage: "RUNNING_COMPUTE" });
    expect(deps.buildEvidenceEnvelope).not.toHaveBeenCalled();
    expect(deps.uploadStorage).not.toHaveBeenCalled();
    expect(deps.writeChain).not.toHaveBeenCalled();
  });

  it("stops before the Registry when retrieved evidence is not bound", async () => {
    const calls: RunnerStage[] = [];
    const deps = dependencies(calls);
    vi.mocked(deps.verifyStorage).mockResolvedValueOnce({
      envelopeDigest: H1, storageRoot: H5, uploadTxHash: H6, retrievedDigest: H1,
      finalizedAtBlock: "456", retrievalVerified: true,
    });
    await expect(createProofLockRunner(deps).run({
      identity: identity().identity, registryAddress: REGISTRY, policyVersion: 1,
      scanner: A, scannerSoftwareVersion: "sentinel-wave3", validForSeconds: 604800, mode: "SEAL",
    })).rejects.toMatchObject({ stage: "VERIFYING_STORAGE" });
    expect(deps.writeChain).not.toHaveBeenCalled();
  });

  it("does not let a status-reporter disconnect control the proof run", async () => {
    const result = await createProofLockRunner(dependencies([])).run({
      identity: identity().identity, registryAddress: REGISTRY, policyVersion: 1,
      scanner: A, scannerSoftwareVersion: "sentinel-wave3", validForSeconds: 604800, mode: "SEAL",
    }, () => { throw new Error("SSE disconnected"); });
    expect(result.stage).toBe("SEALED");
  });

  it("requires explicit prior-version and prior-proof bindings for reseal", async () => {
    const calls: RunnerStage[] = [];
    await expect(createProofLockRunner(dependencies(calls)).run({
      identity: identity().identity, registryAddress: REGISTRY, policyVersion: 1,
      scanner: A, scannerSoftwareVersion: "sentinel-wave3", validForSeconds: 604800, mode: "RESEAL",
      expectedPriorVersion: 1n,
    })).rejects.toMatchObject({ stage: "VALIDATING_IDENTITY" });
    expect(calls).toEqual([]);
  });

  it("does not report SEALED when the finalized contract rejects the runtime hash", async () => {
    const deps = dependencies([]);
    const stages: RunnerStage[] = [];
    vi.mocked(deps.writeChain).mockRejectedValueOnce(new Error("RuntimeCodeHashMismatch"));
    await expect(createProofLockRunner(deps).run({
      identity: identity().identity, registryAddress: REGISTRY, policyVersion: 1,
      scanner: A, scannerSoftwareVersion: "sentinel-wave3", validForSeconds: 604800, mode: "SEAL",
    }, (stage) => stages.push(stage))).rejects.toMatchObject({ stage: "WRITING_CHAIN" });
    expect(stages).not.toContain("SEALED");
    expect(deps.readChainBack).not.toHaveBeenCalled();
  });

  it("passes the classified runtime hash and predecessor linkage to the chain writer", async () => {
    const deps = dependencies([]);
    const envelope = { ...runnerEnvelope(), previousProofId: H6 };
    const envelopeDigest = hashCanonical(envelope);
    vi.mocked(deps.buildEvidenceEnvelope).mockResolvedValueOnce(envelope);
    vi.mocked(deps.verifyStorage).mockResolvedValueOnce({
      envelopeDigest, storageRoot: H5, uploadTxHash: H6, retrievedDigest: envelopeDigest,
      finalizedAtBlock: "456", retrievalVerified: true,
    });
    vi.mocked(deps.writeChain).mockResolvedValueOnce({ transactionHash: H6, expectedVersion: 2n });
    vi.mocked(deps.readChainBack).mockImplementationOnce(async (input) => ({
      identityKey: input.identityKey, subject: input.subject, envelopeDigest: input.envelopeDigest,
      storageRoot: input.storageRoot, computeRoot: input.computeRoot, artifactHash: input.artifactHash,
      runtimeCodeHash: input.runtimeCodeHash, version: 2n, issuedAt: 1n, validUntil: 604801n,
      policyVersion: input.policyVersion, behavioralScore: input.behavioralScore, codeRisk: input.codeRisk,
      coverage: input.coverage, state: 1, stateReason: 0,
    }));
    await createProofLockRunner(deps).run({
      identity: identity().identity, registryAddress: REGISTRY, policyVersion: 1,
      scanner: A, scannerSoftwareVersion: "sentinel-wave3", validForSeconds: 604800,
      mode: "RESEAL", expectedPriorVersion: 1n, previousProofId: H6,
    });
    expect(deps.writeChain).toHaveBeenCalledWith(expect.objectContaining({
      runtimeCodeHash: ZERO_BYTES32, expectedPriorVersion: 1n, previousProofId: H6,
    }));
  });
});

function record(overrides: Partial<RegistryProofLockRecord> = {}): RegistryProofLockRecord {
  return {
    identityKey: H1,
    subject: B,
    envelopeDigest: H2,
    storageRoot: H3,
    computeRoot: H4,
    artifactHash: H5,
    runtimeCodeHash: `0x${"00".repeat(32)}` as Bytes32,
    version: 1n,
    issuedAt: 100n,
    validUntil: 604900n,
    policyVersion: 1,
    behavioralScore: 10,
    codeRisk: 0,
    coverage: 0x7f,
    state: 1,
    stateReason: 0,
    ...overrides,
  };
}

function chainAdapter(overrides: Partial<RegistryChainAdapter> = {}): RegistryChainAdapter {
  const proof = record({ version: 0n, identityKey: `0x${"00".repeat(32)}` as Bytes32 });
  const expectedEvent = REGISTRY_V2_INTERFACE.encodeEventLog(
    REGISTRY_V2_INTERFACE.getEvent("ProofLocked")!,
    [H1, B, 1n, 100n, 604900n, H2, H3, H4, H5, `0x${"00".repeat(32)}`, 1, 10, 0, 0x7f],
  );
  const transactionData = REGISTRY_V2_INTERFACE.encodeFunctionData("seal", [
    H1, B, [H2, H3, H4, H5, `0x${"00".repeat(32)}`, 604800, 1, 10, 0, 0x7f],
  ]);
  return {
    registryAddress: REGISTRY,
    getChainId: vi.fn(async () => 16661n),
    getCode: vi.fn(async (address) => address.toLowerCase() === REGISTRY ? "0x6000" : "0x"),
    getProofLock: vi.fn(async () => proof),
    sendTransaction: vi.fn(async ({ to, data }) => ({ hash: H6, to, data })),
    waitForReceipt: vi.fn(async () => ({
      transactionHash: H6,
      status: 1,
      blockNumber: 456n,
      blockHash: BLOCK,
      confirmations: 3,
      logs: [{ address: REGISTRY, topics: expectedEvent.topics, data: expectedEvent.data }],
    })),
    getTransaction: vi.fn(async () => ({ hash: H6, to: REGISTRY, data: transactionData })),
    ...overrides,
  };
}

const chainRequest = {
  registryAddress: REGISTRY,
  mode: "SEAL" as const,
  identityKey: H1,
  subject: B,
  envelopeDigest: H2,
  storageRoot: H3,
  computeRoot: H4,
  artifactHash: H5,
  runtimeCodeHash: `0x${"00".repeat(32)}` as Bytes32,
  validForSeconds: 604800,
  policyVersion: 1,
  behavioralScore: 10,
  codeRisk: 0,
  coverage: 0x7f,
};

describe("strict registry chain writer", () => {
  it("binds identity keys to mainnet ERC-8004 identities", () => {
    expect(computeIdentityKey(identity().identity)).toBe(
      keccak256(AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "uint256"], [16661, identity().identity.registryAddress, 42],
      )),
    );
    expect(() => computeIdentityKey({ ...identity().identity, registryAddress: A })).toThrow(/registry/i);
  });

  it("requires chain 16661, bytecode, exact calldata, finality, event, and readback", async () => {
    const adapter = chainAdapter();
    const written = await writeProofLock(adapter, chainRequest, { confirmations: 3, timeoutMs: 10_000 });
    const readAdapter = { ...adapter, getProofLock: vi.fn(async () => record()) };
    const read = await readProofLockBack(readAdapter, chainRequest, written);
    expect(written).toEqual({ transactionHash: H6, expectedVersion: 1n });
    expect(read).toEqual(record());
  });

  it("encodes the analyzed runtime hash and atomic prior version in reseal calldata", async () => {
    const proof = record({ version: 4n });
    const previousProofId = computeProofLockId(REGISTRY, proof);
    const request = { ...chainRequest, mode: "RESEAL" as const, expectedPriorVersion: 4n, previousProofId };
    const event = REGISTRY_V2_INTERFACE.encodeEventLog(
      REGISTRY_V2_INTERFACE.getEvent("ProofLocked")!,
      [H1, B, 5n, 100n, 604900n, H2, H3, H4, H5, ZERO_BYTES32, 1, 10, 0, 0x7f],
    );
    const expectedData = REGISTRY_V2_INTERFACE.encodeFunctionData("reseal", [
      H1, B, 4n, [H2, H3, H4, H5, ZERO_BYTES32, 604800, 1, 10, 0, 0x7f],
    ]);
    const adapter = chainAdapter({
      getProofLock: vi.fn(async () => proof),
      waitForReceipt: vi.fn(async () => ({
        transactionHash: H6, status: 1, blockNumber: 456n, blockHash: BLOCK,
        confirmations: 3, logs: [{ address: REGISTRY, topics: event.topics, data: event.data }],
      })),
      getTransaction: vi.fn(async () => ({ hash: H6, to: REGISTRY, data: expectedData })),
    });
    await writeProofLock(adapter, request, { confirmations: 3, timeoutMs: 10_000 });
    expect(adapter.sendTransaction).toHaveBeenCalledWith({ to: REGISTRY, data: expectedData });
  });

  it("derives a lifecycle-stable, content-sensitive prior proof ID", () => {
    const proof = record({ version: 4n });
    expect(computeProofLockId(REGISTRY, proof)).toBe(computeProofLockId(REGISTRY.toUpperCase().replace("0X", "0x"), {
      ...proof, state: 3, stateReason: 6,
    }));
    expect(computeProofLockId(REGISTRY, { ...proof, artifactHash: H6 }))
      .not.toBe(computeProofLockId(REGISTRY, proof));
  });

  it("rejects an arbitrary previous proof ID before sending a reseal", async () => {
    const adapter = chainAdapter({ getProofLock: vi.fn(async () => record({ version: 4n })) });
    const request = { ...chainRequest, mode: "RESEAL" as const, expectedPriorVersion: 4n, previousProofId: H6 };
    await expect(writeProofLock(adapter, request, { confirmations: 3, timeoutMs: 10_000 }))
      .rejects.toMatchObject({ code: "LOCK_STATE_MISMATCH" });
    expect(adapter.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", 0n],
    ["uint64 overflow", 1n << 64n],
  ])("rejects %s prior version before ABI encoding", async (_name, expectedPriorVersion) => {
    const adapter = chainAdapter();
    await expect(writeProofLock(adapter, {
      ...chainRequest, mode: "RESEAL", expectedPriorVersion, previousProofId: H6,
    }, { confirmations: 3, timeoutMs: 10_000 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(adapter.sendTransaction).not.toHaveBeenCalled();
  });

  it("forbids predecessor fields on an initial seal", async () => {
    await expect(writeProofLock(chainAdapter(), {
      ...chainRequest, expectedPriorVersion: 1n, previousProofId: H6,
    }, { confirmations: 3, timeoutMs: 10_000 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("snapshots request and finality options before the first await", async () => {
    const mutableRequest = { ...chainRequest, registryAddress: REGISTRY as `0x${string}` };
    const mutableOptions = { confirmations: 3, timeoutMs: 10_000 };
    const adapter = chainAdapter({
      getChainId: vi.fn(async () => {
        mutableRequest.registryAddress = A;
        mutableOptions.confirmations = 1;
        return 16661n;
      }),
    });
    await writeProofLock(adapter, mutableRequest, mutableOptions);
    expect(adapter.waitForReceipt).toHaveBeenCalledWith(H6, 3, 10_000);
    expect(adapter.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: REGISTRY }));
  });

  it.each([
    ["WRONG_CHAIN", { getChainId: vi.fn(async () => 1n) }],
    ["REGISTRY_UNAVAILABLE", { getCode: vi.fn(async () => "0x") }],
    ["TRANSACTION_REVERTED", { waitForReceipt: vi.fn(async () => ({ transactionHash: H6, status: 0, blockNumber: 1n, blockHash: BLOCK, confirmations: 3, logs: [] })) }],
    ["FINALITY_INCOMPLETE", { waitForReceipt: vi.fn(async () => ({ transactionHash: H6, status: 1, blockNumber: 1n, blockHash: BLOCK, confirmations: 2, logs: [] })) }],
  ])("fails closed with %s", async (code, overrides) => {
    await expect(writeProofLock(chainAdapter(overrides), chainRequest, { confirmations: 3, timeoutMs: 10_000 }))
      .rejects.toMatchObject({ name: "ChainProofError", code });
  });

  it("rejects a mismatched transaction and a missing expected event", async () => {
    const wrongTx = chainAdapter({ getTransaction: vi.fn(async () => ({ hash: H6, to: A, data: "0x" })) });
    await expect(writeProofLock(wrongTx, chainRequest, { confirmations: 3, timeoutMs: 10_000 }))
      .rejects.toMatchObject({ code: "TRANSACTION_MISMATCH" });
    const noEvent = chainAdapter({ waitForReceipt: vi.fn(async () => ({ transactionHash: H6, status: 1, blockNumber: 1n, blockHash: BLOCK, confirmations: 3, logs: [] })) });
    await expect(writeProofLock(noEvent, chainRequest, { confirmations: 3, timeoutMs: 10_000 }))
      .rejects.toMatchObject({ code: "LOCK_EVENT_MISSING" });
  });

  it("rejects readback mismatches", async () => {
    const adapter = chainAdapter({ getProofLock: vi.fn(async () => record({ storageRoot: H6 })) });
    await expect(readProofLockBack(adapter, chainRequest, { transactionHash: H6, expectedVersion: 1n }))
      .rejects.toBeInstanceOf(ChainProofError);
  });

  it("rejects subject runtime drift before submitting the Registry transaction", async () => {
    const adapter = chainAdapter({ getCode: vi.fn(async (address) => address.toLowerCase() === REGISTRY ? "0x6000" : "0x6001") });
    await expect(writeProofLock(adapter, chainRequest, { confirmations: 3, timeoutMs: 10_000 }))
      .rejects.toMatchObject({ code: "LOCK_STATE_MISMATCH" });
    expect(adapter.sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects a coverage byte that does not contain the required mask", async () => {
    await expect(writeProofLock(chainAdapter(), { ...chainRequest, coverage: 0x80 }, { confirmations: 3, timeoutMs: 10_000 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

function fingerprint(overrides: Partial<DriftFingerprint> = {}): DriftFingerprint {
  return buildDriftFingerprint({
    owner: A,
    agentWallet: B,
    registrationDigest: H1,
    subjectKind: "CONTRACT",
    runtimeCodeHash: H2,
    proxyImplementation: REGISTRY,
    proxyImplementationCodeHash: H3,
    policyVersion: 1,
    ...overrides,
  });
}

describe("on-demand drift detection", () => {
  it("produces a stable fingerprint and reports no drift for equivalent casing", () => {
    const expected = fingerprint();
    const current = fingerprint({ owner: A.toUpperCase().replace("0X", "0x") as typeof A });
    expect(compareDriftFingerprints(expected, current)).toMatchObject({ drifted: false, changedFields: [] });
  });

  it.each([
    ["owner", { owner: B }],
    ["agentWallet", { agentWallet: A }],
    ["registrationDigest", { registrationDigest: H4 }],
    ["subjectKind", { subjectKind: "EOA", runtimeCodeHash: `0x${"00".repeat(32)}`, proxyImplementation: undefined, proxyImplementationCodeHash: undefined }],
    ["runtimeCodeHash", { runtimeCodeHash: H4 }],
    ["proxyImplementation", { proxyImplementation: A }],
    ["proxyImplementationCodeHash", { proxyImplementationCodeHash: H4 }],
    ["policyVersion", { policyVersion: 2 }],
  ] as const)("distinguishes %s drift", (field, overrides) => {
    const result = compareDriftFingerprints(fingerprint(), fingerprint(overrides));
    expect(result.drifted).toBe(true);
    expect(result.changedFields).toContain(field);
  });

  it("binds EIP-7702 delegation target and code hash", () => {
    const expected = buildDriftFingerprint({
      owner: A, agentWallet: B, registrationDigest: H1,
      subjectKind: "EIP7702_DELEGATED_EOA", runtimeCodeHash: H2,
      delegationTarget: REGISTRY, delegationCodeHash: H3, policyVersion: 1,
    });
    const current = buildDriftFingerprint({ ...expected, delegationCodeHash: H4 });
    expect(compareDriftFingerprints(expected, current).changedFields).toEqual(["delegationCodeHash"]);
  });

  it("rejects structurally impossible fingerprints", () => {
    expect(() => fingerprint({ proxyImplementationCodeHash: undefined })).toThrow(/proxy/i);
    expect(() => buildDriftFingerprint({
      owner: A, agentWallet: B, registrationDigest: H1,
      subjectKind: "EOA", runtimeCodeHash: H2, policyVersion: 1,
    })).toThrow(/EOA runtime/i);
  });

  it("marks drift with the sealed version and returns only a verified chain result", async () => {
    const marked = vi.fn(async (request: { expectedVersion: bigint; reason: number }) => ({
      transactionHash: H6, version: request.expectedVersion, reason: request.reason,
    }));
    const result = await runOnDemandDriftCheck({
      readSealedSnapshot: vi.fn(async () => ({ identityKey: H1, version: 1n, fingerprint: fingerprint() })),
      resolveCurrentFingerprint: vi.fn(async () => fingerprint({ policyVersion: 2 })),
      markDrift: marked,
    }, H1, true);
    expect(marked).toHaveBeenCalledWith({ identityKey: H1, expectedVersion: 1n, reason: 3 });
    expect(result).toMatchObject({ mode: "ON_DEMAND", marked: true, transactionHash: H6, version: 1n });
  });
});

describe("strict drift lifecycle write", () => {
  function driftAdapter(overrides: Partial<RegistryChainAdapter> = {}): RegistryChainAdapter {
    const event = REGISTRY_V2_INTERFACE.encodeEventLog(
      REGISTRY_V2_INTERFACE.getEvent("DriftMarked")!, [H1, 1n, 3],
    );
    const data = REGISTRY_V2_INTERFACE.encodeFunctionData("markDrift", [H1, 3, 1n]);
    return chainAdapter({
      getProofLock: vi.fn()
        .mockResolvedValueOnce(record())
        .mockResolvedValueOnce(record({ state: 3, stateReason: 3 })),
      waitForReceipt: vi.fn(async () => ({
        transactionHash: H6, status: 1, blockNumber: 456n, blockHash: BLOCK,
        confirmations: 3, logs: [{ address: REGISTRY, topics: event.topics, data: event.data }],
      })),
      getTransaction: vi.fn(async () => ({ hash: H6, to: REGISTRY, data })),
      ...overrides,
    });
  }

  it("verifies chain, calldata, finality, one event, and drifted readback", async () => {
    const adapter = driftAdapter();
    const result = await markProofLockDrift(adapter, {
      registryAddress: REGISTRY, identityKey: H1, expectedVersion: 1n, reason: 3,
    }, { confirmations: 3, timeoutMs: 10_000 });
    expect(result).toEqual({ transactionHash: H6, version: 1n, reason: 3 });
  });

  it("fails closed when a concurrent reseal makes the expected version stale", async () => {
    const adapter = driftAdapter({ sendTransaction: vi.fn(async () => { throw new Error("StaleVersion"); }) });
    await expect(markProofLockDrift(adapter, {
      registryAddress: REGISTRY, identityKey: H1, expectedVersion: 1n, reason: 3,
    }, { confirmations: 3, timeoutMs: 10_000 })).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
  });

  it("rejects duplicate events and mismatched drift readback", async () => {
    const event = REGISTRY_V2_INTERFACE.encodeEventLog(
      REGISTRY_V2_INTERFACE.getEvent("DriftMarked")!, [H1, 1n, 3],
    );
    const duplicate = driftAdapter({ waitForReceipt: vi.fn(async () => ({
      transactionHash: H6, status: 1, blockNumber: 456n, blockHash: BLOCK,
      confirmations: 3, logs: [
        { address: REGISTRY, topics: event.topics, data: event.data },
        { address: REGISTRY, topics: event.topics, data: event.data },
      ],
    })) });
    await expect(markProofLockDrift(duplicate, {
      registryAddress: REGISTRY, identityKey: H1, expectedVersion: 1n, reason: 3,
    }, { confirmations: 3, timeoutMs: 10_000 })).rejects.toMatchObject({ code: "LOCK_EVENT_MISMATCH" });

    const badReadback = driftAdapter({
      getProofLock: vi.fn().mockResolvedValueOnce(record()).mockResolvedValueOnce(record({ state: 1 })),
    });
    await expect(markProofLockDrift(badReadback, {
      registryAddress: REGISTRY, identityKey: H1, expectedVersion: 1n, reason: 3,
    }, { confirmations: 3, timeoutMs: 10_000 })).rejects.toMatchObject({ code: "READBACK_MISMATCH" });
  });

  it.each([
    ["WRONG_CHAIN", { getChainId: vi.fn(async () => 1n) }],
    ["REGISTRY_UNAVAILABLE", { getCode: vi.fn(async () => "0x") }],
    ["TRANSACTION_REVERTED", { waitForReceipt: vi.fn(async () => ({ transactionHash: H6, status: 0, blockNumber: 1n, blockHash: BLOCK, confirmations: 3, logs: [] })) }],
    ["FINALITY_INCOMPLETE", { waitForReceipt: vi.fn(async () => ({ transactionHash: H6, status: 1, blockNumber: 1n, blockHash: BLOCK, confirmations: 2, logs: [] })) }],
    ["TRANSACTION_MISMATCH", { getTransaction: vi.fn(async () => ({ hash: H6, to: A, data: "0x" })) }],
  ])("fails closed on drift lifecycle dependency error %s", async (code, overrides) => {
    await expect(markProofLockDrift(driftAdapter(overrides), {
      registryAddress: REGISTRY, identityKey: H1, expectedVersion: 1n, reason: 3,
    }, { confirmations: 3, timeoutMs: 10_000 })).rejects.toMatchObject({ code });
  });
});
