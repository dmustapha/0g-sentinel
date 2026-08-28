export class EvidenceValidationError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "EvidenceValidationError";
    this.cause = cause;
  }
}

export class ProofMismatchError extends Error {
  constructor() {
    super("Proof evidence does not match its onchain commitments");
    this.name = "ProofMismatchError";
  }
}

export type IdentityErrorCode =
  | "INVALID_IDENTITY"
  | "WRONG_CHAIN"
  | "REGISTRY_UNAVAILABLE"
  | "AGENT_NOT_FOUND"
  | "AGENT_WALLET_UNSET"
  | "AGENT_URI_UNAVAILABLE"
  | "CARD_URI_UNSUPPORTED"
  | "CARD_PRIVATE_NETWORK"
  | "CARD_REDIRECT_LOOP"
  | "CARD_REDIRECT_INVALID"
  | "CARD_REDIRECT_LIMIT"
  | "CARD_TOO_LARGE"
  | "CARD_TIMEOUT"
  | "CARD_CONTENT_TYPE"
  | "CARD_MALFORMED"
  | "CARD_INACTIVE"
  | "CARD_BACKLINK_MISMATCH";

export type IdentityErrorStage = "identity" | "registry" | "card";

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    readonly stage: IdentityErrorStage,
    readonly retryable: boolean,
    message = code,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}
