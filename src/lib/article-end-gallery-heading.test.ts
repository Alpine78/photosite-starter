import { describe, expect, it } from "vitest";
import { articleEndGalleryHeadingId } from "@/lib/article-end-gallery-heading";
import type { ContentBlock } from "@/lib/content-page";

describe("article end-gallery heading reuse", () => {
  it.each(["Galleria", "Gallery"])("keeps the authored %s anchor for case and whitespace variants", (label) => {
    const body: readonly ContentBlock[] = [{ type: "heading", level: 2, text: `\u00a0${label.toUpperCase()}\u00a0` }];
    expect(articleEndGalleryHeadingId(body, label)).toBe(`section-${label.toLowerCase()}`);
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
    [],
    [{ type: "heading", level: 3, text: "Gallery" }],
    [{ type: "heading", level: 2, text: "Another gallery" }],
    [{ type: "heading", level: 2, text: "Galleria" }],
    [{ type: "heading", level: 2, text: "Gallery" }, { type: "paragraph", text: "Content follows." }],
    [{ type: "heading", level: 2, text: "Gallery" }, { type: "paragraph", text: "\u00a0" }],
  ] satisfies readonly (readonly ContentBlock[])[])("keeps a generated label when no terminal localized h2 matches: %j", (...body) => {
    expect(articleEndGalleryHeadingId(body as readonly ContentBlock[], "Gallery")).toBeUndefined();
  });
});
