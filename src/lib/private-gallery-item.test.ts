import { describe, expect, it } from "vitest";

import type { PrivateGalleryPlacement } from "@/lib/private-gallery";
import {
  PRIVATE_GALLERY_ITEM_LIMITS,
  PRIVATE_GALLERY_MAX_ALT_LENGTH,
  PrivateGalleryItemError,
  projectPrivateGalleryItem,
  projectPrivateGalleryItems,
} from "@/lib/private-gallery-item";
import { MAX_PUBLIC_DELIVERY_DIMENSION } from "@/lib/image-delivery";

const PLACEMENT: PrivateGalleryPlacement = {
  galleryId: "gallery-1",
  placementId: "placement-1",
  objectKey: "private/gallery-1/preview/1.webp",
  order: 1,
  derivativeKind: "delivery-preview",
  nominalBytes: 2 * 1024 * 1024,
  width: 2048,
  height: 1365,
  alt: "Rocky shoreline beside calm water",
};

const placement = (overrides: Partial<PrivateGalleryPlacement> = {}) => ({
  ...PLACEMENT,
  ...overrides,
});

describe("projectPrivateGalleryItem", () => {
  it("carries the item's identity, shape, and authored text", () => {
    expect(projectPrivateGalleryItem(PLACEMENT)).toEqual({
      itemId: "placement-1",
      width: 2048,
      height: 1365,
      derivativeKind: "delivery-preview",
      alt: "Rocky shoreline beside calm water",
    });
  });

  it("carries nothing that addresses storage or accounting", () => {
    // The load-bearing property. A page holding an object key could ask for a
    // signature by naming one, which is the request shape the delivery
    // boundary refuses to accept in the first place.
    const item = projectPrivateGalleryItem(PLACEMENT);
    const serialized = JSON.stringify(item);

    expect(item).not.toHaveProperty("objectKey");
    expect(item).not.toHaveProperty("galleryId");
    expect(item).not.toHaveProperty("nominalBytes");
    expect(item).not.toHaveProperty("order");
    expect(serialized).not.toContain(PLACEMENT.objectKey);
    expect(serialized).not.toContain(PLACEMENT.galleryId);
    expect(serialized).not.toContain(String(PLACEMENT.nominalBytes));
  });

  it("cannot leak a column added to the placement later", () => {
    // Built field by field rather than by spreading the row, so a future
    // `archiveLocator` or provider id cannot reach a payload by merely existing.
    const withExtra = {
      ...PLACEMENT,
      archiveLocator: "shelf-3/negative-118",
      providerAssetId: "asset-abc",
    } as PrivateGalleryPlacement;

    const serialized = JSON.stringify(projectPrivateGalleryItem(withExtra));

    expect(serialized).not.toContain("shelf-3");
    expect(serialized).not.toContain("asset-abc");
  });

  it("omits absent and blank alternative text rather than emitting an empty one", () => {
    expect(
      projectPrivateGalleryItem(placement({ alt: undefined })),
    ).not.toHaveProperty("alt");
    expect(
      projectPrivateGalleryItem(placement({ alt: "   " })),
    ).not.toHaveProperty("alt");
  });

  it("keeps a portrait frame portrait", () => {
    // The no-crop rule is only expressible because the true pixels are carried:
    // a layout that does not know a photograph's shape can only guess it.
    const item = projectPrivateGalleryItem(
      placement({ width: 1365, height: 2048 }),
    );

    expect(item.height).toBeGreaterThan(item.width);
  });

  it("accepts a derivative exactly at the pixel ceiling", () => {
    expect(() =>
      projectPrivateGalleryItem(
        placement({ width: PRIVATE_GALLERY_ITEM_LIMITS.maxLongestEdgePx, height: 100 }),
      ),
    ).not.toThrow();
  });

  it.each([
    ["landscape", { width: 2049, height: 100 }],
    ["portrait", { width: 100, height: 2049 }],
  ])("refuses a %s derivative past the pixel ceiling", (_case, size) => {
    // Refused, never downscaled on the fly: silently serving something smaller
    // would be a crop-shaped decision made by the wrong layer.
    expect(() => projectPrivateGalleryItem(placement(size))).toThrow(
      PrivateGalleryItemError,
    );
  });

  it("ties the pixel ceiling to the public export policy", () => {
    // §8e sets it to `MAX_PUBLIC_DELIVERY_DIMENSION` deliberately — the actual
    // web-delivery policy, not the 8192px contract maximum — so a private
    // preview cannot quietly become a higher-resolution delivery path than a
    // public one.
    expect(PRIVATE_GALLERY_ITEM_LIMITS.maxLongestEdgePx).toBe(
      MAX_PUBLIC_DELIVERY_DIMENSION,
    );
  });

  it("refuses a derivative past the byte ceiling", () => {
    expect(() =>
      projectPrivateGalleryItem(
        placement({ nominalBytes: PRIVATE_GALLERY_ITEM_LIMITS.maxBytes + 1 }),
      ),
    ).toThrow(PrivateGalleryItemError);
  });

  it.each([
    ["no identifier", { placementId: "" }],
    ["a zero width", { width: 0 }],
    ["a fractional height", { height: 12.5 }],
    ["a negative width", { width: -2048 }],
    ["no size", { nominalBytes: 0 }],
    ["an unknown derivative kind", { derivativeKind: "master" as never }],
    ["overlong alternative text", { alt: "a".repeat(PRIVATE_GALLERY_MAX_ALT_LENGTH + 1) }],
  ])("refuses a placement with %s", (_case, override) => {
    // Thrown rather than skipped: a skipped item silently shortens a customer's
    // gallery, and neither they nor the photographer would ever know a
    // delivered photograph is missing.
    expect(() => projectPrivateGalleryItem(placement(override))).toThrow(
      PrivateGalleryItemError,
    );
  });

  it("names neither the key nor the identifier when it refuses", () => {
    let message = "";
    try {
      projectPrivateGalleryItem(placement({ width: 9000 }));
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain(PLACEMENT.objectKey);
    expect(message).not.toContain(PLACEMENT.placementId);
  });
});

describe("projectPrivateGalleryItems", () => {
  const page = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      placement({ placementId: `placement-${index}`, order: index }),
    );

  it("preserves the store's order rather than imposing one", () => {
    // The sequence is the photographer's authored `order`; re-sorting here
    // would give the grid, the DOM, and the lightbox two different opinions
    // about it — the defect the public gallery's row-major rule prevents.
    const shuffled = [
      placement({ placementId: "c", order: 3 }),
      placement({ placementId: "a", order: 1 }),
      placement({ placementId: "b", order: 2 }),
    ];

    expect(projectPrivateGalleryItems(shuffled).map((i) => i.itemId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("accepts a page exactly at the ceiling", () => {
    expect(
      projectPrivateGalleryItems(page(PRIVATE_GALLERY_ITEM_LIMITS.maxPageSize)),
    ).toHaveLength(PRIVATE_GALLERY_ITEM_LIMITS.maxPageSize);
  });

  it("refuses an over-long page rather than truncating it", () => {
    // Truncating would hand a caller a silently short gallery that still looked
    // complete.
    expect(() =>
      projectPrivateGalleryItems(
        page(PRIVATE_GALLERY_ITEM_LIMITS.maxPageSize + 1),
      ),
    ).toThrow(PrivateGalleryItemError);
  });

  it("refuses two placements sharing one identifier", () => {
    // A repeated identity breaks the render key and makes focus-return-by-item
    // ambiguous, the same way a duplicated body-block key does publicly.
    expect(() =>
      projectPrivateGalleryItems([
        placement({ placementId: "same" }),
        placement({ placementId: "same" }),
      ]),
    ).toThrow(PrivateGalleryItemError);
  });

  it("refuses the whole page when one item is malformed", () => {
    expect(() =>
      projectPrivateGalleryItems([PLACEMENT, placement({ width: 0 })]),
    ).toThrow(PrivateGalleryItemError);
  });

  it("projects an empty page as an empty page", () => {
    expect(projectPrivateGalleryItems([])).toEqual([]);
  });
});
