import { keccak256 } from "ethers";

import {
  assertExpectedSourceBlock,
  deepFreeze,
  normalizeRuntimeCode,
  type ClassifiedSubject,
  type SubjectChainAdapter,
} from "../subject/classify";
import type { ContractCheckOptions } from "./contract";
import { inspectContract, type ContractCheckReport } from "./contract";
import { inspectEoa, type EoaCheckReport } from "./eoa";

export type DelegatedEoaCheckReport = Readonly<{
  kind: "DELEGATED_EOA_ANALYSIS";
  status: "PASS" | "WARN" | "FAIL";
  requiresDriftMonitoring: true;
  sourceBlockNumber: string;
  sourceBlockHash: ClassifiedSubject["sourceBlockHash"];
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
  const findings = [...targetAnalysis.deterministicFindings];
  if (account.status === "WARN") findings.push("ACCOUNT_HISTORY_CAUTION");
  return findings;
}

export async function inspectDelegatedEoa(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  options: ContractCheckOptions,
): Promise<DelegatedEoaCheckReport> {
  if (
    subject.kind !== "EIP7702_DELEGATED_EOA"
    || !subject.delegationTarget
    || !subject.delegationCode
    || !subject.delegationCodeHash
  ) {
    throw new Error("Delegated EOA checks require complete delegation provenance");
  }
  const sourceBlock = await assertExpectedSourceBlock(adapter, options.sourceBlock);
  if (
    subject.sourceBlockNumber !== sourceBlock.number.toString()
    || subject.sourceBlockHash !== sourceBlock.hash
  ) {
    throw new Error("Delegated EOA check block does not match classification block");
  }
  const liveDelegationCode = normalizeRuntimeCode(
    await adapter.getCode(subject.delegationTarget, sourceBlock.number),
  );
  if (
    liveDelegationCode === "0x"
    || keccak256(liveDelegationCode) !== subject.delegationCodeHash
  ) {
    throw new Error("EIP-7702 delegation code drift detected");
  }
  const accountSubject = { ...subject, kind: "EOA" as const };
  const targetSubject: ClassifiedSubject = {
    address: subject.delegationTarget,
    kind: "CONTRACT",
    sourceBlockNumber: subject.sourceBlockNumber,
    sourceBlockHash: subject.sourceBlockHash,
    runtimeCode: subject.delegationCode,
    runtimeCodeHash: subject.delegationCodeHash,
  };
  const [account, targetAnalysis] = await Promise.all([
    inspectEoa(adapter, accountSubject, sourceBlock),
    inspectContract(adapter, targetSubject, options),
  ]);
  const findings = delegatedFindings(subject, account, targetAnalysis);
  await assertExpectedSourceBlock(adapter, sourceBlock);
  return deepFreeze({
    kind: "DELEGATED_EOA_ANALYSIS",
    status: findings.length ? "WARN" : "PASS",
    requiresDriftMonitoring: true,
    sourceBlockNumber: sourceBlock.number.toString(),
    sourceBlockHash: sourceBlock.hash,
    account,
    delegation: {
      target: subject.delegationTarget,
      codeHash: subject.delegationCodeHash,
    },
    targetAnalysis,
    findings,
  });
}
