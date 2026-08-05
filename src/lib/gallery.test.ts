import { describe, expect, it } from "vitest";
import {
  buildCuratedGalleryPage,
  createHmacGalleryCursorCodec,
  GalleryCursorError,
  MAX_GALLERY_CURSOR_LENGTH,
  MAX_GALLERY_PAGE_SIZE,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
  type GalleryCursorScope,
} from "@/lib/gallery-pagination";
import type { GalleryCursor } from "@/lib/gallery-result";
import type { ImageMedia, VideoMedia } from "@/lib/media";
import { buildPortfolioGallery } from "@/lib/mock-gallery";
import { mockImages } from "@/lib/mock-media";

const TEST_SIGNING_KEY =
  "test-only-gallery-cursor-signing-key-0123456789";
const testCursorCodec = createHmacGalleryCursorCodec(TEST_SIGNING_KEY);

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
  {
    ...placement("placement-hidden", 0, mockImages.forestStream),
    visible: false,
  },
] satisfies readonly CuratedGalleryPlacement[];

function buildPage({
  sourcePlacements = placements,
  cursor,
  cursorScope = scope,
  cursorCodec = testCursorCodec,
}: {
  readonly sourcePlacements?: readonly CuratedGalleryPlacement[];
  readonly cursor?: string;
  readonly cursorScope?: GalleryCursorScope;
  readonly cursorCodec?: GalleryCursorCodec;
} = {}) {
  return buildCuratedGalleryPage({
    placements: sourcePlacements,
    scope: cursorScope,
    cursor,
    cursorCodec,
  });
}

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

function decodeCursorPayload(cursor: string): Record<string, unknown> {
  const [encodedPayload] = cursor.split(".");
  return JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString(),
  ) as Record<string, unknown>;
}

