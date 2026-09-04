import { describe, expect, it } from "vitest";

import {
  asArticlePage,
  assertSemanticHeadingOrder,
  effectiveEventDate,
  type ContentBlock,
  type ContentPage,
} from "@/lib/content-page";
import { buildContentTree, type ContentTree } from "@/lib/content-tree";
import {
  mockAuthoredContentRecords,
  mockContentListingRecords,
} from "@/lib/mock-content-listing";
import { mockContentPages } from "@/lib/mock-content-pages";
import { mockContentTreeInputs } from "@/lib/mock-content-tree";

/**
 * The mock content source has to satisfy the same contract a CMS adapter will:
 * the tree decides which pages have a public detail route, and the page source
 * has to answer for exactly those. A gap either way is a 404 on a link the site
 * renders itself, or a body for a page no route can reach.
 *
 * Both variants are checked for a body, using the same `ContentBlock` set
 * (AB#106): a gallery's own curated result set stays the separate AB#67
 * contract and is never a field here, but its optional lead and long-form body
 * are ordinary `ContentPage` fields exactly like an article's.
 */
const languages = ["en", "fi"] as const;

const articlePage: ContentPage = {
  contentId: "article-id",
  variant: "article",
  title: "Article",
  publishedAt: "2024-01-01",
  body: [],
};

describe("asArticlePage", () => {
  it("accepts only the requested article identity", () => {
    expect(asArticlePage("article-id", articlePage)).toBe(articlePage);
    expect(asArticlePage("another-id", articlePage)).toBeUndefined();
  });

  it("rejects another content variant at an article route", () => {
    expect(
      asArticlePage("article-id", { ...articlePage, variant: "gallery" }),
    ).toBeUndefined();
  });
});

describe("assertSemanticHeadingOrder", () => {
  const heading = (level: 2 | 3, text = "Heading"): ContentBlock => ({
    type: "heading",
    level,
    text,
  });
  const paragraph = (text = "Text"): ContentBlock => ({ type: "paragraph", text });

  it("accepts a body with no headings at all", () => {
    expect(() => assertSemanticHeadingOrder([paragraph()])).not.toThrow();
  });

  it("accepts a level-2 heading followed by one or more level-3 headings", () => {
    expect(() =>
      assertSemanticHeadingOrder([heading(2), heading(3), heading(3)]),
    ).not.toThrow();
  });

  it("accepts consecutive level-2 headings, each starting a new level-3 run", () => {
    expect(() =>
      assertSemanticHeadingOrder([heading(2), heading(3), heading(2), heading(3)]),
    ).not.toThrow();
  });

  it("rejects a level-3 heading as the body's first heading", () => {
    expect(() => assertSemanticHeadingOrder([heading(3)])).toThrow(TypeError);
  });

  it("rejects a level-3 heading preceded only by non-heading blocks", () => {
    expect(() => assertSemanticHeadingOrder([paragraph(), heading(3)])).toThrow(
      TypeError,
    );
  });
});

const trees: ReadonlyMap<string, ContentTree> = new Map(
  languages.map((language) => [
    language,
    buildContentTree(mockContentTreeInputs[language]),
  ]),
);

function treeOf(language: string): ContentTree {
  const tree = trees.get(language);
  if (tree === undefined) throw new Error(`no ${language} tree`);
  return tree;
}

