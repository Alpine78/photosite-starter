import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CuratedGalleryResultItem,
  GalleryCursor,
  GalleryPage,
} from "@/lib/gallery-result";
import type { ImageMedia, Media } from "@/lib/media";

export const MAX_GALLERY_PAGE_SIZE = 100;
export const MAX_GALLERY_CURSOR_LENGTH = 2048;

const MAX_SCOPE_FIELD_LENGTH = 256;
const MAX_ITEM_ID_LENGTH = 256;
const CURSOR_VERSION = 1;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const SHA_256_BASE64URL_LENGTH = 43;

export type GalleryCursorScope = {
  /** Stable project source identity, not a provider document id. */
  readonly sourceId: string;
  /** Canonical filter key; the adapter filters placements before this call. */
  readonly normalizedFilter: string;
  /** Stable ordering rule and rule version, for example `manual-v1`. */
  readonly ordering: string;
  /**
   * Changes when public visibility changes invalidate existing boundaries.
   * Appends and presentation-only edits deliberately keep the same version.
   */
  readonly visibilityVersion: string;
  readonly pageSize: number;
};

export type GalleryCursorErrorCode =
  | "malformed"
  | "tampered"
  | "wrong-scope"
  | "stale";

export class GalleryCursorError extends Error {
  readonly code: GalleryCursorErrorCode;

  constructor(code: GalleryCursorErrorCode) {
    super(`Gallery cursor is ${code}`);
    this.name = "GalleryCursorError";
    this.code = code;
  }
}

export type CuratedGalleryPlacement = {
  readonly placementId: string;
  readonly order: number;
  readonly visible: boolean;
  readonly media: Media;
  readonly sectionId?: string;
  readonly altOverride?: string;
  readonly captionOverride?: string;
};

type CursorPayload = {
  readonly version: typeof CURSOR_VERSION;
  readonly queryScope: string;
  readonly visibilityScope: string;
  readonly offset: number;
  readonly afterItem: string;
};

type DecodedGalleryCursor = {
  readonly offset: number;
  readonly matchesBoundary: (itemId: string) => boolean;
};

/**
 * Replaceable adapter-owned cursor codec. AB#66 may replace the reference
 * encoding without changing the public GalleryPage contract or UI callers.
 * Implementations authenticate and bound untrusted tokens before returning a
 * positive safe offset; the builder validates the returned position again.
 */
export type GalleryCursorCodec = {
  readonly encode: (
    scope: GalleryCursorScope,
    offset: number,
    afterItemId: string,
  ) => GalleryCursor;
  readonly decode: (
    cursor: unknown,
    scope: GalleryCursorScope,
  ) => DecodedGalleryCursor;
};

const cursorPayloadKeys = [
  "version",
  "queryScope",
  "visibilityScope",
  "offset",
  "afterItem",
] as const satisfies readonly (keyof CursorPayload)[];

function assertBoundedString(
  value: unknown,
  field: string,
  maxLength = MAX_SCOPE_FIELD_LENGTH,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new TypeError(`${field} must be a non-empty bounded string`);
  }
}

function assertSigningKey(signingKey: string): void {
  if (
    typeof signingKey !== "string" ||
    signingKey.length < 32 ||
    signingKey.length > 256 ||
    !/^[\x21-\x7e]+$/.test(signingKey)
  ) {
    throw new Error("Gallery cursor signing key is not configured securely");
  }
}

function assertScope(scope: GalleryCursorScope): void {
  assertBoundedString(scope.sourceId, "scope.sourceId");
  assertBoundedString(scope.normalizedFilter, "scope.normalizedFilter");
  assertBoundedString(scope.ordering, "scope.ordering");
  assertBoundedString(scope.visibilityVersion, "scope.visibilityVersion");
  if (
    !Number.isSafeInteger(scope.pageSize) ||
    scope.pageSize <= 0 ||
    scope.pageSize > MAX_GALLERY_PAGE_SIZE
  ) {
    throw new RangeError(
      `Gallery page size must be an integer between 1 and ${MAX_GALLERY_PAGE_SIZE}`,
    );
  }
}

function cursorSignature(payload: string, signingKey: string): Buffer {
  return createHmac("sha256", signingKey)
    .update("gallery-cursor-token-v1")
    .update("\0")
    .update(payload)
    .digest();
}

function scopeDigest(
  label: string,
  values: readonly (string | number)[],
  signingKey: string,
): string {
  return createHmac("sha256", signingKey)
    .update(label)
    .update("\0")
    .update(JSON.stringify(values))
    .digest("base64url");
}

