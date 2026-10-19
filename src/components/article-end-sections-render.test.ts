import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleEndGallery } from "@/components/article-end-gallery";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { mockImages } from "@/lib/mock-media";

describe("server-rendered article filters before hydration", () => {
  it.each(["fi", "en-GB"])("uses count-neutral result copy for one loaded image (%s)", locale => {
    const labels = getBuiltInLabels(locale), media = mockImages.coastalLandscape;
    const html = renderToStaticMarkup(createElement(ArticleEndGallery, {
      articlePath: "/stories/notes/one", articleTitle: "A note", initialSliceKey: "single", labels,
      presentation: { layout: "grid", captionPlacement: "below" },
      sections: [{ sectionId: "one", slug: "soft-light", label: "Soft light", order: 0 }], sectionHeading: "Image themes",
      slice: { items: [{ itemId: "one", mediaId: media.mediaId, media }], slides: [{ itemId: "one", mediaId: media.mediaId, src: media.rendition.src, width: media.rendition.width, height: media.rendition.height, alt: media.alt }], nextCursor: null },
    }));
    expect(html).toContain(locale === "fi" ? "Ladattuja kuvia: 1" : "Loaded images: 1");
    expect(html).not.toMatch(/1 images loaded|1 kuvaa ladattu/);
  });
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
