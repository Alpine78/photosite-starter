/**
 * The Sanity inputs of the public keyword index (AB#59). Two reviewed, cached queries: the
 * vocabulary, and the stored closure of every eligible medium, counted on the server because
 * one `count()` per keyword would cost about 68 ms each (`docs/keyword-query-benchmark.md`).
 * The closures are read in pages, because Next stores a response base64-encoded and will not
 * cache one past 2 MB. They page by `mediaId` rather than by offset, so a medium published between
 * pages cannot count another one twice. These are separate reads, so counts can briefly reflect
 * another generation than the names.
 *
 * Known limit: each read walks every page, from the cache when it holds them. Caching the counts
 * themselves would need one entry, but nothing in this project caches a computed value yet.
 */

import "server-only";

import { buildKeywordIndex, type KeywordIndex, type KeywordIndexCategory } from "@/lib/keyword-index";
import { isKeywordId } from "@/lib/media-keywords";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
import { KEYWORD_GALLERY_ELIGIBILITY } from "@/lib/sanity-keyword-gallery";
import { getFallbackLocale } from "@/lib/sanity-media";
import { parsePublicKeywordTaxonomy, PUBLIC_KEYWORD_FILTER } from "@/lib/sanity-media-keywords";
import { isRecord, readString, selectLocalizedText, toLanguageSubtag } from "@/lib/sanity-values";

export const KEYWORD_INDEX_VOCABULARY_QUERY = `*[${PUBLIC_KEYWORD_FILTER}]{
  keywordId,
  title[]{language, value},
  aliases,
  "categorySlug": category->slug,
  "categoryTitle": category->title[]{language, value},
  "categoryOrder": category->order,
  "parentRef": parent._ref,
  "parentKeywordId": parent->keywordId
}`;

/**
 * Twenty 40-character ids a medium stay under Next's limit at this size, once encoded. A closure
 * has no hard bound, because media can sit in many branches; a page past the limit still
 * works, and only goes uncached.
 */
export const KEYWORD_INDEX_CLOSURE_PAGE_SIZE = 1000;
/** Far beyond a real archive; a store that never ends a list must not loop forever. */
const MAX_CLOSURE_PAGES = 200;

/** The same eligibility as a keyword gallery (ADR-0012 §2), or its counts could mislead. */
export const KEYWORD_INDEX_CLOSURES_QUERY = `*[${KEYWORD_GALLERY_ELIGIBILITY} && defined(expandedKeywordIds) && mediaId > $after] | order(mediaId asc) [0...$limit]{mediaId, expandedKeywordIds}`;

export function parseKeywordClosures(result: unknown): readonly (readonly string[])[] {
  if (!Array.isArray(result)) throw new TypeError("the keyword closures are malformed");
  return result.map((closure) => {
    if (!Array.isArray(closure) || !closure.every(isKeywordId)) throw new TypeError("a medium has a malformed expandedKeywordIds");
    return closure;
  });
}

/**
 * A keyword whose parent is not in the public vocabulary, and whatever sits under it, is left out of the index. Studio
 * prevents this, but it does not bind an API write, and one bad row must not hide every keyword from every visitor.
 */
function withoutOrphans(rows: readonly unknown[]): readonly unknown[] {
  let kept = rows;
  for (;;) {
    const ids = new Set(kept.map((row) => (isRecord(row) ? row.keywordId : undefined)));
    const next = kept.filter((row) => !isRecord(row) || row.parentRef === null || row.parentRef === undefined || ids.has(row.parentKeywordId));
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

export function parseKeywordIndex(vocabulary: unknown, closures: unknown, language: string, fallbackLanguage: string): KeywordIndex {
  if (!Array.isArray(vocabulary)) throw new TypeError("the keyword index vocabulary is malformed");
  vocabulary = withoutOrphans(vocabulary);
  const selected = toLanguageSubtag(language), fallback = toLanguageSubtag(fallbackLanguage);
  const taxonomy = parsePublicKeywordTaxonomy(vocabulary, selected, fallback);
  const categories = new Map<string, KeywordIndexCategory>();
  const aliases = new Map<string, readonly string[]>();
  for (const row of vocabulary as unknown[]) {
    if (!isRecord(row)) throw new TypeError("a keyword row is malformed");
    const keywordId = row.keywordId as string, slug = readString(row.categorySlug) as string;
    const title = selectLocalizedText(row.categoryTitle, selected) ?? selectLocalizedText(row.categoryTitle, fallback);
    if (title === undefined) throw new TypeError(`keyword "${keywordId}" has a category with no title in the default language`);
    const order = row.categoryOrder ?? null;
    if (order !== null && typeof order !== "number") throw new TypeError(`keyword "${keywordId}" has a category with a malformed order`);
    const known = categories.get(slug);
    // A slug's uniqueness is a Studio check, and a query has no order, so last-wins would change between reads.
    if (known !== undefined && (known.title !== title || known.order !== order)) throw new TypeError(`two keyword categories claim the slug "${slug}"`);
    categories.set(slug, { title, order: order as number | null });
    const rowAliases = row.aliases ?? [];
    if (!Array.isArray(rowAliases) || !rowAliases.every((alias) => typeof alias === "string")) throw new TypeError(`keyword "${keywordId}" has malformed aliases`);
    aliases.set(keywordId, rowAliases);
  }
  return buildKeywordIndex({ language: selected, taxonomy, categories, aliases, closures: parseKeywordClosures(closures) });
}

export async function readSanityKeywordIndex(options: Readonly<{ language: string; fallbackLanguage?: string; client?: SanityClient }>): Promise<KeywordIndex> {
  const client = options.client ?? getSanityClient();
  const vocabulary = await client.query({ query: KEYWORD_INDEX_VOCABULARY_QUERY, params: {}, tag: "keyword-index.vocabulary" });
  const closures: unknown[] = [];
  let after = "";
  for (let page = 0; ; page += 1) {
    if (page === MAX_CLOSURE_PAGES) throw new TypeError("the keyword closures did not end within the supported archive size");
    const rows = await client.query({ query: KEYWORD_INDEX_CLOSURES_QUERY, params: { after, limit: KEYWORD_INDEX_CLOSURE_PAGE_SIZE }, tag: "keyword-index.closures" });
    if (!Array.isArray(rows)) throw new TypeError("the keyword closures are malformed");
    for (const row of rows) {
      const mediaId = (row as { mediaId?: unknown } | null)?.mediaId;
      if (typeof mediaId !== "string" || mediaId <= after) throw new TypeError("the keyword closures are malformed");
      after = mediaId;
      closures.push((row as { expandedKeywordIds: unknown }).expandedKeywordIds);
    }
    if (rows.length < KEYWORD_INDEX_CLOSURE_PAGE_SIZE) break;
  }
  return parseKeywordIndex(vocabulary, closures, options.language, options.fallbackLanguage ?? getFallbackLocale());
}
