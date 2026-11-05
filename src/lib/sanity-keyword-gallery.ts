/**
 * The Sanity source of a dynamic keyword gallery (ADR-0012, ADR-0039, AB#58). Keyword values
 * travel only as GROQ parameters; the query text changes only with how many there are.
 *
 * A medium has no expiry of its own. Expiry belongs to an unlisted gallery, whose media stays
 * out of here because `dynamicallyDiscoverable` is off unless someone opts it in.
 */

import "server-only";

import type { KeywordVocabularySnapshot } from "@/lib/keyword-gallery-selection";
import type { KeywordGallerySource } from "@/lib/keyword-gallery";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  getFallbackLocale,
  PUBLIC_MEDIA_FILTER,
  PUBLIC_MEDIA_ORDER,
  PUBLIC_MEDIA_PROJECTION,
  projectPublicMedia,
  type RawPublicMediaDocument,
} from "@/lib/sanity-media";
import { parsePublicKeywordTaxonomy, PUBLIC_KEYWORD_TAXONOMY_QUERY } from "@/lib/sanity-media-keywords";
import { isRecord, toLanguageSubtag } from "@/lib/sanity-values";

export const KEYWORD_TAXONOMY_STATE_DOCUMENT_ID = "keywordTaxonomyState";

/** One query, so the version, the hierarchy and the merges describe the same moment. */
export const KEYWORD_VOCABULARY_QUERY = `{
  "taxonomyVersion": *[_id == "${KEYWORD_TAXONOMY_STATE_DOCUMENT_ID}"][0].taxonomyVersion,
  "keywords": ${PUBLIC_KEYWORD_TAXONOMY_QUERY},
  "mergeRecords": *[_type == "keyword" && status == "merged" && visibility == "public" && _id in path("*")]{
    keywordId,
    "mergedIntoKeywordId": mergedInto->keywordId
  }
}`;

function matchPredicate(canonicalIds: readonly string[]): string {
  if (canonicalIds.length < 1 || canonicalIds.length > 5) throw new RangeError("a keyword query needs 1 to 5 keywords");
  return canonicalIds.map((_, index) => `$k${index} in expandedKeywordIds`).join(" && ");
}

/** ADR-0012 §2. The keyword index counts with this too, or its counts could mislead. */
export const KEYWORD_GALLERY_ELIGIBILITY = `${PUBLIC_MEDIA_FILTER} && mediaType == "image" && dynamicallyDiscoverable == true`;

/** Eligibility plus the selection. Everything that reads or counts uses this. */
export function keywordGalleryFilter(canonicalIds: readonly string[]): string {
  return `${KEYWORD_GALLERY_ELIGIBILITY} && ${matchPredicate(canonicalIds)}`;
}

const KEYED_PROJECTION = `{"orderKey": coalesce(capturedAt, ""), "enquiryAllowed": enquiryEligible == true, "document": @${PUBLIC_MEDIA_PROJECTION}}`;

export function keywordGalleryLatestChangeQuery(canonicalIds: readonly string[]): string {
  return `*[${keywordGalleryFilter(canonicalIds)}] | order(_updatedAt desc) [0]._updatedAt`;
}

/** Two rows at most, so a repeated identity is reported rather than resolved by taking the first. */
export function keywordGalleryBoundaryQuery(canonicalIds: readonly string[]): string {
  return `*[${keywordGalleryFilter(canonicalIds)} && mediaId == $afterId][0...2]${KEYED_PROJECTION}`;
}

export function keywordGalleryWindowQuery(canonicalIds: readonly string[], hasBoundary: boolean): string {
  const keyset = hasBoundary ? ` && (coalesce(capturedAt, "") < $afterKey || (coalesce(capturedAt, "") == $afterKey && mediaId > $afterId))` : "";
  return `*[${keywordGalleryFilter(canonicalIds)}${keyset}] | ${PUBLIC_MEDIA_ORDER} [0...$limit]${KEYED_PROJECTION}`;
}

const keywordParams = (canonicalIds: readonly string[]) => Object.fromEntries(canonicalIds.map((keywordId, index) => [`k${index}`, keywordId]));

