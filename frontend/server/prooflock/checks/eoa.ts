import type { ClassifiedSubject, SubjectChainAdapter } from "../subject/classify";

export type EoaHistory =
  | Readonly<{ status: "AVAILABLE"; observedTransactions: number }>
  | Readonly<{ status: "UNKNOWN"; reason: string }>;

export type EoaCheckReport = Readonly<{
  kind: "EOA_SNAPSHOT";
  status: "PASS" | "WARN";
  assessment: "OBSERVED" | "CAUTION";
  sourceBlockNumber: string;
  nonce: string;
  balanceWei: string;
  history: EoaHistory;
  findings: readonly string[];
}>;

function validateEoa(subject: ClassifiedSubject, blockTag: bigint): void {
  if (subject.kind !== "EOA") throw new Error("EOA checks require an EOA subject");
  if (subject.sourceBlockNumber !== blockTag.toString()) {
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
    if (!history.complete || !Number.isSafeInteger(history.observedTransactions)) {
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

export async function inspectEoa(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  blockTag: bigint,
): Promise<EoaCheckReport> {
  validateEoa(subject, blockTag);
  const [nonce, balance, history] = await Promise.all([
    adapter.getTransactionCount(subject.address, blockTag),
    adapter.getBalance(subject.address, blockTag),
    loadHistory(adapter, subject, blockTag),
  ]);
  const observed = history.status === "AVAILABLE" && history.observedTransactions > 0;
  const findings = observed
    ? []
    : [history.status === "UNKNOWN" ? history.reason : "NO_HISTORY_OBSERVED"];
  return Object.freeze({
    kind: "EOA_SNAPSHOT",
    status: observed ? "PASS" : "WARN",
    assessment: observed ? "OBSERVED" : "CAUTION",
    sourceBlockNumber: blockTag.toString(),
    nonce: nonce.toString(),
    balanceWei: balance.toString(),
    history,
    findings,
  });
}
