/**
 * One page of a dynamic keyword gallery (ADR-0012, AB#58), independent of the store.
 *
 * The order is `PUBLIC_MEDIA_ORDER`: `coalesce(capturedAt, "") desc, mediaId asc`, compared
 * as strings. GROQ's string order and `compareKeywordGalleryOrder` agree on sub-second
 * precision, offsets and the empty string (verified on the `preview` dataset 2026-11-04). That
 * order is lexical, so instants written with mixed precision are consistent across pages but
 * not always chronological. Changing it must bump `KEYWORD_GALLERY_ORDERING`.
 */

import "server-only";

import {
  createHmacKeysetCursorCodec,
  KeysetCursorError,
  loadKeysetCursorSigningKey,
  MAX_KEYSET_ID_LENGTH,
  type KeysetCursorScope,
} from "@/lib/keyset-cursor";
import { GalleryCursorError, MAX_GALLERY_PAGE_SIZE } from "@/lib/gallery-pagination";
import type { DynamicGalleryResultItem, GalleryCursor, GalleryPage } from "@/lib/gallery-result";
import type { ImageMedia } from "@/lib/media";

export const KEYWORD_GALLERY_SOURCE_ID = "dynamic-keyword-query-v1";
export const KEYWORD_GALLERY_ORDERING = "dynamic-default-v1";
export const KEYWORD_GALLERY_PAGE_SIZE = 24;
/** Part of every cursor's visibility scope. Bump it when the eligibility predicate changes. */
export const KEYWORD_GALLERY_VISIBILITY_POLICY = "p1";

/**
 * The cursor names only the boundary's `mediaId`. It is signed, not encrypted, so a capture
 * time inside it would be readable by anyone holding the link; the server reads the
 * boundary's order key itself. This constant fills the key slot of the shared wire format.
 */
const CURSOR_KEY = 0;
const ORDER_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type KeywordGalleryBoundary = Readonly<{ orderKey: string; mediaId: string }>;

export type KeywordGalleryRow = Readonly<{ orderKey: string; enquiryAllowed: boolean; media: ImageMedia }>;

export type KeywordGalleryCursorCodec = Readonly<{
  encode: (scope: KeysetCursorScope, mediaId: string) => string;
  decode: (cursor: unknown, scope: KeysetCursorScope) => string;
}>;

export type KeywordGallerySource = Readonly<{
  /** The newest change among the query's eligible media; `undefined` when nothing matches. */
  readLatestChange: (canonicalIds: readonly string[]) => Promise<string | undefined>;
  /** The named medium, if it still qualifies. The same predicate as the window. */
  readBoundary: (canonicalIds: readonly string[], mediaId: string) => Promise<KeywordGalleryRow | undefined>;
  readWindow: (request: Readonly<{
    canonicalIds: readonly string[];
    after: KeywordGalleryBoundary | undefined;
    limit: number;
  }>) => Promise<readonly KeywordGalleryRow[]>;
}>;

function isOrderKey(value: string): boolean {
  return value === "" || ORDER_KEY.test(value);
}

/** Key descending by code unit, then `mediaId` ascending: `PUBLIC_MEDIA_ORDER` exactly. */
export function compareKeywordGalleryOrder(left: KeywordGalleryBoundary, right: KeywordGalleryBoundary): number {
  if (left.orderKey !== right.orderKey) return left.orderKey < right.orderKey ? 1 : -1;
  if (left.mediaId === right.mediaId) return 0;
  return left.mediaId < right.mediaId ? -1 : 1;
}

/** Signature, scope and boundary failures all surface as `GalleryCursorError`, which a route answers with a 404. */
export function createKeywordGalleryCursorCodec(signingKey: string): KeywordGalleryCursorCodec {
  const inner = createHmacKeysetCursorCodec(signingKey);
  return {
    encode: (scope, mediaId) => inner.encode(scope, CURSOR_KEY, mediaId),
    decode: (cursor, scope) => {
      try {
        const { afterKey, afterId } = inner.decode(cursor, scope);
        if (afterKey !== CURSOR_KEY) throw new GalleryCursorError("malformed");
        return afterId;
      } catch (error) {
        if (error instanceof KeysetCursorError) throw new GalleryCursorError(error.code);
        throw error;
      }
    },
  };
}

let cachedCodec: KeywordGalleryCursorCodec | undefined;

/** The deployment's codec, with the signing key read only when a cursor is actually used. */
export const keywordGalleryCursorCodec: KeywordGalleryCursorCodec = {
  encode: (scope, mediaId) => {
    cachedCodec ??= createKeywordGalleryCursorCodec(loadKeysetCursorSigningKey(process.env));
    return cachedCodec.encode(scope, mediaId);
  },
  decode: (cursor, scope) => {
    cachedCodec ??= createKeywordGalleryCursorCodec(loadKeysetCursorSigningKey(process.env));
    return cachedCodec.decode(cursor, scope);
  },
};

