import { describe, expect, it } from "vitest";
import {
  buildCuratedGalleryPage,
  createHmacGalleryCursorCodec,
  GalleryCursorError,
  MAX_GALLERY_CURSOR_LENGTH,
  MAX_GALLERY_PAGE_SIZE,
  selectCuratedGalleryCover,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
  type GalleryCursorScope,
} from "@/lib/gallery-pagination";
import type {
  CuratedGalleryResultItem,
  GalleryCursor,
} from "@/lib/gallery-result";
import { UnknownGallerySectionError } from "@/lib/gallery-sections";
import type { ImageMedia, VideoMedia } from "@/lib/media";
import {
  getMockGalleryCover,
  getMockGalleryResult,
  MOCK_FEATURED_GALLERY_ID,
} from "@/lib/mock-gallery";
import { getMockImages, mockImages } from "@/lib/mock-media";

const TEST_SIGNING_KEY =
  "test-only-gallery-cursor-signing-key-0123456789";
const testCursorCodec = createHmacGalleryCursorCodec(TEST_SIGNING_KEY);

/** The gallery that outgrew one page, and the reason continuation exists. */
const LARGE_GALLERY_ID = "content-large-archive";
const LARGE_GALLERY_SIZE = 400;
const MOCK_PAGE_SIZE = 24;

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

/**
 * One page of a fixture gallery, with the codec the seam would have supplied.
 *
 * The fixture holds no key of its own — `gallery.ts` is where a deployment's
 * signing key enters — so a test that walks past a page boundary hands one over
 * exactly as the seam does.
 */
