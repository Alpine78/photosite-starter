/**
 * What a private gallery item is allowed to be, once it crosses into a browser
 * payload (ADR-0014 §5, ADR-0002, `AGENTS.md`'s "Public derivatives only" rule
 * and its one scoped private exception).
 *
 * This is the private counterpart of `projectPublicMedia`, and it exists for the
 * same reason: a store row carries more than a page may render, and the safe
 * subset should be produced by one function that cannot be bypassed rather than
 * remembered at each call site.
 *
 * ## What must not cross, and why the type is the enforcement
 *
 * A {@link PrivateGalleryItem} has **no `objectKey`**. The key is the thing a
 * signed URL is minted for; a page that held one could ask for a signature by
 * naming it, which is exactly the shape `private-gallery-delivery.ts` refuses to
 * accept. A browser addresses an item by its `itemId` — the `placementId` this
 * deployment minted — and the server resolves the key. It also carries no
 * `galleryId` (a page already knows which gallery it is) and no `nominalBytes`
 * (the access budget's unit, an internal accounting fact).
 *
 * Camera masters, archive locators, and provider internals never appear here
 * because they are not on the placement at all — ADR-0002 keeps them off the
 * model, and this projection is the second lock rather than the only one.
 *
 * ## Why the ceilings are checked here as well as at upload
 *
 * §8e bounds a private derivative at 2 048 px on its longest edge and 8 MB. The
 * owner-run CLI will check that before uploading, but a read-time refusal is
 * what makes the bound true of what is *served* rather than of what one tool
 * happened to write — the same doubled enforcement the Sanity media boundary
 * already uses, and for the same reason: the writer is not the only way a row
 * can appear. An oversized derivative is refused, never downscaled on the fly:
 * silently serving something smaller would be a crop-shaped decision made by
 * the wrong layer.
 */

import {
  type PrivateGalleryDerivativeKind,
  type PrivateGalleryPlacement,
} from "@/lib/private-gallery";
import {
  PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES,
  PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_LONGEST_EDGE_PX,
  PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE,
} from "@/lib/private-gallery-limits";

/** The longest a caption or alternative text may be before it is a defect. */
export const PRIVATE_GALLERY_MAX_ALT_LENGTH = 500;

/**
 * One item as a page may hold it. Everything here is either the visitor's own
 * content or an identifier this deployment minted; nothing addresses storage.
 */
export type PrivateGalleryItem = {
  /** The `placementId`. The only handle a browser has on an item. */
  readonly itemId: string;
  /** True intrinsic pixels, so the frame is reserved at the real ratio. */
  readonly width: number;
  readonly height: number;
  readonly derivativeKind: PrivateGalleryDerivativeKind;
  readonly alt?: string;
};

export type PrivateGalleryItemErrorReason =
  | "malformed-placement"
  | "oversized-derivative"
  | "page-too-large";

export class PrivateGalleryItemError extends Error {
  readonly reason: PrivateGalleryItemErrorReason;

  constructor(reason: PrivateGalleryItemErrorReason, message: string) {
    // Never interpolate an object key or a placement id into a message.
    super(`[private-gallery-item] ${message}`);
    this.name = "PrivateGalleryItemError";
    this.reason = reason;
  }
}