describe.each(languages)("mock content pages (%s)", (language) => {
  const tree = treeOf(language);
  const pages = mockContentPages[language];
  const records = mockContentListingRecords[language];
  const authoredRecords = mockAuthoredContentRecords[language];

  const publishedPlacements = [...tree.placements.values()].filter(
    (placement) =>
      placement.published && placement.canonicalCategoryId !== null,
  );

  it("has a page for every published page the tree routes", () => {
    const routed = publishedPlacements
      .map((placement) => placement.contentId)
      .sort();

    expect([...pages.keys()].sort()).toEqual(routed);
  });

  it("authors no page the tree gives no canonical route", () => {
    for (const contentId of pages.keys()) {
      const placement = tree.placements.get(contentId);
      expect(placement?.published).toBe(true);
      expect(placement?.canonicalCategoryId).not.toBeNull();
    }
  });

  it("agrees with the tree about each page's variant", () => {
    for (const [contentId, page] of pages) {
      expect(page.variant).toBe(tree.placements.get(contentId)?.variant);
      expect(page.contentId).toBe(contentId);
    }
  });

  it("shows a card and its detail page the same title, lead, and effective event date", () => {
    // Composed from one record rather than restated, which is what a CMS
    // adapter's two projections of one document must also guarantee.
    // `record.eventDate` (the card contract) is the already-resolved
    // `eventDate ?? publishedAt`; the page's own raw fields (AB#150,
    // ADR-0017) are compared against the pre-fallback authored record, which
    // is where they actually live.
    for (const [contentId, page] of pages) {
      const record = records?.get(contentId);
      const authoredRecord = authoredRecords?.get(contentId);
      expect(record).toBeDefined();
      expect(authoredRecord).toBeDefined();
      expect(page.title).toBe(record?.title);
      expect(page.summary).toBe(record?.summary);
      expect(page.publishedAt).toBe(authoredRecord?.publishedAt);
      expect(page.eventDate).toBe(authoredRecord?.eventDate);
      expect(record?.eventDate).toBe(effectiveEventDate(page));
    }
  });

  it("gives a page's own hero the explicit cover only, never the listing card's fallback (AB#149)", () => {
    // A card is allowed to fall back to a gallery's own first item
    // (`withGalleryCovers`); a page's hero must not repeat that duplication
    // by default (ADR-0003's 2026-09-04 amendment), so it reads the
    // pre-fallback record instead. Every content id's explicit cover — set
    // or absent — must therefore agree exactly with `page.cover`, and an
    // article (which has no fallback concept) is unaffected either way.
    for (const [contentId, page] of pages) {
      const authored = authoredRecords?.get(contentId);
      expect(authored).toBeDefined();
      expect(page.cover).toBe(authored?.cover);
    }
  });

  it("starts every authored heading below the page's own h1, in semantic order", () => {
    for (const page of pages.values()) {
      for (const block of page.body) {
        if (block.type === "heading") {
          expect(block.level).toBeGreaterThanOrEqual(2);
        }
      }
      expect(() => assertSemanticHeadingOrder(page.body)).not.toThrow();
    }
  });

  it("lets a gallery author a long-form body alongside its curated result", () => {
    const galleries = publishedPlacements.filter(
      (placement) => placement.variant === "gallery",
    );

    expect(galleries.length).toBeGreaterThan(0);

    // A gallery's curated result set is the separate AB#67 contract, never a
    // field here. Its body is optional supporting context (ADR-0003 decision
    // 3): this fixture authors one for the gallery AB#106 exercises and,
    // separately, a short one on the large multi-page archive (AB#106
    // decision 3's first-page-only rule needs a gallery that both spans a
    // continuation and carries a body to prove the omission is a rule, not
    // an accident of having nothing to omit) — through the same shared block
    // set an article uses — and leaves every other gallery's body empty,
    // proving absence is a normal, unstubbed state rather than a defect, and
    // that neither authored body drifted onto (or got duplicated across) an
    // unrelated gallery.
    const AUTHORED_GALLERY_BODY_IDS: ReadonlySet<string> = new Set([
      "content-coastal-mornings",
      "content-large-archive",
    ]);

    for (const placement of galleries) {
      const body = pages.get(placement.contentId)?.body ?? [];
      if (AUTHORED_GALLERY_BODY_IDS.has(placement.contentId)) {
        expect(body.length).toBeGreaterThan(0);
      } else {
        expect(body).toEqual([]);
      }
    }
  });
});
