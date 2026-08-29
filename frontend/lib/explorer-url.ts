import { isNonZeroBytes32 } from "./prooflock-validation";

const ALLOWED_EXPLORER_ORIGINS = new Set(["https://chainscan.0g.ai"]);
const ALLOWED_BASE = /^https:\/\/chainscan\.0g\.ai\/?$/i;
const NON_ZERO_ADDRESS = /^0x(?!0{40}$)[0-9a-f]{40}$/i;

export function explorerTransactionUrl(base: string, transactionHash: string): string | null {
  if (!isNonZeroBytes32(transactionHash)) return null;
  return explorerUrl(base, "tx", transactionHash);
}

export function explorerAddressUrl(base: string, address: string): string | null {
  if (!NON_ZERO_ADDRESS.test(address)) return null;
  return explorerUrl(base, "address", address);
}

function explorerUrl(base: string, kind: "tx" | "address", value: string): string | null {
  const origin = explorerOrigin(base);
  return origin ? new URL(`/${kind}/${value}`, origin).toString() : null;
}

function explorerOrigin(base: string): string | null {
  try {
    if (!ALLOWED_BASE.test(base)) return null;
    const parsed = new URL(base);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password
      || parsed.pathname !== "/" || parsed.search || parsed.hash
      || !ALLOWED_EXPLORER_ORIGINS.has(parsed.origin)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
