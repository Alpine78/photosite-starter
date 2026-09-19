import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CategoryDescription } from "@/components/category-description";

describe("CategoryDescription", () => {
  it("renders paragraphs, lists, and safe link semantics without another heading", () => {
    const markup = renderToStaticMarkup(
      CategoryDescription({
        blocks: [
          {
            type: "paragraph",
            spans: [
              { text: "Read " },
              { text: "more", href: "/tarinat/services", marks: ["emphasis"] },
              { text: "." },
            ],
          },
          {
            type: "list",
            ordered: true,
            items: [{ spans: [{ text: "First album" }] }],
          },
          {
            type: "paragraph",
            spans: [
              { text: "External", href: "https://example.com" },
            ],
          },
        ],
      }),
    );

    expect(markup).toContain("<p>Read <a href=\"/tarinat/services\"");
    expect(markup).toContain("<em>more</em>");
    expect(markup).toContain("<ol");
    expect(markup).toContain("<li>First album</li>");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain("<h2");
  });
});
