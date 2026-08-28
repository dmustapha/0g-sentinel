import {
  assertExpectedSourceBlock,
  deepFreeze,
  type ClassifiedSubject,
  type ExpectedSourceBlock,
  type SubjectChainAdapter,
} from "../subject/classify";

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

export type EoaHistory =
  | Readonly<{ status: "AVAILABLE"; observedTransactions: number }>
  | Readonly<{ status: "UNKNOWN"; reason: string }>;

export type EoaCheckReport = Readonly<{
  kind: "EOA_SNAPSHOT";
  status: "PASS" | "WARN";
  assessment: "OBSERVED" | "CAUTION";
  sourceBlockNumber: string;
  sourceBlockHash: ClassifiedSubject["sourceBlockHash"];
  nonce: string;
  balanceWei: string;
  history: EoaHistory;
  findings: readonly string[];
}>;

function validateEoa(subject: ClassifiedSubject, sourceBlock: ExpectedSourceBlock): void {
  if (subject.kind !== "EOA") throw new Error("EOA checks require an EOA subject");
  if (
    subject.sourceBlockNumber !== sourceBlock.number.toString()
    || subject.sourceBlockHash !== sourceBlock.hash
  ) {
    throw new Error("EOA check block does not match classification block");
  }
}

async function loadHistory(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  blockTag: bigint,
): Promise<EoaHistory> {
  if (!adapter.getHistory) {
    return { status: "UNKNOWN", reason: "HISTORY_SOURCE_UNAVAILABLE" };
  }
  try {
    const history = await adapter.getHistory(subject.address, blockTag);
    if (history.complete !== true || !Number.isSafeInteger(history.observedTransactions)) {
      return { status: "UNKNOWN", reason: "HISTORY_INCOMPLETE" };
    }
    if (history.observedTransactions < 0) {
      return { status: "UNKNOWN", reason: "HISTORY_INVALID" };
    }
    return { status: "AVAILABLE", observedTransactions: history.observedTransactions };
  } catch {
    return { status: "UNKNOWN", reason: "HISTORY_QUERY_FAILED" };
  }
}

function requireRpcInteger(value: unknown, maximum: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > maximum) {
    throw new Error(`${label} must be a bigint in range`);
  }
  return value;
}

export async function inspectEoa(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  sourceBlockInput: ExpectedSourceBlock,
): Promise<EoaCheckReport> {
  const sourceBlock = await assertExpectedSourceBlock(adapter, sourceBlockInput);
  validateEoa(subject, sourceBlock);
  const [nonce, balance, history] = await Promise.all([
    adapter.getTransactionCount(subject.address, sourceBlock.number),
    adapter.getBalance(subject.address, sourceBlock.number),
    loadHistory(adapter, subject, sourceBlock.number),
  ]);
  const checkedNonce = requireRpcInteger(nonce, UINT64_MAX, "nonce");
  const checkedBalance = requireRpcInteger(balance, UINT256_MAX, "balance");
  const observed = history.status === "AVAILABLE" && history.observedTransactions > 0;
  const findings = observed
    ? []
    : [history.status === "UNKNOWN" ? history.reason : "NO_HISTORY_OBSERVED"];
  await assertExpectedSourceBlock(adapter, sourceBlock);
  return deepFreeze({
    kind: "EOA_SNAPSHOT",
    status: observed ? "PASS" : "WARN",
    assessment: observed ? "OBSERVED" : "CAUTION",
    sourceBlockNumber: sourceBlock.number.toString(),
    sourceBlockHash: sourceBlock.hash,
    nonce: checkedNonce.toString(),
    balanceWei: checkedBalance.toString(),
    history,
    findings,
  });
}
