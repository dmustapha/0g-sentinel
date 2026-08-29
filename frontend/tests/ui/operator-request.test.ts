import { describe, expect, it, vi } from "vitest";
import { ProofLockApiError, recoverProofLock, runProofLock } from "../../lib/prooflock-client";

describe("operator mutation request", () => {
  it.each([
    ["NOT_BROADCAST", true], ["REVERTED", true], ["SEALED", true],
    ["SUBMISSION_OUTCOME_UNKNOWN", false], ["FINALIZED_READBACK_UNAVAILABLE", false],
  ] as const)("clears recovery-indexed continuity for %s only when definitive", async (status, clears) => {
    const values = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    const recoveryId = "rec_1234567890abcdef"; const transactionHash = `0x${"2".repeat(64)}`;
    const admission = { type: "progress", progress: { type: "admission", state: "ACCEPTED",
      recoveryId, idempotencyKey: "client-stable-key" } };
    const outcome = status === "NOT_BROADCAST" ? { status, recoveryId }
      : status === "REVERTED" ? { status, recoveryId, transactionHash }
        : { status, recoveryId, transactionHash, identityKey: `0x${"3".repeat(64)}`, version: "1" };
    const sealed = { type: "complete", result: { kind: "SEALED", stage: "SEALED", writeOutcome: { status: "SEALED",
      recoveryId: "rec_abcdefabcdefabcd", transactionHash: `0x${"4".repeat(64)}`, identityKey: `0x${"5".repeat(64)}`, version: "1" } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(`data: ${JSON.stringify(admission)}\n\n`))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: outcome }), { status: 200 }))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(sealed)}\n\n`)); vi.stubGlobal("fetch", fetchMock);
    const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"1".repeat(40)}` as `0x${string}`, agentId: String(100 + status.length) }, mode: "SEAL" as const };
    await expect(runProofLock(input, "secret", vi.fn())).rejects.toMatchObject({ recoveryId });
    await recoverProofLock(recoveryId, "secret", "transactionHash" in outcome ? transactionHash : undefined);
    await runProofLock(input, "secret", vi.fn());
    const firstKey = fetchMock.mock.calls[0]?.[1]?.headers["idempotency-key"];
    const retryKey = fetchMock.mock.calls[2]?.[1]?.headers["idempotency-key"];
    clears ? expect(retryKey).not.toBe(firstKey) : expect(retryKey).toBe(firstKey);
    vi.unstubAllGlobals();
  });

  it.each(["NOT_BROADCAST", "REVERTED"] as const)("clears the active key after definitive %s before retry", async (status) => {
    const outcome = status === "NOT_BROADCAST" ? { status, recoveryId: "rec_1234567890abcdef" }
      : { status, recoveryId: "rec_1234567890abcdef", transactionHash: `0x${"2".repeat(64)}` };
    const failed = { type: "error", error: { code: status, message: "definitive", stage: "WRITING_CHAIN",
      retryable: false, requestId: "req-1" }, writeOutcome: outcome };
    const sealed = { type: "complete", result: { kind: "SEALED", stage: "SEALED", writeOutcome: { status: "SEALED",
      recoveryId: "rec_abcdefabcdefabcd", transactionHash: `0x${"3".repeat(64)}`, identityKey: `0x${"4".repeat(64)}`, version: "1" } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(`data: ${JSON.stringify(failed)}\n\n`))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(sealed)}\n\n`)); vi.stubGlobal("fetch", fetchMock);
    const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"1".repeat(40)}` as `0x${string}`, agentId: status === "REVERTED" ? "81" : "80" }, mode: "SEAL" as const };
    await expect(runProofLock(input, "secret", vi.fn())).rejects.toBeInstanceOf(ProofLockApiError);
    await expect(runProofLock(input, "secret", vi.fn())).resolves.toMatchObject({ kind: "SEALED" });
    expect(fetchMock.mock.calls[1]?.[1]?.headers["idempotency-key"]).not.toBe(fetchMock.mock.calls[0]?.[1]?.headers["idempotency-key"]);
    vi.unstubAllGlobals();
  });

  it("clears active continuity after a structured pre-journal failure", async () => {
    const failed = { type: "error", error: { code: "MISMATCH", message: "pre-journal",
      stage: "VERIFYING_STORAGE", retryable: false, requestId: "req-1" } };
    const sealed = { type: "complete", result: { kind: "SEALED", stage: "SEALED", writeOutcome: { status: "SEALED",
      recoveryId: "rec_abcdefabcdefabcd", transactionHash: `0x${"3".repeat(64)}`,
      identityKey: `0x${"4".repeat(64)}`, version: "1" } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(`data: ${JSON.stringify(failed)}\n\n`))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(sealed)}\n\n`)); vi.stubGlobal("fetch", fetchMock);
    const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"1".repeat(40)}` as `0x${string}`, agentId: "82" }, mode: "SEAL" as const };
    await expect(runProofLock(input, "secret", vi.fn())).rejects.toBeInstanceOf(ProofLockApiError);
    await expect(runProofLock(input, "secret", vi.fn())).resolves.toMatchObject({ kind: "SEALED" });
    expect(fetchMock.mock.calls[1]?.[1]?.headers["idempotency-key"])
      .not.toBe(fetchMock.mock.calls[0]?.[1]?.headers["idempotency-key"]);
    vi.unstubAllGlobals();
  });

  it("persists active idempotency and recovery continuity across a module reload", async () => {
    const values = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    const admission = { type: "progress", progress: { type: "admission", state: "ACCEPTED",
      recoveryId: "rec_1234567890abcdef", idempotencyKey: "client-stable-key" } };
    const existing = { type: "complete", result: { kind: "EXISTING_OPERATION", operation: {
      recoveryId: "rec_1234567890abcdef", phase: "RECOVERY_REQUIRED" } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(`data: ${JSON.stringify(admission)}\n\n`))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(existing)}\n\n`)); vi.stubGlobal("fetch", fetchMock);
    const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"1".repeat(40)}` as `0x${string}`, agentId: "91" }, mode: "SEAL" as const };
    await expect(runProofLock(input, "secret", vi.fn())).rejects.toMatchObject({ recoveryId: "rec_1234567890abcdef" });
    vi.resetModules(); const reloaded = await import("../../lib/prooflock-client");
    await expect(reloaded.runProofLock(input, "secret", vi.fn())).resolves.toMatchObject({ kind: "EXISTING_OPERATION" });
    expect(fetchMock.mock.calls[1]?.[1]?.headers["idempotency-key"]).toBe(fetchMock.mock.calls[0]?.[1]?.headers["idempotency-key"]);
    vi.unstubAllGlobals();
  });

  it("clears persisted continuity for a deduplicated existing SEALED operation", async () => {
    const values = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    const recoveryId = "rec_1234567890abcdef";
    const admission = { type: "progress", progress: { type: "admission", state: "DEDUPLICATED",
      recoveryId, idempotencyKey: "client-stable-key" } };
    const writeOutcome = { status: "SEALED", recoveryId, transactionHash: `0x${"3".repeat(64)}`,
      identityKey: `0x${"4".repeat(64)}`, version: "1" };
    const existing = { type: "complete", result: { kind: "EXISTING_OPERATION", operation: {
      recoveryId, phase: "TERMINAL", writeOutcome } } };
    const sealed = { type: "complete", result: { kind: "SEALED", stage: "SEALED", writeOutcome: {
      ...writeOutcome, recoveryId: "rec_abcdefabcdefabcd" } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(`data: ${JSON.stringify(admission)}\n\ndata: ${JSON.stringify(existing)}\n\n`))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(sealed)}\n\n`)); vi.stubGlobal("fetch", fetchMock);
    const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"1".repeat(40)}` as `0x${string}`, agentId: "92" }, mode: "SEAL" as const };
    await expect(runProofLock(input, "secret", vi.fn())).resolves.toMatchObject({ kind: "EXISTING_OPERATION" });
    await expect(runProofLock(input, "secret", vi.fn())).resolves.toMatchObject({ kind: "SEALED" });
    expect(fetchMock.mock.calls[1]?.[1]?.headers["idempotency-key"])
      .not.toBe(fetchMock.mock.calls[0]?.[1]?.headers["idempotency-key"]);
    vi.unstubAllGlobals();
  });
  it("sends only identity and lifecycle intent, never client-controlled provenance or policy", async () => {
    const sealed = { kind: "SEALED", stage: "SEALED", writeOutcome: { status: "SEALED",
      recoveryId: "rec_1234567890abcdef", transactionHash: `0x${"22".repeat(32)}`,
      identityKey: `0x${"33".repeat(32)}`, version: "1" } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: "complete", result: sealed })}\n\n`, {
      status: 200, headers: { "content-type": "text/event-stream" },
    })); vi.stubGlobal("fetch", fetchMock);
    const identity = { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"11".repeat(20)}` as `0x${string}`, agentId: "7" };
    await runProofLock({ identity, mode: "RESEAL", expectedPriorVersion: "2", previousProofId: `0x${"22".repeat(32)}` }, "secret", vi.fn());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ identity, mode: "RESEAL", expectedPriorVersion: "2", previousProofId: `0x${"22".repeat(32)}` });
    for (const key of ["registryAddress", "policyVersion", "scanner", "scannerSoftwareVersion", "validForSeconds"]) expect(body).not.toHaveProperty(key);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer secret" });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toHaveProperty("idempotency-key");
    vi.unstubAllGlobals();
  });

  it("rejects malformed complete, progress, and error DTOs at runtime", async () => {
    const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"11".repeat(20)}` as `0x${string}`, agentId: "7" }, mode: "SEAL" as const };
    for (const payload of [
      { type: "complete", result: { kind: "SEALED", stage: "SEALED" } },
      { type: "progress", progress: { phase: "HASH_KNOWN", transactionHash: "private" } },
      { type: "error", error: { code: 7 } },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(payload)}\n\n`, { status: 200 })));
      await expect(runProofLock(input, "secret", vi.fn())).rejects.toThrow(/invalid|parse|terminal|stream/i);
    }
    vi.unstubAllGlobals();
  });

  it("reuses the active idempotency key and exposes recovery after disconnect", async () => {
    const admission = { type: "progress", progress: { type: "admission", state: "ACCEPTED",
      recoveryId: "rec_1234567890abcdef", idempotencyKey: "client-stable-key" } };
    const existing = { type: "complete", result: { kind: "EXISTING_OPERATION", operation: {
      recoveryId: "rec_1234567890abcdef", phase: "RECOVERY_REQUIRED",
      writeOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: "rec_1234567890abcdef" } } } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(admission)}\n\n`, { status: 200 }))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(existing)}\n\n`, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"11".repeat(20)}` as `0x${string}`, agentId: "9" }, mode: "SEAL" as const };
    await expect(runProofLock(input, "secret", vi.fn())).rejects.toMatchObject({
      recoveryId: "rec_1234567890abcdef", idempotencyKey: expect.any(String),
    });
    await expect(runProofLock(input, "secret", vi.fn())).resolves.toMatchObject({ kind: "EXISTING_OPERATION" });
    expect(fetchMock.mock.calls[1]?.[1]?.headers["idempotency-key"])
      .toBe(fetchMock.mock.calls[0]?.[1]?.headers["idempotency-key"]);
    vi.unstubAllGlobals();
  });

  it("reuses the active idempotency key when cancellation beats the admission frame", async () => {
    const controller = new AbortController();
    const sealed = { type: "complete", result: { kind: "SEALED", stage: "SEALED", writeOutcome: {
      status: "SEALED", recoveryId: "rec_abcdefabcdefabcd", transactionHash: `0x${"3".repeat(64)}`,
      identityKey: `0x${"4".repeat(64)}`, version: "1" } } };
    const fetchMock = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) =>
      (init.signal as AbortSignal).addEventListener("abort",
        () => reject(new DOMException("canceled", "AbortError")), { once: true })))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(sealed)}\n\n`));
    vi.stubGlobal("fetch", fetchMock);
    const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"1".repeat(40)}` as `0x${string}`, agentId: "93" }, mode: "SEAL" as const };
    const pending = runProofLock(input, "secret", vi.fn(), controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(runProofLock(input, "secret", vi.fn())).resolves.toMatchObject({ kind: "SEALED" });
    expect(fetchMock.mock.calls[1]?.[1]?.headers["idempotency-key"])
      .toBe(fetchMock.mock.calls[0]?.[1]?.headers["idempotency-key"]);
    vi.unstubAllGlobals();
  });

  it("throws a typed terminal error that preserves exact write certainty", async () => {
    const frame = { type: "error", error: { code: "SUBMISSION_OUTCOME_UNKNOWN",
      message: "Submission attempted; broadcast not yet proven", stage: "WRITING_CHAIN", retryable: false,
      requestId: "req-1" }, writeOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId: "rec_1234567890abcdef" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(frame)}\n\n`, {
      status: 200, headers: { "content-type": "text/event-stream" },
    })));
    let caught: unknown;
    try { await runProofLock({ identity: { namespace: "eip155", chainId: 16661,
      registryAddress: `0x${"11".repeat(20)}`, agentId: "7" }, mode: "SEAL" }, "secret", vi.fn()); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ProofLockApiError);
    expect(caught).toMatchObject({ writeOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN",
      recoveryId: "rec_1234567890abcdef" } });
    vi.unstubAllGlobals();
  });

  it("reports sanitized admission and chain boundaries to cancellation logic", async () => {
    const recoveryId = "rec_1234567890abcdef"; const transactionHash = `0x${"2".repeat(64)}`;
    const frames = [
      { type: "progress", progress: { type: "admission", state: "ACCEPTED", recoveryId,
        idempotencyKey: "client-stable-key" } },
      { type: "progress", progress: { phase: "SUBMISSION_ATTEMPTED" } },
      { type: "progress", progress: { phase: "HASH_KNOWN", transactionHash } },
      { type: "error", error: { code: "SUBMISSION_OUTCOME_UNKNOWN", message: "uncertain",
        stage: "WRITING_CHAIN", retryable: false, requestId: "req-1" },
        writeOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId, transactionHash } },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(frames
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), { status: 200 })));
    const progress = vi.fn(); const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"1".repeat(40)}` as `0x${string}`, agentId: "177" }, mode: "SEAL" as const };
    await expect(runProofLock(input, "secret", vi.fn(), undefined, undefined, progress)).rejects.toMatchObject({
      writeOutcome: { status: "SUBMISSION_OUTCOME_UNKNOWN", recoveryId, transactionHash },
    });
    expect(progress.mock.calls.map(([value]) => value)).toEqual(frames.slice(0, 3).map(({ progress: value }) => value));
    expect(JSON.stringify(progress.mock.calls)).not.toContain("secret");
    vi.unstubAllGlobals();
  });

  it("keeps progress reporting observational when a UI callback throws", async () => {
    const sealed = { type: "complete", result: { kind: "SEALED", stage: "SEALED", writeOutcome: { status: "SEALED",
      recoveryId: "rec_abcdefabcdefabcd", transactionHash: `0x${"3".repeat(64)}`,
      identityKey: `0x${"4".repeat(64)}`, version: "1" } } };
    const admission = { type: "progress", progress: { type: "admission", state: "ACCEPTED",
      recoveryId: "rec_abcdefabcdefabcd", idempotencyKey: "client-stable-key" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      `data: ${JSON.stringify(admission)}\n\ndata: ${JSON.stringify(sealed)}\n\n`, { status: 200 })));
    const input = { identity: { namespace: "eip155" as const, chainId: 16661 as const,
      registryAddress: `0x${"1".repeat(40)}` as `0x${string}`, agentId: "178" }, mode: "SEAL" as const };
    await expect(runProofLock(input, "secret", vi.fn(), undefined, undefined,
      () => { throw new Error("render observer failed"); })).resolves.toMatchObject({ kind: "SEALED" });
    vi.unstubAllGlobals();
  });

  it("recovers by opaque ID without exposing the token in its body", async () => {
    const outcome = { status: "SEALED", recoveryId: "rec_1234567890abcdef",
      transactionHash: `0x${"22".repeat(32)}`, identityKey: `0x${"33".repeat(32)}`, version: "1" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: outcome }), {
      status: 200, headers: { "content-type": "application/json" },
    })); vi.stubGlobal("fetch", fetchMock);
    await expect(recoverProofLock("rec_1234567890abcdef", "secret", outcome.transactionHash)).resolves.toEqual(outcome);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request.headers.authorization).toBe("Bearer secret");
    expect(String(request.body)).not.toContain("secret");
    vi.unstubAllGlobals();
  });
});
