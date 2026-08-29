import { OperatorWorkbench } from "@/components/OperatorWorkbench";
import { isCanonicalAgentId } from "@/lib/prooflock-validation";

type OperatorPageProps = Readonly<{
  searchParams?: Readonly<{ agentId?: string | readonly string[] }>;
}>;

export default function OperatorPage({ searchParams = {} }: OperatorPageProps) {
  const candidate = typeof searchParams.agentId === "string" ? searchParams.agentId : "";
  const initialAgentId = isCanonicalAgentId(candidate) ? candidate : "";
  return <OperatorWorkbench initialAgentId={initialAgentId} />;
}
