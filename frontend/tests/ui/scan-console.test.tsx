// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ readProofLockDetail: vi.fn() }));

vi.mock("../../lib/prooflock-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/prooflock-client")>(),
  ...client,
}));

import { ScanConsole } from "../../components/ScanConsole";
import type { ProofLockRecord } from "../../lib/prooflock-types";

const ADDRESS = `0x${"11".repeat(20)}` as const;
const KEY = `0x${"22".repeat(32)}` as const;
const PROOF = `0x${"33".repeat(32)}` as const;
const ROOT = `0x${"44".repeat(32)}` as const;

const record: ProofLockRecord = { identityKey: KEY, subject: ADDRESS, envelopeDigest: KEY, storageRoot: ROOT,
  computeRoot: KEY, artifactHash: KEY, runtimeCodeHash: KEY, version: "3", issuedAt: "1", validUntil: "2",
  policyVersion: 1, behavioralScore: 1, codeRisk: 0, coverage: 0x7f, state: 1, stateReason: 0 };

function streamResponse(frames: readonly Record<string, unknown>[]): Response {
  const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message, stage: "VALIDATING_IDENTITY",
    retryable: status >= 500, requestId: "req-1" } }), { status,
    headers: { "content-type": "application/json" } });
}

beforeEach(() => { client.readProofLockDetail.mockReset(); localStorage.clear(); });
afterEach(() => cleanup());

describe("ScanConsole state machine", () => {
  it("idle prefills the demo agent id and enables scanning", () => {
    render(<ScanConsole />);
    const input = screen.getByLabelText(/agent id/i) as HTMLInputElement;
    expect(input.value).toBe(process.env.NEXT_PUBLIC_PROOFLOCK_DEMO_AGENT_ID ?? "3527152");
    expect((screen.getByRole("button", { name: /scan agent/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/keys rotated post-event/i)).toBeTruthy();
  });

  it("streams stages then reconciles to a sealed card when the stream ends after WRITING_CHAIN", async () => {
    const user = userEvent.setup();
    // The stream is cut after WRITING_CHAIN: no SEALED frame arrives, forcing reconciliation.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      { type: "stage", stage: "VALIDATING_IDENTITY" },
      { type: "stage", stage: "RUNNING_COMPUTE" },
      { type: "stage", stage: "WRITING_CHAIN" },
    ])));
    client.readProofLockDetail.mockResolvedValue({
      identityKey: KEY, proofId: PROOF, proofLock: record,
      detail: { status: "VERIFIED", gate: { status: "VERIFIED", allowed: true, reason: 0,
        subject: ADDRESS, version: "3" } },
    });

    render(<ScanConsole />);
    await user.click(screen.getByRole("button", { name: /scan agent/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: /agent #.* sealed/i })).toBeTruthy());
    expect(client.readProofLockDetail).toHaveBeenCalledTimes(1);
    expect(screen.getByText(PROOF)).toBeTruthy();
    expect(screen.getByText(ROOT)).toBeTruthy();
    expect(screen.getByText(/confirmed on chain/i)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("shows a friendly error and no reconciliation when the front door rejects the agent id", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      errorResponse(400, "INVALID_INPUT", "A canonical ERC-8004 agentId is required")));

    render(<ScanConsole />);
    await user.click(screen.getByRole("button", { name: /scan agent/i }));

    await waitFor(() => expect(screen.getByText(/that agent id is not valid/i)).toBeTruthy());
    expect(client.readProofLockDetail).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports the busy message on a rate-limited front door", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      errorResponse(429, "RATE_LIMIT", "Public scan is busy; try again shortly")));

    render(<ScanConsole />);
    await user.click(screen.getByRole("button", { name: /scan agent/i }));

    await waitFor(() => expect(screen.getByText(/the scanner is busy/i)).toBeTruthy());
    vi.unstubAllGlobals();
  });

  it("blocks scanning an invalid agent id", async () => {
    const user = userEvent.setup();
    render(<ScanConsole />);
    const input = screen.getByLabelText(/agent id/i);
    await user.clear(input);
    await user.type(input, "0x12");
    expect((screen.getByRole("button", { name: /scan agent/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/invalid agent id/i)).toBeTruthy();
  });
});
