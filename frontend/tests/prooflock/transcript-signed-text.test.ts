import { describe, expect, it } from "vitest";
import { sha256 } from "ethers";
import { verifyContentBinding } from "../../server/prooflock/compute/transcript";

// Captured from a live 0G provider: the enclave signs a colon-separated attestation string whose
// first two fields are sha256(request) and sha256(response), followed by provenance fields, e.g.
//   "<sha256(req)>:<sha256(resp)>:centralized:openrouter:<requestId>"
// The old parser required EXACTLY two hashes and rejected every real provider.
const SIGNER = "0x4c1b546f5fc11a9c2428eafed1d951aa13c17ee8";
const SIG = `0x${"ab".repeat(65)}`;
const okVerifier = { verifySignature: () => true } as const;
const req = new TextEncoder().encode("the-request-bytes");
const resp = new TextEncoder().encode("the-response-bytes");
const rh = sha256(req).slice(2);
const sh = sha256(resp).slice(2);

function bind(text: string) {
  return verifyContentBinding(
    { text, signature: SIG, signing_address: SIGNER } as never,
    SIGNER as never,
    req,
    resp,
    okVerifier,
  );
}

describe("0G real signed-text binding", () => {
  it("binds the real 5-field 0G signed text", () => {
    const binding = bind(`${rh}:${sh}:centralized:openrouter:${"cd".repeat(32)}`);
    expect(binding.signatureVerified).toBe(true);
    expect(binding.requestSha256).toBe(sha256(req));
    expect(binding.responseSha256).toBe(sha256(resp));
  });

  it("still accepts the legacy two-hash form", () => {
    expect(bind(`${rh}:${sh}`).signatureVerified).toBe(true);
  });

  it("marks requestBytesExact TRUE when the enclave request hash matches our bytes (direct provider)", () => {
    const binding = bind(`${rh}:${sh}:centralized:direct:${"cd".repeat(32)}`);
    expect(binding.requestBytesExact).toBe(true);
    expect(binding.attestedRequestSha256).toBe(sha256(req));
    expect(binding.requestSha256).toBe(sha256(req));
  });

  it("records the enclave-attested request hash without requiring exact request bytes (proxied provider)", () => {
    // A proxying provider (provider_identity=openrouter) re-serializes the request before the
    // enclave hashes it, so the enclave's request hash never equals sha256(our raw POST body).
    // The response stays exactly bound; the request commitment becomes the enclave-attested hash
    // and our raw bytes are retained for transparency (requestBytesExact=false).
    const attested = "aa".repeat(32);
    const binding = bind(`${attested}:${sh}:centralized:openrouter:${"cd".repeat(32)}`);
    expect(binding.signatureVerified).toBe(true);
    expect(binding.requestBytesExact).toBe(false);
    expect(binding.attestedRequestSha256).toBe(`0x${attested}`);
    expect(binding.requestSha256).toBe(sha256(req));
    expect(binding.responseSha256).toBe(sha256(resp));
  });

  it("still rejects when the RESPONSE hash does not bind the response bytes", () => {
    expect(() => bind(`${rh}:${"00".repeat(32)}:centralized:openrouter:${"cd".repeat(32)}`)).toThrow();
  });

  it("rejects text that does not start with two sha256 hashes", () => {
    expect(() => bind("not-a-hash:whatever:centralized")).toThrow();
  });
});
