import { z } from "zod";

import type { HexAddress } from "../types";
import { validateComputeUrl } from "./safe-https";
import { computeFailure } from "./strict-error";

export type ServiceDetail = Readonly<{
  provider: string;
  url: string;
  model: string;
  additionalInfo: string;
  verifiability: string;
  teeSignerAddress: string;
  teeSignerAcknowledged: boolean;
}>;

type ServiceBroker = Readonly<{
  listService(
    offset: number,
    limit: number,
    includeUnacknowledged: boolean,
    signal: AbortSignal,
  ): Promise<readonly unknown[]>;
}>;

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const serviceSchema = z
  .object({
    provider: z.string().regex(addressPattern),
    url: z.string().trim().min(1).max(4_096),
    model: z.string().trim().min(1).max(256),
    additionalInfo: z.string().max(65_536),
    verifiability: z.string().max(256),
    teeSignerAddress: z.string().regex(addressPattern),
    teeSignerAcknowledged: z.boolean(),
  })
  .passthrough();

export async function resolveService(
  broker: ServiceBroker,
  provider: string,
  model: string,
  signal: AbortSignal,
): Promise<ServiceDetail> {
  for (let offset = 0; offset < 1_000; offset += 50) {
    const page = await broker.listService(offset, 50, true, signal);
    signal.throwIfAborted();
    const candidate = page.map(normalizeService).find((service) => matches(service, provider));
    if (candidate) return parseService(candidate, model);
    if (page.length < 50) break;
  }
  throw computeFailure("COMPUTE_SERVICE_UNAVAILABLE", "service was not found on-chain");
}

export function validateBaseUrl(endpoint: string): URL {
  try {
    return validateComputeUrl(endpoint, false);
  } catch (error) {
    throw computeFailure(
      "COMPUTE_METADATA_INVALID",
      "0G Compute endpoint is not a safe HTTPS base URL",
      error,
    );
  }
}

export function assertServiceEndpoint(metadataEndpoint: string, serviceEndpoint: string): void {
  const metadata = validateBaseUrl(metadataEndpoint);
  const service = validateBaseUrl(serviceEndpoint);
  const expected = `${service.href.replace(/\/$/, "")}/v1/proxy`;
  if (metadata.href.replace(/\/$/, "") !== expected) {
    throw computeFailure(
      "COMPUTE_METADATA_INVALID",
      "metadata endpoint differs from on-chain service",
    );
  }
}

export function resolveExpectedSigner(service: ServiceDetail): HexAddress {
  if (!service.teeSignerAcknowledged) {
    throw computeFailure("COMPUTE_SIGNER_UNACKNOWLEDGED", "signer is not acknowledged");
  }
  const additional = parseAdditionalInfo(service.additionalInfo);
  // 0G's real TEE attestation model (verified against the live network): the enclave signer
  // lives in the acknowledged top-level `teeSignerAddress`, `verifiability` is "TeeML" (dstack /
  // Intel TDX), and `TargetSeparated` marks that the enclave signing key is separated from the
  // provider's operator key. `additionalInfo.TargetTeeAddress` is empty for every real provider,
  // and `ProviderType` denotes the host operator identity (e.g. "centralized"/"aliyun"), NOT the
  // attestation class — so neither may gate acceptance. We require a genuinely separated TeeML
  // signer and verify the transcript signature against it.
  if (!isSeparatedTeeMlSigner(service, additional)) {
    throw computeFailure(
      "COMPUTE_PROOF_CLASS_UNSUPPORTED",
      "mandatory proofs require a separated TEE-attested (TeeML) enclave signer",
    );
  }
  return service.teeSignerAddress.toLowerCase() as HexAddress;
}

export function assertSameServiceSnapshot(before: ServiceDetail, after: ServiceDetail): void {
  for (const key of snapshotKeys) {
    if (before[key] !== after[key]) {
      throw computeFailure("COMPUTE_SERVICE_UNAVAILABLE", "service changed during verification");
    }
  }
}

const snapshotKeys = [
  "provider",
  "url",
  "model",
  "additionalInfo",
  "verifiability",
  "teeSignerAddress",
  "teeSignerAcknowledged",
] as const;

function normalizeService(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const service = value as Record<string, unknown>;
  return Object.fromEntries(snapshotKeys.map((key) => [key, service[key]]));
}

function matches(service: Record<string, unknown>, provider: string): boolean {
  return typeof service.provider === "string" && service.provider.toLowerCase() === provider;
}

function parseService(candidate: Record<string, unknown>, model: string): ServiceDetail {
  const parsed = serviceSchema.safeParse(candidate);
  if (!parsed.success) {
    throw computeFailure("COMPUTE_SERVICE_UNAVAILABLE", "on-chain service detail is malformed");
  }
  if (parsed.data.model !== model) {
    throw computeFailure("COMPUTE_MODEL_MISMATCH", "configured model differs at service boundary");
  }
  return parsed.data;
}

function parseAdditionalInfo(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    return value;
  } catch (error) {
    throw computeFailure("COMPUTE_SERVICE_UNAVAILABLE", "service additionalInfo is invalid", error);
  }
}

function isSeparatedTeeMlSigner(
  service: ServiceDetail,
  additional: Record<string, unknown>,
): boolean {
  const signer = service.teeSignerAddress;
  return (
    service.verifiability === "TeeML" &&
    additional.TargetSeparated === true &&
    typeof signer === "string" &&
    addressPattern.test(signer) &&
    !/^0x0{40}$/i.test(signer) &&
    // "separated" means the enclave signer is distinct from the provider's operator key.
    signer.toLowerCase() !== service.provider.toLowerCase()
  );
}
