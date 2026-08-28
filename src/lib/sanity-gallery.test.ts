import { describe, expect, it, vi } from "vitest";

import {
  GALLERY_DOCUMENT_TYPE,
  GALLERY_PAGE_SIZE,
  GALLERY_PLACEMENT_DOCUMENT_TYPE,
  projectGalleryContentPage,
  projectGalleryListingRecord,
  projectGalleryPlacement,
  projectGalleryPlacementInput,
  projectGallerySectionIntro,
  projectGallerySectionSummary,
  readPublicGalleryListingRecords,
  readPublicGalleryListingRecordsInCategories,
  readPublicGalleryPage,
  readSanityCuratedGalleryPage,
  SanityGalleryError,
  type RawGalleryDetailDocument,
  type RawGalleryListingDocument,
  type RawGalleryPlacementDocument,
  type RawGalleryPlacementItem,
} from "@/lib/sanity-gallery";
import { MAX_CONTENT_IDS_BYTES } from "@/lib/sanity-values";
import {
  galleryType,
  ORDERING_RULES,
  MAX_GALLERY_SECTIONS as SCHEMA_MAX_GALLERY_SECTIONS,
  MAX_ORDERING_SEED_LENGTH as SCHEMA_MAX_ORDERING_SEED_LENGTH,
  MAX_SECTION_ID_LENGTH as SCHEMA_MAX_SECTION_ID_LENGTH,
  MAX_SECTION_LABEL_LENGTH as SCHEMA_MAX_SECTION_LABEL_LENGTH,
  MAX_SECTION_SLUG_LENGTH as SCHEMA_MAX_SECTION_SLUG_LENGTH,
} from "../../sanity/schemas/gallery";
import {
  galleryPlacementType,
  MAX_PLACEMENT_ID_LENGTH as SCHEMA_MAX_PLACEMENT_ID_LENGTH,
} from "../../sanity/schemas/gallery-placement";
import {
  INTERNAL_LINK_PATH as SCHEMA_INTERNAL_LINK_PATH,
  MAX_INTRO_BLOCKS as SCHEMA_MAX_INTRO_BLOCKS,
  MAX_LIST_ITEMS as SCHEMA_MAX_LIST_ITEMS,
  MAX_SPANS_PER_BLOCK as SCHEMA_MAX_SPANS_PER_BLOCK,
  MAX_SPAN_TEXT_LENGTH as SCHEMA_MAX_SPAN_TEXT_LENGTH,
} from "../../sanity/schemas/gallery-section-intro";
import {
  INTERNAL_LINK_PATH,
  MAX_GALLERY_SECTIONS,
  MAX_INTRO_BLOCKS,
  MAX_LIST_ITEMS,
  MAX_SECTION_ID_LENGTH,
  MAX_SPANS_PER_BLOCK,
  MAX_SPAN_TEXT_LENGTH,
  UnknownGallerySectionError,
} from "@/lib/gallery-sections";
import {
  createHmacGalleryCursorCodec,
  GalleryCursorError,
  MAX_GALLERY_ORDERING_SEED_LENGTH,
  MAX_ITEM_ID_LENGTH,
  MAX_SCOPE_FIELD_LENGTH,
} from "@/lib/gallery-pagination";
import { computeShuffledOrder } from "@/lib/gallery-shuffle";
import type { CuratedGalleryResultItem } from "@/lib/gallery-result";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import type { RawPublicMediaDocument } from "@/lib/sanity-media";
import type {
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "../../sanity/schemas/schema-types";

/**
 * Runs `gallery.ts`'s own `orderingRule` custom validator against one value,
 * with a bare-bones rule stub — mirrors the `inspect()` harness `gallery.test.ts`
 * uses for the same field, kept minimal here since this file only needs the
 * one `custom()` check, to cross-check the Studio guard against the runtime
 * refusal below (see "ties Studio's seeded-random block to the runtime
 * refusal").
 */
async function runOrderingRuleValidation(value: string): Promise<SchemaValidationResult> {
  const field = galleryType.fields.find((candidate) => candidate.name === "orderingRule");
  if (field === undefined) throw new Error("gallery.ts has no orderingRule field");
  let check:
    | ((
        candidate: unknown,
        context: SchemaValidationContext,
      ) => SchemaValidationResult | Promise<SchemaValidationResult>)
    | undefined;
  const rule: SchemaValidationRule = {
    required: () => rule,
    min: () => rule,
    max: () => rule,
    custom: (fn) => {
      check = fn as typeof check;
      return rule;
    },
    warning: () => rule,
  };
  field.validation?.(rule);
  if (check === undefined) throw new Error("orderingRule declares no custom validator");
  return check(value, {
    getClient: () => {
      throw new Error("orderingRule's validator should not need a client");
    },
  });
}

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

describe("gallery-placement.ts's restated placementId length bound", () => {
  it("matches gallery-pagination.ts's MAX_ITEM_ID_LENGTH", () => {
    expect(SCHEMA_MAX_PLACEMENT_ID_LENGTH).toBe(MAX_ITEM_ID_LENGTH);
  });
});

describe("gallery.ts's restated section catalog bounds", () => {
  it("matches every bound assertGallerySections enforces at the read boundary", () => {
    expect(SCHEMA_MAX_GALLERY_SECTIONS).toBe(MAX_GALLERY_SECTIONS);
    expect(SCHEMA_MAX_SECTION_ID_LENGTH).toBe(MAX_SECTION_ID_LENGTH);
    expect(SCHEMA_MAX_SECTION_SLUG_LENGTH).toBe(MAX_ITEM_ID_LENGTH);
    expect(SCHEMA_MAX_SECTION_LABEL_LENGTH).toBe(MAX_SCOPE_FIELD_LENGTH);
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
    readonly pinned?: boolean;
    readonly shuffledOrder?: string;
    readonly shuffledOrderSeed?: string;
  };

  const SEEDED_SEED = "test-shuffle-seed-2026";

  /**
   * A seeded-random fixture gallery: `pinnedCount` pinned leads (order 0..n),
   * then `shuffledCount` non-pinned placements each carrying a real
   * `computeShuffledOrder(seed, placementId)` key. Small `order`s on the
   * shuffled rows are inert — the shuffle decides their sequence.
   */
  function buildSeededGallery(options: {
    readonly pinnedCount: number;
    readonly shuffledCount: number;
    readonly seed?: string;
  }): readonly FixturePlacement[] {
    const seed = options.seed ?? SEEDED_SEED;
    const pinned = Array.from({ length: options.pinnedCount }, (_u, i) => ({
      placementId: `shuffled-pin-${String(i + 1).padStart(3, "0")}`,
      order: i,
      visible: true,
      media: mediaDocumentOf({ mediaId: `media-pin-${i + 1}` }),
      pinned: true,
    }));
    const shuffled = Array.from({ length: options.shuffledCount }, (_u, i) => {
      const placementId = `shuffled-item-${String(i + 1).padStart(3, "0")}`;
      return {
        placementId,
        order: options.pinnedCount + i,
        visible: true,
        media: mediaDocumentOf({ mediaId: `media-item-${i + 1}` }),
        pinned: false,
        shuffledOrder: computeShuffledOrder(seed, placementId),
        shuffledOrderSeed: seed,
      };
    });
    return [...pinned, ...shuffled];
  }

  /** The tiered order a seeded fixture should walk in (ADR-0009 §3). */
  function expectedSeededSequence(
    placements: readonly FixturePlacement[],
  ): readonly string[] {
    const cmpId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const pinned = placements
      .filter((p) => p.pinned === true && p.visible)
      .toSorted((a, b) => a.order - b.order || cmpId(a.placementId, b.placementId));
    const rest = placements
      .filter((p) => p.pinned !== true && p.visible)
      .toSorted(
        (a, b) =>
          cmpId(a.shuffledOrder ?? "", b.shuffledOrder ?? "") ||
          cmpId(a.placementId, b.placementId),
      );
    return [...pinned, ...rest].map((p) => p.placementId);
  }

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
    readonly orderingSeed?: string;
    readonly contentId?: string;
    /** Overrides the computed `staleShuffledOrderCount` (for the ordering-stale path). */
    readonly staleShuffledOrderCount?: number;
  }): { readonly client: SanityClient; readonly requests: SanityQueryRequest[] } {
    const requests: SanityQueryRequest[] = [];
    const galleryContentId = options.contentId ?? CONTENT_ID;
    const galleryDocumentId = `gallery-doc-${galleryContentId}`;
    const seed = options.orderingSeed;

    const toRow = (placement: FixturePlacement) => ({
      placementId: placement.placementId,
      order: placement.order,
      sectionId: placement.sectionId ?? null,
      visible: placement.visible,
      altOverride: null,
      captionOverride: null,
      pinned: placement.pinned === true,
      shuffledOrder: placement.shuffledOrder ?? null,
      shuffledOrderSeed: placement.shuffledOrderSeed ?? null,
      media: placement.media,
    });

    // Only meaningful for a seeded gallery — the adapter reads it only when
    // `ordering.kind === "seeded-random"`.
    const computedStaleCount =
      seed === undefined
        ? 0
        : options.placements.filter(
            (p) =>
              p.pinned !== true &&
              (p.shuffledOrder === undefined || p.shuffledOrderSeed !== seed),
          ).length;

    const cmpId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

    const client: SanityClient = {
      async query(request) {
        requests.push(request);
        const params = (request.params ?? {}) as Record<string, unknown>;

        if (request.tag === "gallery.placements.basics") {
          if (params.contentId !== galleryContentId) {
            return [];
          }
          return [
            {
              _id: galleryDocumentId,
              orderingRule: options.orderingRule ?? "manual",
              ...(seed === undefined ? {} : { orderingSeed: seed }),
              sections: (options.sections ?? []).map((section) => ({
                sectionId: section.sectionId,
                slug: section.slug,
                label: section.label,
              })),
              latestPlacementUpdatedAt: "2026-01-01T00:00:00.000Z",
              staleShuffledOrderCount:
                options.staleShuffledOrderCount ?? computedStaleCount,
            },
          ];
        }

        if (request.tag === "gallery.placements.window") {
          const sectionId = params.sectionId as string | undefined;
          const candidateLimit = params.candidateLimit as number;
          const afterOrder = params.afterOrder as number | undefined;
          const afterShuffledOrder = params.afterShuffledOrder as string | undefined;
          const afterPlacementId = params.afterPlacementId as string | undefined;

          const matching =
            params.galleryDocumentId !== galleryDocumentId
              ? []
              : options.placements.filter(
                  (placement) =>
                    placement.visible &&
                    placement.media.publiclyRenderable === true &&
                    (sectionId === undefined || placement.sectionId === sectionId),
                );

          // --- seeded-random: two-lane query shape ({boundary, pinnedLane, shuffledLane}) ---
          if (options.orderingRule === "seeded-random") {
            const pinnedSorted = matching
              .filter((p) => p.pinned === true)
              .toSorted((a, b) => a.order - b.order || cmpId(a.placementId, b.placementId));
            const shuffledSorted = matching
              .filter((p) => p.pinned !== true)
              .toSorted(
                (a, b) =>
                  cmpId(a.shuffledOrder ?? "", b.shuffledOrder ?? "") ||
                  cmpId(a.placementId, b.placementId),
              );

            const boundary =
              afterPlacementId === undefined
                ? null
                : (matching.find((p) => p.placementId === afterPlacementId) ?? null);

            let pinnedLane: readonly FixturePlacement[];
            let shuffledLane: readonly FixturePlacement[];
            if (afterPlacementId === undefined) {
              pinnedLane = pinnedSorted;
              shuffledLane = shuffledSorted;
            } else if (afterShuffledOrder !== undefined) {
              // tier 1 boundary: no pinned rows after, only shuffled strictly after
              pinnedLane = [];
              shuffledLane = shuffledSorted.filter(
                (p) =>
                  (p.shuffledOrder ?? "") > afterShuffledOrder ||
                  ((p.shuffledOrder ?? "") === afterShuffledOrder &&
                    p.placementId > afterPlacementId),
              );
            } else {
              // tier 0 boundary: pinned strictly after, plus every shuffled row
              pinnedLane = pinnedSorted.filter(
                (p) =>
                  p.order > (afterOrder as number) ||
                  (p.order === afterOrder && p.placementId > afterPlacementId),
              );
              shuffledLane = shuffledSorted;
            }

            return {
              boundary: boundary === null ? null : toRow(boundary),
              pinnedLane: pinnedLane.slice(0, candidateLimit).map(toRow),
              shuffledLane: shuffledLane.slice(0, candidateLimit).map(toRow),
            };
          }

          // --- manual: unchanged single-lane query ---
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

  it("both manual and seeded-random are accepted rules the Studio no longer blocks (AB#129 PR2)", async () => {
    for (const rule of ORDERING_RULES) {
      expect(await runOrderingRuleValidation(rule)).toBe(true);
    }
  });

  it("rejects a seeded-random gallery with no usable orderingSeed as a content defect", async () => {
    const { client } = fakeGalleryStore({
      placements: buildSeededGallery({ pinnedCount: 1, shuffledCount: 2 }),
      orderingRule: "seeded-random",
      // no orderingSeed
    });
    const error = await readSanityCuratedGalleryPage("en", CONTENT_ID, {
      client,
      config,
      cursorCodec: testCursorCodec,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("malformed-result");
  });

  it("rejects a seeded-random gallery whose orderingSeed has surrounding whitespace (used verbatim everywhere)", async () => {
    const { client } = fakeGalleryStore({
      placements: buildSeededGallery({ pinnedCount: 1, shuffledCount: 2, seed: " padded " }),
      orderingRule: "seeded-random",
      orderingSeed: " padded ",
    });
    const error = await readSanityCuratedGalleryPage("en", CONTENT_ID, {
      client,
      config,
      cursorCodec: testCursorCodec,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("malformed-result");
  });

  it("reads the placement projection from the same document type the schema declares", () => {
    expect(GALLERY_PLACEMENT_DOCUMENT_TYPE).toBe(galleryPlacementType.name);
  });

  it("filters the placement window by direct gallery document reference, not a contentId/language join", async () => {
    const { client, requests } = fakeGalleryStore({ placements: buildLargeArchive() });
    await readPage(client);

    const windowRequest = requests.find((request) => request.tag === "gallery.placements.window");
    expect(windowRequest?.params?.galleryDocumentId).toBe(`gallery-doc-${CONTENT_ID}`);
    expect(windowRequest?.params).not.toHaveProperty("contentId");
    expect(windowRequest?.params).not.toHaveProperty("language");
  });

  it("rejects a section catalog Studio's own guard would have blocked, e.g. an API write with a duplicate section id", async () => {
    const sections = [
      { sectionId: "dup", slug: "dup-a", label: "A" },
      { sectionId: "dup", slug: "dup-b", label: "B" },
    ];
    const { client } = fakeGalleryStore({ placements: buildLargeArchive().slice(0, 5), sections });
    const error = await readSanityCuratedGalleryPage("en", CONTENT_ID, {
      client,
      config,
      cursorCodec: testCursorCodec,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("malformed-section");
  });

  it("throws ambiguous-content-id when two gallery documents claim one identity in this language", async () => {
    const client: SanityClient = {
      async query(request) {
        if (request.tag === "gallery.placements.basics") {
          return [
            { _id: "gallery-doc-a", orderingRule: "manual", sections: [], latestPlacementUpdatedAt: null },
            { _id: "gallery-doc-b", orderingRule: "manual", sections: [], latestPlacementUpdatedAt: null },
          ];
        }
        throw new Error(`no fixture behavior for tag "${request.tag}"`);
      },
    };
    const error = await readSanityCuratedGalleryPage("en", CONTENT_ID, {
      client,
      config,
      cursorCodec: testCursorCodec,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("ambiguous-content-id");
  });

  // --- Seeded-random ordering (AB#129 PR2, ADR-0009) ---

  const readSeededPage = (
    client: SanityClient,
    cursor?: string,
  ) =>
    readSanityCuratedGalleryPage("en", CONTENT_ID, {
      client,
      config,
      cursorCodec: testCursorCodec,
      ...(cursor === undefined ? {} : { cursor }),
    });

  async function walkSeeded(client: SanityClient): Promise<readonly string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard += 1) {
      const page = await readSeededPage(client, cursor);
      expect(page).toBeDefined();
      if (page === undefined) break;
      expect(page.items.length).toBeLessThanOrEqual(page.page.size);
      ids.push(...page.items.map((item) => item.itemId));
      if (!page.page.hasNextPage) break;
      cursor = page.page.endCursor ?? undefined;
    }
    return ids;
  }

  it("walks a seeded gallery in the tiered order (pinned by manual order, then by shuffledOrder) with every placement exactly once", async () => {
    const placements = buildSeededGallery({ pinnedCount: 3, shuffledCount: 60 });
    const { client } = fakeGalleryStore({
      placements,
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
    });
    const walked = await walkSeeded(client);
    expect(walked).toEqual(expectedSeededSequence(placements));
    expect(new Set(walked).size).toBe(placements.length);
    expect(walked.slice(0, 3)).toEqual([
      "shuffled-pin-001",
      "shuffled-pin-002",
      "shuffled-pin-003",
    ]);
  });

  it("exercises a pinned-tier continuation boundary (more pinned leads than one page)", async () => {
    // GALLERY_PAGE_SIZE pinned + a few, so page 1's endCursor names a pinned
    // boundary and page 2's query uses the `after.pinnedTier === 0` branch.
    const placements = buildSeededGallery({
      pinnedCount: GALLERY_PAGE_SIZE + 5,
      shuffledCount: 10,
    });
    const { client, requests } = fakeGalleryStore({
      placements,
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
    });
    const walked = await walkSeeded(client);
    expect(walked).toEqual(expectedSeededSequence(placements));

    // The second window request carried a numeric (pinned-tier) boundary.
    const windowRequests = requests.filter((r) => r.tag === "gallery.placements.window");
    expect(windowRequests.length).toBeGreaterThanOrEqual(2);
    expect(typeof windowRequests[1]?.params?.afterOrder).toBe("number");
    expect(windowRequests[1]?.params).not.toHaveProperty("afterShuffledOrder");
  });

  it("continues from a shuffled-tier boundary using the shuffledOrder keyset", async () => {
    const placements = buildSeededGallery({ pinnedCount: 2, shuffledCount: 40 });
    const { client, requests } = fakeGalleryStore({
      placements,
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
    });
    await walkSeeded(client);
    const windowRequests = requests.filter((r) => r.tag === "gallery.placements.window");
    // The second page's boundary is a shuffled item (only 2 pinned, page size 24).
    expect(typeof windowRequests[1]?.params?.afterShuffledOrder).toBe("string");
  });

  it("passes the seed into the window request as $orderingScope so the fetch cache key varies by seed", async () => {
    const { client, requests } = fakeGalleryStore({
      placements: buildSeededGallery({ pinnedCount: 1, shuffledCount: 3 }),
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
    });
    await readSeededPage(client);
    const windowRequest = requests.find((r) => r.tag === "gallery.placements.window");
    expect(windowRequest?.params?.orderingScope).toBe(`seeded-random-v1:${SEEDED_SEED}`);
    expect(windowRequest?.query).toContain("$orderingScope == $orderingScope");
  });

  it("does not add $orderingScope for a manual gallery", async () => {
    const { client, requests } = fakeGalleryStore({ placements: buildLargeArchive() });
    await readPage(client);
    const windowRequest = requests.find((r) => r.tag === "gallery.placements.window");
    expect(windowRequest?.params).not.toHaveProperty("orderingScope");
  });

  it("serves ordering-stale when the basics count reports placements on a wrong/absent seed", async () => {
    const { client } = fakeGalleryStore({
      placements: buildSeededGallery({ pinnedCount: 1, shuffledCount: 3 }),
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
      staleShuffledOrderCount: 2,
    });
    const error = await readSeededPage(client).catch((c: unknown) => c);
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("ordering-stale");
  });

  it("still 404s a malformed cursor during a rotation window, rather than returning the reordering page", async () => {
    const { client } = fakeGalleryStore({
      placements: buildSeededGallery({ pinnedCount: 1, shuffledCount: 3 }),
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
      staleShuffledOrderCount: 5,
    });
    const error = await readSeededPage(client, "not-a-real-cursor").catch((c: unknown) => c);
    // The cursor is validated before the ordering-stale short-circuit.
    expect(error).toBeInstanceOf(GalleryCursorError);
  });

  it("still 404s an unknown section during a rotation window", async () => {
    const { client } = fakeGalleryStore({
      placements: buildSeededGallery({ pinnedCount: 1, shuffledCount: 3 }),
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
      sections: [{ sectionId: "real", slug: "real", label: "Real" }],
      staleShuffledOrderCount: 5,
    });
    const error = await readSanityCuratedGalleryPage("en", CONTENT_ID, {
      client,
      config,
      cursorCodec: testCursorCodec,
      sectionSlug: "does-not-exist",
    }).catch((c: unknown) => c);
    expect(error).toBeInstanceOf(UnknownGallerySectionError);
  });

  it("holds no sticky state — recovers on the next read once the stale count is zero", async () => {
    // First: a store that reports a non-zero stale count -> throws.
    const stale = fakeGalleryStore({
      placements: buildSeededGallery({ pinnedCount: 1, shuffledCount: 3 }),
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
      staleShuffledOrderCount: 1,
    });
    await expect(readSeededPage(stale.client)).rejects.toMatchObject({
      rejection: "ordering-stale",
    });

    // Then: a fresh store (post-recompute, count now zero) -> serves normally.
    // The adapter kept no flag from the failed read; recovery is purely a
    // function of the basics aggregate, not any command signal.
    const recovered = fakeGalleryStore({
      placements: buildSeededGallery({ pinnedCount: 1, shuffledCount: 3 }),
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
      staleShuffledOrderCount: 0,
    });
    const page = await readSeededPage(recovered.client);
    expect(page?.items.map((i) => i.itemId)[0]).toBe("shuffled-pin-001");
  });

  it("raises ordering-stale (defense in depth) if a returned row's shuffledOrderSeed is wrong despite a clean count", async () => {
    const placements = buildSeededGallery({ pinnedCount: 1, shuffledCount: 3 }).map(
      (p, i) =>
        i === 2 ? { ...p, shuffledOrderSeed: "some-other-seed" } : p,
    );
    const { client } = fakeGalleryStore({
      placements,
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
      staleShuffledOrderCount: 0, // aggregate lies / lags; per-row check still catches it
    });
    const error = await readSeededPage(client).catch((c: unknown) => c);
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("ordering-stale");
  });

  it("raises ordering-stale for a whitespace-padded shuffledOrder rather than trimming it to a boundary the store would not agree with", async () => {
    const clean = buildSeededGallery({ pinnedCount: 1, shuffledCount: 3 });
    const padded = clean.map((p, i) =>
      i === 2 && p.shuffledOrder !== undefined
        ? { ...p, shuffledOrder: ` ${p.shuffledOrder} ` }
        : p,
    );
    const { client } = fakeGalleryStore({
      placements: padded,
      orderingRule: "seeded-random",
      orderingSeed: SEEDED_SEED,
      staleShuffledOrderCount: 0,
    });
    const error = await readSeededPage(client).catch((c: unknown) => c);
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("ordering-stale");
  });

  it("produces a different walk order for a different seed", async () => {
    const a = buildSeededGallery({ pinnedCount: 2, shuffledCount: 30, seed: "seed-a" });
    const b = buildSeededGallery({ pinnedCount: 2, shuffledCount: 30, seed: "seed-b" });
    const walkA = await walkSeeded(
      fakeGalleryStore({ placements: a, orderingRule: "seeded-random", orderingSeed: "seed-a" }).client,
    );
    const walkB = await walkSeeded(
      fakeGalleryStore({ placements: b, orderingRule: "seeded-random", orderingSeed: "seed-b" }).client,
    );
    expect([...walkA].sort()).toEqual([...walkB].sort());
    expect(walkA).not.toEqual(walkB);
  });

  it("pins the schema's restated ordering-seed length ceiling to the runtime constant", () => {
    expect(SCHEMA_MAX_ORDERING_SEED_LENGTH).toBe(MAX_GALLERY_ORDERING_SEED_LENGTH);
  });
});

describe("projectGalleryListingRecord", () => {
  it("projects the fields a listing card reads", () => {
    const document: RawGalleryListingDocument = {
      contentId: "content-coastal-mornings",
      title: "Coastal mornings",
      summary: "First light along the shoreline.",
      publishedAt: "2024-06-18",
      cover: mediaDocumentOf(),
    };

    expect(projectGalleryListingRecord(document, languages)).toMatchObject({
      contentId: "content-coastal-mornings",
      title: "Coastal mornings",
      summary: "First light along the shoreline.",
      publishedAt: "2024-06-18",
    });
  });

  it("omits summary and cover when the gallery has none", () => {
    const document: RawGalleryListingDocument = {
      contentId: "content-awaiting-selection",
      title: "Awaiting selection",
      publishedAt: "2024-01-08",
    };

    expect(projectGalleryListingRecord(document, languages)).toEqual({
      contentId: "content-awaiting-selection",
      title: "Awaiting selection",
      publishedAt: "2024-01-08",
    });
  });

  it("throws incomplete-document when the gallery has no title", () => {
    const error = rejectionOf(() =>
      projectGalleryListingRecord(
        { contentId: "content-x", publishedAt: "2024-01-01" },
        languages,
      ),
    );
    expect(error.rejection).toBe("incomplete-document");
  });
});

describe("readPublicGalleryListingRecords", () => {
  it("skips the query entirely for an empty candidate list", async () => {
    const { client, requests } = fakeClient({});

    const records = await readPublicGalleryListingRecords(
      { scope: "routed-content", contentIds: [], ordering: "published-desc-v1", limit: 25 },
      { language: "en", client },
    );

    expect(records).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("bounds the query by the given ids and limit, tagged for the gallery cache family", async () => {
    const { client, requests } = fakeClient({ "gallery.listing": [] });

    await readPublicGalleryListingRecords(
      {
        scope: "routed-content",
        contentIds: ["content-a", "content-b"],
        ordering: "published-desc-v1",
        limit: 5,
      },
      { language: "en", client, config },
    );

    expect(requests[0].tag).toBe("gallery.listing");
    expect(requests[0].params).toMatchObject({
      language: "en",
      contentIds: ["content-a", "content-b"],
      limit: 5,
    });
  });

  it("chunks a candidate list that would exceed the GET URL budget into more than one request", async () => {
    const contentIds = Array.from(
      { length: 500 },
      (_, index) => `content-${"x".repeat(40)}-${index}`,
    );
    const { client, requests } = fakeClient({ "gallery.listing": [] });

    await readPublicGalleryListingRecords(
      { scope: "routed-content", contentIds, ordering: "published-desc-v1", limit: 25 },
      { language: "en", client, config },
    );

    expect(requests.length).toBeGreaterThan(1);
    const requestedIds = requests.flatMap(
      (request) => request.params?.contentIds as readonly string[],
    );
    expect(new Set(requestedIds)).toEqual(new Set(contentIds));
  });

  it("merges and re-bounds chunked results to the requested limit, newest first", async () => {
    const contentIds = Array.from(
      { length: 500 },
      (_, index) => `content-${"x".repeat(40)}-${index}`,
    );
    const olderRecord: RawGalleryListingDocument = {
      contentId: "content-older",
      title: "Older",
      publishedAt: "2024-01-01",
    };
    const newerRecord: RawGalleryListingDocument = {
      contentId: "content-newer",
      title: "Newer",
      publishedAt: "2024-06-01",
    };

    let call = 0;
    const client: SanityClient = {
      async query() {
        call += 1;
        if (call === 1) return [olderRecord];
        if (call === 2) return [newerRecord];
        return [];
      },
    };

    const records = await readPublicGalleryListingRecords(
      { scope: "routed-content", contentIds, ordering: "published-desc-v1", limit: 1 },
      { language: "en", client, config },
    );

    expect(records.map((record) => record.contentId)).toEqual(["content-newer"]);
  });

  it("reports an oversized single content id as a gallery error, never an article error", async () => {
    // This is the specific bug the shared, provider-neutral
    // `sanity-values.ts#chunkContentIds` prevents: a gallery-listing
    // failure must never surface as `SanityArticleError`.
    const hugeId = "x".repeat(MAX_CONTENT_IDS_BYTES + 100);
    const { client } = fakeClient({ "gallery.listing": [] });

    const error = await readPublicGalleryListingRecords(
      { scope: "routed-content", contentIds: [hugeId], ordering: "published-desc-v1", limit: 25 },
      { language: "en", client, config },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("incomplete-document");
  });
});

describe("readPublicGalleryListingRecordsInCategories", () => {
  it("skips every query for an empty category scope", async () => {
    const { client, requests } = fakeClient({});

    const records = await readPublicGalleryListingRecordsInCategories(
      { scope: "category-subtree", categoryIds: [], ordering: "published-desc-v1", limit: 25 },
      { language: "en", client, config },
    );

    expect(records).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("resolves the scope with a targeted lookup and filters galleries by reference", async () => {
    const { client, requests } = fakeClient({
      "category.ids": [{ _id: "doc-formula" }, { _id: "doc-rally" }],
      "gallery.listing.by-category": [
        { contentId: "content-rally-gallery", title: "Rally", publishedAt: "2024-05-01" },
      ],
    });

    const records = await readPublicGalleryListingRecordsInCategories(
      {
        scope: "category-subtree",
        categoryIds: ["cat-formula", "cat-rally"],
        ordering: "published-desc-v1",
        limit: 5,
      },
      { language: "en", client, config },
    );

    expect(records.map((record) => record.contentId)).toEqual([
      "content-rally-gallery",
    ]);

    const scopeRequest = requests.find(
      (request) => request.tag === "category.ids",
    );
    expect(scopeRequest?.query).toContain("categoryId in $categoryIds");
    expect(scopeRequest?.params).toMatchObject({
      categoryIds: ["cat-formula", "cat-rally"],
    });

    const listingRequest = requests.find(
      (request) => request.tag === "gallery.listing.by-category",
    );
    expect(listingRequest?.query).toContain("references($categoryIds)");
    expect(listingRequest?.params).toMatchObject({
      language: "en",
      categoryIds: ["doc-formula", "doc-rally"],
      limit: 5,
    });
  });

  it("adds a keyset boundary clause for a category continuation cursor (AB#140)", async () => {
    const { client, requests } = fakeClient({
      "category.ids": [{ _id: "doc-a" }],
      "gallery.listing.by-category": [],
    });

    await readPublicGalleryListingRecordsInCategories(
      {
        scope: "category-subtree",
        categoryIds: ["cat-a"],
        ordering: "published-desc-v1",
        limit: 5,
        after: { publishedAt: "2024-06-18", contentId: "content-x" },
      },
      { language: "en", client, config },
    );

    const listingRequest = requests.find(
      (request) => request.tag === "gallery.listing.by-category",
    );
    expect(listingRequest?.query).toContain(
      "publishedAt < $afterPublishedAt || (publishedAt == $afterPublishedAt && contentId > $afterContentId)",
    );
    expect(listingRequest?.params).toMatchObject({
      afterPublishedAt: "2024-06-18",
      afterContentId: "content-x",
    });
  });

  it("returns nothing when no scope category exists in the store", async () => {
    const { client, requests } = fakeClient({ "category.ids": [] });

    const records = await readPublicGalleryListingRecordsInCategories(
      {
        scope: "category-subtree",
        categoryIds: ["cat-unknown"],
        ordering: "published-desc-v1",
        limit: 5,
      },
      { language: "en", client, config },
    );

    expect(records).toEqual([]);
    expect(
      requests.some((request) => request.tag === "gallery.listing.by-category"),
    ).toBe(false);
  });
});
