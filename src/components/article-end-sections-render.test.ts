import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleEndGallery } from "@/components/article-end-gallery";
import { getBuiltInLabels } from "@/lib/deployment-config";

describe("server-rendered article filters before hydration", () => {
  it("offers All plus one declared section and visible empty result copy with one initially empty live region", () => {
    const labels = getBuiltInLabels("en-GB");
    const html = renderToStaticMarkup(
      createElement(ArticleEndGallery, {
        articlePath: "/stories/notes/one",
        articleTitle: "A note",
        initialSliceKey: "first",
        labels,
        presentation: { layout: "grid", captionPlacement: "below" },
        slice: { items: [], slides: [], nextCursor: null },
        sections: [
          {
            sectionId: "one",
            slug: "soft-light",
            label: "Soft light",
            order: 0,
          },
        ],
        sectionHeading: "Image themes",
        carriedQuery: { keep: ["a", "b"], cursor: "discard" },
      }),
    );
    expect(html).toContain('aria-label="Image themes"');
    expect(html).toContain('href="/stories/notes/one?keep=a&amp;keep=b"');
    expect(html).toContain(
      'href="/stories/notes/one?section=soft-light&amp;keep=a&amp;keep=b"',
    );
    expect(html).toContain(labels.gallery.empty);
    expect(html).not.toContain("discard");
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/role="status"[^>]*><\/p>/);
  });
});
