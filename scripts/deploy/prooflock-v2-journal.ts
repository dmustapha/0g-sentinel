import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "ethers";
import type { ContractDeploymentRecord } from "./prooflock-v2-config";

export interface DeploymentJournal {
  schemaVersion?: "prooflock-deployment-journal-v1";
  status?: "DEPLOYING" | "COMPLETE";
  configFingerprint: string;
  confirmations: number;
  deployer: string;
  estimatedGraphGas: string;
  requiredBalance: string;
  deployments?: Partial<{
    registry: ContractDeploymentRecord;
    gate: ContractDeploymentRecord;
    consumer: ContractDeploymentRecord;
  }>;
}

export class DeploymentJournalStore {
  readonly path: string;

  constructor(directory: string, deployer: string) {
    this.path = join(directory, `prooflock-v2-pending-${getAddress(deployer).toLowerCase()}.json`);
  }

  open(seed: DeploymentJournal): Required<DeploymentJournal> {
    if (!existsSync(this.path)) {
      const created = this.normalize(seed);
      this.save(created);
      return created;
    }
    const recovered = this.normalize(JSON.parse(readFileSync(this.path, "utf8")) as DeploymentJournal);
    if (recovered.configFingerprint !== seed.configFingerprint) {
      throw new Error("Partial deployment config fingerprint does not match current inputs");
    }
    return recovered;
  }

  save(journal: DeploymentJournal): void {
    const normalized = this.normalize(journal);
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    if (/private.?key|secret|operator.?token/i.test(serialized)) {
      throw new Error("Deployment journal must not contain secrets");
    }
    mkdirSync(join(this.path, ".."), { recursive: true });
    const temporary = `${this.path}.${process.pid}-${Date.now()}.tmp`;
    writeFileSync(temporary, serialized, { flag: "wx", mode: 0o600 });
    renameSync(temporary, this.path);
  }

  private normalize(journal: DeploymentJournal): Required<DeploymentJournal> {
    return {
      ...journal,
      schemaVersion: "prooflock-deployment-journal-v1",
      status: journal.status ?? "DEPLOYING",
      deployer: getAddress(journal.deployer),
      deployments: journal.deployments ?? {},
    };
  }
}
