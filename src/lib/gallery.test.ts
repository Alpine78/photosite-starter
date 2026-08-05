import { describe, expect, it } from "vitest";
import {
  buildCuratedGalleryPage,
  GalleryCursorError,
  type CuratedGalleryPlacement,
  type GalleryCursorScope,
} from "@/lib/gallery-result";
import { getPortfolioGallery } from "@/lib/gallery";
import type { ImageMedia, VideoMedia } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";

const scope: GalleryCursorScope = {
  sourceId: "test-gallery",
  normalizedFilter: "all",
  ordering: "manual-v1",
  visibilityVersion: "published-v1",
  pageSize: 2,
};

function placement(
  placementId: string,
  order: number,
  media: ImageMedia = mockImages.coastalLandscape,
): CuratedGalleryPlacement {
  return { placementId, order, visible: true, media };
}

const placements = [
  placement("placement-c", 2, mockImages.lakesideReeds),
  placement("placement-b", 1, mockImages.mistyBirch),
  placement("placement-a", 1, mockImages.coastalLandscape),
  placement("placement-hidden", 0, mockImages.forestStream),
] satisfies CuratedGalleryPlacement[];

placements[3] = { ...placements[3], visible: false };

function expectCursorError(
  operation: () => unknown,
  code: GalleryCursorError["code"],
): void {
  try {
    operation();
    throw new Error("Expected gallery cursor operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(GalleryCursorError);
    expect((error as GalleryCursorError).code).toBe(code);
  }
}

describe("curated gallery result contract", () => {
  it("derives item identity from placement while retaining media identity", () => {
    const result = buildCuratedGalleryPage({ placements, scope });

    expect(result.items.map(({ itemId, mediaId, placementId }) => ({
      itemId,
      mediaId,
      placementId,
    }))).toEqual([
      {
        itemId: "placement-a",
        mediaId: "coastal-landscape",
        placementId: "placement-a",
      },
      {
        itemId: "placement-b",
        mediaId: "misty-birch",
        placementId: "placement-b",
      },
    ]);
  });

  it("preserves manual order with placementId as a deterministic tie-breaker", () => {
    const first = buildCuratedGalleryPage({ placements, scope });
    const second = buildCuratedGalleryPage({
      placements: placements.toReversed(),
      scope,
    });

    expect(first.items.map((item) => item.itemId)).toEqual([
      "placement-a",
      "placement-b",
    ]);
    expect(second.items.map((item) => item.itemId)).toEqual([
      "placement-a",
      "placement-b",
    ]);
  });

  it("returns bounded pages and an opaque cursor only when another page exists", () => {
    const first = buildCuratedGalleryPage({ placements, scope });
    expect(first.page).toMatchObject({ size: 2, hasNextPage: true });
    expect(first.page.endCursor).toEqual(expect.any(String));
    expect(first.page.endCursor).not.toContain("placement");

    const second = buildCuratedGalleryPage({
      placements,
      scope,
      cursor: first.page.endCursor,
    });
    expect(second.items.map((item) => item.itemId)).toEqual(["placement-c"]);
    expect(second.page).toEqual({ size: 2, hasNextPage: false });
  });

  it("rejects duplicate curated placement identity", () => {
    expect(() =>
      buildCuratedGalleryPage({
        placements: [placement("same", 0), placement("same", 1)],
        scope,
      }),
    ).toThrow("Duplicate placementId: same");
  });

  it("resolves explicit placement overrides without changing the source media", () => {
    const source = mockImages.coastalLandscape;
    const result = buildCuratedGalleryPage({
      placements: [
        {
          ...placement("overridden", 0, source),
          altOverride: "",
          captionOverride: "Placement caption",
        },
      ],
      scope,
    });

    expect(result.items[0].media).toMatchObject({
      alt: "",
      caption: "Placement caption",
    });
    expect(source.alt).not.toBe("");
    expect(source.caption).toBeUndefined();
  });

  it("fails before pagination when a visible media type is unsupported", () => {
    const video: VideoMedia = {
      type: "video",
      mediaId: "test-video",
      src: "/video/test.mp4",
      title: "Test video",
      width: 1920,
      height: 1080,
    };

    expect(() =>
      buildCuratedGalleryPage({
        placements: [
          placement("image", 0),
          { placementId: "video", order: 99, visible: true, media: video },
        ],
        scope: { ...scope, pageSize: 1 },
      }),
    ).toThrow("Unsupported public gallery media type: video");
  });
});

describe("gallery cursor safety", () => {
  const firstPage = buildCuratedGalleryPage({ placements, scope });
  const cursor = firstPage.page.endCursor as string;

  it("rejects malformed cursors", () => {
    expectCursorError(
      () => buildCuratedGalleryPage({ placements, scope, cursor: "not-a-cursor" }),
      "malformed",
    );
  });

  it("rejects tampered cursors", () => {
    const replacement = cursor.endsWith("a") ? "b" : "a";
    const tampered = `${cursor.slice(0, -1)}${replacement}`;

    expectCursorError(
      () => buildCuratedGalleryPage({ placements, scope, cursor: tampered }),
      "tampered",
    );
  });

  it.each([
    { sourceId: "another-gallery" },
    { normalizedFilter: "section:nature" },
    { ordering: "newest-v1" },
    { pageSize: 3 },
  ])("rejects a cursor used with the wrong scope: %o", (change) => {
    expectCursorError(
      () =>
        buildCuratedGalleryPage({
          placements,
          scope: { ...scope, ...change },
          cursor,
        }),
      "wrong-scope",
    );
  });

  it("rejects a cursor from an older visibility version as stale", () => {
    expectCursorError(
      () =>
        buildCuratedGalleryPage({
          placements,
          scope: { ...scope, visibilityVersion: "published-v2" },
          cursor,
        }),
      "stale",
    );
  });
});

describe("portfolio gallery adapter", () => {
  it("uses the shared result without visible reordering", async () => {
    const gallery = await getPortfolioGallery();

    expect(gallery.result.items.map((item) => item.mediaId)).toEqual([
      "coastal-landscape",
      "misty-birch",
      "lakeside-reeds",
      "forest-stream",
      "open-marsh",
      "lichen-stones",
    ]);
    expect(new Set(gallery.result.items.map((item) => item.itemId)).size).toBe(
      gallery.result.items.length,
    );
  });
});
