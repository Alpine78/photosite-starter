import { describe, expect, it } from "vitest";

import { asArticlePage, type ContentPage } from "@/lib/content-page";
import { buildContentTree, type ContentTree } from "@/lib/content-tree";
import { mockContentListingRecords } from "@/lib/mock-content-listing";
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

  it("shows a card and its detail page the same title, date, and cover", () => {
    // Composed from one record rather than restated, which is what a CMS
    // adapter's two projections of one document must also guarantee.
    for (const [contentId, page] of pages) {
      const record = records?.get(contentId);
      expect(record).toBeDefined();
      expect(page.title).toBe(record?.title);
      expect(page.summary).toBe(record?.summary);
      expect(page.publishedAt).toBe(record?.publishedAt);
      expect(page.cover).toBe(record?.cover);
    }
  });

  it("starts every authored heading below the page's own h1", () => {
    for (const page of pages.values()) {
      for (const block of page.body) {
        if (block.type === "heading") {
          expect(block.level).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("lets a gallery author a long-form body alongside its curated result", () => {
    const galleries = publishedPlacements.filter(
      (placement) => placement.variant === "gallery",
    );

    expect(galleries.length).toBeGreaterThan(0);

    // A gallery's curated result set is the separate AB#67 contract, never a
    // field here. Its body is optional supporting context (ADR-0003 decision
    // 3): this fixture authors one only for the gallery AB#106 exercises,
    // through the same shared block set an article uses, and leaves every
    // other gallery's body empty — proving absence is a normal, unstubbed
    // state rather than a defect, and that the authored body did not drift
    // onto (or get duplicated across) an unrelated gallery.
    const AUTHORED_GALLERY_BODY_ID = "content-coastal-mornings";

    for (const placement of galleries) {
      const body = pages.get(placement.contentId)?.body ?? [];
      if (placement.contentId === AUTHORED_GALLERY_BODY_ID) {
        expect(body.length).toBeGreaterThan(0);
      } else {
        expect(body).toEqual([]);
      }
    }
  });
});
