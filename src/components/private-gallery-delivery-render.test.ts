import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { PrivateGalleryGrid } from "./private-gallery-grid";
import { PrivateGalleryZipDownload } from "./private-gallery-zip-download";

for (const locale of ["fi", "en-GB"]) {
  describe(`private delivery server markup ${locale}`, () => {
    const labels = getBuiltInLabels(locale).privateGallery;
    it("reserves complete native frames with honest missing-alt fallback and no eager signed URLs", () => {
      const html = renderToStaticMarkup(createElement(PrivateGalleryGrid, { labels, assetPath: "/private/handle/asset", items: [
        { itemId: "one", width: 1200, height: 1800, derivativeKind: "delivery-preview" },
        { itemId: "two", width: 2048, height: 768, derivativeKind: "delivery-preview", alt: "" },
      ] }));
      expect(html).toContain(`aria-label="${labels.photograph.replace("{number}", "1")}"`);
      expect(html).toContain('aria-label=""');
      expect(html).toContain('aspect-ratio:1200 / 1800');
      expect(html).not.toContain('<img');
      expect(html).not.toContain('href=');
      expect(html).not.toContain('filename');
      expect(html).not.toContain('objectKey');
    });
    it("keeps the download inert without hydration and preserves the empty-gallery state", () => {
      const button = renderToStaticMarkup(createElement(PrivateGalleryZipDownload, { labels, assetPath: "/private/handle/asset" }));
      expect(button).toContain('disabled=""');
      expect(button).toContain(labels.downloadZip);
      expect(button).not.toContain('href=');
      const empty = renderToStaticMarkup(createElement(PrivateGalleryGrid, { labels, assetPath: "/private/handle/asset", items: [] }));
      expect(empty).toContain(labels.noPhotographs);
      expect(empty).not.toContain('<img');
    });
  });
}
