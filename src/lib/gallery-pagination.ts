import {
  MAX_KEYSET_CURSOR_LENGTH,
  MAX_KEYSET_ID_LENGTH,
  MAX_KEYSET_SCOPE_FIELD_LENGTH,
  KeysetCursorError,
  assertBoundedString,
  createHmacKeysetCursorCodec,
  type KeysetCursorErrorCode,
  type KeysetCursorScope,
} from "@/lib/keyset-cursor";
import { SHUFFLED_ORDER_PATTERN } from "@/lib/gallery-shuffle";
import type {
  CuratedGalleryResultItem,
  GalleryCursor,
  GalleryPage,
} from "@/lib/gallery-result";
import type { ImageMedia, Media } from "@/lib/media";

export const MAX_GALLERY_PAGE_SIZE = 100;
export const MAX_GALLERY_CURSOR_LENGTH = MAX_KEYSET_CURSOR_LENGTH;

/** Kept as gallery-named re-exports for AB#67 callers and their tests. */
export const MAX_SCOPE_FIELD_LENGTH = MAX_KEYSET_SCOPE_FIELD_LENGTH;
export const MAX_ITEM_ID_LENGTH = MAX_KEYSET_ID_LENGTH;
export { assertBoundedString };

// --- Ordering rule (AB#129, ADR-0009) ---
//
// A curated gallery is ordered either by the administrator's manual `order`
// (the default, unchanged since AB#67) or by a deterministic seeded shuffle.
// The rule is a property of the gallery, resolved by whoever reads it (the
// mock fixture, or PR2's Sanity adapter), and travels into this module as one
// structured value — never as a bare seed alongside a separately-built scope
// string that could disagree with it.

export type GalleryOrdering =
  | { readonly kind: "manual" }
  | { readonly kind: "seeded-random"; readonly seed: string };

/** The `ordering` half of `GalleryCursorScope`, for `manual`. Unchanged wire value. */
export const MANUAL_ORDERING_SCOPE = "manual-v1";

/** Prefix for a seeded gallery's `ordering` scope value: `seeded-random-v1:<seed>`. */
export const SEEDED_ORDERING_SCOPE_PREFIX = "seeded-random-v1:";

/**
 * The raw `orderingSeed` shares one length ceiling everywhere it is validated —
 * the core guard here, the mock fixture, and (PR2) the Studio schema and Sanity
 * projection. It is derived from `MAX_SCOPE_FIELD_LENGTH` minus the prefix so
 * `orderingScopeString` can never produce a value `assertScope` then rejects at
 * the pagination boundary for a reason no author could see — the same
 * derived-from-its-own-prefix trick `gallery-sections.ts`'s
 * `MAX_SECTION_ID_LENGTH` already uses.
 */
export const MAX_GALLERY_ORDERING_SEED_LENGTH =
  MAX_SCOPE_FIELD_LENGTH - SEEDED_ORDERING_SCOPE_PREFIX.length;

/**
 * Validates a `GalleryOrdering` before it is used to build a scope or sort a
 * window. A `seeded-random` rule must carry a non-empty seed within the shared
 * length ceiling; `manual` carries nothing.
 */
export function assertGalleryOrdering(ordering: GalleryOrdering): void {
  if (ordering.kind === "manual") return;
  if (ordering.kind !== "seeded-random") {
    throw new TypeError(
      `Unknown gallery ordering rule: ${JSON.stringify((ordering as { kind: unknown }).kind)}`,
    );
  }
  assertBoundedString(
    ordering.seed,
    "ordering.seed",
    MAX_GALLERY_ORDERING_SEED_LENGTH,
  );
}

/**
 * The `GalleryCursorScope.ordering` string for a rule. `manual` keeps its exact
 * AB#67 value so a cursor issued before AB#129 still decodes; a seeded gallery's
 * value embeds the seed, so `queryScopeDigest` (`keyset-cursor.ts`) already
 * folds a reseed into the scope digest — a cursor minted under one seed replayed
 * after a rotation fails `wrong-scope`, not `stale` (ADR-0009 §4), with no new
 * cursor logic.
 */
