import { describe, expect, it } from "vitest";

import {
  assertCategoryDescriptionBlocks,
  MAX_CATEGORY_DESCRIPTION_BLOCKS,
  type CategoryDescriptionBlock,
} from "@/lib/category-description";

const paragraph = (text = "A short introduction"): CategoryDescriptionBlock => ({
  type: "paragraph",
  spans: [{ text }],
});

describe("category descriptions", () => {
  it("preserves a seven-paragraph introduction while keeping a finite block limit", () => {
    expect(() => assertCategoryDescriptionBlocks(Array.from({ length: 7 }, () => paragraph()))).not.toThrow();
    expect(() => assertCategoryDescriptionBlocks(Array.from({ length: MAX_CATEGORY_DESCRIPTION_BLOCKS + 1 }, () => paragraph()))).toThrow();
  });
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
