import { describe, expect, it, vi } from "vitest";

import {
  GALLERY_DOCUMENT_TYPE,
  GALLERY_PAGE_SIZE,
  GALLERY_PLACEMENT_DOCUMENT_TYPE,
  projectGalleryContentPage,
  projectGalleryPlacement,
  projectGalleryPlacementInput,
  projectGallerySectionIntro,
  projectGallerySectionSummary,
  readPublicGalleryPage,
  readSanityCuratedGalleryPage,
  SanityGalleryError,
  type RawGalleryDetailDocument,
  type RawGalleryPlacementDocument,
  type RawGalleryPlacementItem,
} from "@/lib/sanity-gallery";
import { galleryType } from "../../sanity/schemas/gallery";
import { galleryPlacementType } from "../../sanity/schemas/gallery-placement";
import {
  INTERNAL_LINK_PATH as SCHEMA_INTERNAL_LINK_PATH,
  MAX_INTRO_BLOCKS as SCHEMA_MAX_INTRO_BLOCKS,
  MAX_LIST_ITEMS as SCHEMA_MAX_LIST_ITEMS,
  MAX_SPANS_PER_BLOCK as SCHEMA_MAX_SPANS_PER_BLOCK,
  MAX_SPAN_TEXT_LENGTH as SCHEMA_MAX_SPAN_TEXT_LENGTH,
} from "../../sanity/schemas/gallery-section-intro";
import {
  INTERNAL_LINK_PATH,
  MAX_INTRO_BLOCKS,
  MAX_LIST_ITEMS,
  MAX_SPANS_PER_BLOCK,
  MAX_SPAN_TEXT_LENGTH,
} from "@/lib/gallery-sections";
import { createHmacGalleryCursorCodec } from "@/lib/gallery-pagination";
import type { CuratedGalleryResultItem } from "@/lib/gallery-result";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import type { RawPublicMediaDocument } from "@/lib/sanity-media";

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

const languages = { language: "en", fallbackLanguage: "fi", config };

const EXPORTED_ASSET = "Tb9Ew8CXIwaY6R1kjMvI0uRR";

function assetOf() {
  const path = `images/${config.projectId}/${config.dataset}/${EXPORTED_ASSET}-1600x1067.webp`;
  return {
    url: `https://cdn.sanity.io/${path}`,
    path,
    extension: "webp",
    mimeType: "image/webp",
    width: 1600,
    height: 1067,
  };
}

function mediaDocumentOf(
  overrides: Partial<RawPublicMediaDocument> = {},
): RawPublicMediaDocument {
  return {
    mediaId: "northern-coast",
    mediaType: "image",
    publiclyRenderable: true,
    alt: [{ language: "en", value: "A rocky northern coastline" }],
    asset: assetOf(),
    ...overrides,
  };
}

function rejectionOf(run: () => unknown): SanityGalleryError {
  try {
    run();
  } catch (error) {
    if (error instanceof SanityGalleryError) return error;
    throw error;
  }
  throw new Error("expected projection to throw");
}

function fakeClient(
  answers: Readonly<Record<string, unknown>>,
): { client: SanityClient; requests: SanityQueryRequest[] } {
  const requests: SanityQueryRequest[] = [];
  return {
    requests,
    client: {
      async query(request) {
        requests.push(request);
        if (request.tag === undefined || !(request.tag in answers)) {
          throw new Error(`no fixture answer for tag "${request.tag}"`);
        }
        return answers[request.tag];
      },
    },
  };
}

describe("GALLERY_DOCUMENT_TYPE", () => {
  it("matches the Studio schema's own type name", () => {
    expect(GALLERY_DOCUMENT_TYPE).toBe(galleryType.name);
  });
});

describe("restated section-intro bounds stay pinned to gallery-sections.ts", () => {
  it("matches every restated constant", () => {
    expect(SCHEMA_MAX_INTRO_BLOCKS).toBe(MAX_INTRO_BLOCKS);
    expect(SCHEMA_MAX_SPANS_PER_BLOCK).toBe(MAX_SPANS_PER_BLOCK);
    expect(SCHEMA_MAX_LIST_ITEMS).toBe(MAX_LIST_ITEMS);
    expect(SCHEMA_MAX_SPAN_TEXT_LENGTH).toBe(MAX_SPAN_TEXT_LENGTH);
    expect(SCHEMA_INTERNAL_LINK_PATH.source).toBe(INTERNAL_LINK_PATH.source);
  });
});

