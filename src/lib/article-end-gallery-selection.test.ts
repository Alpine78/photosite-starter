import { describe, expect, it } from "vitest";
import { resolveArticleEndSection } from "@/lib/article-end-gallery-selection";
import { articleSectionHref } from "@/lib/article-section-navigation";
import { getMockArticleEndGalleryPage } from "@/lib/mock-article-end-gallery";
import {
  MAX_ITEM_ID_LENGTH,
  createHmacGalleryCursorCodec,
} from "@/lib/gallery-pagination";
import {
  FILTER_ARTICLE_ID,
  FILTER_END_GALLERY_ID,
  mockArticleEndSections,
} from "@/lib/mock-article-end-sections";
const catalog = { endGallerySections: mockArticleEndSections("fi") };
describe("article selectors and intact query carry", () => {
  it.each([undefined, "", "all"])("resolves All spelling %j", (raw) =>
    expect(resolveArticleEndSection(catalog, raw)).toEqual({ kind: "all" }),
  );
  it.each([
    { raw: [] },
    { raw: ["all"] },
    { raw: ["pehmea-valo", "pinnat"] },
    { raw: "soft-light" },
    { raw: "../x" },
    { raw: "X" },
    { raw: "x".repeat(MAX_ITEM_ID_LENGTH + 1) },
  ])("refuses invalid/other-locale selectors %j", ({ raw }) =>
    expect(resolveArticleEndSection(catalog, raw)).toEqual({
      kind: "not-found",
    }),
  );
  it("uses stable identity and preserves legacy incidental state", () => {
    expect(resolveArticleEndSection(catalog, "pinnat")).toMatchObject({
      kind: "selected",
      section: { sectionId: "texture" },
    });
    expect(resolveArticleEndSection({}, ["bad", "bad"])).toEqual({
      kind: "legacy-ignore",
    });
    expect(
      resolveArticleEndSection(
        { endGallerySections: catalog.endGallerySections.slice(0, 1) },
        "pehmea-valo",
      ).kind,
    ).toBe("selected");
  });
  it("clears every cursor/section value, preserves duplicate unrelated values and fragment", () => {
    expect(
      articleSectionHref(
        "/notes",
        {
          a: ["one two", "&"],
          section: ["old", "bad"],
          cursor: "token",
          nil: undefined,
        },
        "pinnat",
        "#section-one",
      ),
    ).toBe("/notes?section=pinnat&a=one+two&a=%26#section-one");
    expect(
      articleSectionHref("/notes", { section: "old", cursor: "old" }),
    ).toBe("/notes");
  });
  it("keeps hydrated section and All links intact without URLSearchParams.size", () => {
    const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
    expect(descriptor).toBeDefined();
    expect(Reflect.deleteProperty(URLSearchParams.prototype, "size")).toBe(true);
    try {
      expect(articleSectionHref("/notes", { keep: ["one two", "&"], cursor: "old" }, "soft-light", "#chapter"))
        .toBe("/notes?section=soft-light&keep=one+two&keep=%26#chapter");
      expect(articleSectionHref("/notes", { keep: "one" }, undefined, "#chapter"))
        .toBe("/notes?keep=one#chapter");
      expect(articleSectionHref("/notes", { cursor: "old" }, undefined, "#chapter"))
        .toBe("/notes#chapter");
    } finally {
      if (descriptor) Object.defineProperty(URLSearchParams.prototype, "size", descriptor);
    }
  });
});

describe("actual selected mock source uses the complete interleaved collection", () => {
  const cursorCodec = createHmacGalleryCursorCodec("x".repeat(32));
  const read = (sectionId?: string, cursor?: string) =>
    getMockArticleEndGalleryPage({
      cursorCodec,
      query: {
        locale: "en-GB",
        contentId: FILTER_ARTICLE_ID,
        endGalleryId: FILTER_END_GALLERY_ID,
        ...(sectionId === undefined ? {} : { sectionId }),
        ...(cursor === undefined ? {} : { cursor }),
      },
    });
  it("loads27 selected photographs as24+3 beyond All's first window and keeps unassigned in All", async () => {
    const all = (await read())!,
      selected = (await read("soft-light"))!;
    expect(all.items).toHaveLength(24);
    expect(all.items.some((x) => x.placementId === "image-note-03")).toBe(true);
    expect(selected.items).toHaveLength(24);
    expect(selected.items.at(-1)?.placementId).toBe("image-note-27");
    expect(selected.items.some((x) => x.placementId === "image-note-03")).toBe(
      false,
    );
    expect(
      (await read("soft-light", selected.page.endCursor!))?.items.map(
        (x) => x.placementId,
      ),
    ).toEqual(["image-note-28", "image-note-29", "image-note-30"]);
    expect((await read(undefined, all.page.endCursor!))?.items).toHaveLength(6);
    expect((await read("texture"))?.items).toHaveLength(2);
    expect((await read("waiting"))?.items).toHaveLength(0);
  });
  it("rejects cross-scope in both directions and an All-only boundary inside the selected scope", async () => {
    const all = (await read())!,
      selected = (await read("soft-light"))!;
    await expect(read("soft-light", all.page.endCursor!)).rejects.toMatchObject(
      { code: "wrong-scope" },
    );
    await expect(
      read(undefined, selected.page.endCursor!),
    ).rejects.toMatchObject({ code: "wrong-scope" });
    expect(await read("missing")).toBeUndefined();
  });
});
