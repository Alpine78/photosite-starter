import { describe, expect, it } from "vitest";

import { buildFallbackLanguageLinks, languageName } from "@/lib/language-fallback";

const storyRoots = [
  { locale: "fi", path: "/tarinat" },
  { locale: "en", path: "/en/stories" },
];

describe("buildFallbackLanguageLinks", () => {
  it("offers every other language's story root with the fallback note", () => {
    expect(buildFallbackLanguageLinks(storyRoots, "fi", "avaa kaikki tarinat")).toEqual([
      { locale: "en", label: languageName("en"), href: "/en/stories", note: "avaa kaikki tarinat" },
    ]);
  });

  it("never offers the page's own language", () => {
    expect(
      buildFallbackLanguageLinks(storyRoots, "en", "opens all stories").map((link) => link.locale),
    ).toEqual(["fi"]);
  });

  it("offers nothing when no other language has a public story root", () => {
    expect(buildFallbackLanguageLinks([{ locale: "fi", path: "/tarinat" }], "fi", "note")).toEqual(
      [],
    );
  });
});

describe("languageName", () => {
  it("names a language in that language", () => {
    expect(languageName("fi")).toBe("suomi");
  });
});
