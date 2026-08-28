export type StrictComputeErrorCode =
  | "COMPUTE_INPUT_INVALID"
  | "COMPUTE_METADATA_INVALID"
  | "COMPUTE_SPEND_NOT_AUTHORIZED"
  | "COMPUTE_PROOF_CLASS_UNSUPPORTED"
  | "COMPUTE_MODEL_MISMATCH"
  | "COMPUTE_BROKER_ERROR"
  | "COMPUTE_PROVIDER_HTTP_ERROR"
  | "COMPUTE_RESPONSE_TOO_LARGE"
  | "COMPUTE_RESPONSE_INVALID"
  | "COMPUTE_CHAT_ID_MISSING"
  | "COMPUTE_PROVIDER_MISMATCH"
  | "COMPUTE_SERVICE_UNAVAILABLE"
  | "COMPUTE_SIGNER_UNACKNOWLEDGED"
  | "COMPUTE_SIGNER_MISMATCH"
  | "COMPUTE_SIGNATURE_INVALID"
  | "COMPUTE_SIGNED_TEXT_INVALID"
  | "COMPUTE_REQUEST_BINDING_FAILED"
  | "COMPUTE_RESPONSE_BINDING_FAILED"
  | "COMPUTE_RECEIPT_REPLAY"
  | "COMPUTE_REPLAY_STORE_REQUIRED"
  | "COMPUTE_REPLAY_STORE_FULL"
  | "COMPUTE_VERIFICATION_FAILED"
  | "COMPUTE_VERIFICATION_ERROR"
  | "COMPUTE_TIMEOUT";

export class StrictComputeError extends Error {
  constructor(
    public readonly code: StrictComputeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StrictComputeError";
  }
}

export function computeFailure(
  code: StrictComputeErrorCode,
  message: string,
  cause?: unknown,
): StrictComputeError {
  return new StrictComputeError(code, message, cause === undefined ? undefined : { cause });
}
