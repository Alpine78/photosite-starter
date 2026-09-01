import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCuratedGalleryPage,
  createHmacGalleryCursorCodec,
  GalleryCursorError,
  GalleryOrderingStaleError,
  MAX_GALLERY_CURSOR_LENGTH,
  MAX_GALLERY_PAGE_SIZE,
  resolveGalleryWindowRequest,
  selectCuratedGalleryCover,
  selectGalleryWindow,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
  type GalleryCursorScope,
  type GalleryOrdering,
} from "@/lib/gallery-pagination";
import type {
  CuratedGalleryResultItem,
  GalleryCursor,
} from "@/lib/gallery-result";
import { UnknownGallerySectionError } from "@/lib/gallery-sections";
import { getGalleryPage } from "@/lib/gallery";
import type { ImageMedia, VideoMedia } from "@/lib/media";
import {
  getMockGalleryCover,
  getMockGalleryResult,
  MOCK_FEATURED_GALLERY_ID,
} from "@/lib/mock-gallery";
import { getMockImages, mockImages } from "@/lib/mock-media";

// The seam dispatch tests below mock `@/lib/deployment-config` and
// `@/lib/sanity-gallery` file-wide. Neither is imported by `mock-gallery.ts`
// (a plain in-memory fixture with no deployment dependency of its own), so
// every other describe block in this file — which reads `getMockGalleryResult`
// directly, never through the `gallery.ts` seam — is unaffected by them.
const deploymentConfig = vi.hoisted(() => ({
  contentSource: "mock" as "mock" | "sanity",
}));

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => deploymentConfig,
}));

const sanityGalleryModule = vi.hoisted(() => ({
  readSanityCuratedGalleryPage: vi.fn(),
}));

vi.mock("@/lib/sanity-gallery", () => sanityGalleryModule);

const TEST_SIGNING_KEY =
  "test-only-gallery-cursor-signing-key-0123456789";
const testCursorCodec = createHmacGalleryCursorCodec(TEST_SIGNING_KEY);
const MANUAL_ORDERING: GalleryOrdering = { kind: "manual" };

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

/**
 * Composes the same three functions a bounded source and `gallery-sections.ts`
 * compose in production — `resolveGalleryWindowRequest`, `selectGalleryWindow`,
 * `buildCuratedGalleryPage` (AB#134) — over a hand-built `sourcePlacements`
 * array standing in for "everything a fixture happens to hold." All three are
 * pure and synchronous, so this helper stays synchronous too: only a real
 * store-backed source needs to await anything.
 */