export function orderingScopeString(ordering: GalleryOrdering): string {
  assertGalleryOrdering(ordering);
  return ordering.kind === "manual"
    ? MANUAL_ORDERING_SCOPE
    : `${SEEDED_ORDERING_SCOPE_PREFIX}${ordering.seed}`;
}

/**
 * A gallery cursor's scope is the generic keyset scope (AB#140 extracted the
 * codec into `keyset-cursor.ts`). The name is kept because AB#67's callers,
 * fixtures, and tests refer to it; the shape and field meanings are unchanged.
 */
export type GalleryCursorScope = KeysetCursorScope;

export type GalleryCursorErrorCode = KeysetCursorErrorCode;

export class GalleryCursorError extends Error {
  readonly code: GalleryCursorErrorCode;

  constructor(code: GalleryCursorErrorCode) {
    super(`Gallery cursor is ${code}`);
    this.name = "GalleryCursorError";
    this.code = code;
  }
}

/**
 * A `seeded-random` gallery whose materialized `shuffledOrder` keys are being
 * recomputed after a seed change — a transient, retryable state, not a defect
 * (AB#129, ADR-0009 2026-08-28 amendment). Provider-neutral so a route can
 * distinguish it from a 404 without reaching past `@/lib/gallery`: the Sanity
 * adapter's own classified `ordering-stale` is re-raised as this at the seam.
 * The mock never produces it (a fixture reseed is atomic).
 */
export class GalleryOrderingStaleError extends Error {
  readonly contentId: string;

  constructor(contentId: string) {
    super(`Gallery ordering is being recomputed (contentId "${contentId}")`);
    this.name = "GalleryOrderingStaleError";
    this.contentId = contentId;
  }
}

export type CuratedGalleryPlacement = {
  readonly placementId: string;
  readonly order: number;
  readonly visible: boolean;
  readonly media: Media;
  /**
   * The media record's `privateOnly` flag (ADR-0002), surfaced on the placement
   * the pagination layer sees. A `privateOnly` photograph is a private
   * client-gallery asset and is refused from every public surface outright
   * (ADR-0014 §2): whoever builds these rows — the mock fixture, or the Sanity
   * projection — resolves it, the bounded source filters it out the same way it
   * filters a hidden placement, and `buildCuratedGalleryPage` rejects one that
   * still slips through a window as a source-contract violation.
   */
  readonly privateOnly?: boolean;
  readonly sectionId?: string;
  readonly altOverride?: string;
  readonly captionOverride?: string;
  /**
   * Keeps this placement in the pinned lead tier under a `seeded-random`
   * ordering rule (ADR-0009 §3): pinned placements sort before every shuffled
   * one, among themselves by manual `order`. Ignored under `manual` ordering,
   * where every placement already has a unique `order`.
   */
  readonly pinned?: boolean;
  /**
   * The materialized seeded-random sort key (`gallery-shuffle.ts`), required on
   * every non-pinned placement of a `seeded-random` gallery and unused
   * otherwise. ADR-0009 §2 forbids computing it on the read path — whoever
   * produces these rows (the mock fixture, or PR2's Sanity projection)
   * materializes it once; this module only consumes it.
   */
  readonly shuffledOrder?: string;
};

/**
 * The boundary a decoded gallery cursor names: "continue strictly after this
 * position in the active order." Generalizes AB#67's `(order, placementId)`
 * pair to ADR-0009 §3's tiered `(pinnedTier, key, placementId)` triple, without
 * changing anything for a `manual` gallery — there `pinnedTier` is always `0`
 * and `key` is the numeric `order`, exactly the information the old pair
 * carried. Under `seeded-random`, a pinned boundary is tier `0` with a numeric
 * `order` key and a shuffled boundary is tier `1` with the string
 * `shuffledOrder` key.
 */
