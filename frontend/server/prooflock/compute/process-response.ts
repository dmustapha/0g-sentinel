import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";

export type ProcessResponseVerification = Readonly<{
  provider: string;
  chatId: string;
  usage: string;
  signatureUrl: string;
  signatureBody: Uint8Array;
}>;

export type ComputeSdk = Readonly<{
  getServiceMetadata(provider: string, model: string, signal: AbortSignal): Promise<{ endpoint: string; model: string }>;
  getRequestHeaders(provider: string, content: string, signal: AbortSignal): Promise<unknown>;
  listService(offset: number, limit: number, includeUnacknowledged: boolean, signal: AbortSignal): Promise<readonly unknown[]>;
  processResponse(input: ProcessResponseVerification, signal: AbortSignal): Promise<boolean | null>;
}>;

type SdkAction =
  | { action: "metadata"; provider: string; model: string }
  | { action: "headers"; provider: string; content: string }
  | { action: "services"; offset: number; limit: number; includeUnacknowledged: boolean }
  | ({ action: "process" } & Omit<ProcessResponseVerification, "signatureBody"> & { signatureBodyBase64: string });
type WorkerResult = { ok: true; value: unknown } | { ok: false; error: string };
type WorkerLauncher = () => ChildProcess;

export type SubprocessComputeSdkOptions = Readonly<{
  privateKey: string;
  rpcUrl: string;
  /** Dependency seam for deterministic supervisor tests only. */
  workerLauncher?: WorkerLauncher;
}>;

/** Each SDK operation is isolated. Abort settles only after the child exits. */
export class SubprocessComputeSdk implements ComputeSdk {
  private readonly launch: WorkerLauncher;

  constructor(private readonly options: SubprocessComputeSdkOptions) {
    this.launch = options.workerLauncher ?? (() => this.launchProductionWorker());
  }

  async getServiceMetadata(provider: string, model: string, signal: AbortSignal) {
    return (await this.run({ action: "metadata", provider, model }, signal)) as { endpoint: string; model: string };
  }

  async getRequestHeaders(provider: string, content: string, signal: AbortSignal) {
    return await this.run({ action: "headers", provider, content }, signal);
  }

  async listService(offset: number, limit: number, includeUnacknowledged: boolean, signal: AbortSignal) {
    return (await this.run({ action: "services", offset, limit, includeUnacknowledged }, signal)) as readonly unknown[];
  }

  async processResponse(input: ProcessResponseVerification, signal: AbortSignal) {
    return (await this.run({
      action: "process",
      ...input,
      signatureBodyBase64: Buffer.from(input.signatureBody).toString("base64"),
    }, signal)) as boolean | null;
  }

  private launchProductionWorker(): ChildProcess {
    return fork(join(process.cwd(), ".prooflock-build/sdk-worker.cjs"), [], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: process.env.NODE_ENV,
        SENTINEL_0G_PRIVATE_KEY: this.options.privateKey,
        SENTINEL_0G_RPC_URL: this.options.rpcUrl,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "json",
    });
  }

  private run(action: SdkAction, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    return supervise(this.launch(), action, signal);
  }
}

function supervise(child: ChildProcess, action: SdkAction, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let result: WorkerResult | undefined;
    let workerError: Error | undefined;
    let aborted = false;
    const abort = () => {
      aborted = true;
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.once("message", (message) => {
      result = message as WorkerResult;
      child.kill();
    });
    child.once("error", (error) => {
      workerError = error;
      child.kill("SIGKILL");
    });
    child.once("close", (code, killedBy) => {
      signal.removeEventListener("abort", abort);
      if (aborted) return reject(signal.reason);
      if (workerError) return reject(workerError);
      if (!result) return reject(new Error(`0G SDK worker exited ${code ?? killedBy}`));
      return result.ok ? resolve(result.value) : reject(new Error(result.error));
    });
    child.send(action, (error) => {
      if (!error) return;
      workerError = error;
      child.kill("SIGKILL");
    });
  });
}
