/**
 * The Sanity side of the shared media keyword model (AB#68): allow-listed queries and the
 * parsers that turn their rows into project-owned values. Failure is loud, as in
 * `sanity-media.ts`: a malformed row raises rather than silently hiding a photograph.
 *
 * Only `keywords` and `expandedKeywordIds` are read from a medium. The import audit, the
 * editor's overrides and internal keywords live in a private record that no query here
 * names (ADR-0039 decisions 2 and 7). `_id in path("*")` keeps private-path documents out
 * even for a reader whose token could see them; verified on the `preview` dataset 2026-11-04.
 */

import "server-only";

import {
  buildMediaKeywordIndex,
  buildPublicKeywordTaxonomy,
  isKeywordId,
  type MediaKeywordIndex,
  type MediaKeywords,
  type PublicKeyword,
  type PublicKeywordTaxonomy,
} from "@/lib/media-keywords";
import { isRecord, readString, selectLocalizedText } from "@/lib/sanity-values";

export const KEYWORD_DOCUMENT_TYPE = "keyword";

/** Fields read from a keyword. A test pins them to the schema. */
export const PROJECTED_KEYWORD_FIELDS = ["keywordId", "title", "category", "parent", "status", "visibility"] as const;
/** Fields read from a medium. A test pins them to the schema. */
export const PROJECTED_MEDIA_KEYWORD_FIELDS = ["mediaId", "keywords", "expandedKeywordIds"] as const;

/** What makes a keyword public. Every public read of the vocabulary builds on this one rule. */
export const PUBLIC_KEYWORD_FILTER = `_type == "${KEYWORD_DOCUMENT_TYPE}" && status == "active" && visibility == "public" && _id in path("*")`;

export const PUBLIC_KEYWORD_TAXONOMY_QUERY = `*[${PUBLIC_KEYWORD_FILTER}]{
  keywordId,
  title[]{language, value},
  "categorySlug": category->slug,
  "parentRef": parent._ref,
  "parentKeywordId": parent->keywordId
}`;

/**
 * A medium's stored references and what each one points at. The parser decides, because a
 * GROQ filter here would make a dangling reference look like a keyword nobody assigned.
 * `expandedKeywordIds` is read as stored. A dangling target stays in its array position as
 * `null` (verified on the `preview` dataset 2026-11-04).
 */
export const PUBLIC_MEDIA_KEYWORD_PROJECTION = `{
  mediaId,
  keywords,
  "keywordTargets": keywords[]->{keywordId, status, visibility},
  expandedKeywordIds
}`;

function parseKeyword(row: unknown, language: string, defaultLanguage: string): PublicKeyword {
  if (!isRecord(row)) throw new TypeError("a keyword row is malformed");
  const { keywordId, categorySlug, parentRef, parentKeywordId } = row;
  const defaultTitle = selectLocalizedText(row.title, defaultLanguage);
  const slug = readString(categorySlug);
  if (!isKeywordId(keywordId)) throw new TypeError("a keyword row has an invalid id");
  if (defaultTitle === undefined) throw new TypeError(`keyword "${keywordId}" has no title in the default language`);
  const title = selectLocalizedText(row.title, language) ?? defaultTitle;
  if (slug === undefined) throw new TypeError(`keyword "${keywordId}" has no category`);
  if (parentKeywordId !== null && parentKeywordId !== undefined && !isKeywordId(parentKeywordId)) {
    throw new TypeError(`keyword "${keywordId}" has an invalid parent`);
  }
  // A reference with no target would otherwise pass for a root and shorten the closure.
  if (parentRef !== null && parentRef !== undefined && (parentKeywordId === null || parentKeywordId === undefined)) {
    throw new TypeError(`keyword "${keywordId}" has a dangling parent`);
  }
  return { keywordId, title, categorySlug: slug, parentKeywordId: parentKeywordId ?? null };
}

/** A keyword without a title in this language falls back to the default language (ADR-0039 decision 1). */
export function parsePublicKeywordTaxonomy(rows: unknown, language: string, defaultLanguage: string): PublicKeywordTaxonomy {
  if (!Array.isArray(rows)) throw new TypeError("the keyword taxonomy is malformed");
  return buildPublicKeywordTaxonomy(rows.map((row) => parseKeyword(row, language, defaultLanguage)));
}

function closureList(value: unknown, mediaId: string, hasReferences: boolean): readonly string[] {
  // Only a medium without references may have no stored closure.
  if ((value === null || value === undefined) && !hasReferences) return [];
  if (!Array.isArray(value) || !value.every(isKeywordId)) throw new TypeError(`media "${mediaId}" has a malformed expandedKeywordIds`);
  return [...new Set(value)].sort();
}

/**
 * A merged or retired keyword stays on the medium until the re-sync re-points it, so it is
 * left out rather than an error. A reference that points at nothing is a defect.
 */
function effectiveKeywordIds(references: unknown, targets: unknown, mediaId: string): readonly string[] {
  if (references === null || references === undefined) return [];
  if (!Array.isArray(references) || !Array.isArray(targets) || targets.length !== references.length) {
    throw new TypeError(`media "${mediaId}" has malformed keywords`);
  }
  const keywordIds = references.flatMap((reference, index) => {
    const target: unknown = targets[index];
    if (!isRecord(reference) || typeof reference._ref !== "string") throw new TypeError(`media "${mediaId}" has malformed keywords`);
    if (!isRecord(target)) throw new TypeError(`media "${mediaId}" has a dangling keyword`);
    if (!isKeywordId(target.keywordId)) throw new TypeError(`media "${mediaId}" has malformed keywords`);
    if (target.status !== "active" && target.status !== "merged" && target.status !== "retired") throw new TypeError(`media "${mediaId}" has malformed keywords`);
    if (target.visibility !== "public" && target.visibility !== "internal") throw new TypeError(`media "${mediaId}" has malformed keywords`);
    return target.status === "active" && target.visibility === "public" ? [target.keywordId] : [];
  });
  return [...new Set(keywordIds)].sort();
}

function parseMediaKeywords(row: unknown): MediaKeywords {
  if (!isRecord(row)) throw new TypeError("a media keyword row is malformed");
  const mediaId = readString(row.mediaId);
  if (mediaId === undefined) throw new TypeError("a media keyword row has no mediaId");
  return {
    mediaId,
    keywordIds: effectiveKeywordIds(row.keywords, row.keywordTargets, mediaId),
    expandedKeywordIds: closureList(row.expandedKeywordIds, mediaId, Array.isArray(row.keywords) && row.keywords.length > 0),
  };
}

export function parseMediaKeywordIndex(rows: unknown): MediaKeywordIndex {
  if (!Array.isArray(rows)) throw new TypeError("the media keyword rows are malformed");
  return buildMediaKeywordIndex(rows.map(parseMediaKeywords));
}
