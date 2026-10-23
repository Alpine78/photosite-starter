/**
 * Request boundary of the proof publication route (ADR-0038 amendment
 * 2026-10-22, AB#130): configuration, the Studio-only CORS answer, the editor's
 * bearer token and the closed request body. Pure apart from reading the
 * secret, so every rejection path is unit-testable.
 */
import "server-only";
import { readProofSelectionKeySecret } from "@/lib/proof-selection-key";
import { parseProofTerms, type ProofTerms } from "@/lib/proof-terms";

/** Leaves room for `proofTerms.`, `proofSelection.<id>.v<n>` and similar private IDs within Sanity's 128 characters. */
export const PROOF_GALLERY_ID_MAX_LENGTH = 96;
export const PROOF_PUBLICATION_BODY_BYTES = 2048;
const TOKEN = /^[A-Za-z0-9._~+/=-]{20,4096}$/u;
const GALLERY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export type ProofPublicationConfig =
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "misconfigured" }>
  | Readonly<{ state: "enabled"; studioOrigins: ReadonlySet<string>; secret: Buffer }>;

function exactOrigin(value: string, development: boolean): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.origin !== value || url.username || url.password) return undefined;
  if (url.protocol === "https:") return url.origin;
  // A local Studio (`sanity dev`) only during development.
  if (development && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return url.origin;
  return undefined;
}

/**
 * Off unless explicitly enabled. An enabled but incomplete configuration is
 * reported as misconfigured rather than guessed at, and the route answers it
 * with an unavailable status instead of running.
 */
export function readProofPublicationConfig(environment: Record<string, string | undefined>): ProofPublicationConfig {
  if (environment.PROOF_PUBLICATION?.trim() !== "enabled") return { state: "disabled" };
  const development = environment.NODE_ENV === "development";
  const raw = environment.PROOF_PUBLICATION_STUDIO_ORIGINS?.trim() ?? "";
  const origins = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (origins.length === 0 || origins.length > 5) return { state: "misconfigured" };
  const studioOrigins = new Set<string>();
  for (const origin of origins) {
    const exact = exactOrigin(origin, development);
    if (!exact) return { state: "misconfigured" };
    studioOrigins.add(exact);
  }
  try {
    return { state: "enabled", studioOrigins, secret: readProofSelectionKeySecret(environment) };
  } catch {
    return { state: "misconfigured" };
  }
}

/** CORS headers for an allowed Studio origin; nothing for any other origin. */
export function studioCorsHeaders(origin: string | null, allowed: ReadonlySet<string>): Record<string, string> | undefined {
  if (origin === null || !allowed.has(origin)) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** The editor's Sanity token from `Authorization: Bearer …`, or `undefined`. */
export function readEditorToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /^Bearer ([^\s]+)$/u.exec(header);
  return match && TOKEN.test(match[1]) ? match[1] : undefined;
}

export type ProofPublicationOperation = "publish" | "rotate-key";
export type ProofPublicationRequest =
  | Readonly<{ galleryId: string; operation: "publish"; expectedDraftRevision: string; terms?: ProofTerms }>
  | Readonly<{ galleryId: string; operation: "rotate-key" }>;
const REVISION = /^[A-Za-z0-9_-]{1,128}$/u;

export function isProofGalleryId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= PROOF_GALLERY_ID_MAX_LENGTH && GALLERY_ID.test(value);
}

/**
 * `publish`: `{galleryId, operation, expectedDraftRevision, terms?}` — the
 * revision the editor's validated view was based on, and the terms on a first
 * publication. `rotate-key`: exactly `{galleryId, operation}`. Nothing else.
 */
export function parseProofPublicationBody(body: string | undefined): ProofPublicationRequest | undefined {
  if (body === undefined) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!isProofGalleryId(record.galleryId)) return undefined;
  if (record.operation === "rotate-key") {
    return keys.length === 2 && keys.includes("operation") ? { galleryId: record.galleryId, operation: "rotate-key" } : undefined;
  }
  if (record.operation !== "publish" || typeof record.expectedDraftRevision !== "string" || !REVISION.test(record.expectedDraftRevision)) return undefined;
  const allowed = ["galleryId", "operation", "expectedDraftRevision", "terms"];
  if (keys.some((name) => !allowed.includes(name))) return undefined;
  if (!("terms" in record)) return { galleryId: record.galleryId, operation: "publish", expectedDraftRevision: record.expectedDraftRevision };
  const terms = parseProofTerms(record.terms);
  return terms === undefined ? undefined
    : { galleryId: record.galleryId, operation: "publish", expectedDraftRevision: record.expectedDraftRevision, terms };
}
