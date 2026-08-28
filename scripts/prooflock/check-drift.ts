import type { Bytes32 } from "../../frontend/server/prooflock/types";

async function main(): Promise<void> {
  const identityKey = parseIdentityKey(process.argv[2]);
  const mark = process.argv.slice(3).includes("--mark");
  const { loadProofLockDrift } = await import("../../frontend/server/prooflock/operator.js");
  const result = await (await loadProofLockDrift()).run(identityKey, mark);
  print(result, bigintReplacer);
}

function parseIdentityKey(value: string | undefined): Bytes32 {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error("Usage: ts-node scripts/prooflock/check-drift.ts <identity-key> [--mark]");
  }
  return value.toLowerCase() as Bytes32;
}

function print(value: unknown, replacer?: (_key: string, value: unknown) => unknown): void {
  process.stdout.write(`${JSON.stringify(value, replacer)}\n`);
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

main().catch((error: unknown) => {
  const failure = error instanceof Error ? error : new Error("Unknown on-demand drift failure");
  process.stderr.write(`${JSON.stringify({ error: failure.name, message: failure.message })}\n`);
  process.exitCode = 1;
});
