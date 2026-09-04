/**
 * The deployment's category-listing continuation cursor codec (AB#140,
 * ADR-0013). It shares `keyset-cursor.ts`'s HMAC machinery — and, by owner
 * decision, the gallery cursor's `GALLERY_CURSOR_SIGNING_KEY` secret — with the
 * gallery continuation cursor, resolved through the same lazy, `server-only`,
 * deferred accessor `gallery-cursor.ts` documents in full.
 *
 * ## How this cursor differs from the gallery's
 *
 * The gallery cursor's primary boundary key is a placement's numeric manual
 * `order`. A category branch listing is ordered by `(eventDate DESC,
 * contentId ASC)` (ADR-0003 decision 8, AB#150/ADR-0017), where `eventDate` is
 * the page's *effective event date* — `eventDate ?? publishedAt`, a store's
 * `coalesce(eventDate, publishedAt)`. A store compares that *string* — date-only
 * `2024-06-18` or a datetime — so the cursor carries it verbatim as its
 * boundary key rather than a parsed timestamp, which would not compare equal at
 * a same-date tie.
 *
 * ## Ordering-rule version (AB#150, ADR-0017 decision 4)
 *
 * `CONTENT_LISTING_ORDERING` is `event-date-desc-v1`, up from the historical
 * `published-desc-v1`. It rides in the HMAC-bound `KeysetCursorScope.ordering`,
 * so a cursor minted before the switch to the effective event date decodes as
 * `wrong-scope` — never a silently valid position under the new order. Same
 * mechanism as ADR-0009 §4's gallery reseed.
 *
 * ## Visibility version
 *
 * The effective event date is authored, frozen nowhere, so a mid-walk edit to
 * any in-scope item's `eventDate`/`publishedAt` — not only the boundary item's —
 * can move it across an issued boundary, and so can a category re-parent that
 * reshapes the subtree. ADR-0013 therefore binds a conservative
 * `visibilityVersion` into the scope (a cheap `max(_updatedAt)` + `count` for a
 * store, an in-memory digest for the mock); any of those changes invalidates an
 * in-flight cursor with `stale`, exactly as the gallery cursor's own visibility
 * version does for a reorder.
 */

import "server-only";
import {
  KeysetCursorConfigurationError,
  KeysetCursorError,
  createHmacKeysetCursorCodec,
  loadKeysetCursorSigningKey,
  type KeysetCursorCodec,
  type KeysetCursorEnvironment,
  type KeysetCursorScope,
} from "@/lib/keyset-cursor";
import { CONTENT_LISTING_ORDERING } from "@/lib/content-listing";

/** Stable source identity for every category-listing cursor this deployment issues. */
const CONTENT_LISTING_CURSOR_SOURCE = "content-listing";

export type ContentListingCursorErrorCode =
  | "malformed"
  | "tampered"
  | "wrong-scope"
  | "stale";

/**
 * Raised when a category-listing continuation token cannot be spent: the same
 * classified-error convention `GalleryCursorError` and the Sanity adapters
 * follow, so a route-level boundary or a log filter recognises it as one of the
 * cursor family rather than an unclassified `TypeError`.
 */
export class ContentListingCursorError extends Error {
  readonly code: ContentListingCursorErrorCode;

  constructor(code: ContentListingCursorErrorCode) {
    super(`Content listing cursor is ${code}`);
    this.name = "ContentListingCursorError";
    this.code = code;
  }
}

export class ContentListingCursorConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContentListingCursorConfigurationError";
  }
}

/** The boundary a decoded category-listing cursor names. */
export type ContentListingCursorBoundary = {
  /**
   * The verbatim effective event date (`eventDate ?? publishedAt`) of the last
   * item on the previous page (AB#150, ADR-0017).
   */
  readonly afterEventDate: string;
  /** That item's immutable content identifier, the order's tie-breaker. */
  readonly afterContentId: string;
};

