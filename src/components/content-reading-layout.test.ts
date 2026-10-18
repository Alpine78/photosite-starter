import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentReadingLayout } from "./content-reading-layout";

describe("the shared reading layout", () => {
  it("keeps one native, nested contents list between the introduction and body", () => {
    const html = renderToStaticMarkup(ContentReadingLayout({
      label: "Contents",
      headings: [
        { id: "section-first", text: "First", level: 2 },
        { id: "section-child", text: "Child", level: 3 },
        { id: "section-detail", text: "Detail", level: 4 },
      ],
      intro: createElement("h1", null, "Introduction"),
      children: createElement("p", null, "Editorial body"),
    }));
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Contents"');
    expect(html).toContain('href="#section-detail"');
    expect(html).toMatch(/First<\/a><ol[^>]*><li><a[^>]*>Child<\/a><ol[^>]*><li><a[^>]*>Detail/);
    expect(html.indexOf("Introduction")).toBeLessThan(html.indexOf("<nav"));
    expect(html.indexOf("</nav>")).toBeLessThan(html.indexOf("Editorial body"));
    expect(html).not.toContain("<button");
  });

  it("omits the empty navigation without omitting the editorial body", () => {
    const html = renderToStaticMarkup(ContentReadingLayout({
      label: "Contents", headings: [], children: "Editorial body",
    }));
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("content-reading-row--with-nav");
    expect(html).toContain("Editorial body");
  });

  it("preserves a gallery's leading grid link even without authored headings", () => {
    const html = renderToStaticMarkup(ContentReadingLayout({
      label: "Contents", headings: [],
      leadingLink: { href: "#gallery", label: "Images" },
      children: "Editorial body",
    }));
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html).toContain('href="#gallery"');
    expect(html).toContain("content-reading-row--with-nav");
    expect(html.indexOf("Images")).toBeLessThan(html.indexOf("Editorial body"));
  });
});
