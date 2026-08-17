import { describe, expect, it, vi } from "vitest";
import {
  createHmacGalleryCursorCodec,
  GalleryCursorError,
  MAX_SCOPE_FIELD_LENGTH,
  selectGalleryWindow,
  type CuratedGalleryPlacement,
} from "@/lib/gallery-pagination";
import {
  assertGallerySectionIntroBlocks,
  assertGallerySections,
  assertGallerySectionsSlugStable,
  assertPlacementSectionReferences,
  diffGallerySectionSlugChanges,
  INTERNAL_LINK_PATH,
  MAX_GALLERY_SECTIONS,
  MAX_INTRO_BLOCKS,
  MAX_LIST_ITEMS,
  MAX_SECTION_ID_LENGTH,
  MAX_SPANS_PER_BLOCK,
  MAX_SPAN_TEXT_LENGTH,
  normalizedFilterKey,
  readCuratedGallerySectionPage,
  resolveGallerySectionFilter,
  RESERVED_ALL_SECTION_SLUG,
  selectGallerySectionSummaries,
  UnknownGallerySectionError,
  type CuratedGallerySectionSource,
  type GallerySection,
  type GallerySectionIntroBlock,
} from "@/lib/gallery-sections";
import { mockImages } from "@/lib/mock-media";
import { ROOT_RELATIVE_PATH } from "../../sanity/schemas/site-link";

const TEST_SIGNING_KEY = "test-only-gallery-section-signing-key-0123456789";
const testCursorCodec = createHmacGalleryCursorCodec(TEST_SIGNING_KEY);

function paragraph(text = "Some text"): GallerySectionIntroBlock {
  return { type: "paragraph", spans: [{ text }] };
}

function section(
  sectionId: string,
  slug: string,
  order: number,
  overrides: Partial<GallerySection> = {},
): GallerySection {
  return { sectionId, slug, label: `Label ${sectionId}`, order, ...overrides };
}

function placement(
  placementId: string,
  order: number,
  sectionId?: string,
): CuratedGalleryPlacement {
  return {
    placementId,
    order,
    visible: true,
    media: mockImages.coastalLandscape,
    ...(sectionId === undefined ? {} : { sectionId }),
  };
}

describe("assertGallerySectionIntroBlocks", () => {
  it("accepts a paragraph and a list within bounds", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([
        paragraph("Intro paragraph"),
        {
          type: "list",
          ordered: true,
          items: [{ spans: [{ text: "First" }] }, { spans: [{ text: "Second" }] }],
        },
      ]),
    ).not.toThrow();
  });

  it("accepts a link and an emphasis mark", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([
        {
          type: "paragraph",
          spans: [
            { text: "See the ", marks: ["emphasis"] },
            { text: "results", href: "/tarinat/wrc" },
            { text: " page", href: "https://example.com/results" },
          ],
        },
      ]),
    ).not.toThrow();
  });

  it("rejects more than the block cap", () => {
    const blocks = Array.from({ length: MAX_INTRO_BLOCKS + 1 }, () => paragraph());
    expect(() => assertGallerySectionIntroBlocks(blocks)).toThrow();
  });

  it("rejects a block kind outside paragraph/list", () => {
    const heading = { type: "heading", level: 2, text: "Not allowed" };
    expect(() =>
      assertGallerySectionIntroBlocks([
        heading as unknown as GallerySectionIntroBlock,
      ]),
    ).toThrow();
  });

  it("rejects an empty paragraph", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([{ type: "paragraph", spans: [] }]),
    ).toThrow();
  });

  it("rejects more spans than the per-block cap", () => {
    const spans = Array.from({ length: MAX_SPANS_PER_BLOCK + 1 }, () => ({
      text: "x",
    }));
    expect(() =>
      assertGallerySectionIntroBlocks([{ type: "paragraph", spans }]),
    ).toThrow();
  });

  it("rejects span text over the length bound", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([
        paragraph("x".repeat(MAX_SPAN_TEXT_LENGTH + 1)),
      ]),
    ).toThrow();
  });

  it("rejects an unknown mark", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([
        {
          type: "paragraph",
          spans: [{ text: "x", marks: ["strong" as never] }],
        },
      ]),
    ).toThrow();
  });

  it("rejects a duplicate mark", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([
        {
          type: "paragraph",
          spans: [{ text: "x", marks: ["emphasis", "emphasis"] }],
        },
      ]),
    ).toThrow();
  });

  it("rejects a javascript: link", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([
        {
          type: "paragraph",
          spans: [{ text: "click", href: "javascript:alert(1)" }],
        },
      ]),
    ).toThrow();
  });

  it("rejects a malformed link", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([
        { type: "paragraph", spans: [{ text: "click", href: "not a url" }] },
      ]),
    ).toThrow();
  });

  it("rejects a non-boolean ordered flag", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([
        {
          type: "list",
          ordered: "false" as unknown as boolean,
          items: [{ spans: [{ text: "item" }] }],
        },
      ]),
    ).toThrow();
  });

  it("rejects a list outside the item-count bounds", () => {
    expect(() =>
      assertGallerySectionIntroBlocks([
        { type: "list", ordered: false, items: [] },
      ]),
    ).toThrow();

    const items = Array.from({ length: MAX_LIST_ITEMS + 1 }, () => ({
      spans: [{ text: "item" }],
    }));
    expect(() =>
      assertGallerySectionIntroBlocks([
        { type: "list", ordered: false, items },
      ]),
    ).toThrow();
  });
});