export type GalleryOrderingBoundary = {
  readonly pinnedTier: 0 | 1;
  readonly key: string | number;
  readonly placementId: string;
};

/**
 * Replaceable adapter-owned cursor codec. AB#66 may replace the reference
 * encoding without changing the public GalleryPage contract or UI callers.
 * Implementations authenticate and bound an untrusted token before returning
 * a boundary key; `resolveGalleryWindowRequest` validates the returned value
 * again before it ever reaches a source's query.
 *
 * The boundary is ADR-0009 §3's `(pinnedTier, key, placementId)` triple. The
 * tier is not a separate wire field: it is recoverable from `key`'s type — a
 * `number` key is always tier `0` (a `manual` gallery, or a `seeded-random`
 * gallery's pinned lead), and a `shuffledOrder` string key is always tier `1`.
 * So the underlying `keyset-cursor.ts` wire format is unchanged (no
 * `CURSOR_VERSION` bump, which would also retire the category-listing cursors
 * that share it), and a `manual` cursor AB#67 issued still decodes byte for
 * byte.
 */
export type GalleryCursorCodec = {
  readonly encode: (
    scope: GalleryCursorScope,
    boundary: GalleryOrderingBoundary,
  ) => GalleryCursor;
  readonly decode: (
    cursor: unknown,
    scope: GalleryCursorScope,
  ) => GalleryOrderingBoundary;
};

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

/**
 * Reference authenticated codec used by browser-free contract tests.
 *
 * A thin adapter over `keyset-cursor.ts`'s generic codec (AB#140 extracted the
 * HMAC machinery there so the category branch listing could share it and the
 * signing secret): it maps a gallery's `(pinnedTier, key, placementId)`
 * boundary onto the generic `(afterKey, afterId)` pair, brands the token as a
 * `GalleryCursor`, and re-raises the generic `KeysetCursorError` as the
 * `GalleryCursorError` every gallery caller already pattern-matches on.
 *
 * The tier rides in the *type* of the generic `afterKey`, not a new field: a
 * numeric key is tier `0` (manual, or a seeded gallery's pinned lead), a
 * `shuffledOrder` string key is tier `1`. The wire format, the signature domain
 * string, and the digest labels are all unchanged, so a `manual` cursor AB#67
 * issued still decodes to `{ pinnedTier: 0, key: <its order>, placementId }`.
 */
export function createHmacGalleryCursorCodec(
  signingKey: string,
): GalleryCursorCodec {
  const inner = createHmacKeysetCursorCodec(signingKey);

  return {
    encode: (scope, boundary) =>
      inner.encode(
        scope,
        boundary.key,
        boundary.placementId,
      ) as GalleryCursor,
    decode: (cursor, scope) => {
      try {
        const decoded = inner.decode(cursor, scope);
        const key = decoded.afterKey;
        if (typeof key === "number") {
          return {
            pinnedTier: 0,
            key,
            placementId: decoded.afterId,
          };
        }
        // A string key can only be a materialized `shuffledOrder` (tier 1);
        // anything else is a token from another cursor family or a hand-forged
        // one that still cleared the signature and scope digest.
        if (!SHUFFLED_ORDER_PATTERN.test(key)) {
          throw new GalleryCursorError("malformed");
        }
        return {
          pinnedTier: 1,
          key,
          placementId: decoded.afterId,
        };
      } catch (error) {
        if (error instanceof KeysetCursorError) {
          throw new GalleryCursorError(error.code);
        }
        throw error;
      }
    },
  };
}

export function comparePlacementIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * One placement's position in the active order, as ADR-0009 §3's
 * `(pinnedTier, key, placementId)` triple — the same shape a cursor boundary
 * carries, so the two compare directly.
 *
 * - `manual`: always `{ 0, order, placementId }`. `pinned` is ignored (every
 *   placement already has a unique integer `order`).
 * - `seeded-random`, pinned: `{ 0, order, placementId }` — the pinned lead
 *   tier, ordered among itself by manual `order`.
 * - `seeded-random`, not pinned: `{ 1, shuffledOrder, placementId }`. The
 *   materialized `shuffledOrder` must be present — ADR-0009 §2 forbids
 *   computing it here, so its absence is a defect in whoever built the row,
 *   not something to paper over.
 */