describe("projectGalleryPlacementInput", () => {
  it("projects the gallery variant, always published", () => {
    const document: RawGalleryPlacementDocument = {
      contentId: "content-northern-coast",
      slug: "northern-coast",
      canonicalCategoryRef: "doc-landscape",
      secondaryCategoryRefs: [],
    };
    const index = new Map([["doc-landscape", "cat-landscape"]]);

    expect(projectGalleryPlacementInput(document, index)).toEqual({
      contentId: "content-northern-coast",
      variant: "gallery",
      slug: "northern-coast",
      published: true,
      canonicalCategoryId: "cat-landscape",
    });
  });

  it("throws for a missing slug", () => {
    const error = rejectionOf(() =>
      projectGalleryPlacementInput(
        { contentId: "content-x", canonicalCategoryRef: null },
        new Map(),
      ),
    );
    expect(error.rejection).toBe("incomplete-document");
  });
});

describe("projectGalleryContentPage", () => {
  const detailOf = (overrides: Partial<RawGalleryDetailDocument> = {}): RawGalleryDetailDocument => ({
    contentId: "content-northern-coast",
    title: "Northern Coast",
    publishedAt: "2026-01-15T00:00:00Z",
    ...overrides,
  });

  it("allows an empty body, unlike an article", () => {
    const page = projectGalleryContentPage(detailOf(), languages);
    expect(page.variant).toBe("gallery");
    expect(page.body).toEqual([]);
  });

  it("projects an explicit cover when authored", () => {
    const page = projectGalleryContentPage(
      detailOf({ cover: mediaDocumentOf() }),
      languages,
    );
    expect(page.cover?.mediaId).toBe("northern-coast");
  });

  it("omits cover when none is authored — no fallback resolution here", () => {
    const page = projectGalleryContentPage(detailOf(), languages);
    expect(page.cover).toBeUndefined();
  });

  it("throws for a missing title", () => {
    const error = rejectionOf(() =>
      projectGalleryContentPage(detailOf({ title: undefined }), languages),
    );
    expect(error.rejection).toBe("incomplete-document");
  });
});

