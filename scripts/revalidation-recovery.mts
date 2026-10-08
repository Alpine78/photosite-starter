/** Only validated acknowledgement references and project-owned errors reach operator logs. */
import { readVercelPreviewApiSettings, VercelApiError, type VercelPreviewApiSettings } from "./vercel-preview-api.mts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export async function readRecoveryResponse(response: Response): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer()));
}

export function isRecoveryAcknowledgement(value: unknown): value is { status: "accepted"; correlationId: string } {
  return typeof value === "object" && value !== null &&
    "status" in value && value.status === "accepted" &&
    "correlationId" in value && typeof value.correlationId === "string" &&
    UUID_V4.test(value.correlationId);
}

export function classifyRecoveryResult(response: Pick<Response, "ok" | "status">, value: unknown):
  | { readonly kind: "accepted"; readonly correlationId: string }
  | { readonly kind: "http-failure"; readonly status: number }
  | { readonly kind: "unverified"; readonly status: number } {
  if (!response.ok) return { kind: "http-failure", status: response.status };
  if (!isRecoveryAcknowledgement(value)) return { kind: "unverified", status: response.status };
  return { kind: "accepted", correlationId: value.correlationId };
}

export function describeRecoveryFailure(cause: unknown): string {
  try {
    if (cause instanceof VercelApiError) return cause.message;
    if (cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError")) return "request timed out or was aborted; details withheld";
  } catch { /* unknown thrown objects need not support inspection */ }
  return "request failed; details withheld";
}

export function readRecoveryPreviewSettings(environment: NodeJS.ProcessEnv = process.env): VercelPreviewApiSettings {
  try { return readVercelPreviewApiSettings(environment); } catch {
    throw new VercelApiError("Preview ownership lookup requires valid VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID settings");
  }
}
