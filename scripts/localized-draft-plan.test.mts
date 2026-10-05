import { describe, expect, it } from "vitest";
import { planLocalizedDraft, selectCurrentPlacementVersions } from "./localized-draft-plan.mts";

const category = {
  _id: "cat-landscape", _type: "category",
  slug: [{ language: "fi", value: "maisemat" }, { language: "en", value: "landscapes" }],
  label: [{ language: "fi", value: "Maisemat" }, { language: "en", value: "Landscapes" }],
};
const media = {
  _id: "photo-1", _type: "media",
  alt: [{ language: "fi", value: "Ranta" }], caption: [{ language: "fi", value: "Kesä" }],
};
const article = {
  _id: "article-fi", _rev: "source-revision", _createdAt: "yesterday", _type: "article",
  contentId: "summer-trip", language: "fi", title: "Kesäretki", slug: "kesaretki",
  summary: "Lyhyt johdanto", canonicalCategory: { _type: "reference", _ref: "cat-landscape" },
  cover: { _type: "reference", _ref: "photo-1" }, endGalleryId: "summer-photos",
  body: [{ _key: "paragraph-1", _type: "contentParagraphBlock", text: "Rannalla" },
    { _key: "media-1", _type: "contentMediaBlock", media: { _type: "reference", _ref: "photo-1" }, caption: "Aalto" }],
};
const gallery = {
  _id: "gallery-fi", _type: "gallery", contentId: "summer-trip", language: "fi",
  title: "Kesäkuvat", slug: "kesakuvat", orderingRule: "manual", cover: { _type: "reference", _ref: "photo-1" },
  canonicalCategory: { _type: "reference", _ref: "cat-landscape" },
  sections: [{ _key: "section-1", _type: "gallerySection", sectionId: "beach", slug: "ranta", label: "Ranta", intro: [] }],
  body: [{ _key: "heading-1", _type: "contentHeadingBlock", text: "Päivä" }],
};
const placement = {
  _id: "placement-fi", _type: "galleryPlacement", gallery: { _type: "reference", _ref: "gallery-fi" },
  placementId: "beach-photo", order: 7, sectionId: "beach", visible: true,
  media: { _type: "reference", _ref: "photo-1" }, altOverride: "Ranta", captionOverride: "Aamu",
};
function input(source: Record<string, unknown> = article, placements: Record<string, unknown>[] = []) {
  return { source, targetLanguage: "en", configuredLanguages: ["fi", "en"], existingVersions: [source], placements, categories: [category], media: [media] };
}