function orderingKeyOf(
  placement: CuratedGalleryPlacement,
  ordering: GalleryOrdering,
): GalleryOrderingBoundary {
  if (ordering.kind === "manual" || placement.pinned === true) {
    return {
      pinnedTier: 0,
      key: placement.order,
      placementId: placement.placementId,
    };
  }
  if (placement.shuffledOrder === undefined) {
    throw new TypeError(
      `Placement ${placement.placementId} has no materialized shuffledOrder for a seeded-random gallery`,
    );
  }
  return {
    pinnedTier: 1,
    key: placement.shuffledOrder,
    placementId: placement.placementId,
  };
}

/**
 * Total order over `(pinnedTier, key, placementId)` triples: tier first, then
 * the key (numeric subtraction in the tier-0 lane, JS code-unit string
 * comparison in the tier-1 lane — the two never mix because the tier is
 * compared first), then `placementId` as the final tie-break, matching every
 * other ordering this codebase defines.
 *
 * A store-backed adapter's own keyset range query (AB#114/PR2) must return
 * rows in this exact order — `ORDER BY <the active rule's key>, placementId`
 * under a collation that agrees with JS string comparison, not a database's
 * locale-aware default — or a walk can permanently skip or duplicate items at
 * a tie. Keyset pagination trusts the store's ordering for everything strictly
 * after the boundary, so the two orderings must agree exactly.
 */
function compareOrderingBoundaries(
  left: GalleryOrderingBoundary,
  right: GalleryOrderingBoundary,
): number {
  if (left.pinnedTier !== right.pinnedTier) {
    return left.pinnedTier - right.pinnedTier;
  }
  if (typeof left.key === "number" && typeof right.key === "number") {
    if (left.key !== right.key) return left.key - right.key;
  } else if (typeof left.key === "string" && typeof right.key === "string") {
    if (left.key !== right.key) return left.key < right.key ? -1 : 1;
  } else {
    throw new TypeError(
      "Gallery ordering keys of different types compared within one tier",
    );
  }
  return comparePlacementIds(left.placementId, right.placementId);
}

/** Compares two placements in the active order. */
function comparePlacementsByOrdering(
  left: CuratedGalleryPlacement,
  right: CuratedGalleryPlacement,
  ordering: GalleryOrdering,
): number {
  return compareOrderingBoundaries(
    orderingKeyOf(left, ordering),
    orderingKeyOf(right, ordering),
  );
}

/** Where a placement sits relative to a decoded cursor boundary. */
function comparePlacementToBoundary(
  placement: CuratedGalleryPlacement,
  boundary: GalleryOrderingBoundary,
  ordering: GalleryOrdering,
): number {
  return compareOrderingBoundaries(orderingKeyOf(placement, ordering), boundary);
}

