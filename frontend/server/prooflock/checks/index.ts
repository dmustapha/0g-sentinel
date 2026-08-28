import type { ClassifiedSubject, SubjectChainAdapter } from "../subject/classify";
import { inspectContract, type ContractCheckOptions } from "./contract";
import { inspectDelegatedEoa } from "./delegated-eoa";
import { inspectEoa } from "./eoa";

export async function runSubjectChecks(
  adapter: SubjectChainAdapter,
  subject: ClassifiedSubject,
  options: ContractCheckOptions,
) {
  if (subject.kind === "EOA") return inspectEoa(adapter, subject, options.blockTag);
  if (subject.kind === "CONTRACT") return inspectContract(adapter, subject, options);
  return inspectDelegatedEoa(adapter, subject, options);
}

export * from "./contract";
export * from "./delegated-eoa";
export * from "./eoa";
export * from "./static-analysis";
