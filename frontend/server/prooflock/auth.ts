import { createHash, timingSafeEqual } from "node:crypto";

const BEARER = "Bearer ";
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 256;

export function authenticateOperator(
  authorization: string | null | undefined,
  configuredToken: string | null | undefined,
): boolean {
  const supplied = authorization?.startsWith(BEARER)
    ? authorization.slice(BEARER.length)
    : "";
  const expected = configuredToken ?? "";
  const matches = timingSafeEqual(digest(supplied), digest(expected));
  const size = Buffer.byteLength(expected, "utf8");
  const validConfiguration = size >= MIN_TOKEN_BYTES && size <= MAX_TOKEN_BYTES;
  return validConfiguration && supplied.length > 0 && matches;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