function mockPage(
  language: string,
  contentId: string,
  cursor?: string,
) {
  return getMockGalleryResult(language, contentId, {
    ...(cursor === undefined ? {} : { cursor }),
    cursorCodec: testCursorCodec,
  });
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

  it.each([
    ["empty", ""],
    ["oversized", "x".repeat(MAX_GALLERY_CURSOR_LENGTH + 1)],
  ])(
    "rejects invalid input before calling an adapter codec: %s",
    (_caseName, value) => {
      let decodeCalled = false;
      const acceptingCodec: GalleryCursorCodec = {
        encode: testCursorCodec.encode,
        decode: () => {
          decodeCalled = true;
          return {
            offset: 1,
            matchesBoundary: () => true,
          };
        },
      };

      expectCursorError(
        () => buildPage({ cursor: value, cursorCodec: acceptingCodec }),
        "malformed",
      );
      expect(decodeCalled).toBe(false);
    },
  );

  it.each([
    ["empty", ""],
    ["oversized", "x".repeat(MAX_GALLERY_CURSOR_LENGTH + 1)],
  ])(
    "rejects an invalid cursor emitted by an adapter codec: %s",
    (_caseName, value) => {
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

  it("scopes item boundary digests to their gallery query", () => {
    const firstPayload = decodeCursorPayload(cursor);
    const foreignResult = buildPage({
      cursorScope: { ...scope, sourceId: "another-gallery" },
    });
    const foreignPayload = decodeCursorPayload(
      foreignResult.page.endCursor as string,
    );

    expect(firstPayload.afterItem).not.toBe(foreignPayload.afterItem);
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

describe("selectCuratedGalleryCover", () => {
  it("takes the first visible placement in manual order", () => {
    const cover = selectCuratedGalleryCover(placements);

    // `placement-hidden` sorts first by order but is not public, and
    // `placement-a` and `placement-b` tie on order — the placement id breaks it,
    // exactly as the first page does.
    expect(cover?.mediaId).toBe("coastal-landscape");
  });

  it("opens on the same image the gallery's own first page does", () => {
    const cover = selectCuratedGalleryCover(placements);
    const { items } = buildPage({ cursorScope: { ...scope, pageSize: 3 } });

    expect(cover?.mediaId).toBe(items[0]?.mediaId);
  });

  it("carries the placement's caption and alt overrides", () => {
    const cover = selectCuratedGalleryCover([
      {
        ...placement("placement-only", 0),
        altOverride: "Placement alt",
        captionOverride: "Placement caption",
      },
    ]);

    expect(cover?.alt).toBe("Placement alt");
    expect(cover?.caption).toBe("Placement caption");
  });

  it("projects only public rendition fields", () => {
    const cover = selectCuratedGalleryCover(placements);

    expect(Object.keys(cover?.rendition ?? {}).toSorted()).toEqual([
      "height",
      "src",
      "version",
      "width",
    ]);
  });

  it("rejects unsupported media rather than skipping past it", () => {
    // The same answer the first page gives. A cover that skipped ahead would
    // advertise a gallery whose detail route cannot render.
    expect(() =>
      selectCuratedGalleryCover([
        {
          ...placement("placement-video", 0),
          media: {
            type: "video",
            mediaId: "a-video",
            src: "/video/clip.mp4",
            title: "A clip",
            width: 1920,
            height: 1080,
          },
        },
      ]),
    ).toThrow(/Unsupported public gallery media type/);
  });

  it("has no cover when every placement is hidden", () => {
    expect(
      selectCuratedGalleryCover([
        { ...placement("placement-hidden", 0), visible: false },
      ]),
    ).toBeUndefined();
  });

  it("has no cover for an empty gallery", () => {
    expect(selectCuratedGalleryCover([])).toBeUndefined();
  });

  it("rejects a malformed placement rather than skipping it", () => {
    expect(() =>
      selectCuratedGalleryCover([placement("duplicate", 0), placement("duplicate", 1)]),
    ).toThrow(/Duplicate placementId/);
  });
});

describe("curated gallery fixtures", () => {
  it("keeps the featured gallery's authored order and captions", () => {
    const result = mockPage("en", MOCK_FEATURED_GALLERY_ID);

    // The order and captions the pre-tree `/portfolio` route published. The
    // gallery moved to a canonical route inside the content tree; what a visitor
    // sees did not move with it.
    expect(
      result?.items.map((item) => [item.mediaId, item.media.caption]),
    ).toEqual([
      ["coastal-landscape", "Quiet coast"],
      ["misty-birch", "Morning mist"],
      ["lakeside-reeds", undefined],
      ["forest-stream", "Forest stream"],
      ["open-marsh", "After the rain"],
      ["lichen-stones", "Shoreline details"],
    ]);
  });

  it("gives every item a distinct result identity", () => {
    const result = mockPage("en", MOCK_FEATURED_GALLERY_ID);
    const itemIds = result?.items.map((item) => item.itemId) ?? [];

    expect(new Set(itemIds).size).toBe(itemIds.length);
  });

  it("keeps the itemId and the mediaId separate", () => {
    const result = mockPage("en", MOCK_FEATURED_GALLERY_ID);

    expect(
      result?.items.every((item) => item.itemId !== item.mediaId),
    ).toBe(true);
  });

  it("issues no cursor for a gallery that fits inside one page", () => {
    expect(mockPage("en", MOCK_FEATURED_GALLERY_ID)?.page).toEqual({
      size: MOCK_PAGE_SIZE,
      hasNextPage: false,
      endCursor: null,
    });
  });

  it("orders every locale's version of a gallery identically", () => {
    const english = mockPage("en", MOCK_FEATURED_GALLERY_ID);
    const finnish = mockPage("fi", MOCK_FEATURED_GALLERY_ID);

    expect(finnish?.items.map((item) => item.itemId)).toEqual(
      english?.items.map((item) => item.itemId),
    );
  });

  it("describes a localized gallery in that language", () => {
    const finnish = mockPage("fi", MOCK_FEATURED_GALLERY_ID);
    const finnishImages = getMockImages("fi");

    expect(finnish?.items[0]?.media.alt).toBe(finnishImages.coastalLandscape.alt);
    expect(finnish?.items[0]?.media.caption).toBe("Hiljainen rannikko");
    // The same public bytes, under the same version: only the words are
    // translated, never the rendition.
    expect(finnish?.items[0]?.media.rendition).toEqual(
      mockImages.coastalLandscape.rendition,
    );
  });

  it("serves a published gallery that has no items yet", () => {
    const result = mockPage("en", "content-awaiting-selection");

    // A gallery between selections is published and empty, not missing: the
    // route renders its empty state rather than 404ing an address a visitor may
    // already hold.
    expect(result?.items).toEqual([]);
    expect(result?.page.hasNextPage).toBe(false);
  });

  it("gives an empty gallery no cover to fall back to", () => {
    expect(
      getMockGalleryCover("en", "content-awaiting-selection"),
    ).toBeUndefined();
  });

  it("publishes nothing for an unknown gallery identity", () => {
    expect(mockPage("en", "content-does-not-exist")).toBeUndefined();
  });

  it("publishes nothing for a language it was not authored in", () => {
    expect(
      mockPage("de", MOCK_FEATURED_GALLERY_ID),
    ).toBeUndefined();
  });
});

describe("continuing a gallery larger than one page", () => {
  /**
   * Every item of the archive, gathered the way a visitor reaches them: one
   * bounded page at a time, each spending the cursor the last one issued. The
   * page bound is asserted on every hop, so a fixture that quietly returned
   * everything at once could not pass by returning the right items.
   */
  function walkArchive(language = "en"): readonly CuratedGalleryResultItem[] {
    const collected: CuratedGalleryResultItem[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page = mockPage(language, LARGE_GALLERY_ID, cursor);
      expect(page).toBeDefined();
      if (page === undefined) break;

      expect(page.items.length).toBeLessThanOrEqual(page.page.size);
      collected.push(...page.items);
      pages += 1;
      // A bound on the walk itself, so a cursor that failed to advance would
      // fail this test rather than hang the suite.
      expect(pages).toBeLessThanOrEqual(100);

      if (!page.page.hasNextPage) break;
      cursor = page.page.endCursor;
    }

    return collected;
  }

  it("reaches every item without duplicates or gaps", () => {
    const items = walkArchive();
    const itemIds = items.map((item) => item.itemId);

    expect(itemIds).toHaveLength(LARGE_GALLERY_SIZE);
    expect(new Set(itemIds).size).toBe(LARGE_GALLERY_SIZE);
    // The authored manual order, start to end, across every page boundary.
    expect(itemIds).toEqual(
      Array.from(
        { length: LARGE_GALLERY_SIZE },
        (_unused, index) =>
          `large-archive-${String(index + 1).padStart(4, "0")}`,
      ),
    );
  });

  it("issues a cursor on every page but the last", () => {
    const first = mockPage("en", LARGE_GALLERY_ID);
    expect(first?.page.hasNextPage).toBe(true);
    expect(first?.items).toHaveLength(MOCK_PAGE_SIZE);

    let cursor = first?.page.endCursor as string;
    let last = first;
    while (last?.page.hasNextPage) {
      last = mockPage("en", LARGE_GALLERY_ID, cursor);
      if (last?.page.hasNextPage) cursor = last.page.endCursor;
    }

    expect(last?.page.endCursor).toBeNull();
    // 400 items over pages of 24 leaves a short final page rather than an
    // empty one, which is the boundary an off-by-one would break first.
    expect(last?.items).toHaveLength(LARGE_GALLERY_SIZE % MOCK_PAGE_SIZE);
  });

  it("orders every locale's version of the archive identically", () => {
    expect(walkArchive("fi").map((item) => item.itemId)).toEqual(
      walkArchive("en").map((item) => item.itemId),
    );
  });

  it("keeps a repeated photograph's placements distinct across pages", () => {
    // Six demo images stand in for four hundred, so the archive is also the
    // fixture that proves a page boundary carries placement identity rather
    // than media identity. Collapsing the two would restore focus to the wrong
    // trigger and misidentify the subject of a later media-level action.
    const items = walkArchive();
    const mediaIds = new Set(items.map((item) => item.mediaId));

    expect(mediaIds.size).toBeLessThan(items.length);
    expect(new Set(items.map((item) => item.itemId)).size).toBe(items.length);
  });

  it("binds a cursor to the whole route locale, not its language", () => {
    // `en-GB` and `en-US` are separate route spaces that happen to share one set
    // of English placements today. Scoping to the `en` subtag would let a slice
    // issued on one route be spent on the other, and an adapter that can answer
    // differently per locale (AB#114) would then serve the wrong items under an
    // already-indexed URL.
    const cursor = mockPage("en-GB", LARGE_GALLERY_ID)?.page.endCursor as string;

    expect(cursor).toBeTruthy();
    expectCursorError(
      () => mockPage("en-US", LARGE_GALLERY_ID, cursor),
      "wrong-scope",
    );
  });

  it("serves the same items to every route locale of one language", () => {
    // The other half: separate cursor scopes must not mean separate galleries.
    expect(
      mockPage("en-US", LARGE_GALLERY_ID)?.items.map((item) => item.itemId),
    ).toEqual(mockPage("en-GB", LARGE_GALLERY_ID)?.items.map((i) => i.itemId));
  });

  it("binds a cursor to the language it was issued in", () => {
    // The two locales hold the same placements in the same order, so spending an
    // English token against the Finnish result would look harmless — until an
    // adapter can answer differently per locale (AB#114), by which point the
    // tokens are indexed. It is also the property the continuation page's
    // metadata leans on when it names no `hreflang` alternates.
    const cursor = mockPage("en", LARGE_GALLERY_ID)?.page.endCursor as string;

    expectCursorError(
      () => mockPage("fi", LARGE_GALLERY_ID, cursor),
      "wrong-scope",
    );
  });

  it("binds a cursor to the gallery that issued it", () => {
    const cursor = mockPage("en", LARGE_GALLERY_ID)?.page
      .endCursor as string;

    // Same deployment key, different gallery: the scope digest is what refuses
    // it, so a token can never be spent in a gallery it did not come from.
    expectCursorError(
      () => mockPage("en", MOCK_FEATURED_GALLERY_ID, cursor),
      "wrong-scope",
    );
  });

  it.each([
    ["malformed", "not-a-token-this-deployment-minted"],
    ["oversized", "x".repeat(MAX_GALLERY_CURSOR_LENGTH + 1)],
  ])("refuses a cursor it never issued: %s", (_caseName, value) => {
    expectCursorError(
      () => mockPage("en", LARGE_GALLERY_ID, value),
      "malformed",
    );
  });

  it("refuses a cursor whose signature was edited", () => {
    const cursor = mockPage("en", LARGE_GALLERY_ID)?.page
      .endCursor as string;
    const replacement = cursor.endsWith("a") ? "b" : "a";

    expectCursorError(
      () =>
        mockPage(
          "en",
          LARGE_GALLERY_ID,
          `${cursor.slice(0, -1)}${replacement}`,
        ),
      "tampered",
    );
  });

  it("touches no codec for a gallery that fits inside one page", () => {
    // The laziness the deployment story rests on. `galleryCursorCodec` resolves
    // the signing key on use, so "never used" is what makes a deployment whose
    // galleries all fit inside one page able to run without the secret at all.
    // A codec that fails on contact is the only way to assert that here.
    const refusingCodec: GalleryCursorCodec = {
      encode: () => {
        throw new Error("A complete gallery must not need a cursor codec");
      },
      decode: () => {
        throw new Error("A complete gallery must not need a cursor codec");
      },
    };

    const result = getMockGalleryResult("en", MOCK_FEATURED_GALLERY_ID, {
      cursorCodec: refusingCodec,
    });

    expect(result?.page).toEqual({
      size: MOCK_PAGE_SIZE,
      hasNextPage: false,
      endCursor: null,
    });
  });
});

describe("sections", () => {
  // The large archive is the fixture that declares sections (AB#105):
  // "early" (placements 1–150) and "late" (151–300) each span more than one
  // 24-item mock page, placements 301–400 stay unsectioned, and "unused" is
  // declared with zero placements referencing it.
  const EARLY_SECTION_SLUG = "early";
  const LATE_SECTION_SLUG = "late";
  const UNUSED_SECTION_SLUG = "unused";

  function walkSection(
    sectionSlug: string,
    language = "en",
  ): readonly CuratedGalleryResultItem[] {
    const collected: CuratedGalleryResultItem[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page = getMockGalleryResult(language, LARGE_GALLERY_ID, {
        sectionSlug,
        ...(cursor === undefined ? {} : { cursor }),
        cursorCodec: testCursorCodec,
      });
      expect(page).toBeDefined();
      if (page === undefined) break;

      collected.push(...page.items);
      pages += 1;
      expect(pages).toBeLessThanOrEqual(100);

      if (!page.page.hasNextPage) break;
      cursor = page.page.endCursor;
    }

    return collected;
  }

  it("includes only a named section's own placements, in original order, across more than one page", () => {
    const itemIds = walkSection(EARLY_SECTION_SLUG).map((item) => item.itemId);

    expect(itemIds).toHaveLength(150);
    expect(itemIds).toEqual(
      Array.from(
        { length: 150 },
        (_unused, index) => `large-archive-${String(index + 1).padStart(4, "0")}`,
      ),
    );
  });

  it("excludes unsectioned items from a named section", () => {
    const lateItemIds = walkSection(LATE_SECTION_SLUG).map((item) => item.itemId);

    expect(lateItemIds).toHaveLength(150);
    expect(lateItemIds.at(-1)).toBe("large-archive-0300");
    expect(lateItemIds).not.toContain("large-archive-0301");
  });

  it("returns a successful, empty, self-identifying page for a valid section with no placements", () => {
    const page = getMockGalleryResult("en", LARGE_GALLERY_ID, {
      sectionSlug: UNUSED_SECTION_SLUG,
      cursorCodec: testCursorCodec,
    });

    expect(page?.items).toEqual([]);
    expect(page?.page.hasNextPage).toBe(false);
    expect(page?.selectedSection?.sectionId).toBe("unused");
    expect(page?.selectedSection?.intro).toBeDefined();
  });

  it("throws UnknownGallerySectionError for an unresolvable slug", () => {
    expect(() =>
      getMockGalleryResult("en", LARGE_GALLERY_ID, {
        sectionSlug: "does-not-exist",
        cursorCodec: testCursorCodec,
      }),
    ).toThrow(UnknownGallerySectionError);
  });

  it("carries the selected section's identity only on its first page, never on All", () => {
    expect(mockPage("en", LARGE_GALLERY_ID)?.selectedSection).toBeUndefined();

    const first = getMockGalleryResult("en", LARGE_GALLERY_ID, {
      sectionSlug: EARLY_SECTION_SLUG,
      cursorCodec: testCursorCodec,
    });
    expect(first?.selectedSection?.sectionId).toBe("early");
    expect(first?.page.hasNextPage).toBe(true);

    const second = getMockGalleryResult("en", LARGE_GALLERY_ID, {
      sectionSlug: EARLY_SECTION_SLUG,
      cursor: first?.page.endCursor as string,
      cursorCodec: testCursorCodec,
    });
    expect(second?.selectedSection).toBeUndefined();
  });

  it("exposes the gallery's ordered section catalog regardless of the active filter", () => {
    const expected = [
      { sectionId: "early", slug: "early", label: "Early", order: 0 },
      { sectionId: "late", slug: "late", label: "Late", order: 1 },
      { sectionId: "unused", slug: "unused", label: "Unused", order: 2 },
    ];

    expect(mockPage("en", LARGE_GALLERY_ID)?.sections).toEqual(expected);
    expect(
      getMockGalleryResult("en", LARGE_GALLERY_ID, {
        sectionSlug: LATE_SECTION_SLUG,
        cursorCodec: testCursorCodec,
      })?.sections,
    ).toEqual(expected);
  });

  it("returns an empty section catalog for a gallery with no declared sections", () => {
    expect(mockPage("en", MOCK_FEATURED_GALLERY_ID)?.sections).toEqual([]);
  });

  it("rejects a cursor minted under one section when replayed under All or a different section", () => {
    const earlyFirst = getMockGalleryResult("en", LARGE_GALLERY_ID, {
      sectionSlug: EARLY_SECTION_SLUG,
      cursorCodec: testCursorCodec,
    });
    const cursor = earlyFirst?.page.endCursor as string;
    expect(cursor).toBeTruthy();

    expectCursorError(
      () =>
        getMockGalleryResult("en", LARGE_GALLERY_ID, {
          cursor,
          cursorCodec: testCursorCodec,
        }),
      "wrong-scope",
    );
    expectCursorError(
      () =>
        getMockGalleryResult("en", LARGE_GALLERY_ID, {
          sectionSlug: LATE_SECTION_SLUG,
          cursor,
          cursorCodec: testCursorCodec,
        }),
      "wrong-scope",
    );
  });
});