function matchesDigest(encodedDigest: string, expectedDigest: string): boolean {
  const supplied = Buffer.from(encodedDigest, "base64url");
  const expected = Buffer.from(expectedDigest, "base64url");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function queryScopeDigest(
  scope: GalleryCursorScope,
  signingKey: string,
): string {
  return scopeDigest(
    "gallery-query-scope-v1",
    [
      scope.sourceId,
      scope.normalizedFilter,
      scope.ordering,
      scope.pageSize,
    ],
    signingKey,
  );
}

function visibilityScopeDigest(
  scope: GalleryCursorScope,
  signingKey: string,
): string {
  return scopeDigest(
    "gallery-visibility-scope-v1",
    [scope.sourceId, scope.visibilityVersion],
    signingKey,
  );
}

function itemBoundaryDigest(
  queryScope: string,
  itemId: string,
  signingKey: string,
): string {
  return scopeDigest(
    "gallery-item-boundary-v1",
    [queryScope, itemId],
    signingKey,
  );
}

function encodeHmacCursor(
  scope: GalleryCursorScope,
  offset: number,
  afterItemId: string,
  signingKey: string,
): GalleryCursor {
  const queryScope = queryScopeDigest(scope, signingKey);
  const cursorPayload: CursorPayload = {
    version: CURSOR_VERSION,
    queryScope,
    visibilityScope: visibilityScopeDigest(scope, signingKey),
    offset,
    afterItem: itemBoundaryDigest(queryScope, afterItemId, signingKey),
  };
  const encodedPayload = Buffer.from(JSON.stringify(cursorPayload)).toString(
    "base64url",
  );
  const signature = cursorSignature(encodedPayload, signingKey).toString(
    "base64url",
  );

  return `${encodedPayload}.${signature}` as GalleryCursor;
}

function parseHmacCursor(
  cursor: unknown,
  scope: GalleryCursorScope,
  signingKey: string,
): DecodedGalleryCursor {
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > MAX_GALLERY_CURSOR_LENGTH
  ) {
    throw new GalleryCursorError("malformed");
  }

  const parts = cursor.split(".");
  if (parts.length !== 2) {
    throw new GalleryCursorError("malformed");
  }

  const [encodedPayload, encodedSignature] = parts;
  if (
    !BASE64URL_SEGMENT.test(encodedPayload) ||
    !BASE64URL_SEGMENT.test(encodedSignature) ||
    encodedSignature.length !== SHA_256_BASE64URL_LENGTH
  ) {
    throw new GalleryCursorError("malformed");
  }

  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = cursorSignature(encodedPayload, signingKey);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new GalleryCursorError("tampered");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    throw new GalleryCursorError("malformed");
  }

  if (!isCursorPayload(payload)) {
    throw new GalleryCursorError("malformed");
  }
  const expectedQueryScope = queryScopeDigest(scope, signingKey);
  if (!matchesDigest(payload.queryScope, expectedQueryScope)) {
    throw new GalleryCursorError("wrong-scope");
  }
  if (
    !matchesDigest(
      payload.visibilityScope,
      visibilityScopeDigest(scope, signingKey),
    )
  ) {
    throw new GalleryCursorError("stale");
  }

  return {
    offset: payload.offset,
    matchesBoundary: (itemId) =>
      matchesDigest(
        payload.afterItem,
        itemBoundaryDigest(expectedQueryScope, itemId, signingKey),
      ),
  };
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload);
  return (
    keys.length === cursorPayloadKeys.length &&
    cursorPayloadKeys.every((key) => Object.hasOwn(payload, key)) &&
    payload.version === CURSOR_VERSION &&
    typeof payload.queryScope === "string" &&
    BASE64URL_SEGMENT.test(payload.queryScope) &&
    payload.queryScope.length === SHA_256_BASE64URL_LENGTH &&
    typeof payload.visibilityScope === "string" &&
    BASE64URL_SEGMENT.test(payload.visibilityScope) &&
    payload.visibilityScope.length === SHA_256_BASE64URL_LENGTH &&
    Number.isSafeInteger(payload.offset) &&
    (payload.offset as number) > 0 &&
    typeof payload.afterItem === "string" &&
    BASE64URL_SEGMENT.test(payload.afterItem) &&
    payload.afterItem.length === SHA_256_BASE64URL_LENGTH
  );
}

/**
 * Reference authenticated codec used by browser-free contract tests. The
 * signing key is supplied by a future server adapter; AB#67 does not make it a
 * deployment setting or freeze this private encoding for AB#66.
 */
export function createHmacGalleryCursorCodec(
  signingKey: string,
): GalleryCursorCodec {
  assertSigningKey(signingKey);

  return {
    encode: (scope, offset, afterItemId) =>
      encodeHmacCursor(scope, offset, afterItemId, signingKey),
    decode: (cursor, scope) =>
      parseHmacCursor(cursor, scope, signingKey),
  };
}

function comparePlacementIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertPlacements(
  placements: readonly CuratedGalleryPlacement[],
): void {
  const ids = new Set<string>();
  for (const placement of placements) {
    assertBoundedString(
      placement.placementId,
      "placementId",
      MAX_ITEM_ID_LENGTH,
    );
    if (ids.has(placement.placementId)) {
      throw new TypeError(`Duplicate placementId: ${placement.placementId}`);
    }
    ids.add(placement.placementId);

    if (!Number.isSafeInteger(placement.order) || placement.order < 0) {
      throw new TypeError("placement.order must be a non-negative safe integer");
    }
    if (typeof placement.visible !== "boolean") {
      throw new TypeError("placement.visible must be a boolean");
    }
    if (placement.sectionId !== undefined) {
      assertBoundedString(placement.sectionId, "placement.sectionId");
    }
    if (
      placement.altOverride !== undefined &&
      typeof placement.altOverride !== "string"
    ) {
      throw new TypeError("placement.altOverride must be a string when provided");
    }
    if (
      placement.captionOverride !== undefined &&
      typeof placement.captionOverride !== "string"
    ) {
      throw new TypeError(
        "placement.captionOverride must be a string when provided",
      );
    }
  }
}

function projectPublicImage(media: ImageMedia, alt: string, caption?: string) {
  return {
    type: "image",
    mediaId: media.mediaId,
    alt,
    rendition: {
      src: media.rendition.src,
      version: media.rendition.version,
      width: media.rendition.width,
      height: media.rendition.height,
    },
    ...(caption === undefined ? {} : { caption }),
    ...(media.credit === undefined ? {} : { credit: media.credit }),
  } satisfies ImageMedia;
}

function projectCuratedItem(
  placement: CuratedGalleryPlacement,
): CuratedGalleryResultItem {
  if (placement.media.type !== "image") {
    throw new TypeError(
      `Unsupported public gallery media type: ${placement.media.type}`,
    );
  }

  const media = projectPublicImage(
    placement.media,
    placement.altOverride ?? placement.media.alt,
    placement.captionOverride ?? placement.media.caption,
  );

  return {
    itemId: placement.placementId,
    mediaId: media.mediaId,
    placementId: placement.placementId,
    media,
    ...(placement.sectionId === undefined
      ? {}
      : { sectionId: placement.sectionId }),
  };
}

export function buildCuratedGalleryPage({
  placements,
  scope,
  cursor,
  cursorCodec,
}: {
  /** Placements after the adapter has applied `scope.normalizedFilter`. */
  readonly placements: readonly CuratedGalleryPlacement[];
  readonly scope: GalleryCursorScope;
  readonly cursor?: string;
  readonly cursorCodec?: GalleryCursorCodec;
}): GalleryPage<CuratedGalleryResultItem> {
  assertScope(scope);
  if (cursor !== undefined) {
    if (
      typeof cursor !== "string" ||
      cursor.length === 0 ||
      cursor.length > MAX_GALLERY_CURSOR_LENGTH
    ) {
      throw new GalleryCursorError("malformed");
    }
    if (cursorCodec === undefined) {
      throw new Error("A gallery cursor codec is required to decode a cursor");
    }
  }
  const decodedCursor =
    cursor === undefined ? undefined : cursorCodec?.decode(cursor, scope);
  if (
    decodedCursor !== undefined &&
    (!Number.isSafeInteger(decodedCursor.offset) || decodedCursor.offset <= 0)
  ) {
    throw new GalleryCursorError("malformed");
  }

  assertPlacements(placements);
  const orderedPlacements = placements
    .filter((placement) => placement.visible)
    .toSorted(
      (left, right) =>
        left.order - right.order ||
        comparePlacementIds(left.placementId, right.placementId),
    );

  // Validate every counted item before slicing so unsupported media can never
  // be counted and then silently disappear from this or a later page.
  for (const placement of orderedPlacements) {
    if (placement.media.type !== "image") {
      throw new TypeError(
        `Unsupported public gallery media type: ${placement.media.type}`,
      );
    }
  }

  const offset = decodedCursor?.offset ?? 0;
  if (decodedCursor !== undefined) {
    if (
      offset >= orderedPlacements.length ||
      !decodedCursor.matchesBoundary(
        orderedPlacements[offset - 1]?.placementId ?? "",
      )
    ) {
      throw new GalleryCursorError("stale");
    }
  }

  const pagePlacements = orderedPlacements.slice(
    offset,
    offset + scope.pageSize,
  );
  const items = pagePlacements.map(projectCuratedItem);
  const nextOffset = offset + items.length;
  const hasNextPage = nextOffset < orderedPlacements.length;
  const lastItem = items.at(-1);

  if (hasNextPage) {
    if (lastItem === undefined) {
      throw new Error(
        "Gallery pagination invariant violated: continuation has no boundary item",
      );
    }
    if (cursorCodec === undefined) {
      throw new Error(
        "A gallery cursor codec is required for a paginated result",
      );
    }

    const endCursor = cursorCodec.encode(
      scope,
      nextOffset,
      lastItem.itemId,
    );
    if (
      typeof endCursor !== "string" ||
      endCursor.length === 0 ||
      endCursor.length > MAX_GALLERY_CURSOR_LENGTH
    ) {
      throw new Error("Gallery cursor codec returned an invalid cursor");
    }

    return {
      items,
      page: {
        size: scope.pageSize,
        hasNextPage: true,
        endCursor,
      },
    };
  }

  return {
    items,
    page: {
      size: scope.pageSize,
      hasNextPage: false,
      endCursor: null,
    },
  };
}