/**
 * Structural validation shared by every entry point that takes a placement
 * list: bounded/unique id, a safe non-negative `order` (so a malformed value
 * can never reach the sort and corrupt it — `left.order - right.order` on a
 * `NaN` breaks sort transitivity for the whole array, not just the offending
 * item), a boolean `visible`, an optional boolean `pinned`, an optional
 * `shuffledOrder` matching the materialized-key shape, and well-typed
 * overrides. Rule-specific completeness — "a non-pinned placement of a
 * seeded-random gallery must carry a `shuffledOrder`" — is enforced where the
 * ordering rule is known (`orderingKeyOf`), not here.
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
    if (
      placement.privateOnly !== undefined &&
      typeof placement.privateOnly !== "boolean"
    ) {
      throw new TypeError(
        "placement.privateOnly must be a boolean when provided",
      );
    }
    if (
      placement.pinned !== undefined &&
      typeof placement.pinned !== "boolean"
    ) {
      throw new TypeError("placement.pinned must be a boolean when provided");
    }
    if (
      placement.shuffledOrder !== undefined &&
      !SHUFFLED_ORDER_PATTERN.test(placement.shuffledOrder)
    ) {
      throw new TypeError(
        "placement.shuffledOrder must be a 64-character lowercase hex string when provided",
      );
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
 * Visible placements in the one authoritative order for the active rule
 * (`manual`, or `seeded-random`'s pinned-then-shuffled sequence), tie-broken by
 * the immutable placement id.
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
  ordering: GalleryOrdering,
): readonly CuratedGalleryPlacement[] {
  return placements
    .filter(
      (placement) => placement.visible && placement.privateOnly !== true,
    )
    .toSorted((left, right) =>
      comparePlacementsByOrdering(left, right, ordering),
    );
}

/**
 * The cover a curated gallery's listing card shows when no explicit cover is
 * authored: the first visible placement in the gallery's active order (manual,
 * or — under a `seeded-random` rule — pinned leads then the shuffle) whose
 * media this site can actually render publicly.
 *
 * Deterministic by construction — it is the same ordering the gallery's own
 * first page uses, and a seeded gallery's shuffle is materialized, not rolled
 * per call — so the card and the page a visitor lands on open with the same
 * photograph. A gallery with no visible placements has no cover, and its card
 * renders as text exactly as a page with no cover at all does.
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
  ordering: GalleryOrdering = { kind: "manual" },
): ImageMedia | undefined {
  assertPlacements(placements);
  assertGalleryOrdering(ordering);

  const [first] = orderVisiblePlacements(placements, ordering);
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
 * items strictly after `after` (or from the very start of the active order, if
 * `after` is undefined — the first page of a filter), plus — only when
 * `after` is set — the current state of the boundary item itself, looked up
 * separately by identity (see `GalleryWindowResult.boundary`). `candidateLimit`
 * is `scope.pageSize + 1`: one extra row past the page so `hasNextPage` never
 * needs a separate count query.
 */
export type GalleryWindowRequest = {
  readonly candidateLimit: number;
  readonly after?: GalleryOrderingBoundary;
};

/**
 * A source's bounded answer to one `GalleryWindowRequest`.
 *
 * `boundary` is the *current* state of the placement `after.placementId`
 * named, found through the same visibility/section filter every other row
 * goes through — so a boundary that has since been hidden, reassigned out of
 * the requested section, reordered, or removed entirely all come back the
 * same way (either absent, or present but no longer at the ordering key the
 * cursor named), and `buildCuratedGalleryPage` treats every such case as one
 * `stale` error rather than several different ones. Always absent when the request carried
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
 * a replaceable adapter seam (AB#66), so the decoded `(pinnedTier, key,
 * placementId)` boundary is validated here — against the active ordering rule —
 * exactly as strictly as a value arriving over the wire, before it ever reaches
 * a source's query. A tier-1 boundary against a `manual` gallery, a non-integer
 * tier-0 key, or a tier-1 key that is not a `shuffledOrder` are all `malformed`.
 */
export function resolveGalleryWindowRequest({
  scope,
  ordering,
  cursor,
  cursorCodec,
}: {
  readonly scope: GalleryCursorScope;
  readonly ordering: GalleryOrdering;
  readonly cursor?: string;
  readonly cursorCodec?: GalleryCursorCodec;
}): GalleryWindowRequest {
  assertScope(scope);
  assertOrderingMatchesScope(scope, ordering);
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
  assertBoundaryForOrdering(decoded, ordering);

  return { candidateLimit, after: decoded };
}

/**
 * The structured ordering rule and the scope string a cursor is bound to must
 * describe the same order — otherwise a caller could mint a cursor scoped to
 * one seed over a window sorted by another. This is the single point that
 * guards it (Codex plan review, AB#129).
 */
