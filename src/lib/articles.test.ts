import { describe, expect, it } from "vitest";

import { getArticles } from "@/lib/articles";

describe("getArticles", () => {
  it("filters articles by category", async () => {
    const articles = await getArticles("technique");

    expect(articles.map((article) => article.slug)).toEqual([
      "understanding-exposure-triangle",
      "shooting-in-low-light",
    ]);
    expect(
      articles.every((article) =>
        article.categories.some((category) => category.slug === "technique"),
      ),
    ).toBe(true);
  });

  it("returns an empty list for an unknown category", async () => {
    await expect(getArticles("unknown-category")).resolves.toEqual([]);
  });
});
