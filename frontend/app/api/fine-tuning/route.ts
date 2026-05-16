import { NextRequest, NextResponse } from "next/server";
import { getAttestationRegistry } from "@/lib/contracts";
import { uploadEvidence } from "@scanner/storage";

const FINE_TUNING_PROVIDER = "0xf07240Efa67755B5311bc75784a061eDB47165Dd";
const BASE_MODEL = "distilbert-base-uncased";

export async function POST(req: NextRequest) {
  let body: { agentAddress?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { agentAddress } = body;
  if (!agentAddress || typeof agentAddress !== "string" || !agentAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
    return NextResponse.json({ error: "Invalid agent address" }, { status: 400 });
  }

  try {
    const registry = getAttestationRegistry();
    const att = await registry.getAttestation(agentAddress);
    if (BigInt(att.attestation_timestamp) === 0n) {
      return NextResponse.json({ error: "Agent has no attestation — scan first" }, { status: 404 });
    }

    const dataset = {
      model: BASE_MODEL,
      task: "sequence-classification",
      labels: { "0": "SAFE", "1": "CAUTION", "2": "FLAGGED" },
      examples: [{
        text: att.reasoning || "No reasoning available",
        label: Number(att.threat_level),
        agent: agentAddress,
        behavioral_score: Number(att.behavioral_score),
        code_risk: Number(att.code_risk),
        timestamp: Number(att.attestation_timestamp),
      }],
      metadata: {
        created_at: Date.now(),
        source: "0G Sentinel attestation registry",
        chain: "0G Aristotle Mainnet (16661)",
        registry: process.env.ATTESTATION_REGISTRY_ADDRESS || "",
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const datasetHash = await uploadEvidence(dataset as any);

    const cliCommand = [
      "0g-compute-cli fine-tuning create-task",
      `--provider ${FINE_TUNING_PROVIDER}`,
      `--model ${BASE_MODEL}`,
      `--dataset ${datasetHash}`,
      "--config-path ./fine-tuning-config.json",
    ].join(" \\\n  ");

    return NextResponse.json({
      success: true,
      agentAddress,
      datasetHash,
      model: BASE_MODEL,
      provider: FINE_TUNING_PROVIDER,
      note: "Dataset uploaded to 0G Storage. Run the CLI command below on a machine with 0g-compute-cli installed (testnet only).",
      command: cliCommand,
    });
  } catch (err: unknown) {
    console.error("[FineTuning] Error:", err);
    return NextResponse.json({ error: "Dataset preparation failed" }, { status: 500 });
  }
}
