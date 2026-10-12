import { describe, expect, it } from "vitest";
import { articleEndGalleryHeadingId } from "@/lib/article-end-gallery-heading";
import type { ContentBlock } from "@/lib/content-page";

describe("article end-gallery heading reuse", () => {
  it.each([2, 3, 4] as const)("reuses supported level %i in either language", (level) => {
    for (const label of ["Galleria", "Gallery"]) {
      const body: readonly ContentBlock[] = [{ type: "heading", level, text: `\u00a0${label.toUpperCase()}\u00a0` }];
      expect(articleEndGalleryHeadingId(body, label)).toBe(`section-${label.toLowerCase()}`);
    }
  });

  it("uses the exact disambiguated fragment when earlier headings have the same text", () => {
    const body: readonly ContentBlock[] = [
      { type: "heading", level: 2, text: "Gallery" },
      { type: "paragraph", text: "Authored discussion of a different gallery." },
      { type: "heading", level: 2, text: "Gallery 2" },
      { type: "heading", level: 2, text: "Gallery" },
    ];
    expect(articleEndGalleryHeadingId(body, "Gallery")).toBe("section-gallery-3");
    expect(body).toHaveLength(4);
  });

  it.each([
    { levels: [2, 3], expected: "section-gallery-2" },
    { levels: [3, 2], expected: "section-gallery" },
    { levels: [2, 4], expected: "section-gallery-2" },
    { levels: [4, 2], expected: "section-gallery" },
    { levels: [3, 4], expected: "section-gallery-2" },
    { levels: [4, 3], expected: "section-gallery-2" },
  ] as const)("preserves H2-reserved fragments across levels $levels", ({ levels, expected }) => {
    const body: readonly ContentBlock[] = levels.map(level => ({ type: "heading", level, text: "Gallery" }));
    expect(articleEndGalleryHeadingId(body, "Gallery")).toBe(expected);
    expect(body.map(block => block.type === "heading" ? block.level : undefined)).toEqual(levels);
  });

  it.each([3, 4] as const)("retains a terminal level %i under a differently named H2", level => {
    const body: readonly ContentBlock[] = [
      { type: "heading", level: 2, text: "Earlier section" },
      { type: "heading", level, text: "Gallery" },
    ];
    expect(articleEndGalleryHeadingId(body, "Gallery")).toBe("section-gallery");
  });

  it.each([3, 4] as const)("keeps generated labels for unmatched or nonterminal level %i headings", level => {
    for (const body of [
      [{ type: "heading", level, text: "Another gallery" }],
      [{ type: "heading", level, text: "Gallery" }, { type: "paragraph", text: "Content follows." }],
      [{ type: "heading", level, text: "Gallery" }, { type: "paragraph", text: "\u00a0" }],
    ] satisfies readonly (readonly ContentBlock[])[]) {
      expect(articleEndGalleryHeadingId(body, "Gallery")).toBeUndefined();
    }
  });

  it("refuses an unsupported runtime heading level", () => {
    const body = [{ type: "heading", level: 5, text: "Gallery" }] as unknown as readonly ContentBlock[];
    expect(articleEndGalleryHeadingId(body, "Gallery")).toBeUndefined();
  });

  it.each([
    [],
    [{ type: "heading", level: 2, text: "Another gallery" }],
    [{ type: "heading", level: 2, text: "Galleria" }],
    [{ type: "heading", level: 2, text: "Gallery" }, { type: "paragraph", text: "Content follows." }],
    [{ type: "heading", level: 2, text: "Gallery" }, { type: "paragraph", text: "\u00a0" }],
  ] satisfies readonly (readonly ContentBlock[])[])("keeps a generated label when no terminal localized heading matches: %j", (...body) => {
    expect(articleEndGalleryHeadingId(body as readonly ContentBlock[], "Gallery")).toBeUndefined();
  });
});