describe("INTERNAL_LINK_PATH", () => {
  it("matches sanity/schemas/site-link.ts's ROOT_RELATIVE_PATH exactly", () => {
    // Same convention as sanity-site-values.test.ts pinning STATIC_PATH: a
    // duplicated pattern across the ADR-0006 application/Studio boundary is
    // pinned equal so the two copies cannot silently drift apart.
    expect(INTERNAL_LINK_PATH.source).toBe(ROOT_RELATIVE_PATH.source);
    expect(INTERNAL_LINK_PATH.flags).toBe(ROOT_RELATIVE_PATH.flags);
  });
});

describe("assertGallerySections", () => {
  it("accepts a valid, distinct set", () => {
    expect(() =>
      assertGallerySections([
        section("early", "early", 0),
        section("late", "late", 1, { intro: [paragraph()] }),
      ]),
    ).not.toThrow();
  });

  it("rejects more than the section-count cap", () => {
    const sections = Array.from({ length: MAX_GALLERY_SECTIONS + 1 }, (_unused, index) =>
      section(`s${index}`, `s${index}`, index),
    );
    expect(() => assertGallerySections(sections)).toThrow();
  });

  it("accepts a sectionId at MAX_SECTION_ID_LENGTH and rejects one over it, so an accepted id can never overflow normalizedFilterKey's scope-field bound", () => {
    const accepted = section("s".repeat(MAX_SECTION_ID_LENGTH), "a", 0);
    expect(() => assertGallerySections([accepted])).not.toThrow();
    expect(
      normalizedFilterKey({ kind: "section", section: accepted }).length,
    ).toBeLessThanOrEqual(MAX_SCOPE_FIELD_LENGTH);

    const overLong = section("s".repeat(MAX_SECTION_ID_LENGTH + 1), "b", 0);
    expect(() => assertGallerySections([overLong])).toThrow();
  });

  it("rejects a duplicate sectionId", () => {
    expect(() =>
      assertGallerySections([section("a", "one", 0), section("a", "two", 1)]),
    ).toThrow();
  });

  it("rejects a duplicate slug", () => {
    expect(() =>
      assertGallerySections([section("a", "same", 0), section("b", "same", 1)]),
    ).toThrow();
  });

  it("rejects the reserved all slug", () => {
    expect(() =>
      assertGallerySections([section("a", RESERVED_ALL_SECTION_SLUG, 0)]),
    ).toThrow();
  });

  it("rejects an invalid slug format", () => {
    for (const slug of ["Upper", "with space", "-leading", "trailing-", "a_b"]) {
      expect(() => assertGallerySections([section("a", slug, 0)])).toThrow();
    }
  });

  it("rejects a negative or non-integer order", () => {
    expect(() =>
      assertGallerySections([section("a", "a", -1)]),
    ).toThrow();
    expect(() =>
      assertGallerySections([section("a", "a", 1.5)]),
    ).toThrow();
  });

  it("rejects an empty label", () => {
    expect(() =>
      assertGallerySections([section("a", "a", 0, { label: "" })]),
    ).toThrow();
  });

  it("propagates an invalid intro", () => {
    expect(() =>
      assertGallerySections([
        section("a", "a", 0, {
          intro: [{ type: "paragraph", spans: [] }],
        }),
      ]),
    ).toThrow();
  });
});

describe("assertPlacementSectionReferences", () => {
  const sections = [section("early", "early", 0)];

  it("accepts a matching or absent sectionId", () => {
    expect(() =>
      assertPlacementSectionReferences(
        [placement("p1", 0, "early"), placement("p2", 1)],
        sections,
      ),
    ).not.toThrow();
  });

  it("rejects a dangling sectionId", () => {
    expect(() =>
      assertPlacementSectionReferences(
        [placement("p1", 0, "does-not-exist")],
        sections,
      ),
    ).toThrow();
  });
});