function buildPage({
  sourcePlacements = placements,
  cursor,
  cursorScope = scope,
  cursorCodec = testCursorCodec,
  ordering = { kind: "manual" } as const,
}: {
  readonly sourcePlacements?: readonly CuratedGalleryPlacement[];
  readonly cursor?: string;
  readonly cursorScope?: GalleryCursorScope;
  readonly cursorCodec?: GalleryCursorCodec;
  readonly ordering?: GalleryOrdering;
} = {}) {
  const windowRequest = resolveGalleryWindowRequest({
    scope: cursorScope,
    ordering,
    cursor,
    cursorCodec,
  });
  const windowResult = selectGalleryWindow(
    sourcePlacements,
    windowRequest,
    ordering,
  );

  return buildCuratedGalleryPage({
    windowResult,
    scope: cursorScope,
    ordering,
    windowRequest,
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

async function expectAsyncCursorError(
  operation: () => Promise<unknown>,
  code: GalleryCursorError["code"],
): Promise<void> {
  try {
    await operation();
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
 * exactly as the seam does. Async because `getMockGalleryResult` is: AB#134
 * made the whole path from here down awaitable, matching what a real
 * store-backed source needs.
 */
async function mockPage(
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

  it("selectGalleryWindow rejects a malformed order before it ever reaches the sort, even alongside well-formed placements", () => {
    // A NaN order breaks compareGalleryOrderKey's transitivity for the whole
    // array, not just the malformed entry — validating before sorting is what
    // stops that corruption, not just an eventual per-item type check.
    const windowRequest = resolveGalleryWindowRequest({ scope, ordering: MANUAL_ORDERING });

    expect(() =>
      selectGalleryWindow(
        [placement("a", 0), placement("b", Number.NaN), placement("c", 2)],
        windowRequest,
      ),
    ).toThrow("placement.order must be a non-negative safe integer");
  });

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
      // AB#60 adds these two server-only, media-owned fields. The public gallery
      // result contract carries neither, and this projection cannot start
      // leaking them into a browser payload.
      enquiryEligible: true,
      dynamicallyDiscoverable: true,
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
    // A media-level `privateOnly` here is one more server-only sentinel the
    // projector must not copy — the whole *item* being refused when the
    // *placement* is `privateOnly` is a separate guarantee, covered below.
    expect(serialized).not.toContain("privateOnly");
    expect(serialized).not.toContain("publicationState");
    expect(serialized).not.toContain("enquiryEligible");
    expect(serialized).not.toContain("dynamicallyDiscoverable");
    expect(result.items[0].media).toEqual(source);
  });

  it("refuses a privateOnly placement from the public page and still fills it", () => {
    const result = buildPage({
      sourcePlacements: [
        placement("public-a", 0, mockImages.coastalLandscape),
        { ...placement("private", 1, mockImages.mistyBirch), privateOnly: true },
        placement("public-b", 2, mockImages.lakesideReeds),
        placement("public-c", 3, mockImages.forestStream),
      ],
      cursorScope: { ...scope, pageSize: 2 },
    });

    // The private-marked placement is absent, and the page is filled from the
    // public placements after it rather than left one item short.
    expect(result.items.map((item) => item.itemId)).toEqual([
      "public-a",
      "public-b",
    ]);
    expect(result.page.hasNextPage).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private");

    const second = buildPage({
      sourcePlacements: [
        placement("public-a", 0, mockImages.coastalLandscape),
        { ...placement("private", 1, mockImages.mistyBirch), privateOnly: true },
        placement("public-b", 2, mockImages.lakesideReeds),
        placement("public-c", 3, mockImages.forestStream),
      ],
      cursorScope: { ...scope, pageSize: 2 },
      cursor: result.page.endCursor as string,
    });
    expect(second.items.map((item) => item.itemId)).toEqual(["public-c"]);
  });

  it("rejects a privateOnly placement that a source leaks into a bounded window", () => {
    const windowRequest = resolveGalleryWindowRequest({
      scope: { ...scope, pageSize: 2 },
      ordering: MANUAL_ORDERING,
      cursorCodec: testCursorCodec,
    });

    expect(() =>
      buildCuratedGalleryPage({
        windowResult: {
          candidates: [
            {
              ...placement("leaked-private", 0, mockImages.coastalLandscape),
              privateOnly: true,
            },
          ],
        },
        scope: { ...scope, pageSize: 2 },
        ordering: MANUAL_ORDERING,
        windowRequest,
        cursorCodec: testCursorCodec,
      }),
    ).toThrow("privateOnly placement in a bounded window");
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
    const windowRequest = resolveGalleryWindowRequest({ scope, ordering: MANUAL_ORDERING });

    expect(() =>
      buildCuratedGalleryPage({
        windowResult: selectGalleryWindow(placements, windowRequest),
        scope,
        windowRequest,
      }),
    ).toThrow("A gallery cursor codec is required for a paginated result");

    const singleWindowRequest = resolveGalleryWindowRequest({ scope, ordering: MANUAL_ORDERING });
    expect(() =>
      buildCuratedGalleryPage({
        windowResult: selectGalleryWindow(
          [placement("single", 0)],
          singleWindowRequest,
        ),
        scope,
        windowRequest: singleWindowRequest,
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
    payload.afterOrder = (payload.afterOrder as number) + 1;
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
        pinnedTier: 0,
        key: -1,
        placementId: "placement-b",
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
            pinnedTier: 0,
            key: 1,
            placementId: "placement-b",
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

  it("answers a successful, empty final page when only later items were removed and the boundary itself is unchanged", () => {
    // AB#134's keyset redesign narrows staleness to the boundary item itself:
    // `placement-c` (which followed the boundary) is gone here, but
    // `placement-b` (the boundary `cursor` names) is untouched — same order,
    // same id, still visible. Under the old offset design this shortened
    // array made a raw array index fall out of range and was unconditionally
    // `stale`, regardless of whether the boundary survived. Under keyset
    // pagination the boundary is found unchanged, so there is nothing to
    // reject — the correct answer is a normal, successful empty final page,
    // the standard, accepted keyset-pagination behaviour for "nothing is left
    // after where you were." (In a well-behaved real caller this exact
    // scenario should not arise on an unchanged `visibilityVersion` at all,
    // since removing a placement is itself a visibility change that should
    // bump it — this test exercises `buildCuratedGalleryPage`'s own
    // defense-in-depth independent of that caller discipline.)
    const result = buildPage({
      sourcePlacements: [
        placement("placement-a", 1),
        placement("placement-b", 1),
      ],
      cursor,
    });

    expect(result).toEqual({
      items: [],
      page: { size: 2, hasNextPage: false, endCursor: null },
    });
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
        "afterOrder",
        "afterPlacementId",
      ].sort(),
    );
    expect(JSON.stringify(payload)).not.toContain("provider-scope-sentinel");
    expect(JSON.stringify(payload)).not.toContain("archive-scope-sentinel");
    expect(Object.values(payload)).not.toContain(scope.sourceId);
    expect(Object.values(payload)).not.toContain(scope.normalizedFilter);
  });
});

describe("resolveGalleryWindowRequest", () => {
  it("returns no boundary for a cursorless request", () => {
    expect(resolveGalleryWindowRequest({ scope, ordering: MANUAL_ORDERING })).toEqual({
      candidateLimit: scope.pageSize + 1,
    });
  });

  it.each(["", "x".repeat(MAX_GALLERY_CURSOR_LENGTH + 1)])(
    "rejects a decoded afterPlacementId that is not a bounded non-empty string: %j",
    (afterPlacementId) => {
      const permissiveCodec: GalleryCursorCodec = {
        encode: testCursorCodec.encode,
        decode: () => ({ pinnedTier: 0, key: 1, placementId: afterPlacementId }),
      };

      expectCursorError(
        () =>
          resolveGalleryWindowRequest({
            scope,
            ordering: MANUAL_ORDERING,
            cursor: buildPage().page.endCursor as string,
            cursorCodec: permissiveCodec,
          }),
        "malformed",
      );
    },
  );
});

/**
 * `buildCuratedGalleryPage` never trusts a source blindly. These hand-build a
 * `GalleryWindowResult` that violates the contract `selectGalleryWindow`
 * itself always honours, so each guard is exercised the only way it can be:
 * directly, rather than through a well-behaved reference source.
 */
describe("buildCuratedGalleryPage rejects a source that violates its contract", () => {
  const windowRequest = resolveGalleryWindowRequest({ scope, ordering: MANUAL_ORDERING });

  it("rejects more candidates than the requested candidateLimit", () => {
    const overLimitCandidates = Array.from({ length: scope.pageSize + 2 }, (_unused, index) =>
      placement(`extra-${index}`, index),
    );

    expect(() =>
      buildCuratedGalleryPage({
        windowResult: { candidates: overLimitCandidates },
        scope,
        windowRequest,
        cursorCodec: testCursorCodec,
      }),
    ).toThrow(/more candidates/);
  });

  it("rejects a boundary on a request that named none", () => {
    expect(() =>
      buildCuratedGalleryPage({
        windowResult: {
          boundary: placement("unexpected-boundary", 0),
          candidates: [],
        },
        scope,
        windowRequest,
        cursorCodec: testCursorCodec,
      }),
    ).toThrow(/boundary for a request that named none/);
  });

  it("rejects a hidden placement smuggled into the window", () => {
    expect(() =>
      buildCuratedGalleryPage({
        windowResult: {
          candidates: [{ ...placement("hidden-candidate", 0), visible: false }],
        },
        scope,
        windowRequest,
        cursorCodec: testCursorCodec,
      }),
    ).toThrow(/hidden placement/);
  });

  it("rejects a candidate at or before the requested boundary", () => {
    const after = { pinnedTier: 0 as const, key: 1, placementId: "placement-b" };

    expect(() =>
      buildCuratedGalleryPage({
        windowResult: {
          boundary: placement("placement-b", 1),
          // Same order, and a placementId sorting *before* "placement-b" —
          // distinct from the boundary (so this isn't the duplicate-id case)
          // but still not strictly after `after`.
          candidates: [placement("placement-a", 1)],
        },
        scope,
        windowRequest: { candidateLimit: scope.pageSize + 1, after },
        cursorCodec: testCursorCodec,
      }),
    ).toThrow(/at or before the requested boundary/);
  });

  it("rejects a windowRequest whose candidateLimit disagrees with scope.pageSize", () => {
    expect(() =>
      buildCuratedGalleryPage({
        windowResult: { candidates: [] },
        scope,
        windowRequest: { candidateLimit: scope.pageSize + 2 },
        cursorCodec: testCursorCodec,
      }),
    ).toThrow(/candidateLimit/);
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
  it("keeps the featured gallery's authored order and captions", async () => {
    const result = await mockPage("en", MOCK_FEATURED_GALLERY_ID);

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

  it("gives every item a distinct result identity", async () => {
    const result = await mockPage("en", MOCK_FEATURED_GALLERY_ID);
    const itemIds = result?.items.map((item) => item.itemId) ?? [];

    expect(new Set(itemIds).size).toBe(itemIds.length);
  });

  it("keeps the itemId and the mediaId separate", async () => {
    const result = await mockPage("en", MOCK_FEATURED_GALLERY_ID);

    expect(
      result?.items.every((item) => item.itemId !== item.mediaId),
    ).toBe(true);
  });

  it("issues no cursor for a gallery that fits inside one page", async () => {
    expect((await mockPage("en", MOCK_FEATURED_GALLERY_ID))?.page).toEqual({
      size: MOCK_PAGE_SIZE,
      hasNextPage: false,
      endCursor: null,
    });
  });

  it("orders every locale's version of a gallery identically", async () => {
    const english = await mockPage("en", MOCK_FEATURED_GALLERY_ID);
    const finnish = await mockPage("fi", MOCK_FEATURED_GALLERY_ID);

    expect(finnish?.items.map((item) => item.itemId)).toEqual(
      english?.items.map((item) => item.itemId),
    );
  });

  it("describes a localized gallery in that language", async () => {
    const finnish = await mockPage("fi", MOCK_FEATURED_GALLERY_ID);
    const finnishImages = getMockImages("fi");

    expect(finnish?.items[0]?.media.alt).toBe(finnishImages.coastalLandscape.alt);
    expect(finnish?.items[0]?.media.caption).toBe("Hiljainen rannikko");
    // The same public bytes, under the same version: only the words are
    // translated, never the rendition.
    expect(finnish?.items[0]?.media.rendition).toEqual(
      mockImages.coastalLandscape.rendition,
    );
  });

  it("serves a published gallery that has no items yet", async () => {
    const result = await mockPage("en", "content-awaiting-selection");

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

  it("publishes nothing for an unknown gallery identity", async () => {
    expect(await mockPage("en", "content-does-not-exist")).toBeUndefined();
  });

  it("publishes nothing for a language it was not authored in", async () => {
    expect(await mockPage("de", MOCK_FEATURED_GALLERY_ID)).toBeUndefined();
  });
});

describe("continuing a gallery larger than one page", () => {
  /**
   * Every item of the archive, gathered the way a visitor reaches them: one
   * bounded page at a time, each spending the cursor the last one issued. The
   * page bound is asserted on every hop, so a fixture that quietly returned
   * everything at once could not pass by returning the right items.
   */
  async function walkArchive(
    language = "en",
  ): Promise<readonly CuratedGalleryResultItem[]> {
    const collected: CuratedGalleryResultItem[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page = await mockPage(language, LARGE_GALLERY_ID, cursor);
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

  it("reaches every item without duplicates or gaps", async () => {
    const items = await walkArchive();
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

  it("issues a cursor on every page but the last", async () => {
    const first = await mockPage("en", LARGE_GALLERY_ID);
    expect(first?.page.hasNextPage).toBe(true);
    expect(first?.items).toHaveLength(MOCK_PAGE_SIZE);

    let cursor = first?.page.endCursor as string;
    let last = first;
    while (last?.page.hasNextPage) {
      last = await mockPage("en", LARGE_GALLERY_ID, cursor);
      if (last?.page.hasNextPage) cursor = last.page.endCursor;
    }

    expect(last?.page.endCursor).toBeNull();
    // 400 items over pages of 24 leaves a short final page rather than an
    // empty one, which is the boundary an off-by-one would break first.
    expect(last?.items).toHaveLength(LARGE_GALLERY_SIZE % MOCK_PAGE_SIZE);
  });

  it("orders every locale's version of the archive identically", async () => {
    expect((await walkArchive("fi")).map((item) => item.itemId)).toEqual(
      (await walkArchive("en")).map((item) => item.itemId),
    );
  });

  it("keeps a repeated photograph's placements distinct across pages", async () => {
    // Six demo images stand in for four hundred, so the archive is also the
    // fixture that proves a page boundary carries placement identity rather
    // than media identity. Collapsing the two would restore focus to the wrong
    // trigger and misidentify the subject of a later media-level action.
    const items = await walkArchive();
    const mediaIds = new Set(items.map((item) => item.mediaId));

    expect(mediaIds.size).toBeLessThan(items.length);
    expect(new Set(items.map((item) => item.itemId)).size).toBe(items.length);
  });

  it("binds a cursor to the whole route locale, not its language", async () => {
    // `en-GB` and `en-US` are separate route spaces that happen to share one set
    // of English placements today. Scoping to the `en` subtag would let a slice
    // issued on one route be spent on the other, and an adapter that can answer
    // differently per locale (AB#114) would then serve the wrong items under an
    // already-indexed URL.
    const cursor = (await mockPage("en-GB", LARGE_GALLERY_ID))?.page
      .endCursor as string;

    expect(cursor).toBeTruthy();
    await expectAsyncCursorError(
      () => mockPage("en-US", LARGE_GALLERY_ID, cursor),
      "wrong-scope",
    );
  });

  it("serves the same items to every route locale of one language", async () => {
    // The other half: separate cursor scopes must not mean separate galleries.
    expect(
      (await mockPage("en-US", LARGE_GALLERY_ID))?.items.map(
        (item) => item.itemId,
      ),
    ).toEqual(
      (await mockPage("en-GB", LARGE_GALLERY_ID))?.items.map(
        (item) => item.itemId,
      ),
    );
  });

  it("binds a cursor to the language it was issued in", async () => {
    // The two locales hold the same placements in the same order, so spending an
    // English token against the Finnish result would look harmless — until an
    // adapter can answer differently per locale (AB#114), by which point the
    // tokens are indexed. It is also the property the continuation page's
    // metadata leans on when it names no `hreflang` alternates.
    const cursor = (await mockPage("en", LARGE_GALLERY_ID))?.page
      .endCursor as string;

    await expectAsyncCursorError(
      () => mockPage("fi", LARGE_GALLERY_ID, cursor),
      "wrong-scope",
    );
  });

  it("binds a cursor to the gallery that issued it", async () => {
    const cursor = (await mockPage("en", LARGE_GALLERY_ID))?.page
      .endCursor as string;

    // Same deployment key, different gallery: the scope digest is what refuses
    // it, so a token can never be spent in a gallery it did not come from.
    await expectAsyncCursorError(
      () => mockPage("en", MOCK_FEATURED_GALLERY_ID, cursor),
      "wrong-scope",
    );
  });

  it.each([
    ["malformed", "not-a-token-this-deployment-minted"],
    ["oversized", "x".repeat(MAX_GALLERY_CURSOR_LENGTH + 1)],
  ])("refuses a cursor it never issued: %s", async (_caseName, value) => {
    await expectAsyncCursorError(
      () => mockPage("en", LARGE_GALLERY_ID, value),
      "malformed",
    );
  });

  it("refuses a cursor whose signature was edited", async () => {
    const cursor = (await mockPage("en", LARGE_GALLERY_ID))?.page
      .endCursor as string;
    const replacement = cursor.endsWith("a") ? "b" : "a";

    await expectAsyncCursorError(
      () =>
        mockPage(
          "en",
          LARGE_GALLERY_ID,
          `${cursor.slice(0, -1)}${replacement}`,
        ),
      "tampered",
    );
  });

  it("touches no codec for a gallery that fits inside one page", async () => {
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

    const result = await getMockGalleryResult("en", MOCK_FEATURED_GALLERY_ID, {
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

  async function walkSection(
    sectionSlug: string,
    language = "en",
  ): Promise<readonly CuratedGalleryResultItem[]> {
    const collected: CuratedGalleryResultItem[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page = await getMockGalleryResult(language, LARGE_GALLERY_ID, {
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

  it("includes only a named section's own placements, in original order, across more than one page", async () => {
    const itemIds = (await walkSection(EARLY_SECTION_SLUG)).map(
      (item) => item.itemId,
    );

    expect(itemIds).toHaveLength(150);
    expect(itemIds).toEqual(
      Array.from(
        { length: 150 },
        (_unused, index) => `large-archive-${String(index + 1).padStart(4, "0")}`,
      ),
    );
  });

  it("excludes unsectioned items from a named section", async () => {
    const lateItemIds = (await walkSection(LATE_SECTION_SLUG)).map(
      (item) => item.itemId,
    );

    expect(lateItemIds).toHaveLength(150);
    expect(lateItemIds.at(-1)).toBe("large-archive-0300");
    expect(lateItemIds).not.toContain("large-archive-0301");
  });

  it("returns a successful, empty, self-identifying page for a valid section with no placements", async () => {
    const page = await getMockGalleryResult("en", LARGE_GALLERY_ID, {
      sectionSlug: UNUSED_SECTION_SLUG,
      cursorCodec: testCursorCodec,
    });

    expect(page?.items).toEqual([]);
    expect(page?.page.hasNextPage).toBe(false);
    expect(page?.selectedSection?.sectionId).toBe("unused");
    expect(page?.selectedSection?.intro).toBeDefined();
  });

  it("throws UnknownGallerySectionError for an unresolvable slug", async () => {
    await expect(
      getMockGalleryResult("en", LARGE_GALLERY_ID, {
        sectionSlug: "does-not-exist",
        cursorCodec: testCursorCodec,
      }),
    ).rejects.toThrow(UnknownGallerySectionError);
  });

  it("carries the selected section's identity only on its first page, never on All", async () => {
    expect((await mockPage("en", LARGE_GALLERY_ID))?.selectedSection).toBeUndefined();

    const first = await getMockGalleryResult("en", LARGE_GALLERY_ID, {
      sectionSlug: EARLY_SECTION_SLUG,
      cursorCodec: testCursorCodec,
    });
    expect(first?.selectedSection?.sectionId).toBe("early");
    expect(first?.page.hasNextPage).toBe(true);

    const second = await getMockGalleryResult("en", LARGE_GALLERY_ID, {
      sectionSlug: EARLY_SECTION_SLUG,
      cursor: first?.page.endCursor as string,
      cursorCodec: testCursorCodec,
    });
    expect(second?.selectedSection).toBeUndefined();
  });

  it("exposes the gallery's ordered section catalog regardless of the active filter", async () => {
    const expected = [
      { sectionId: "early", slug: "early", label: "Early", order: 0 },
      { sectionId: "late", slug: "late", label: "Late", order: 1 },
      { sectionId: "unused", slug: "unused", label: "Unused", order: 2 },
    ];

    expect((await mockPage("en", LARGE_GALLERY_ID))?.sections).toEqual(expected);
    expect(
      (
        await getMockGalleryResult("en", LARGE_GALLERY_ID, {
          sectionSlug: LATE_SECTION_SLUG,
          cursorCodec: testCursorCodec,
        })
      )?.sections,
    ).toEqual(expected);
  });

  it("returns an empty section catalog for a gallery with no declared sections", async () => {
    expect((await mockPage("en", MOCK_FEATURED_GALLERY_ID))?.sections).toEqual([]);
  });

  it("rejects a cursor minted under one section when replayed under All or a different section", async () => {
    const earlyFirst = await getMockGalleryResult("en", LARGE_GALLERY_ID, {
      sectionSlug: EARLY_SECTION_SLUG,
      cursorCodec: testCursorCodec,
    });
    const cursor = earlyFirst?.page.endCursor as string;
    expect(cursor).toBeTruthy();

    await expectAsyncCursorError(
      () =>
        getMockGalleryResult("en", LARGE_GALLERY_ID, {
          cursor,
          cursorCodec: testCursorCodec,
        }),
      "wrong-scope",
    );
    await expectAsyncCursorError(
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

describe("getGalleryPage seam dispatch", () => {
  beforeEach(() => {
    deploymentConfig.contentSource = "mock";
    sanityGalleryModule.readSanityCuratedGalleryPage.mockReset();
  });

  it("reads the mock fixture when contentSource is mock", async () => {
    const page = await getGalleryPage("en", MOCK_FEATURED_GALLERY_ID);

    expect(page?.items.length).toBeGreaterThan(0);
    expect(sanityGalleryModule.readSanityCuratedGalleryPage).not.toHaveBeenCalled();
  });

  it("mirrors the mock call shape into readSanityCuratedGalleryPage when contentSource is sanity", async () => {
    deploymentConfig.contentSource = "sanity";
    const fixture = {
      items: [],
      page: { size: 24, hasNextPage: false, endCursor: null },
    };
    sanityGalleryModule.readSanityCuratedGalleryPage.mockResolvedValue(fixture);
    const page = await getGalleryPage(
      "en",
      "content-selected-work",
      "a-cursor",
      "a-section",
    );

    expect(page).toEqual(fixture);
    expect(sanityGalleryModule.readSanityCuratedGalleryPage).toHaveBeenCalledWith(
      "en",
      "content-selected-work",
      expect.objectContaining({
        cursor: "a-cursor",
        sectionSlug: "a-section",
      }),
    );
  });

  it("propagates a classified Sanity failure rather than falling back to the fixture", async () => {
    deploymentConfig.contentSource = "sanity";
    sanityGalleryModule.readSanityCuratedGalleryPage.mockRejectedValue(
      new Error("classified sanity failure"),
    );
    await expect(
      getGalleryPage("en", "content-selected-work"),
    ).rejects.toThrow("classified sanity failure");
  });

  it("re-raises the adapter's ordering-stale as the provider-neutral GalleryOrderingStaleError (AB#129)", async () => {
    deploymentConfig.contentSource = "sanity";
    // Shaped like `SanityGalleryError` without importing the Sanity module.
    const sanityStale = Object.assign(new Error("[sanity-gallery] ..."), {
      name: "SanityGalleryError",
      rejection: "ordering-stale" as const,
    });
    sanityGalleryModule.readSanityCuratedGalleryPage.mockRejectedValue(sanityStale);

    const error = await getGalleryPage("en", "content-shuffled").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GalleryOrderingStaleError);
    expect((error as GalleryOrderingStaleError).contentId).toBe("content-shuffled");
  });

  it("does not convert any other classified Sanity rejection into GalleryOrderingStaleError", async () => {
    deploymentConfig.contentSource = "sanity";
    const other = Object.assign(new Error("[sanity-gallery] malformed"), {
      name: "SanityGalleryError",
      rejection: "malformed-result" as const,
    });
    sanityGalleryModule.readSanityCuratedGalleryPage.mockRejectedValue(other);
    await expect(getGalleryPage("en", "content-shuffled")).rejects.toBe(other);
  });
});
