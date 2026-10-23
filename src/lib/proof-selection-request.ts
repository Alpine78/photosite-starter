/**
 * Request boundary of the proof selection route (ADR-0038 decision 5, AB#130):
 * the default-off configuration and the closed request body. Pure apart from
 * reading the environment it is given.
 */
import "server-only";
import { isClientGalleryHandle } from "@/lib/client-gallery-model";
import { readProofGalleryDeployment } from "@/lib/proof-gallery-deployment";
import { PROOF_GALLERY_MAX_ITEMS } from "@/lib/proof-gallery-model";
import { isProofReference } from "@/lib/proof-references";
import { readProofSelectionToken } from "@/lib/proof-selection-sanity";

/** 256 references of up to six digits fit comfortably. */
export const PROOF_SELECTION_BODY_BYTES = 8 * 1024;
const KEY = /^[A-Za-z0-9_-]{43}$/u;
const REVISION = /^[A-Za-z0-9_-]{1,128}$/u;

export type ProofSelectionConfig =
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "misconfigured" }>
  | Readonly<{ state: "enabled"; token: string }>
  /** Synthetic in-process store for the harness; only beside the proof page fixture. */
  | Readonly<{ state: "fixture" }>;

/**
 * Off unless `PROOF_SELECTION=enabled` and the proof page reads real Sanity
 * content; an enabled but incomplete configuration is reported, not guessed.
 */
export function readProofSelectionConfig(environment: Readonly<Record<string, string | undefined>>): ProofSelectionConfig {
  const setting = environment.PROOF_SELECTION?.trim();
  if (setting !== "enabled" && setting !== "fixture") return { state: "disabled" };
  let adapter: string;
  try { adapter = readProofGalleryDeployment(environment); } catch { return { state: "misconfigured" }; }
  // The proof page fixture is itself refused outside local development.
  if (setting === "fixture") return adapter === "fixture" ? { state: "fixture" } : { state: "misconfigured" };
  const token = readProofSelectionToken(environment);
  return adapter === "sanity" && token ? { state: "enabled", token } : { state: "misconfigured" };
}

export type ProofSelectionRequest =
  | Readonly<{ operation: "read"; handle: string; key: string }>
  | Readonly<{ operation: "select"; handle: string; key: string; expectedRevision: string | null; references: readonly string[] }>
  | Readonly<{ operation: "confirm"; handle: string; key: string; expectedRevision: string }>
  /** The customer's own reminder stop (ADR-0038 amendment 2026-10-23); works while selection is closed. */
  | Readonly<{ operation: "stop-reminders"; handle: string; key: string }>;

function exactKeys(record: Record<string, unknown>, names: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === names.length && names.every((name) => Object.hasOwn(record, name));
}

/** Exactly one of the three closed shapes; references unique, canonical and bounded. */
export function parseProofSelectionBody(body: string | undefined): ProofSelectionRequest | undefined {
  if (body === undefined) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const row = parsed as Record<string, unknown>;
  if (!isClientGalleryHandle(row.handle) || typeof row.key !== "string" || !KEY.test(row.key)) return undefined;
  const base = { handle: row.handle, key: row.key };
  if (row.operation === "read") return exactKeys(row, ["operation", "handle", "key"]) ? { operation: "read", ...base } : undefined;
  if (row.operation === "stop-reminders") return exactKeys(row, ["operation", "handle", "key"]) ? { operation: "stop-reminders", ...base } : undefined;
  if (row.operation === "confirm") {
    return exactKeys(row, ["operation", "handle", "key", "expectedRevision"]) && typeof row.expectedRevision === "string" && REVISION.test(row.expectedRevision)
      ? { operation: "confirm", ...base, expectedRevision: row.expectedRevision } : undefined;
  }
  if (row.operation !== "select" || !exactKeys(row, ["operation", "handle", "key", "expectedRevision", "references"])) return undefined;
  if (row.expectedRevision !== null && (typeof row.expectedRevision !== "string" || !REVISION.test(row.expectedRevision))) return undefined;
  if (!Array.isArray(row.references) || row.references.length > PROOF_GALLERY_MAX_ITEMS || !row.references.every(isProofReference) ||
    new Set(row.references).size !== row.references.length) return undefined;
  return { operation: "select", ...base, expectedRevision: row.expectedRevision as string | null, references: row.references as string[] };
}