/**
 * What a category-listing cursor is bound to. `categoryId` is the branch root;
 * the story root has no continuation contract (ADR-0013), so it is always a
 * real category id here. `visibilityVersion` is the conservative
 * subtree-state key described in the module comment.
 */
export type ContentListingCursorScopeInput = {
  readonly locale: string;
  readonly categoryId: string;
  readonly visibilityVersion: string;
  readonly pageSize: number;
};

export type ContentListingCursorCodec = {
  readonly encode: (
    scope: ContentListingCursorScopeInput,
    boundary: ContentListingCursorBoundary,
  ) => string;
  readonly decode: (
    cursor: unknown,
    scope: ContentListingCursorScopeInput,
  ) => ContentListingCursorBoundary;
};

function toKeysetScope(
  scope: ContentListingCursorScopeInput,
): KeysetCursorScope {
  return {
    sourceId: CONTENT_LISTING_CURSOR_SOURCE,
    // Binds the cursor to one locale's one branch: a token minted for category
    // A cannot be replayed against category B or another locale.
    normalizedFilter: `${scope.locale} ${scope.categoryId}`,
    ordering: CONTENT_LISTING_ORDERING,
    visibilityVersion: scope.visibilityVersion,
    pageSize: scope.pageSize,
  };
}

/**
 * Adapts the generic keyset codec to the category listing's string boundary
 * key, re-raising `KeysetCursorError` as `ContentListingCursorError` so
 * `content.ts` and the route can pattern-match on the classified family.
 */
function adaptCodec(inner: KeysetCursorCodec): ContentListingCursorCodec {
  return {
    encode: (scope, boundary) =>
      inner.encode(
        toKeysetScope(scope),
        boundary.afterEventDate,
        boundary.afterContentId,
      ),
    decode: (cursor, scope) => {
      try {
        const decoded = inner.decode(cursor, toKeysetScope(scope));
        if (typeof decoded.afterKey !== "string") {
          // A category-listing cursor's boundary key is the effective-event-date
          // string; a number here means a token from another cursor family.
          throw new ContentListingCursorError("malformed");
        }
        return {
          afterEventDate: decoded.afterKey,
          afterContentId: decoded.afterId,
        };
      } catch (error) {
        if (error instanceof KeysetCursorError) {
          throw new ContentListingCursorError(error.code);
        }
        throw error;
      }
    },
  };
}

/**
 * The codec one environment's key produces, validated at the moment it is read.
 * Separate from the memoized accessor so a test can supply an environment
 * directly, the same shape `loadGalleryCursorCodec` takes.
 */
export function loadContentListingCursorCodec(
  environment: KeysetCursorEnvironment,
): ContentListingCursorCodec {
  let signingKey: string;
  try {
    signingKey = loadKeysetCursorSigningKey(environment);
  } catch (cause) {
    if (cause instanceof KeysetCursorConfigurationError) {
      throw new ContentListingCursorConfigurationError(cause.message, { cause });
    }
    throw cause;
  }

  try {
    return adaptCodec(createHmacKeysetCursorCodec(signingKey));
  } catch (cause) {
    throw new ContentListingCursorConfigurationError(
      "Invalid GALLERY_CURSOR_SIGNING_KEY: expected 32 to 256 printable ASCII characters.",
      { cause },
    );
  }
}

let cachedCodec: ContentListingCursorCodec | undefined;

function resolveCodec(): ContentListingCursorCodec {
  if (typeof window !== "undefined") {
    throw new ContentListingCursorConfigurationError(
      "A content listing cursor codec was created in a browser. It carries a server-only signing key and must be reached from a Server Component, Route Handler, or another server module.",
    );
  }

  cachedCodec ??= loadContentListingCursorCodec(process.env);
  return cachedCodec;
}

/**
 * The deployment's codec, with the key resolved on use — so a deployment whose
 * category branches all fit in one page never reads the secret.
 */
export const contentListingCursorCodec: ContentListingCursorCodec = {
  encode: (scope, boundary) => resolveCodec().encode(scope, boundary),
  decode: (cursor, scope) => resolveCodec().decode(cursor, scope),
};