function fail(reason: PrivateGalleryItemErrorReason, message: string): never {
  throw new PrivateGalleryItemError(reason, message);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export type PrivateGalleryItemLimits = {
  readonly maxLongestEdgePx: number;
  readonly maxBytes: number;
  readonly maxPageSize: number;
};

export const PRIVATE_GALLERY_ITEM_LIMITS: PrivateGalleryItemLimits =
  Object.freeze({
    maxLongestEdgePx: PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_LONGEST_EDGE_PX,
    maxBytes: PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES,
    maxPageSize: PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE,
  });

/**
 * Projects one stored placement into the item a page may render.
 *
 * A malformed row **throws** rather than being skipped. A skipped item would
 * silently shorten a customer's gallery — they would have no way to know a
 * photograph they were delivered is missing, and neither would the photographer.
 * That is the same posture every other content boundary in this repository
 * takes toward a store row it cannot trust.
 */
export function projectPrivateGalleryItem(
  placement: PrivateGalleryPlacement,
  limits: PrivateGalleryItemLimits = PRIVATE_GALLERY_ITEM_LIMITS,
): PrivateGalleryItem {
  if (
    typeof placement.placementId !== "string" ||
    placement.placementId.length === 0
  ) {
    fail("malformed-placement", "the placement has no usable identifier");
  }
  if (!isPositiveInteger(placement.width) || !isPositiveInteger(placement.height)) {
    // Without both, the frame cannot be reserved at the right ratio, and a
    // layout that does not know a photograph's shape can only guess it.
    fail(
      "malformed-placement",
      "the placement has no usable intrinsic dimensions",
    );
  }
  if (!isPositiveInteger(placement.nominalBytes)) {
    fail("malformed-placement", "the placement has no usable size");
  }
  if (
    placement.derivativeKind !== "delivery-preview" &&
    placement.derivativeKind !== "watermarked-proof"
  ) {
    fail("malformed-placement", "the placement has no known derivative kind");
  }

  const longestEdge = Math.max(placement.width, placement.height);
  if (longestEdge > limits.maxLongestEdgePx) {
    fail(
      "oversized-derivative",
      `a private derivative is bounded at ${limits.maxLongestEdgePx}px on its longest edge; this one is ${longestEdge}px. An explicit pixel bound is what stops a near-full-resolution proof becoming an individual high-resolution delivery path (ADR-0014 §8e)`,
    );
  }
  if (placement.nominalBytes > limits.maxBytes) {
    fail(
      "oversized-derivative",
      `a private derivative is bounded at ${limits.maxBytes} bytes; this one is ${placement.nominalBytes}`,
    );
  }

  if (placement.alt !== undefined) {
    if (
      typeof placement.alt !== "string" ||
      placement.alt.length > PRIVATE_GALLERY_MAX_ALT_LENGTH
    ) {
      fail("malformed-placement", "the placement's alternative text is unusable");
    }
  }

  // Built field by field rather than by spreading the row, so a column added to
  // the placement later cannot reach a payload by simply existing.
  return {
    itemId: placement.placementId,
    width: placement.width,
    height: placement.height,
    derivativeKind: placement.derivativeKind,
    ...(placement.alt === undefined || placement.alt.trim().length === 0
      ? {}
      : { alt: placement.alt }),
  };
}

/**
 * Projects one bounded page of placements, in the order the store returned them.
 *
 * The order is the store's, not this function's: a gallery's sequence is the
 * photographer's authored `order`, and re-sorting here would give the grid, the
 * DOM, and the lightbox two different opinions about it — the exact defect the
 * public gallery's row-major rule exists to prevent.
 *
 * A page longer than the ceiling is refused rather than truncated. Truncating
 * would hand a caller a silently short gallery that still looked complete.
 */
export function projectPrivateGalleryItems(
  placements: readonly PrivateGalleryPlacement[],
  limits: PrivateGalleryItemLimits = PRIVATE_GALLERY_ITEM_LIMITS,
): readonly PrivateGalleryItem[] {
  if (placements.length > limits.maxPageSize) {
    fail(
      "page-too-large",
      `a private read returns at most ${limits.maxPageSize} items; this page has ${placements.length}`,
    );
  }

  const items = placements.map((placement) =>
    projectPrivateGalleryItem(placement, limits),
  );

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.itemId)) {
      // A repeated identity would break the render-time key and make the
      // lightbox's focus-return-by-item ambiguous, the same way a duplicated
      // body-block key does in the public content boundary.
      fail("malformed-placement", "two placements share one identifier");
    }
    seen.add(item.itemId);
  }

  return items;
}