describe("resolveGallerySectionFilter", () => {
  const sections = [section("early", "early", 0)];

  it("resolves undefined, empty, and the reserved token to All", () => {
    for (const value of [undefined, "", RESERVED_ALL_SECTION_SLUG]) {
      expect(resolveGallerySectionFilter(sections, value)).toEqual({
        kind: "all",
      });
    }
  });

  it("resolves a known slug to its section", () => {
    expect(resolveGallerySectionFilter(sections, "early")).toEqual({
      kind: "section",
      section: sections[0],
    });
  });

  it("throws UnknownGallerySectionError for an unknown slug", () => {
    expect(() => resolveGallerySectionFilter(sections, "missing")).toThrow(
      UnknownGallerySectionError,
    );
  });
});

describe("normalizedFilterKey", () => {
  it("differs between All and each section", () => {
    const early = section("early", "early", 0);
    const late = section("late", "late", 1);

    const allKey = normalizedFilterKey({ kind: "all" });
    const earlyKey = normalizedFilterKey({ kind: "section", section: early });
    const lateKey = normalizedFilterKey({ kind: "section", section: late });

    expect(new Set([allKey, earlyKey, lateKey]).size).toBe(3);
  });

  it("never exceeds gallery-pagination.ts's own scope-field bound for the longest accepted sectionId", () => {
    const longest = section("s".repeat(MAX_SECTION_ID_LENGTH), "longest", 0);
    const key = normalizedFilterKey({ kind: "section", section: longest });

    expect(key.length).toBeLessThanOrEqual(MAX_SCOPE_FIELD_LENGTH);
  });
});

describe("selectGallerySectionSummaries", () => {
  it("orders by order, tie-broken by sectionId, and drops intro", () => {
    const summaries = selectGallerySectionSummaries([
      section("b", "b", 0, { intro: [paragraph()] }),
      section("a", "a", 0),
      section("late", "late", 1),
    ]);

    expect(summaries).toEqual([
      { sectionId: "a", slug: "a", label: "Label a", order: 0 },
      { sectionId: "b", slug: "b", label: "Label b", order: 0 },
      { sectionId: "late", slug: "late", label: "Label late", order: 1 },
    ]);
  });
});

describe("diffGallerySectionSlugChanges / assertGallerySectionsSlugStable", () => {
  it("reports no changes when previous is undefined", () => {
    expect(diffGallerySectionSlugChanges(undefined, [section("a", "a", 0)])).toEqual(
      [],
    );
  });

  it("ignores an unchanged slug, a new section, and a removed section", () => {
    const previous = [section("a", "a", 0), section("removed", "removed", 1)];
    const current = [section("a", "a", 0), section("new", "new", 1)];

    expect(diffGallerySectionSlugChanges(previous, current)).toEqual([]);
    expect(() => assertGallerySectionsSlugStable(previous, current)).not.toThrow();
  });

  it("reports a slug change under a persisting sectionId", () => {
    const previous = [section("a", "old-slug", 0)];
    const current = [section("a", "new-slug", 0)];

    expect(diffGallerySectionSlugChanges(previous, current)).toEqual([
      { sectionId: "a", previousSlug: "old-slug", currentSlug: "new-slug" },
    ]);
    expect(() => assertGallerySectionsSlugStable(previous, current)).toThrow();
  });
});