export function parseKeywordVocabulary(result: unknown, language: string, fallbackLanguage: string): KeywordVocabularySnapshot {
  if (!isRecord(result)) throw new TypeError("the keyword vocabulary is malformed");
  const version = result.taxonomyVersion ?? 0;
  if (!Number.isSafeInteger(version) || (version as number) < 0) throw new TypeError("the taxonomy version is malformed");
  if (!Array.isArray(result.mergeRecords)) throw new TypeError("the keyword merge records are malformed");
  const mergedInto = new Map<string, string>();
  for (const row of result.mergeRecords) {
    if (!isRecord(row) || typeof row.keywordId !== "string") throw new TypeError("a keyword merge record is malformed");
    if (typeof row.mergedIntoKeywordId !== "string") throw new TypeError(`merge record "${row.keywordId}" has a dangling target`);
    if (mergedInto.has(row.keywordId)) throw new TypeError(`merge record "${row.keywordId}" is repeated`);
    mergedInto.set(row.keywordId, row.mergedIntoKeywordId);
  }
  return {
    taxonomyVersion: version as number,
    taxonomy: parsePublicKeywordTaxonomy(result.keywords, toLanguageSubtag(language), toLanguageSubtag(fallbackLanguage)),
    mergedInto,
  };
}

type ReadOptions = Readonly<{
  language: string;
  /** Injected in tests, like the client; production uses the deployment's own. */
  fallbackLanguage?: string;
  client?: SanityClient;
  config?: SanityConfig;
}>;

export async function readSanityKeywordVocabulary(options: ReadOptions): Promise<KeywordVocabularySnapshot> {
  const client = options.client ?? getSanityClient();
  const result = await client.query({ query: KEYWORD_VOCABULARY_QUERY, params: {}, tag: "keyword-gallery.vocabulary" });
  return parseKeywordVocabulary(result, options.language, options.fallbackLanguage ?? getFallbackLocale());
}

function parseRow(row: unknown, options: Readonly<{ language: string; fallbackLanguage: string; config: SanityConfig }>) {
  if (!isRecord(row) || typeof row.orderKey !== "string" || !isRecord(row.document)) throw new TypeError("a keyword gallery row is malformed");
  if (typeof row.enquiryAllowed !== "boolean") throw new TypeError("a keyword gallery row is malformed");
  return { orderKey: row.orderKey, enquiryAllowed: row.enquiryAllowed, media: projectPublicMedia(row.document as RawPublicMediaDocument, options) };
}

export function createSanityKeywordGallerySource(options: ReadOptions): KeywordGallerySource {
  const client = options.client ?? getSanityClient();
  const projection = { language: options.language, fallbackLanguage: options.fallbackLanguage ?? getFallbackLocale(), config: options.config ?? getSanityConfig() };
  return {
    readLatestChange: async (canonicalIds) => {
      const result = await client.query({ query: keywordGalleryLatestChangeQuery(canonicalIds), params: keywordParams(canonicalIds), tag: "keyword-gallery.scope" });
      if (result === null || result === undefined) return undefined;
      if (typeof result !== "string") throw new TypeError("the keyword gallery scope is malformed");
      return result;
    },
    readBoundary: async (canonicalIds, mediaId) => {
      const result = await client.query({ query: keywordGalleryBoundaryQuery(canonicalIds), params: { ...keywordParams(canonicalIds), afterId: mediaId }, tag: "keyword-gallery.boundary" });
      if (!Array.isArray(result)) throw new TypeError("the keyword gallery boundary is malformed");
      if (result.length > 1) throw new TypeError("one media identity appears more than once");
      return result.length === 0 ? undefined : parseRow(result[0], projection);
    },
    readWindow: async ({ canonicalIds, after, limit }) => {
      const params = { ...keywordParams(canonicalIds), limit, ...(after === undefined ? {} : { afterKey: after.orderKey, afterId: after.mediaId }) };
      const result = await client.query({ query: keywordGalleryWindowQuery(canonicalIds, after !== undefined), params, tag: "keyword-gallery.window" });
      if (!Array.isArray(result)) throw new TypeError("the keyword gallery window is malformed");
      return result.map((row) => parseRow(row, projection));
    },
  };
}
