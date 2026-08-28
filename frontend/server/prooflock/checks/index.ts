import type { EvidenceEnvelopeV1 } from "../types";
import {
  assertExpectedSourceBlock,
  deepFreeze,
  type ClassifiedSubject,
  type SubjectChainAdapter,
} from "../subject/classify";
import {
  inspectContract,
  type ContractCheckOptions,
  type ContractCheckReport,
} from "./contract";
import { inspectDelegatedEoa, type DelegatedEoaCheckReport } from "./delegated-eoa";
import { inspectEoa, type EoaCheckReport } from "./eoa";

export type SubjectCheckReport =
  | EoaCheckReport
  | ContractCheckReport
  | DelegatedEoaCheckReport;

export async function runSubjectChecks(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  options: ContractCheckOptions,
): Promise<SubjectCheckReport> {
  const sourceBlock = await assertExpectedSourceBlock(adapter, options.sourceBlock);
  let report: SubjectCheckReport;
  if (subject.kind === "EOA") report = await inspectEoa(adapter, subject, sourceBlock);
  else if (subject.kind === "CONTRACT") report = await inspectContract(adapter, subject, options);
  else report = await inspectDelegatedEoa(adapter, subject, options);
  await assertExpectedSourceBlock(adapter, sourceBlock);
  return report;
}

function assertReportBinding(subject: ClassifiedSubject, report: SubjectCheckReport): void {
  if (
    subject.sourceBlockNumber !== report.sourceBlockNumber
    || subject.sourceBlockHash !== report.sourceBlockHash
  ) {
    throw new Error("Subject report block hash mismatch");
  }
  if (subject.kind === "EOA" && report.kind !== "EOA_SNAPSHOT") {
    throw new Error("EOA subject report mismatch");
  }
  if (subject.kind === "CONTRACT" && report.kind !== "CONTRACT_ANALYSIS") {
    throw new Error("Contract subject report mismatch");
  }
  if (subject.kind === "EIP7702_DELEGATED_EOA" && report.kind !== "DELEGATED_EOA_ANALYSIS") {
    throw new Error("Delegated EOA subject report mismatch");
  }
}

export function toEvidenceSubject(
  subject: ClassifiedSubject,
  report: SubjectCheckReport,
): EvidenceEnvelopeV1["subject"] {
  assertReportBinding(subject, report);
  const base = {
    address: subject.address,
    kind: subject.kind,
    runtimeCodeHash: subject.runtimeCodeHash,
  };
  if (subject.kind === "EOA") return deepFreeze(base);
  if (subject.kind === "EIP7702_DELEGATED_EOA") {
    if (
      report.kind !== "DELEGATED_EOA_ANALYSIS"
      || !subject.delegationTarget
      || !subject.delegationCodeHash
      || report.delegation.target !== subject.delegationTarget
      || report.delegation.codeHash !== subject.delegationCodeHash
      || report.requiresDriftMonitoring !== true
    ) {
      throw new Error("Incomplete delegated EOA evidence provenance");
    }
    return deepFreeze({
      ...base,
      delegationTarget: subject.delegationTarget,
      delegationCodeHash: subject.delegationCodeHash,
    });
  }
  if (report.kind !== "CONTRACT_ANALYSIS" || report.runtimeCodeHash !== subject.runtimeCodeHash) {
    throw new Error("Contract evidence runtime mismatch");
  }
  if (!report.proxy) return deepFreeze(base);
  return deepFreeze({
    ...base,
    proxyImplementation: report.proxy.implementationAddress,
    proxyImplementationCodeHash: report.proxy.implementationCodeHash,
  });
}

export * from "./contract";
export * from "./delegated-eoa";
export * from "./eoa";
export * from "./static-analysis";
