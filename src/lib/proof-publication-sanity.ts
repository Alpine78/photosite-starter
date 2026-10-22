/**
 * Sanity calls of the proof publication route, all made with the **editor's
 * own token** (ADR-0038 amendment 2026-10-22, AB#130): `/users/me` proves a user
 * session, and Sanity enforces read, write and publish permission on every
 * read and transaction. This module holds no credential of its own.
 *
 * Every URL is fixed to this deployment's project host. The token is sent only
 * there, never logged, and never part of an error message.
 */
import "server-only";
import type { SanityConfig } from "@/lib/sanity-config";
import { proofDraftId, proofTermsId, proofVersionsPath, type PublicationRead, type PublicationRelated } from "@/lib/proof-publication";

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type SanityCallOptions = Readonly<{ config: SanityConfig; token: string; fetchImplementation?: typeof fetch }>;

export class ProofPublicationStoreError extends Error {
  constructor(readonly kind: "unauthenticated" | "forbidden" | "conflict" | "unavailable") {
    super(`[proof-publication-sanity] ${kind}`);
    this.name = "ProofPublicationStoreError";
  }
}

function base({ config }: SanityCallOptions): string {
  return `https://${config.projectId}.api.sanity.io/${config.apiVersion}`;
}

async function call(options: SanityCallOptions, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
  const send = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await send(`${base(options)}${path}`, {
      method: init.method,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${options.token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new ProofPublicationStoreError("unavailable");
  }
  if (response.status === 401) throw new ProofPublicationStoreError("unauthenticated");
  if (response.status === 403) throw new ProofPublicationStoreError("forbidden");
  if (response.status === 409) throw new ProofPublicationStoreError("conflict");
  if (!response.ok) throw new ProofPublicationStoreError("unavailable");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new ProofPublicationStoreError("unavailable");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new ProofPublicationStoreError("unavailable");
  try {
    return JSON.parse(text);
  } catch {
    throw new ProofPublicationStoreError("unavailable");
  }
}

/** A user session, not a robot token: `/users/me` accepts only user sessions. */
export async function verifyEditorSession(options: SanityCallOptions): Promise<void> {
  const user = await call(options, "/users/me", { method: "GET" });
  if (typeof user !== "object" || user === null || typeof (user as { id?: unknown }).id !== "string" ||
    (user as { id: string }).id.length === 0) throw new ProofPublicationStoreError("unauthenticated");
}

async function query(options: SanityCallOptions, groq: string, params: Record<string, unknown>): Promise<unknown> {
  // Raw perspective: the publication must see the draft and private documents.
  const result = await call(options, `/data/query/${options.config.dataset}?perspective=raw`, {
    method: "POST", body: { query: groq, params },
  });
  if (typeof result !== "object" || result === null || !("result" in result)) throw new ProofPublicationStoreError("unavailable");
  return (result as { result: unknown }).result;
}

/** Exported for the groq-js contract test (`studio/proof-publication-query-contract.test.ts`). */
export const PUBLICATION_STATE_QUERY = `{
  "draft": *[_id == $draftId][0],
  "published": *[_id == $id][0],
  "terms": *[_id == $termsId][0]{_id, _rev, _type, galleryId},
  "versions": count(*[_id in path($versionsPath)])
}`;

export const PUBLICATION_RELATED_QUERY = `{
  "conflicts": *[_type in ["clientDeliveryGallery", "legacyDeliveryGallery", "clientProofGallery"] && handle == $handle &&
    !(_id in [$id, $draftId]) && !(_id in path($versionsPath))][0...2]{_id},
  "assets": *[_id in $assetIds]{_id, _type, extension, mimeType, sha1hash,
    "width": metadata.dimensions.width, "height": metadata.dimensions.height,
    "restricted": count(*[_type == "media" && image.asset._ref == ^._id && defined(privateOnly) && privateOnly != false]) > 0}
}`;

export async function readPublicationState(galleryId: string, options: SanityCallOptions): Promise<PublicationRead> {
  const result = await query(options, PUBLICATION_STATE_QUERY, { id: galleryId, draftId: proofDraftId(galleryId), termsId: proofTermsId(galleryId), versionsPath: proofVersionsPath(galleryId) });
  if (typeof result !== "object" || result === null) throw new ProofPublicationStoreError("unavailable");
  const row = result as Record<string, unknown>;
  return { draft: row.draft ?? null, published: row.published ?? null, terms: row.terms ?? null, versions: row.versions };
}

export async function readPublicationRelated(galleryId: string, handle: string, assetIds: readonly string[], options: SanityCallOptions): Promise<PublicationRelated> {
  const result = await query(options, PUBLICATION_RELATED_QUERY, { id: galleryId, draftId: proofDraftId(galleryId), versionsPath: proofVersionsPath(galleryId), handle, assetIds });
  if (typeof result !== "object" || result === null) throw new ProofPublicationStoreError("unavailable");
  const row = result as Record<string, unknown>;
  return { conflicts: row.conflicts, assets: row.assets };
}

/** One atomic transaction; a guard mismatch or an existing `create` target is a conflict. */
export async function commitPublication(mutations: readonly Record<string, unknown>[], options: SanityCallOptions): Promise<void> {
  await call(options, `/data/mutate/${options.config.dataset}`, { method: "POST", body: { mutations } });
}
