export class EvidenceValidationError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "EvidenceValidationError";
    this.cause = cause;
  }
}
