import { describe, expect, it } from "vitest";
import { languageName, localizedDraftActionCopy, localizedDraftNotice, summarizeReviewPaths } from "./localized-draft-action-copy";

describe("review path summary", () => {
  it("groups planner paths into author-readable rows in a fixed order", () => {
    expect(summarizeReviewPaths(["body[0].text", "slug", "summary", "title", "body[2].items[1]"])).toEqual([
      { group: "title", count: 1 }, { group: "slug", count: 1 }, { group: "summary", count: 1 }, { group: "body", count: 2 },
    ]);
  });
  it("keeps sections, placements and unknown fields visible rather than dropping them", () => {
    expect(summarizeReviewPaths(["sections[0].label", "endGallerySections[1].slug", "placements[p-1].caption", "seo.description"])).toEqual([
      { group: "sections", count: 2 }, { group: "placements", count: 1 }, { group: "other", count: 1 },
    ]);
    expect(summarizeReviewPaths([])).toEqual([]);
  });
  it("labels each group with its count in both interface languages", () => {
    expect(localizedDraftActionCopy("fi").group("body", 1)).toBe("Sisältö: 1 tekstikohta");
    expect(localizedDraftActionCopy("fi").group("body", 3)).toBe("Sisältö: 3 tekstikohtaa");
    expect(localizedDraftActionCopy("en-US").group("placements", 2)).toBe("Image placement texts: 2 fields");
  });
});

describe("language names", () => {
  it("names a configured tag in the interface language", () => {
    expect(languageName("en", "fi")).toBe("Englanti");
    expect(languageName("fi", "en-US")).toBe("Finnish");
  });
  it("falls back to the raw tag when no name is available", () => {
    expect(languageName("zz", "fi")).toBe("zz");
    expect(languageName("not a tag", "fi")).toBe("not a tag");
  });
});

describe("planner notices", () => {
  const category = "Canonical category cat-blog lacks a published en label and slug. Localize it before publishing.";
  it("names a category by its source-language label when one was read", () => {
    expect(localizedDraftNotice(category, "fi", { "cat-blog": "Blogi" })).toBe(
      "Pääkategorialta ”Blogi” puuttuu julkaistu nimi ja polun osa kielellä EN. Lisää ne kategoriaan ennen julkaisua.");
    expect(localizedDraftNotice(category, "en-US", { "cat-blog": "Blog" })).toContain("main category ”Blog”");
  });
  it("keeps the identifier when no name is known, and never invents one", () => {
    expect(localizedDraftNotice(category, "fi")).toContain("Pääkategorialta cat-blog");
    expect(localizedDraftNotice("Shared media photo-1 needs a en caption entry; this action does not clone media.", "fi", { "photo-1": "Auringonlasku" }))
      .toBe("Kuvalta ”Auringonlasku” puuttuu kuvateksti kielellä EN. Kuvatekstit ovat kuvan omia, joten lisää ne kuvaan erikseen.");
    expect(localizedDraftNotice("Something new", "en")).toBe("Something new");
  });
});
