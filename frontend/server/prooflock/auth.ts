import { createHash, timingSafeEqual } from "node:crypto";

const BEARER = "Bearer ";

export function authenticateOperator(
  authorization: string | null | undefined,
  configuredToken: string | null | undefined,
): boolean {
  const supplied = authorization?.startsWith(BEARER)
    ? authorization.slice(BEARER.length)
    : "";
  const expected = configuredToken ?? "";
  const matches = timingSafeEqual(digest(supplied), digest(expected));
  return supplied.length > 0 && expected.length > 0 && matches;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