describe("planLocalizedDraft", () => {
  it("copies an article into a linked draft without mutating its source or media", () => {
    const before = structuredClone(article);
    const plan = planLocalizedDraft(input());
    expect(article).toEqual(before);
    expect(plan.draft._id).toMatch(/^drafts\.localized-article-/);
    expect(plan.draft._rev).toBeUndefined();
    expect(plan.draft._createdAt).toBeUndefined();
    expect(plan.draft.contentId).toBe(article.contentId);
    expect(plan.draft.language).toBe("en");
    expect(plan.draft.body).toEqual(article.body);
    expect(plan.draft.cover).toEqual(article.cover);
    expect(plan.reviewPaths).toContain("title");
    expect(plan.reviewPaths).toContain("slug");
    expect(plan.reviewPaths).toContain("body[0].text");
    expect(plan.reviewPaths).toContain("body[1].caption");
    expect(plan.notices).toContainEqual(expect.stringContaining("needs a en alt"));
    expect(plan.notices).toContainEqual(expect.stringContaining("needs a en caption"));
    expect(planLocalizedDraft(input()).draft._id).toBe(plan.draft._id);
  });

  it("copies a gallery's sections and ordered placement with stable identities", () => {
    const plan = planLocalizedDraft(input(gallery, [placement]));
    expect(plan.draft.sections).toEqual(gallery.sections);
    expect(plan.reviewPaths).toContain("sections[0].slug");
    expect(plan.reviewPaths).toContain("sections[0].label");
    expect(plan.placementDrafts).toHaveLength(1);
    expect(plan.placementDrafts[0].placementId).toBe("beach-photo");
    expect(plan.placementDrafts[0].order).toBe(7);
    expect(plan.placementDrafts[0].media).toEqual(placement.media);
    expect(plan.placementDrafts[0].gallery).toEqual({ _type: "reference", _ref: String(plan.draft._id).slice(7) });
    expect(plan.reviewPaths).toContain("placements[beach-photo].altOverride");
    expect((plan.draft.localizationReview as { pendingFields: string[] }).pendingFields).not.toContain("placements[beach-photo].altOverride");
    expect((plan.placementDrafts[0].localizationReview as { pendingFields: string[] }).pendingFields).toContain("altOverride");
  });

  it("refuses existing target versions and cross-type identity conflicts", () => {
    expect(() => planLocalizedDraft({ ...input(), existingVersions: [article, { ...article, _id: "drafts.article-en", language: "en" }] })).toThrow(/already exists/);
    expect(() => planLocalizedDraft({ ...input(), existingVersions: [article, { ...gallery, contentId: article.contentId }] })).toThrow(/another content variant/);
  });

  it("reports a category without target-language placement instead of choosing another", () => {
    const plan = planLocalizedDraft({ ...input(), categories: [{ ...category, slug: [category.slug[0]], label: [category.label[0]] }] });
    expect(plan.notices).toContainEqual(expect.stringContaining("Canonical category"));
    expect(plan.draft.canonicalCategory).toEqual(article.canonicalCategory);
  });

  it("rejects a source-language poll reference", () => {
    const source = { ...article, body: [{ _type: "contentPollBlock", poll: { _ref: "poll-fi" } }] };
    expect(() => planLocalizedDraft(input(source))).toThrow(/poll belongs to one language/);
  });

  it("refuses to chain a localization that still has source-language review pending", () => {
    const source = { ...article, localizedFrom: "sv", localizationReview: { pendingFields: ["title"] } };
    expect(() => planLocalizedDraft(input(source))).toThrow(/Finish the source language/);
    expect(() => planLocalizedDraft(input({ ...source, localizationReview: { pendingFields: [] } }))).not.toThrow();
  });

  it("selects current placement drafts and ignores release copies", () => {
    const rows = [
      placement,
      { ...placement, _id: "versions.release-1.placement-fi", captionOverride: "Release" },
      { ...placement, _id: "drafts.placement-fi", captionOverride: "Draft" },
    ];
    expect(selectCurrentPlacementVersions(rows)).toEqual([rows[2]]);
  });

  it("rejects a pending review even if its localization source marker was removed", () => {
    expect(() => planLocalizedDraft(input({ ...article, localizationReview: { pendingFields: ["title"] } })))
      .toThrow(/Finish the source language/);
  });

  it.each([
    { localizedFrom: "sv", localizationReview: { pendingFields: ["captionOverride"] } },
    { localizedFrom: "sv" },
    { localizedFrom: "sv", localizationReview: null },
    { localizedFrom: "sv", localizationReview: { pendingFields: "captionOverride" } },
    { localizationReview: { pendingFields: ["altOverride"] } },
    { localizationReview: null },
  ])("refuses an unreviewed source placement (%j) even when the page is reviewed", (review) => {
    const source = { ...gallery, localizedFrom: "sv", localizationReview: { pendingFields: [] } };
    const sourcePlacement = { ...placement, ...review };
    const before = structuredClone({ source, sourcePlacement });
    expect(() => planLocalizedDraft(input(source, [sourcePlacement])))
      .toThrow(/source placement beach-photo's localization review/);
    expect({ source, sourcePlacement }).toEqual(before);
  });

  it("recomputes the review for a reviewed placement from the immediate source language", () => {
    const sourcePlacement = { ...placement, localizedFrom: "sv", localizationReview: { sourceLanguage: "sv", pendingFields: [] } };
    const before = structuredClone(sourcePlacement);
    const plan = planLocalizedDraft(input(gallery, [sourcePlacement]));
    expect(plan.placementDrafts[0].localizedFrom).toBe("fi");
    expect(plan.placementDrafts[0].localizationReview).toEqual({
      _type: "localizationReview", sourceLanguage: "fi", pendingFields: ["altOverride", "captionOverride"],
    });
    expect(sourcePlacement).toEqual(before);
  });

  it("checks article end-gallery source placements before copying their text", () => {
    const sourcePlacement = {
      ...placement, _type: "articleEndGalleryPlacement", gallery: undefined,
      article: { _type: "reference", _ref: article._id },
      localizedFrom: "sv", localizationReview: { pendingFields: ["captionOverride"] },
    };
    expect(() => planLocalizedDraft(input(article, [sourcePlacement]))).toThrow(/source placement beach-photo/);
    const plan = planLocalizedDraft(input(article, [{ ...sourcePlacement, localizationReview: { pendingFields: [] } }]));
    expect(plan.placementDrafts[0].article).toEqual({ _type: "reference", _ref: String(plan.draft._id).slice(7) });
    expect(plan.placementDrafts[0].localizedFrom).toBe("fi");
  });

  it("returns no partial plan and preserves inputs when a later placement is pending", () => {
    const first = { ...placement, localizedFrom: "sv", localizationReview: { pendingFields: [] } };
    const second = { ...placement, _id: "drafts.placement-two", placementId: "second-photo", localizedFrom: "sv", localizationReview: { pendingFields: ["captionOverride"] } };
    const selected = selectCurrentPlacementVersions([first, second]);
    const before = structuredClone(selected);
    expect(() => planLocalizedDraft(input(gallery, [...selected]))).toThrow(/source placement second-photo/);
    expect(selected).toEqual(before);
  });

  it("requires capture-sequence galleries to have no placements", () => {
    const source = { ...gallery, orderingRule: "capture-sequence" };
    expect(planLocalizedDraft(input(source)).placementDrafts).toHaveLength(0);
    expect(() => planLocalizedDraft(input(source, [placement]))).toThrow(/cannot have placement/);
  });

  it("rejects stale seeded-random materialization before cloning", () => {
    const source = { ...gallery, orderingRule: "seeded-random", orderingSeed: "seed" };
    expect(() => planLocalizedDraft(input(source, [placement]))).toThrow(/stale shuffled order/);
  });
});
