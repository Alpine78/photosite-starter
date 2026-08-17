import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CuratedGalleryResultItem,
  GalleryCursor,
  GalleryPage,
} from "@/lib/gallery-result";
import type { ImageMedia, Media } from "@/lib/media";

export const MAX_GALLERY_PAGE_SIZE = 100;
export const MAX_GALLERY_CURSOR_LENGTH = 2048;

export const MAX_SCOPE_FIELD_LENGTH = 256;
export const MAX_ITEM_ID_LENGTH = 256;
const CURSOR_VERSION = 2;
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
   * A reorder, a hide/show, or a section reassignment does not: any of them
   * can move a placement across another cursor's boundary key (AB#134),
   * which would otherwise duplicate or skip that item mid-walk under keyset
   * pagination — bumping this is what keeps an in-flight walk coherent, the
   * same way it already protects against every other kind of drift.
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
  readonly afterOrder: number;
  readonly afterPlacementId: string;
};

type DecodedGalleryCursor = {
  readonly afterOrder: number;
  readonly afterPlacementId: string;
};

/**
 * Replaceable adapter-owned cursor codec. AB#66 may replace the reference
 * encoding without changing the public GalleryPage contract or UI callers.
 * Implementations authenticate and bound an untrusted token before returning
 * a boundary key; `resolveGalleryWindowRequest` validates the returned value
 * again before it ever reaches a source's query.
 */
