import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { GalleryLightbox, GalleryLightboxTrigger } from "./gallery-lightbox";

function renderTrigger(captionPopoverId?: string, deferUntilEnhanced = true) {
  const triggerProps = {
    itemId: "occurrence-one", index: 0, label: "Open photograph",
    captionPopoverId, deferUntilEnhanced,
    children: createElement("img", {
      src: "/gallery/complete.12345678.webp", width: 480, height: 720,
      alt: "", sizes: "(max-width: 40rem) 50vw, 20rem",
    }),
  };
  const providerProps = {
    slides: [],
    labels: getBuiltInLabels("en").lightbox,
    children: undefined,
  };
  return renderToStaticMarkup(createElement(GalleryLightbox, providerProps,
    createElement(GalleryLightboxTrigger, triggerProps)));
}

describe("curated photograph server controls", () => {
  it("keeps a captionless photograph passive with its complete image and occurrence identity", () => {
    const html = renderTrigger();
    expect(html).toContain('<div data-item-id="occurrence-one"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("aria-haspopup");
    expect(html).not.toContain("aria-label");
    expect(html).not.toContain("cursor-zoom-in");
    expect(html).toContain('width="480" height="720" alt=""');
    expect(html).toContain('sizes="(max-width: 40rem) 50vw, 20rem"');
    expect(html).toContain('src="/gallery/complete.12345678.webp"');
  });

  it("retains the existing native caption dialog action", () => {
    const html = renderTrigger("caption-one");
    expect(html).toContain("<button");
    expect(html).toContain('popoverTarget="caption-one"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('data-item-id="occurrence-one"');
  });

  it("preserves the body figure's separately controlled enhancement contract", () => {
    const html = renderTrigger(undefined, false);
    expect(html).toContain("<button");
    expect(html).toContain('data-item-id="occurrence-one"');
  });
});
