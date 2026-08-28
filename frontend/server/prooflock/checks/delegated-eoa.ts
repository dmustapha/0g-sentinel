import type { ClassifiedSubject, SubjectChainAdapter } from "../subject/classify";
import type { VerifiedSource } from "./contract";
import { inspectContract, type ContractCheckReport } from "./contract";
import { inspectEoa, type EoaCheckReport } from "./eoa";

export type DelegatedEoaCheckReport = Readonly<{
  kind: "DELEGATED_EOA_ANALYSIS";
  status: "PASS" | "WARN" | "FAIL";
  sourceBlockNumber: string;
  account: EoaCheckReport;
  delegation: Readonly<{
    target: NonNullable<ClassifiedSubject["delegationTarget"]>;
    codeHash: NonNullable<ClassifiedSubject["delegationCodeHash"]>;
  }>;
  targetAnalysis: ContractCheckReport;
  findings: readonly string[];
}>;

function delegatedFindings(
  subject: ClassifiedSubject,
  account: EoaCheckReport,
  targetAnalysis: ContractCheckReport,
): string[] {
  const findings = [...targetAnalysis.findings];
  if (subject.delegationCode === "0x") findings.unshift("DELEGATION_TARGET_CODE_EMPTY");
  if (account.status === "WARN") findings.push("ACCOUNT_HISTORY_CAUTION");
  return findings;
}

export async function inspectDelegatedEoa(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  options: Readonly<{ blockTag: bigint; verifiedSource?: VerifiedSource }>,
): Promise<DelegatedEoaCheckReport> {
  if (
    subject.kind !== "EIP7702_DELEGATED_EOA"
    || !subject.delegationTarget
    || !subject.delegationCode
    || !subject.delegationCodeHash
  ) {
    throw new Error("Delegated EOA checks require complete delegation provenance");
  }
  const accountSubject = { ...subject, kind: "EOA" as const };
  const targetSubject: ClassifiedSubject = {
    address: subject.delegationTarget,
    kind: "CONTRACT",
    sourceBlockNumber: subject.sourceBlockNumber,
    runtimeCode: subject.delegationCode,
    runtimeCodeHash: subject.delegationCodeHash,
  };
  const [account, targetAnalysis] = await Promise.all([
    inspectEoa(adapter, accountSubject, options.blockTag),
    inspectContract(adapter, targetSubject, options),
  ]);
  const findings = delegatedFindings(subject, account, targetAnalysis);
  const targetRisk = targetAnalysis.sourcePatternAnalysis?.risk ?? 0;
  return Object.freeze({
    kind: "DELEGATED_EOA_ANALYSIS",
    status: targetRisk === 2 ? "FAIL" : findings.length ? "WARN" : "PASS",
    sourceBlockNumber: options.blockTag.toString(),
    account,
    delegation: {
      target: subject.delegationTarget,
      codeHash: subject.delegationCodeHash,
    },
    targetAnalysis,
    findings,
  });
}