export type GalleryCursorCodec = {
  readonly encode: (
    scope: GalleryCursorScope,
    afterOrder: number,
    afterPlacementId: string,
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
  "afterOrder",
  "afterPlacementId",
] as const satisfies readonly (keyof CursorPayload)[];

export function assertBoundedString(
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

/**
 * Encodes `{version, queryScope, visibilityScope, afterOrder, afterPlacementId}`
 * as one HMAC-signed blob. `afterOrder`/`afterPlacementId` travel in plaintext
 * inside it — unlike `queryScope`/`visibilityScope`, which stay digests because
 * nothing outside this module ever needs their raw inputs back. A caller
 * building a bounded store query needs the actual boundary values, not an
 * opaque hash of them, and this is not a new disclosure of anything sensitive:
 * `placementId` is already returned in plaintext on every page as `itemId`.
 * Both fields still get the same tamper-integrity `offset` always had as a
 * plaintext-but-signed field — `cursorSignature` covers the complete encoded
 * JSON, so neither can be edited, nor recombined with another cursor's
 * `queryScope`/`visibilityScope`, without invalidating the signature.
 */
function encodeHmacCursor(
  scope: GalleryCursorScope,
  afterOrder: number,
  afterPlacementId: string,
  signingKey: string,
): GalleryCursor {
  const cursorPayload: CursorPayload = {
    version: CURSOR_VERSION,
    queryScope: queryScopeDigest(scope, signingKey),
    visibilityScope: visibilityScopeDigest(scope, signingKey),
    afterOrder,
    afterPlacementId,
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
    afterOrder: payload.afterOrder,
    afterPlacementId: payload.afterPlacementId,
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
    Number.isSafeInteger(payload.afterOrder) &&
    (payload.afterOrder as number) >= 0 &&
    typeof payload.afterPlacementId === "string" &&
    payload.afterPlacementId.length > 0 &&
    payload.afterPlacementId.length <= MAX_ITEM_ID_LENGTH
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
    encode: (scope, afterOrder, afterPlacementId) =>
      encodeHmacCursor(scope, afterOrder, afterPlacementId, signingKey),
    decode: (cursor, scope) =>
      parseHmacCursor(cursor, scope, signingKey),
  };
}

export function comparePlacementIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Compares two placements' manual-order sort keys exactly the way
 * `orderVisiblePlacements` does: `order` first, `placementId` (JS code-unit
 * string comparison) to break a tie.
 *
 * A store-backed adapter's own keyset range query (AB#114) must return rows
 * in this exact order — `ORDER BY order, placementId` under a collation that
 * agrees with JS string comparison, not a database's locale-aware default —
 * or a walk can permanently skip or duplicate items at a tie. Offset
 * pagination never had this requirement: the whole set was always re-sorted
 * by this same comparator regardless of what order a store returned rows in.
 * Keyset pagination instead trusts the store's own ordering for everything
 * strictly after the boundary, so the two orderings must agree exactly.
 */
function compareGalleryOrderKey(
  left: { readonly order: number; readonly placementId: string },
  right: { readonly order: number; readonly placementId: string },
): number {
  return (
    left.order - right.order ||
    comparePlacementIds(left.placementId, right.placementId)
  );
}

/**
 * Structural validation shared by every entry point that takes a placement
 * list: bounded/unique id, a safe non-negative `order` (so a malformed value
 * can never reach `compareGalleryOrderKey`'s sort and corrupt it — `left.order
 * - right.order` on a `NaN` breaks sort transitivity for the whole array, not
 * just the offending item), a boolean `visible`, and well-typed overrides.
 */
export function assertPlacements(
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

/**
 * Visible placements in the one authoritative manual order, tie-broken by the
 * immutable placement id.
 *
 * Everything that has to agree about "first" reads it from here: the page a
 * route renders, the sequence the lightbox navigates, and the cover a card
 * falls back to. Restating the sort at any of those call sites is how a card
 * ends up showing an image the gallery opens second.
 *
 * Private to this module: only `selectGalleryWindow` and
 * `selectCuratedGalleryCover` need it, and both already live here. A source
 * outside this file never sorts a full placement list itself — that is
 * exactly the whole-gallery operation AB#134 removes from the bounded path.
 */
function orderVisiblePlacements(
  placements: readonly CuratedGalleryPlacement[],
): readonly CuratedGalleryPlacement[] {
  return placements
    .filter((placement) => placement.visible)
    .toSorted(compareGalleryOrderKey);
}

/**
 * The cover a curated gallery's listing card shows when no explicit cover is
 * authored: the first visible placement, in manual order, whose media this site
 * can actually render publicly.
 *
 * Deterministic by construction — it is the same ordering the gallery's own
 * first page uses — so the card and the page a visitor lands on open with the
 * same photograph. A gallery with no visible placements has no cover, and its
 * card renders as text exactly as a page with no cover at all does.
 *
 * Unsupported media fails here rather than being skipped over, which is the same
 * answer the first page gives. Skipping would be worse than it sounds: the card
 * would advertise a gallery whose detail route cannot render, so the defect
 * would surface as a broken page instead of a rejected fixture.
 *
 * Only the opening placement is read, but the ordering that decides which one
 * that is has to be applied to something. An adapter that can order in its own
 * store passes the single row that query returned — the same one-row projection
 * it puts beside the card's other fields — and this function agrees with it,
 * because a one-placement list sorts to itself. Passing the whole set is what an
 * in-memory fixture does, having nowhere else to sort; a listing query must not
 * load a gallery's media collection to render a card.
 */
export function selectCuratedGalleryCover(
  placements: readonly CuratedGalleryPlacement[],
): ImageMedia | undefined {
  assertPlacements(placements);

  const [first] = orderVisiblePlacements(placements);
  if (first === undefined) return undefined;
  if (first.media.type !== "image") {
    throw new TypeError(
      `Unsupported public gallery media type: ${first.media.type}`,
    );
  }

  return projectPublicImage(
    first.media,
    first.altOverride ?? first.media.alt,
    first.captionOverride ?? first.media.caption,
  );
}

// --- Bounded windowed source contract (AB#134) ---
//
// Before this section existed, `buildCuratedGalleryPage` took a gallery's
// entire ordered, filtered placement set on every call and sliced it itself.
// No adapter — mock or real — could answer one page from a bounded store
// query: a section holding most of a gallery still cost a full-section fetch
// per continuation, and the same was already true of the unfiltered "All"
// view. `GalleryWindowRequest`/`GalleryWindowResult` are the caller-supplied
// window `buildCuratedGalleryPage` now accepts instead: the boundary item
// (found by identity) plus up to `pageSize + 1` items strictly after it,
// which a store-backed adapter (AB#114) answers with one id lookup and one
// keyset range query rather than loading a gallery's whole placement list.

/**
 * What a bounded source must fetch to answer one page: up to `candidateLimit`
 * items strictly after `after` (or from the very start of manual order, if
 * `after` is undefined — the first page of a filter), plus — only when
 * `after` is set — the current state of the boundary item itself, looked up
 * separately by identity (see `GalleryWindowResult.boundary`). `candidateLimit`
 * is `scope.pageSize + 1`: one extra row past the page so `hasNextPage` never
 * needs a separate count query.
 */
export type GalleryWindowRequest = {
  readonly candidateLimit: number;
  readonly after?: {
    readonly order: number;
    readonly placementId: string;
  };
};

/**
 * A source's bounded answer to one `GalleryWindowRequest`.
 *
 * `boundary` is the *current* state of the placement `after.placementId`
 * named, found through the same visibility/section filter every other row
 * goes through — so a boundary that has since been hidden, reassigned out of
 * the requested section, reordered, or removed entirely all come back the
 * same way (either absent, or present with a different `order`), and
 * `buildCuratedGalleryPage` treats every such case as one `stale` error
 * rather than several different ones. Always absent when the request carried
 * no `after` (the first page needs no boundary).
 *
 * `candidates` is up to `request.candidateLimit` items, in any order —
 * `buildCuratedGalleryPage` re-sorts a window this small rather than trusting
 * the caller's order, the same posture this file already takes toward every
 * placement list it is handed. Every returned placement, boundary included,
 * must already be visible and within the requested filter: `buildCuratedGalleryPage`
 * treats one that is not as a source contract violation, not something to
 * silently filter back out.
 */
export type GalleryWindowResult = {
  readonly boundary?: CuratedGalleryPlacement;
  readonly candidates: readonly CuratedGalleryPlacement[];
};

/**
 * Decodes and validates a cursor into the bounded window a source must fetch.
 * Same failure surface `buildCuratedGalleryPage` always produced from a raw
 * cursor — malformed, tampered, wrong-scope, or stale by an outdated
 * `visibilityVersion` — except final positional staleness (has the boundary
 * item itself moved or vanished since?) is necessarily deferred to
 * `buildCuratedGalleryPage`, the only place that ever sees a source's actual
 * answer.
 *
 * `cursorCodec` is untrusted beyond its declared type: `GalleryCursorCodec` is
 * a replaceable adapter seam (AB#66), so a decoded `afterOrder`/`afterPlacementId`
 * is validated here exactly as strictly as a value arriving over the wire,
 * before it ever reaches a source's query.
 */
export function resolveGalleryWindowRequest({
  scope,
  cursor,
  cursorCodec,
}: {
  readonly scope: GalleryCursorScope;
  readonly cursor?: string;
  readonly cursorCodec?: GalleryCursorCodec;
}): GalleryWindowRequest {
  assertScope(scope);
  const candidateLimit = scope.pageSize + 1;

  if (cursor === undefined) {
    return { candidateLimit };
  }

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

  const decoded = cursorCodec.decode(cursor, scope);
  if (!Number.isSafeInteger(decoded.afterOrder) || decoded.afterOrder < 0) {
    throw new GalleryCursorError("malformed");
  }
  if (
    typeof decoded.afterPlacementId !== "string" ||
    decoded.afterPlacementId.length === 0 ||
    decoded.afterPlacementId.length > MAX_ITEM_ID_LENGTH
  ) {
    throw new GalleryCursorError("malformed");
  }

  return {
    candidateLimit,
    after: {
      order: decoded.afterOrder,
      placementId: decoded.afterPlacementId,
    },
  };
}

/**
 * Reference in-memory answer to a `GalleryWindowRequest`: the current state of
 * the boundary item (if `windowRequest.after` names one) plus up to
 * `windowRequest.candidateLimit` items whose sort key is strictly greater than
 * `after`, in manual order.
 *
 * The comparison is always against the *requested* `after` key, never the
 * boundary item's current position — so an edit anywhere else in `placements`
 * changes what this returns only if it moves an item across that exact key,
 * which is the normal, accepted keyset-pagination trade-off `GalleryCursorScope.visibilityVersion`
 * exists to bound.
 *
 * A fixture or test source over an already-loaded array can compute its
 * bounded window this way. A store-backed adapter (AB#114) answers the same
 * shape from two real queries — an id lookup for the boundary, and a keyset
 * range query for the candidates, which must agree with `compareGalleryOrderKey`'s
 * ordering — instead of holding everything in memory. Two separate queries
 * also means two snapshots: if publication changes between them, the boundary
 * and candidates can disagree. A provider that can answer both in one request
 * should; one that cannot should treat that gap the same way it already treats
 * any other window-scoped inconsistency, and this file does not try to close
 * it further than that, since AB#134 adds no real store adapter.
 *
 * `placements` is validated in full before it is sorted — this function, not
 * `buildCuratedGalleryPage`, is the one still holding a whole in-memory list,
 * the same way `buildCuratedGalleryPage` itself always validated its input
 * before sorting it pre-AB#134. That cost is specific to this reference
 * implementation: a store-backed adapter never assembles a whole-gallery
 * array to begin with, so it has nothing here to validate over, and pushes
 * its own row-level checks (an authoring/import-time responsibility, see
 * `buildCuratedGalleryPage`'s doc comment) wherever it writes data instead.
 */
export function selectGalleryWindow(
  placements: readonly CuratedGalleryPlacement[],
  windowRequest: GalleryWindowRequest,
): GalleryWindowResult {
  assertPlacements(placements);
  const ordered = orderVisiblePlacements(placements);
  const { after, candidateLimit } = windowRequest;

  if (after === undefined) {
    return { candidates: ordered.slice(0, candidateLimit) };
  }

  const boundary = ordered.find(
    (placement) => placement.placementId === after.placementId,
  );
  // The boundary's own id is excluded unconditionally, not just wherever its
  // current sort key happens to land relative to `after`: it is already
  // accounted for as `boundary`, and a reorder that moves it *past* `after`
  // (rather than removing or hiding it) would otherwise satisfy the `> after`
  // comparison and appear a second time as a candidate too.
  const candidates = ordered
    .filter(
      (placement) =>
        placement.placementId !== after.placementId &&
        compareGalleryOrderKey(placement, after) > 0,
    )
    .slice(0, candidateLimit);

  return {
    ...(boundary === undefined ? {} : { boundary }),
    candidates,
  };
}

/**
 * Builds one page from a source's bounded `GalleryWindowResult` — never a
 * gallery's full ordered set. `windowRequest` must be the exact value that
 * produced `windowResult`, so this can validate the source actually honoured
 * it (size ceiling, boundary identity, every candidate strictly after it).
 *
 * What is *not* checked here any more, now that a read is genuinely bounded:
 * a duplicate placement id, a malformed order, or unsupported visible media
 * anywhere else in the gallery than this window. Those become an
 * authoring/import-time responsibility for a real adapter — the same split
 * `assertGallerySections`/`assertPlacementSectionReferences` (`gallery-sections.ts`)
 * already draw for a gallery's sections: validated once against the complete
 * list when it is authored, not re-validated on every bounded page a visitor
 * happens to request. Per-window validation below stays as defense in depth,
 * not as a whole-gallery guarantee.
 */
export function buildCuratedGalleryPage({
  windowResult,
  scope,
  windowRequest,
  cursorCodec,
}: {
  readonly windowResult: GalleryWindowResult;
  readonly scope: GalleryCursorScope;
  readonly windowRequest: GalleryWindowRequest;
  readonly cursorCodec?: GalleryCursorCodec;
}): GalleryPage<CuratedGalleryResultItem> {
  assertScope(scope);

  // `windowRequest` is trusted to be the exact value that produced
  // `windowResult` (the docstring's precondition), but `candidateLimit` is
  // never independently derived from `scope.pageSize` below this point — every
  // later size/`hasNextPage` computation trusts `scope.pageSize` alone. A
  // caller that hands a stale or mismatched `windowRequest` (reused across a
  // different `scope`, for instance) would otherwise silently truncate a
  // gallery rather than fail loudly.
  if (windowRequest.candidateLimit !== scope.pageSize + 1) {
    throw new Error(
      `windowRequest.candidateLimit (${windowRequest.candidateLimit}) does not match scope.pageSize + 1 (${scope.pageSize + 1})`,
    );
  }

  if (windowResult.candidates.length > windowRequest.candidateLimit) {
    throw new Error(
      `Gallery source returned more candidates (${windowResult.candidates.length}) than requested (${windowRequest.candidateLimit})`,
    );
  }
  if (windowRequest.after === undefined && windowResult.boundary !== undefined) {
    throw new Error(
      "Gallery source returned a boundary for a request that named none",
    );
  }

  const rawWindow =
    windowResult.boundary === undefined
      ? windowResult.candidates
      : [windowResult.boundary, ...windowResult.candidates];
  assertPlacements(rawWindow);

  // Validate every counted item before slicing so unsupported media can never
  // be counted and then silently disappear from this or a later page. A
  // hidden placement is rejected rather than filtered out: a source's bounded
  // query is documented to return only visible, in-filter rows, so one that
  // is not is a contract violation, not something to quietly correct here.
  for (const placement of rawWindow) {
    if (!placement.visible) {
      throw new Error(
        "Gallery source returned a hidden placement in a bounded window",
      );
    }
    if (placement.media.type !== "image") {
      throw new TypeError(
        `Unsupported public gallery media type: ${placement.media.type}`,
      );
    }
  }

  const after = windowRequest.after;
  if (after !== undefined) {
    if (
      windowResult.boundary === undefined ||
      windowResult.boundary.order !== after.order ||
      windowResult.boundary.placementId !== after.placementId
    ) {
      throw new GalleryCursorError("stale");
    }
  }

  const candidates = windowResult.candidates.toSorted(compareGalleryOrderKey);
  if (
    after !== undefined &&
    candidates.some(
      (placement) => compareGalleryOrderKey(placement, after) <= 0,
    )
  ) {
    throw new Error(
      "Gallery source returned a candidate at or before the requested boundary",
    );
  }

  const items = candidates.slice(0, scope.pageSize).map(projectCuratedItem);
  const hasNextPage = candidates.length > scope.pageSize;
  // `assertScope` guarantees `scope.pageSize > 0`, so whenever `hasNextPage`
  // is true (`candidates.length > scope.pageSize`) this index is always
  // in bounds — the same item `items.at(-1)` already reflects.
  const lastPlacement = candidates[scope.pageSize - 1];

  if (hasNextPage) {
    if (lastPlacement === undefined) {
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
      lastPlacement.order,
      lastPlacement.placementId,
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
