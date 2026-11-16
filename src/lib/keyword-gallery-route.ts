/**
 * The keyword mode of the search route (ADR-0012 §8, AB#71): one request, validated in the
 * ADR's order, and only then described. A caller redirects only after this has answered,
 * because an invalid selection or cursor is never redirected.
 *
 * Shared by the page, its metadata, the redundant-prefix redirect and the continuation
 * endpoint, so they cannot disagree about what a request means.
 */

import "server-only";

import { dispatchContentSource } from "@/lib/content-source";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { GalleryCursorError, MAX_GALLERY_CURSOR_LENGTH } from "@/lib/gallery-pagination";
import type { DynamicGalleryResultItem, GalleryPage } from "@/lib/gallery-result";
import { readKeywordGalleryPage, type KeywordGalleryCursorCodec, type KeywordGallerySource } from "@/lib/keyword-gallery";
import { canonicalizeKeywordSelection, MAX_RAW_KEYWORD_TOKENS, parseKeywordTokens, type KeywordVocabularySnapshot } from "@/lib/keyword-gallery-selection";
import { createMockKeywordGallerySource, getMockKeywordVocabulary } from "@/lib/mock-keyword-gallery";
import { isPublicIdentity } from "@/lib/public-identity";
import { createSanityKeywordGallerySource, readSanityKeywordVocabulary } from "@/lib/sanity-keyword-gallery";

export type KeywordGalleryStore = Readonly<{
  readVocabulary: (locale: string) => Promise<KeywordVocabularySnapshot>;
  source: (locale: string) => KeywordGallerySource;
  /** Injected in tests; a deployment uses its own signing key. */
  cursorCodec?: KeywordGalleryCursorCodec;
}>;

const mockStore: KeywordGalleryStore = {
  readVocabulary: async (locale) => getMockKeywordVocabulary(locale.split("-")[0]),
  source: (locale) => createMockKeywordGallerySource(locale.split("-")[0]),
};
const sanityStore: KeywordGalleryStore = {
  readVocabulary: (locale) => readSanityKeywordVocabulary({ language: locale }),
  source: (locale) => createSanityKeywordGallerySource({ language: locale }),
};

export function deploymentKeywordGalleryStore(): Promise<KeywordGalleryStore> {
  return dispatchContentSource(getDeploymentConfig().contentSource, {
    sanity: async () => sanityStore,
    mock: async () => mockStore,
  });
}

export type KeywordSelectionRoute = Readonly<{
  canonicalParam: string;
  /** `keywords` then `cursor`, ADR-0012 §8's stable order, with literal commas. */
  canonicalQuery: string;
  /** Whether the request's own `keywords` value differs from the canonical one. */
  redirect: boolean;
  /** Display names of the canonical keywords, in canonical order. */
  titles: readonly string[];
}>;

export type KeywordGalleryRoute = KeywordSelectionRoute & Readonly<{
  cursor: string | undefined;
  page: GalleryPage<DynamicGalleryResultItem>;
}>;

/**
 * What `?enquire=` means beside a selection (ADR-0012's 2026-11-05 amendment), the rule ADR-0003 §8
 * gives a curated gallery: one valid identity opens a form, with a cursor it is a 404, and
 * anything else is an ordinary unknown parameter.
 */
export function readKeywordEnquiry(params: Readonly<Record<string, string | readonly string[] | undefined>>):
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "conflict" }>
  | Readonly<{ kind: "enquire"; itemId: string }> {
  const raw = params.enquire;
  if (typeof raw !== "string" || !isPublicIdentity(raw)) return { kind: "none" };
  return params.cursor === undefined ? { kind: "enquire", itemId: raw } : { kind: "conflict" };
}

export function keywordGalleryQuery(canonicalParam: string, cursor?: string): string {
  return `keywords=${canonicalParam}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
}

/**
 * The selection alone, for the enquiry view: it shows no photographs, so a fault in an unrelated
 * photograph on the first page must not stop someone asking about this one. `undefined` is §8's 404.
 */
export async function resolveKeywordSelection(locale: string, rawKeywords: string, store?: KeywordGalleryStore): Promise<KeywordSelectionRoute | undefined> {
  if (parseKeywordTokens(rawKeywords).length > MAX_RAW_KEYWORD_TOKENS) return undefined;
  const { readVocabulary } = store ?? await deploymentKeywordGalleryStore();
  const vocabulary = await readVocabulary(locale);
  const selection = canonicalizeKeywordSelection(rawKeywords, vocabulary);
  if (selection.state !== "selection") return undefined;
  return {
    canonicalParam: selection.canonicalParam,
    canonicalQuery: keywordGalleryQuery(selection.canonicalParam),
    redirect: selection.redirect,
    titles: selection.canonicalIds.map((keywordId) => vocabulary.taxonomy.byId.get(keywordId)!.title),
  };
}

/**
 * `undefined` for everything §8 answers with an accessible 404: an unknown or over-limit
 * selection, a repeated or empty cursor, and any cursor the adapter refuses. Repeating
 * `cursor` names no single slice, so it is refused rather than guessed at.
 */
export async function resolveKeywordGalleryRoute(
  locale: string,
  rawKeywords: string,
  rawCursor: string | readonly string[] | undefined,
  store?: KeywordGalleryStore,
): Promise<KeywordGalleryRoute | undefined> {
  if (rawCursor !== undefined && (typeof rawCursor !== "string" || rawCursor.length === 0 || rawCursor.length > MAX_GALLERY_CURSOR_LENGTH)) {
    return undefined;
  }
  // Costs nothing to check and needs no store, so an oversized link cannot amplify reads (§8).
  if (parseKeywordTokens(rawKeywords).length > MAX_RAW_KEYWORD_TOKENS) return undefined;
  const { readVocabulary, source, cursorCodec } = store ?? await deploymentKeywordGalleryStore();
  const vocabulary = await readVocabulary(locale);
  const selection = canonicalizeKeywordSelection(rawKeywords, vocabulary);
  if (selection.state !== "selection") return undefined;
  try {
    const page = await readKeywordGalleryPage({
      locale,
      canonicalIds: selection.canonicalIds,
      taxonomyVersion: vocabulary.taxonomyVersion,
      source: source(locale),
      ...(cursorCodec === undefined ? {} : { cursorCodec }),
      ...(rawCursor === undefined ? {} : { cursor: rawCursor }),
    });
    return {
      canonicalParam: selection.canonicalParam,
      canonicalQuery: keywordGalleryQuery(selection.canonicalParam, rawCursor),
      redirect: selection.redirect,
      titles: selection.canonicalIds.map((keywordId) => vocabulary.taxonomy.byId.get(keywordId)!.title),
      cursor: rawCursor,
      page,
    };
  } catch (error) {
    if (error instanceof GalleryCursorError) return undefined;
    throw error;
  }
}