function assertOrderingMatchesScope(
  scope: GalleryCursorScope,
  ordering: GalleryOrdering,
): void {
  const expected = orderingScopeString(ordering);
  if (scope.ordering !== expected) {
    throw new Error(
      `scope.ordering (${JSON.stringify(scope.ordering)}) does not match the ordering rule (${JSON.stringify(expected)})`,
    );
  }
}

/** Validates a decoded boundary against the active ordering rule. */
function assertBoundaryForOrdering(
  boundary: GalleryOrderingBoundary,
  ordering: GalleryOrdering,
): void {
  if (
    typeof boundary.placementId !== "string" ||
    boundary.placementId.length === 0 ||
    boundary.placementId.length > MAX_ITEM_ID_LENGTH
  ) {
    throw new GalleryCursorError("malformed");
  }
  if (boundary.pinnedTier !== 0 && boundary.pinnedTier !== 1) {
    throw new GalleryCursorError("malformed");
  }
  if (boundary.pinnedTier === 1 && ordering.kind !== "seeded-random") {
    // A shuffled-tier boundary can only exist for a seeded-random gallery.
    throw new GalleryCursorError("malformed");
  }
  if (boundary.pinnedTier === 0) {
    if (typeof boundary.key !== "number" || !Number.isSafeInteger(boundary.key) || boundary.key < 0) {
      throw new GalleryCursorError("malformed");
    }
  } else if (
    typeof boundary.key !== "string" ||
    !SHUFFLED_ORDER_PATTERN.test(boundary.key)
  ) {
    throw new GalleryCursorError("malformed");
  }
}

/**
 * Reference in-memory answer to a `GalleryWindowRequest`: the current state of
 * the boundary item (if `windowRequest.after` names one) plus up to
 * `windowRequest.candidateLimit` items whose sort key is strictly greater than
 * `after`, in the active order (`ordering`, default `manual`).
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
 * range query for the candidates, which must agree with `compareOrderingBoundaries`'s
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
  ordering: GalleryOrdering = { kind: "manual" },
): GalleryWindowResult {
  assertPlacements(placements);
  assertGalleryOrdering(ordering);
  const ordered = orderVisiblePlacements(placements, ordering);
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
        comparePlacementToBoundary(placement, after, ordering) > 0,
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
  ordering = { kind: "manual" },
  windowRequest,
  cursorCodec,
}: {
  readonly windowResult: GalleryWindowResult;
  readonly scope: GalleryCursorScope;
  readonly ordering?: GalleryOrdering;
  readonly windowRequest: GalleryWindowRequest;
  readonly cursorCodec?: GalleryCursorCodec;
}): GalleryPage<CuratedGalleryResultItem> {
  assertScope(scope);
  assertOrderingMatchesScope(scope, ordering);

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
    if (placement.privateOnly === true) {
      throw new Error(
        "Gallery source returned a privateOnly placement in a bounded window",
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
    // The boundary is `stale` unless the placement the source found still
    // occupies the exact position the cursor named — same tier, same key, same
    // id. A reorder, a hide, a section move, or a removal all land here; a
    // reseed does not, because the changed `ordering` scope string already
    // failed the cursor as `wrong-scope` before this point (ADR-0009 §4).
    const current =
      windowResult.boundary === undefined
        ? undefined
        : orderingKeyOf(windowResult.boundary, ordering);
    if (
      current === undefined ||
      current.pinnedTier !== after.pinnedTier ||
      current.key !== after.key ||
      current.placementId !== after.placementId
    ) {
      throw new GalleryCursorError("stale");
    }
  }

  const candidates = windowResult.candidates.toSorted((left, right) =>
    comparePlacementsByOrdering(left, right, ordering),
  );
  if (
    after !== undefined &&
    candidates.some(
      (placement) => comparePlacementToBoundary(placement, after, ordering) <= 0,
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
      orderingKeyOf(lastPlacement, ordering),
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