describe("readCuratedGallerySectionPage", () => {
  const sections = [
    section("early", "early", 0, { intro: [paragraph("Early intro")] }),
    section("late", "late", 1),
  ];

  /**
   * A bounded reference source over an already-loaded array, the same way
   * `mock-gallery.ts`'s own `source` is: it never returns more than the
   * request's window asks for, proving the AB#134 boundedness contract is
   * satisfiable rather than just declared.
   */
  function sourceOf(
    placements: readonly CuratedGalleryPlacement[],
  ): CuratedGallerySectionSource {
    return async ({ window }) => selectGalleryWindow(placements, window);
  }

  const query = {
    locale: "en",
    contentId: "content-test",
    pageSize: 24,
    ordering: "manual-v1",
    visibilityVersion: "v1",
  } as const;

  it("never requires the source to return placements outside the requested section", async () => {
    // Only the "early" section's own two placements — proving the composition
    // does not need the rest of the gallery to answer this request.
    const source = sourceOf([placement("e1", 0, "early"), placement("e2", 1, "early")]);

    const page = await readCuratedGallerySectionPage({
      query: { ...query, sectionSlug: "early" },
      sections,
      source,
    });

    expect(page.items.map((item) => item.itemId)).toEqual(["e1", "e2"]);
    expect(page.selectedSection?.sectionId).toBe("early");
  });

  it("passes the source only the already-resolved filter and a bounded window, never a raw slug, cursor, or offset", async () => {
    const spy = vi.fn(async () => ({
      candidates: [placement("e1", 0, "early")],
    }));

    await readCuratedGallerySectionPage({
      query: { ...query, sectionSlug: "early" },
      sections,
      source: spy,
    });

    expect(spy).toHaveBeenCalledWith({
      locale: "en",
      contentId: "content-test",
      filter: { kind: "section", section: sections[0] },
      window: { candidateLimit: query.pageSize + 1 },
    });
  });

  it("requests the boundary item and a candidateLimit-bounded window on a continuation, never the whole section", async () => {
    const many = Array.from({ length: 3 }, (_unused, index) =>
      placement(`e${index}`, index, "early"),
    );
    const spy = vi.fn(sourceOf(many));

    const first = await readCuratedGallerySectionPage({
      query: { ...query, sectionSlug: "early", pageSize: 2 },
      sections,
      source: spy,
      cursorCodec: testCursorCodec,
    });
    expect(first.page.hasNextPage).toBe(true);
    const cursor = first.page.hasNextPage ? first.page.endCursor : undefined;

    spy.mockClear();
    await readCuratedGallerySectionPage({
      query: { ...query, sectionSlug: "early", pageSize: 2, cursor },
      sections,
      source: spy,
      cursorCodec: testCursorCodec,
    });

    expect(spy).toHaveBeenCalledWith({
      locale: "en",
      contentId: "content-test",
      filter: { kind: "section", section: sections[0] },
      window: {
        candidateLimit: 3,
        after: { order: 1, placementId: "e1" },
      },
    });
  });

  it("does not call the source at all for an unknown section", async () => {
    const spy = vi.fn(async () => ({ candidates: [] }));

    await expect(
      readCuratedGallerySectionPage({
        query: { ...query, sectionSlug: "missing" },
        sections,
        source: spy,
      }),
    ).rejects.toThrow(UnknownGallerySectionError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("exposes the section catalog on every page, and selectedSection only on All's absence", async () => {
    const page = await readCuratedGallerySectionPage({
      query,
      sections,
      source: sourceOf([placement("a1", 0)]),
    });

    expect(page.sections).toEqual([
      { sectionId: "early", slug: "early", label: "Label early", order: 0 },
      { sectionId: "late", slug: "late", label: "Label late", order: 1 },
    ]);
    expect(page.selectedSection).toBeUndefined();
  });

  it("omits selectedSection on a section's continuation page", async () => {
    const many = Array.from({ length: 3 }, (_unused, index) =>
      placement(`e${index}`, index, "early"),
    );

    const first = await readCuratedGallerySectionPage({
      query: { ...query, sectionSlug: "early", pageSize: 2 },
      sections,
      source: sourceOf(many),
      cursorCodec: testCursorCodec,
    });
    expect(first.selectedSection?.sectionId).toBe("early");
    expect(first.page.hasNextPage).toBe(true);

    const cursor = first.page.hasNextPage ? first.page.endCursor : undefined;
    const second = await readCuratedGallerySectionPage({
      query: { ...query, sectionSlug: "early", pageSize: 2, cursor },
      sections,
      source: sourceOf(many),
      cursorCodec: testCursorCodec,
    });
    expect(second.selectedSection).toBeUndefined();
  });

  it("rejects a cursor minted under a different section as wrong-scope", async () => {
    const early = [placement("e1", 0, "early"), placement("e2", 1, "early")];
    const late = [placement("l1", 0, "late"), placement("l2", 1, "late")];

    const earlyPage = await readCuratedGallerySectionPage({
      query: { ...query, sectionSlug: "early", pageSize: 1 },
      sections,
      source: sourceOf(early),
      cursorCodec: testCursorCodec,
    });
    const cursor = earlyPage.page.hasNextPage
      ? earlyPage.page.endCursor
      : undefined;
    expect(cursor).toBeDefined();

    let caught: unknown;
    try {
      await readCuratedGallerySectionPage({
        query: { ...query, sectionSlug: "late", pageSize: 1, cursor },
        sections,
        source: sourceOf(late),
        cursorCodec: testCursorCodec,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GalleryCursorError);
    expect((caught as GalleryCursorError).code).toBe("wrong-scope");
  });
});