describe("curated gallery result contract", () => {
  it("separates result, media, and curated placement identities", () => {
    const result = buildPage();

    expect(
      result.items.map(({ itemId, mediaId, placementId }) => ({
        itemId,
        mediaId,
        placementId,
      })),
    ).toEqual([
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

  it("allows repeated media in distinct curated placements", () => {
    const result = buildPage({
      sourcePlacements: [placement("repeat-a", 0), placement("repeat-b", 1)],
    });

    expect(result.items.map((item) => item.itemId)).toEqual([
      "repeat-a",
      "repeat-b",
    ]);
    expect(result.items.map((item) => item.mediaId)).toEqual([
      "coastal-landscape",
      "coastal-landscape",
    ]);
  });

  it("preserves manual order with a locale-independent item tie-breaker", () => {
    const tied = [placement("item-2", 0), placement("item-10", 0)];
    const first = buildPage({
      sourcePlacements: tied,
      cursorScope: { ...scope, pageSize: 1 },
    });
    const reversed = buildPage({
      sourcePlacements: tied.toReversed(),
      cursorScope: { ...scope, pageSize: 1 },
    });

    expect(first.items[0].itemId).toBe("item-10");
    expect(reversed.items[0].itemId).toBe("item-10");

    const second = buildPage({
      sourcePlacements: tied,
      cursorScope: { ...scope, pageSize: 1 },
      cursor: first.page.endCursor as string,
    });
    expect(second.items[0].itemId).toBe("item-2");
  });

  it("rejects duplicate curated placement identity", () => {
    expect(() =>
      buildPage({
        sourcePlacements: [placement("same", 0), placement("same", 1)],
      }),
    ).toThrow("Duplicate placementId: same");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2 ** 53])(
    "rejects a non-deterministic manual order: %s",
    (order) => {
      expect(() =>
        buildPage({ sourcePlacements: [placement("invalid", order)] }),
      ).toThrow("placement.order must be a non-negative safe integer");
    },
  );

  it("resolves placement overrides without changing source media", () => {
    const source = mockImages.coastalLandscape;
    const result = buildPage({
      sourcePlacements: [
        {
          ...placement("overridden", 0, source),
          altOverride: "",
          captionOverride: "Placement caption",
        },
      ],
    });

    expect(result.items[0].media).toMatchObject({
      alt: "",
      caption: "Placement caption",
    });
    expect(source.alt).not.toBe("");
    expect(source.caption).toBeUndefined();
  });

  it("treats an undefined alt override as absent", () => {
    const result = buildPage({
      sourcePlacements: [
        { ...placement("default-alt", 0), altOverride: undefined },
      ],
    });

    expect(result.items[0].media.alt).toBe(mockImages.coastalLandscape.alt);
  });

  it("projects public media property by property", () => {
    const source = mockImages.coastalLandscape;
    const enrichedMedia = {
      ...source,
      _id: "provider-document-sentinel",
      archiveLocator: "archive-locator-sentinel",
      masterUrl: "master-url-sentinel",
      publicationState: "draft",
      privateOnly: true,
      rendition: {
        ...source.rendition,
        providerAssetRef: "provider-asset-sentinel",
      },
    };

    const result = buildPage({
      sourcePlacements: [
        placement("safe-result", 0, enrichedMedia),
        placement("cursor-tail", 1, mockImages.mistyBirch),
      ],
      cursorScope: { ...scope, pageSize: 1 },
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("provider-document-sentinel");
    expect(serialized).not.toContain("archive-locator-sentinel");
    expect(serialized).not.toContain("master-url-sentinel");
    expect(serialized).not.toContain("provider-asset-sentinel");
    expect(serialized).not.toContain("privateOnly");
    expect(serialized).not.toContain("publicationState");
    expect(result.items[0].media).toEqual(source);
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
      buildPage({
        sourcePlacements: [
          placement("image", 0),
          { placementId: "video", order: 99, visible: true, media: video },
        ],
        cursorScope: { ...scope, pageSize: 1 },
      }),
    ).toThrow("Unsupported public gallery media type: video");
  });

  it("does not count a hidden unsupported media item", () => {
    const video: VideoMedia = {
      type: "video",
      mediaId: "hidden-video",
      src: "/video/hidden.mp4",
      title: "Hidden video",
      width: 1920,
      height: 1080,
    };
    const result = buildPage({
      sourcePlacements: [
        placement("image", 0),
        { placementId: "video", order: 1, visible: false, media: video },
      ],
    });

    expect(result.items.map((item) => item.itemId)).toEqual(["image"]);
  });
});

describe("gallery page boundaries", () => {
  it("returns an accessible empty first page without a cursor", () => {
    const result = buildPage({ sourcePlacements: [] });

    expect(result).toEqual({
      items: [],
      page: { size: 2, hasNextPage: false, endCursor: null },
    });
  });

  it("does not issue a cursor when the items exactly fill one page", () => {
    const result = buildPage({
      sourcePlacements: [placement("a", 0), placement("b", 1)],
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.length).toBeLessThanOrEqual(result.page.size);
    expect(result.page).toEqual({
      size: 2,
      hasNextPage: false,
      endCursor: null,
    });
  });

  it("issues an opaque cursor only when another bounded page exists", () => {
    const first = buildPage();
    expect(first.items).toHaveLength(2);
    expect(first.page.hasNextPage).toBe(true);
    expect(first.page.endCursor).toEqual(expect.any(String));
    expect(first.page.endCursor).not.toContain("placement");

    const second = buildPage({ cursor: first.page.endCursor as string });
    expect(second.items.map((item) => item.itemId)).toEqual(["placement-c"]);
    expect(second.page).toEqual({
      size: 2,
      hasNextPage: false,
      endCursor: null,
    });
  });

  it("requires an adapter codec only when a continuation is needed", () => {
    expect(() =>
      buildCuratedGalleryPage({
        placements,
        scope,
      }),
    ).toThrow("A gallery cursor codec is required for a paginated result");

    expect(() =>
      buildCuratedGalleryPage({
        placements: [placement("single", 0)],
        scope,
      }),
    ).not.toThrow();
  });

  it.each([0, -1, 1.5, MAX_GALLERY_PAGE_SIZE + 1, 2 ** 53])(
    "rejects an invalid page bound: %s",
    (pageSize) => {
      expect(() =>
        buildPage({ cursorScope: { ...scope, pageSize } }),
      ).toThrow(
        `Gallery page size must be an integer between 1 and ${MAX_GALLERY_PAGE_SIZE}`,
      );
    },
  );
});

describe("gallery cursor safety and durability", () => {
  const firstPage = buildPage();
  const cursor = firstPage.page.endCursor as string;

  it.each([
    "not-a-cursor",
    "payload.signature.extra",
    "payload.!invalid-signature!",
    "x".repeat(MAX_GALLERY_CURSOR_LENGTH + 1),
  ])("rejects a malformed cursor without reading gallery data: %s", (value) => {
    expectCursorError(
      () =>
        buildPage({
          sourcePlacements: [placement("same", 0), placement("same", 1)],
          cursor: value,
        }),
      "malformed",
    );
  });

  it("rejects a modified cursor signature", () => {
    const replacement = cursor.endsWith("a") ? "b" : "a";
    const tampered = `${cursor.slice(0, -1)}${replacement}`;

    expectCursorError(() => buildPage({ cursor: tampered }), "tampered");
  });

  it("rejects a payload modified without the server signing key", () => {
    const [encodedPayload, signature] = cursor.split(".");
    const payload = decodeCursorPayload(cursor);
    payload.offset = 1;
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );

    expectCursorError(
      () => buildPage({ cursor: `${tamperedPayload}.${signature}` }),
      "tampered",
    );
    expect(tamperedPayload).not.toBe(encodedPayload);
  });

  it("rejects a cursor signed by another deployment key", () => {
    expectCursorError(
      () =>
        buildPage({
          cursor,
          cursorCodec: createHmacGalleryCursorCodec(
            "another-test-signing-key-abcdefghijklmnopqrstuvwxyz",
          ),
        }),
      "tampered",
    );
  });

  it("rejects an invalid position returned by an adapter codec", () => {
    const invalidCodec: GalleryCursorCodec = {
      encode: testCursorCodec.encode,
      decode: () => ({
        offset: -1,
        matchesBoundary: () => true,
      }),
    };

    expectCursorError(
      () => buildPage({ cursor, cursorCodec: invalidCodec }),
      "malformed",
    );
  });

  it.each(["", "x".repeat(MAX_GALLERY_CURSOR_LENGTH + 1)])(
    "rejects an invalid cursor emitted by an adapter codec",
    (value) => {
      const invalidCodec: GalleryCursorCodec = {
        encode: () => value as GalleryCursor,
        decode: testCursorCodec.decode,
      };

      expect(() => buildPage({ cursorCodec: invalidCodec })).toThrow(
        "Gallery cursor codec returned an invalid cursor",
      );
    },
  );

  it.each([
    { sourceId: "another-gallery" },
    { normalizedFilter: "section:nature" },
    { ordering: "newest-v1" },
    { pageSize: 3 },
  ])("rejects a cursor used with the wrong scope: %o", (change) => {
    expectCursorError(
      () =>
        buildPage({
          cursorScope: { ...scope, ...change },
          cursor,
        }),
      "wrong-scope",
    );
  });

  it("classifies a foreign source before its visibility version", () => {
    expectCursorError(
      () =>
        buildPage({
          cursorScope: {
            ...scope,
            sourceId: "another-gallery",
            visibilityVersion: "published-v2",
          },
          cursor,
        }),
      "wrong-scope",
    );
  });

  it("rejects a cursor from an older visibility version as stale", () => {
    expectCursorError(
      () =>
        buildPage({
          cursorScope: { ...scope, visibilityVersion: "published-v2" },
          cursor,
        }),
      "stale",
    );
  });

  it("rejects a result shortened exactly to the previous boundary", () => {
    expectCursorError(
      () =>
        buildPage({
          sourcePlacements: [
            placement("placement-a", 1),
            placement("placement-b", 1),
          ],
          cursor,
        }),
      "stale",
    );
  });

  it("rejects a reorder that moves the cursor boundary", () => {
    expectCursorError(
      () =>
        buildPage({
          sourcePlacements: [
            placement("placement-c", 0, mockImages.lakesideReeds),
            placement("placement-a", 1, mockImages.coastalLandscape),
            placement("placement-b", 2, mockImages.mistyBirch),
          ],
          cursor,
        }),
      "stale",
    );
  });

  it("survives appending items after an unchanged boundary", () => {
    const result = buildPage({
      sourcePlacements: [
        ...placements,
        placement("placement-d", 3, mockImages.openMarsh),
      ],
      cursor,
    });

    expect(result.items.map((item) => item.itemId)).toEqual([
      "placement-c",
      "placement-d",
    ]);
  });

  it("survives presentation edits that do not move its boundary", () => {
    const editedMedia = {
      ...mockImages.mistyBirch,
      caption: "Edited presentation caption",
    } satisfies ImageMedia;
    const result = buildPage({
      sourcePlacements: placements.map((item) =>
        item.placementId === "placement-b"
          ? { ...item, media: editedMedia }
          : item,
      ),
      cursor,
    });

    expect(result.items.map((item) => item.itemId)).toEqual(["placement-c"]);
  });

  it("allow-lists project-owned cursor fields", () => {
    const enrichedScope = {
      ...scope,
      providerDocumentId: "provider-scope-sentinel",
      archiveLocator: "archive-scope-sentinel",
    };
    const result = buildPage({ cursorScope: enrichedScope });
    const payload = decodeCursorPayload(result.page.endCursor as string);

    expect(Object.keys(payload).sort()).toEqual(
      [
        "version",
        "queryScope",
        "visibilityScope",
        "offset",
        "afterItem",
      ].sort(),
    );
    expect(JSON.stringify(payload)).not.toContain("provider-scope-sentinel");
    expect(JSON.stringify(payload)).not.toContain("archive-scope-sentinel");
    expect(Object.values(payload)).not.toContain(scope.sourceId);
    expect(Object.values(payload)).not.toContain(scope.normalizedFilter);
  });
});

describe("portfolio gallery adapter", () => {
  it("uses the shared contract without visible reordering", () => {
    const gallery = buildPortfolioGallery();

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
    expect(gallery.result.page).toEqual({
      size: 24,
      hasNextPage: false,
      endCursor: null,
    });
  });
});