describe("readPublicGalleryPage", () => {
  it("returns undefined when this language has no published version", async () => {
    const { client } = fakeClient({ "gallery.detail": [] });
    const page = await readPublicGalleryPage("content-x", { language: "en", client, config });
    expect(page).toBeUndefined();
  });

  it("throws ambiguous-content-id when two documents claim one identity", async () => {
    const { client } = fakeClient({
      "gallery.detail": [
        { contentId: "content-x", title: "A", publishedAt: "2026-01-01T00:00:00Z" },
        { contentId: "content-x", title: "B", publishedAt: "2026-01-02T00:00:00Z" },
      ],
    });
    const error = await readPublicGalleryPage("content-x", { language: "en", client, config }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("ambiguous-content-id");
  });
});

describe("projectGallerySectionSummary", () => {
  it("projects id, slug, label, and the caller-supplied order", () => {
    expect(
      projectGallerySectionSummary(
        { sectionId: "sec-a", slug: "behind-the-scenes", label: "Behind the scenes" },
        2,
        "content-x",
      ),
    ).toEqual({ sectionId: "sec-a", slug: "behind-the-scenes", label: "Behind the scenes", order: 2 });
  });

  it("throws malformed-section when a field is missing", () => {
    const error = rejectionOf(() =>
      projectGallerySectionSummary({ sectionId: "sec-a", slug: undefined, label: "x" }, 0, "content-x"),
    );
    expect(error.rejection).toBe("malformed-section");
  });
});

describe("projectGallerySectionIntro", () => {
  it("returns an empty array for an unauthored intro", () => {
    expect(projectGallerySectionIntro(undefined)).toEqual([]);
  });

  it("projects a paragraph with emphasis and a link, preserving _key", () => {
    const blocks = projectGallerySectionIntro([
      {
        _type: "gallerySectionIntroParagraphBlock",
        _key: "k1",
        spans: [
          { text: "Shot along the " },
          { text: "northern coast", marks: ["emphasis"], href: "/stories/northern-coast" },
          { text: "." },
        ],
      },
    ]);

    expect(blocks).toEqual([
      {
        type: "paragraph",
        key: "k1",
        spans: [
          { text: "Shot along the " },
          { text: "northern coast", marks: ["emphasis"], href: "/stories/northern-coast" },
          { text: "." },
        ],
      },
    ]);
  });

  it("projects a list block with its items, preserving each item's own _key", () => {
    const blocks = projectGallerySectionIntro([
      {
        _type: "gallerySectionIntroListBlock",
        _key: "list-1",
        ordered: true,
        items: [
          { _key: "item-1", spans: [{ text: "First" }] },
          { _key: "item-2", spans: [{ text: "Second" }] },
        ],
      },
    ]);

    expect(blocks).toEqual([
      {
        type: "list",
        key: "list-1",
        ordered: true,
        items: [
          { key: "item-1", spans: [{ text: "First" }] },
          { key: "item-2", spans: [{ text: "Second" }] },
        ],
      },
    ]);
  });

  it("rejects an unknown mark", () => {
    expect(() =>
      projectGallerySectionIntro([
        {
          _type: "gallerySectionIntroParagraphBlock",
          spans: [{ text: "x", marks: ["strikethrough"] }],
        },
      ]),
    ).toThrow(SanityGalleryError);
  });

  it("rejects an unknown block type", () => {
    expect(() =>
      projectGallerySectionIntro([
        { _type: "someOtherBlock" } as never,
      ]),
    ).toThrow(SanityGalleryError);
  });
});

describe("projectGalleryPlacement", () => {
  const rawOf = (overrides: Partial<RawGalleryPlacementItem> = {}): RawGalleryPlacementItem => ({
    placementId: "northern-coast-01",
    order: 3,
    media: mediaDocumentOf(),
    visible: true,
    ...overrides,
  });

  it("projects a visible placement with order from the row itself", () => {
    const placement = projectGalleryPlacement(rawOf(), languages);
    expect(placement).toMatchObject({
      placementId: "northern-coast-01",
      order: 3,
      visible: true,
    });
    expect(placement?.media.mediaId).toBe("northern-coast");
  });

  it("passes through altOverride and captionOverride", () => {
    const placement = projectGalleryPlacement(
      rawOf({ altOverride: "Custom alt", captionOverride: "Custom caption" }),
      languages,
    );
    expect(placement?.altOverride).toBe("Custom alt");
    expect(placement?.captionOverride).toBe("Custom caption");
  });

  it("reflects the placement's own visible: false", () => {
    const placement = projectGalleryPlacement(rawOf({ visible: false }), languages);
    expect(placement?.visible).toBe(false);
  });

  it("resolves to undefined — not a thrown error — when the media is not publicly renderable (ADR-0002 §3)", () => {
    const placement = projectGalleryPlacement(
      rawOf({ media: mediaDocumentOf({ publiclyRenderable: false }) }),
      languages,
    );
    expect(placement).toBeUndefined();
  });

  it("still throws for a genuinely malformed row: no placementId", () => {
    const error = rejectionOf(() => projectGalleryPlacement(rawOf({ placementId: undefined }), languages));
    expect(error.rejection).toBe("malformed-result");
  });

  it("still throws for a genuinely malformed row: no usable order", () => {
    const error = rejectionOf(() => projectGalleryPlacement(rawOf({ order: -1 }), languages));
    expect(error.rejection).toBe("malformed-result");
  });

  it("still throws when public media fails its own content checks (e.g. no alt text)", () => {
    expect(() =>
      projectGalleryPlacement(
        rawOf({ media: mediaDocumentOf({ alt: [] }) }),
        languages,
      ),
    ).toThrow();
  });
});

describe("readSanityCuratedGalleryPage", () => {
  const CONTENT_ID = "content-large-archive";
  const TEST_SIGNING_KEY = "a".repeat(32);
  const testCursorCodec = createHmacGalleryCursorCodec(TEST_SIGNING_KEY);
  const LARGE_ARCHIVE_SIZE = 400;

  type FixturePlacement = {
    readonly placementId: string;
    readonly order: number;
    readonly sectionId?: string;
    readonly visible: boolean;
    readonly media: RawPublicMediaDocument;
  };

  function buildLargeArchive(): readonly FixturePlacement[] {
    return Array.from({ length: LARGE_ARCHIVE_SIZE }, (_unused, index) => {
      const position = index + 1;
      const sectionId = position <= 150 ? "early" : position <= 300 ? "late" : undefined;
      return {
        placementId: `large-archive-${String(position).padStart(4, "0")}`,
        order: index,
        visible: true,
        media: mediaDocumentOf({ mediaId: `media-${position}` }),
        ...(sectionId === undefined ? {} : { sectionId }),
      };
    });
  }

  /**
   * A fake Content Lake that answers exactly the two query shapes
   * `sanity-gallery.ts`'s bounded source issues — dispatched by `request.tag`
   * and computed from `request.params` — rather than a general GROQ
   * interpreter. It applies the same visible/publiclyRenderable/section
   * filter and `(order, placementId)` keyset comparison the real GROQ this
   * adapter sends is built to express, so a pagination walk through it
   * exercises the adapter's own query construction and cursor handling, not
   * a second copy of the pagination logic under test.
   */
  function fakeGalleryStore(options: {
    readonly placements: readonly FixturePlacement[];
    readonly sections?: readonly { readonly sectionId: string; readonly slug: string; readonly label: string }[];
    readonly orderingRule?: string;
    readonly contentId?: string;
  }): { readonly client: SanityClient; readonly requests: SanityQueryRequest[] } {
    const requests: SanityQueryRequest[] = [];
    const galleryContentId = options.contentId ?? CONTENT_ID;

    const toRow = (placement: FixturePlacement) => ({
      placementId: placement.placementId,
      order: placement.order,
      sectionId: placement.sectionId ?? null,
      visible: placement.visible,
      altOverride: null,
      captionOverride: null,
      media: placement.media,
    });

    const client: SanityClient = {
      async query(request) {
        requests.push(request);
        const params = (request.params ?? {}) as Record<string, unknown>;

        if (request.tag === "gallery.placements.basics") {
          if (params.contentId !== galleryContentId) {
            return { gallery: null, latestPlacementUpdatedAt: null };
          }
          return {
            gallery: {
              orderingRule: options.orderingRule ?? "manual",
              sections: (options.sections ?? []).map((section) => ({
                sectionId: section.sectionId,
                slug: section.slug,
                label: section.label,
              })),
            },
            latestPlacementUpdatedAt: "2026-01-01T00:00:00.000Z",
          };
        }

        if (request.tag === "gallery.placements.window") {
          const sectionId = params.sectionId as string | undefined;
          const candidateLimit = params.candidateLimit as number;
          const afterOrder = params.afterOrder as number | undefined;
          const afterPlacementId = params.afterPlacementId as string | undefined;

          const matching = options.placements.filter(
            (placement) =>
              placement.visible &&
              placement.media.publiclyRenderable === true &&
              (sectionId === undefined || placement.sectionId === sectionId),
          );
          const sorted = matching.toSorted(
            (a, b) => a.order - b.order || (a.placementId < b.placementId ? -1 : a.placementId > b.placementId ? 1 : 0),
          );

          if (afterPlacementId === undefined) {
            return sorted.slice(0, candidateLimit).map(toRow);
          }

          const boundary = sorted.find((placement) => placement.placementId === afterPlacementId);
          const candidates = sorted
            .filter(
              (placement) =>
                placement.order > (afterOrder as number) ||
                (placement.order === afterOrder && placement.placementId > afterPlacementId),
            )
            .slice(0, candidateLimit);

          return {
            boundary: boundary === undefined ? null : toRow(boundary),
            candidates: candidates.map(toRow),
          };
        }

        throw new Error(`no fixture behavior for tag "${request.tag}"`);
      },
    };

    return { client, requests };
  }

  async function readPage(
    client: SanityClient,
    cursor?: string,
    sectionSlug?: string,
  ) {
    return readSanityCuratedGalleryPage("en", CONTENT_ID, {
      client,
      config,
      cursorCodec: testCursorCodec,
      ...(cursor === undefined ? {} : { cursor }),
      ...(sectionSlug === undefined ? {} : { sectionSlug }),
    });
  }

  async function walkArchive(
    client: SanityClient,
    sectionSlug?: string,
  ): Promise<readonly CuratedGalleryResultItem[]> {
    const collected: CuratedGalleryResultItem[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page = await readPage(client, cursor, sectionSlug);
      expect(page).toBeDefined();
      if (page === undefined) break;

      expect(page.items.length).toBeLessThanOrEqual(page.page.size);
      collected.push(...page.items);
      pages += 1;
      expect(pages).toBeLessThanOrEqual(100);

      if (!page.page.hasNextPage) break;
      cursor = page.page.endCursor ?? undefined;
    }

    return collected;
  }

  it("returns undefined when no gallery matches this identity and language", async () => {
    const { client } = fakeGalleryStore({ placements: [] });
    const page = await readSanityCuratedGalleryPage("en", "content-does-not-exist", {
      client,
      config,
      cursorCodec: testCursorCodec,
    });
    expect(page).toBeUndefined();
  });

  it("reads gallery basics and the first placement window in exactly two round trips", async () => {
    const { client, requests } = fakeGalleryStore({ placements: buildLargeArchive() });
    await readPage(client);
    expect(requests.map((request) => request.tag)).toEqual([
      "gallery.placements.basics",
      "gallery.placements.window",
    ]);
  });

  it(`reaches every one of ${LARGE_ARCHIVE_SIZE} items without duplicates or gaps across page boundaries`, async () => {
    const { client } = fakeGalleryStore({ placements: buildLargeArchive() });
    const items = await walkArchive(client);
    const itemIds = items.map((item) => item.itemId);

    expect(itemIds).toHaveLength(LARGE_ARCHIVE_SIZE);
    expect(new Set(itemIds).size).toBe(LARGE_ARCHIVE_SIZE);
    expect(itemIds).toEqual(
      Array.from(
        { length: LARGE_ARCHIVE_SIZE },
        (_unused, index) => `large-archive-${String(index + 1).padStart(4, "0")}`,
      ),
    );
  });

  it("issues a bounded page every time, sized to GALLERY_PAGE_SIZE, with a short final page", async () => {
    const { client } = fakeGalleryStore({ placements: buildLargeArchive() });
    const first = await readPage(client);
    expect(first?.page.hasNextPage).toBe(true);
    expect(first?.items).toHaveLength(GALLERY_PAGE_SIZE);

    let cursor = first?.page.endCursor ?? undefined;
    let last = first;
    while (last?.page.hasNextPage) {
      last = await readPage(client, cursor);
      if (last?.page.hasNextPage) cursor = last.page.endCursor ?? undefined;
    }

    expect(last?.page.endCursor).toBeNull();
    expect(last?.items).toHaveLength(LARGE_ARCHIVE_SIZE % GALLERY_PAGE_SIZE);
  });

  it("continues a section spanning more than one page without loading the whole gallery", async () => {
    const sections = [
      { sectionId: "early", slug: "early", label: "Early" },
      { sectionId: "late", slug: "late", label: "Late" },
    ];
    const { client } = fakeGalleryStore({ placements: buildLargeArchive(), sections });

    const items = await walkArchive(client, "early");
    expect(items.map((item) => item.itemId)).toEqual(
      Array.from({ length: 150 }, (_unused, index) => `large-archive-${String(index + 1).padStart(4, "0")}`),
    );
  });

  it("does not require a different section's window to answer the requested one", async () => {
    const sections = [
      { sectionId: "early", slug: "early", label: "Early" },
      { sectionId: "late", slug: "late", label: "Late" },
    ];
    const { client, requests } = fakeGalleryStore({ placements: buildLargeArchive(), sections });
    await readPage(client, undefined, "early");

    const windowRequest = requests.find((request) => request.tag === "gallery.placements.window");
    expect(windowRequest?.params?.sectionId).toBe("early");
  });

  it("excludes a hidden placement and one whose media is not publicly renderable", async () => {
    const placements: readonly FixturePlacement[] = [
      { placementId: "visible-01", order: 0, visible: true, media: mediaDocumentOf({ mediaId: "m1" }) },
      { placementId: "hidden-01", order: 1, visible: false, media: mediaDocumentOf({ mediaId: "m2" }) },
      {
        placementId: "private-01",
        order: 2,
        visible: true,
        media: mediaDocumentOf({ mediaId: "m3", publiclyRenderable: false }),
      },
      { placementId: "visible-02", order: 3, visible: true, media: mediaDocumentOf({ mediaId: "m4" }) },
    ];
    const { client } = fakeGalleryStore({ placements });
    const page = await readPage(client);
    expect(page?.items.map((item) => item.itemId)).toEqual(["visible-01", "visible-02"]);
  });

  it("throws a defined, loud error for a seeded-random gallery rather than mis-paginating it", async () => {
    const { client } = fakeGalleryStore({
      placements: buildLargeArchive().slice(0, 5),
      orderingRule: "seeded-random",
    });
    const error = await readSanityCuratedGalleryPage("en", CONTENT_ID, {
      client,
      config,
      cursorCodec: testCursorCodec,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("ordering-not-implemented");
  });

  it("reads the placement projection from the same document type the schema declares", () => {
    expect(GALLERY_PLACEMENT_DOCUMENT_TYPE).toBe(galleryPlacementType.name);
  });
});