export function keywordGalleryScope(
  canonicalIds: readonly string[],
  taxonomyVersion: number,
  latestChange: string | undefined,
  pageSize: number,
  locale: string,
): KeysetCursorScope {
  return {
    // A page's words differ by language, so a cursor stays in the language it was issued for.
    sourceId: `${KEYWORD_GALLERY_SOURCE_ID}@${locale}`,
    normalizedFilter: `v${taxonomyVersion}:${canonicalIds.join(",")}`,
    ordering: KEYWORD_GALLERY_ORDERING,
    visibilityVersion: `${KEYWORD_GALLERY_VISIBILITY_POLICY}:${latestChange ?? "none"}`,
    pageSize,
  };
}

function boundaryOf(row: KeywordGalleryRow): KeywordGalleryBoundary {
  if (!isOrderKey(row.orderKey)) throw new TypeError(`media "${row.media.mediaId}" has an unusable order key`);
  // A longer id would issue a cursor its own decoder refuses, on unchanged data.
  if (row.media.mediaId.length > MAX_KEYSET_ID_LENGTH) throw new TypeError("a medium's mediaId is too long to continue a keyword gallery from");
  return { orderKey: row.orderKey, mediaId: row.media.mediaId };
}

/** The source's rows must already be the page the order promises; anything else is a defect, not a visitor's error. */
function assertWindow(rows: readonly KeywordGalleryRow[], after: KeywordGalleryBoundary | undefined, limit: number): void {
  if (rows.length > limit) throw new TypeError("the keyword gallery source returned more rows than the page allows");
  // Two documents can claim one `mediaId` with different dates, which the order would not catch.
  const identities = new Set(rows.map((row) => row.media.mediaId));
  if (identities.size !== rows.length || (after !== undefined && identities.has(after.mediaId))) {
    throw new TypeError("one media identity appears more than once in a keyword gallery window");
  }
  let previous = after;
  for (const row of rows) {
    const current = boundaryOf(row);
    if (previous !== undefined && compareKeywordGalleryOrder(previous, current) >= 0) {
      throw new TypeError("the keyword gallery source returned rows out of order");
    }
    previous = current;
  }
}

/**
 * One bounded page. `canonicalIds` and `taxonomyVersion` come from the selection, so a
 * cursor from another selection or hierarchy fails its scope. Throws `GalleryCursorError`
 * for a malformed, tampered, foreign or stale cursor, none of which may be cached as a result.
 */
export async function readKeywordGalleryPage({
  locale,
  canonicalIds,
  taxonomyVersion,
  cursor,
  source,
  cursorCodec = keywordGalleryCursorCodec,
  pageSize = KEYWORD_GALLERY_PAGE_SIZE,
}: Readonly<{
  /** The full route locale, as a curated gallery's cursor scope has it. */
  locale: string;
  canonicalIds: readonly string[];
  taxonomyVersion: number;
  cursor?: string;
  source: KeywordGallerySource;
  cursorCodec?: KeywordGalleryCursorCodec;
  pageSize?: number;
}>): Promise<GalleryPage<DynamicGalleryResultItem>> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_GALLERY_PAGE_SIZE) {
    throw new RangeError(`A keyword gallery page size must be an integer between 1 and ${MAX_GALLERY_PAGE_SIZE}`);
  }
  const scope = keywordGalleryScope(canonicalIds, taxonomyVersion, await source.readLatestChange(canonicalIds), pageSize, locale);
  const afterMediaId = cursor === undefined ? undefined : cursorCodec.decode(cursor, scope);
  // The named item must still be eligible, whatever the coarse version says. If it moved, its
  // own `_updatedAt` already changed the scope above.
  const boundary = afterMediaId === undefined ? undefined : await source.readBoundary(canonicalIds, afterMediaId);
  if (afterMediaId !== undefined && boundary === undefined) throw new GalleryCursorError("stale");
  const after = boundary === undefined ? undefined : boundaryOf(boundary);
  const limit = pageSize + 1;
  const candidates = await source.readWindow({ canonicalIds, after, limit });
  assertWindow(candidates, after, limit);

  const rows = candidates.slice(0, pageSize);
  const items = rows.map(({ media, enquiryAllowed }): DynamicGalleryResultItem => ({ itemId: media.mediaId, mediaId: media.mediaId, enquiryAllowed, media }));
  if (candidates.length <= pageSize) return { items, page: { size: pageSize, hasNextPage: false, endCursor: null } };
  return {
    items,
    page: {
      size: pageSize,
      hasNextPage: true,
      endCursor: cursorCodec.encode(scope, rows[rows.length - 1].media.mediaId) as GalleryCursor,
    },
  };
}
