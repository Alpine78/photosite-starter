import { describe, expect, it } from "vitest";

import {
  assertCategoryDescriptionBlocks,
  type CategoryDescriptionBlock,
} from "@/lib/category-description";

const paragraph = (text = "A short introduction"): CategoryDescriptionBlock => ({
  type: "paragraph",
  spans: [{ text }],
});

describe("category descriptions", () => {
  it("accepts paragraphs and lists with safe links and emphasis", () => {
    expect(() =>
      assertCategoryDescriptionBlocks([
        {
          type: "paragraph",
          spans: [
            { text: "See " },
            {
              text: "the service details",
              href: "/tarinat/services",
              marks: ["emphasis"],
            },
            { text: "." },
          ],
        },
        {
          type: "list",
          ordered: false,
          items: [{ spans: [{ text: "One collection" }] }],
        },
      ]),
    ).not.toThrow();
  });

  it.each([
    ["an empty description", []],
    ["an unsupported heading", [{ type: "heading", text: "Heading" }]],
    ["a script URL", [{ type: "paragraph", spans: [{ text: "Link", href: "javascript:alert(1)" }] }]],
    ["duplicate emphasis", [{ type: "paragraph", spans: [{ text: "Text", marks: ["emphasis", "emphasis"] }] }]],
  ])("rejects %s", (_case, blocks) => {
    expect(() =>
      assertCategoryDescriptionBlocks(
        blocks as unknown as readonly CategoryDescriptionBlock[],
      ),
    ).toThrow();
  });

  it("rejects a paragraph without text", () => {
    expect(() =>
      assertCategoryDescriptionBlocks([
        { type: "paragraph", spans: [] },
      ]),
    ).toThrow();
    expect(() => assertCategoryDescriptionBlocks([paragraph(" ")])).toThrow();
  });
});
