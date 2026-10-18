import { describe, expect, it, vi } from "vitest";
import { buildContentTree } from "@/lib/content-tree";
import { buildContentRedirects } from "@/lib/content-redirects";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { resolveLocalePrefixRequest } from "@/lib/locale-prefix-request";
import {
  mockContentTreeInputs,
  mockContentRedirectInputs,
} from "@/lib/mock-content-tree";
import { resolveArticleEndSection } from "@/lib/article-end-gallery-selection";
import {
  FILTER_ARTICLE_ID,
  mockArticleEndSections,
} from "@/lib/mock-article-end-sections";
const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat" },
    { locale: "en", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: [],
  reservedLocaleRouteSegments: [],
});
const trees = new Map(
  ["fi", "en"].map((locale) => [
    locale,
    buildContentTree(mockContentTreeInputs[locale as "fi" | "en"]),
  ]),
);
const redirects = new Map(
  ["fi", "en"].map((locale) => [
    locale,
    buildContentRedirects(trees.get(locale)!, [
      ...mockContentRedirectInputs[locale as "fi" | "en"],
      {
        kind: "content" as const,
        id: FILTER_ARTICLE_ID,
        previousPath: ["notes", "old-image-notes"],
      },
    ]),
  ]),
);
const selection = (
  locale: string,
  contentId: string,
  raw: string | readonly string[] | undefined,
) =>
  resolveArticleEndSection(
    contentId === FILTER_ARTICLE_ID
      ? { endGallerySections: mockArticleEndSections(locale) }
      : {},
    raw,
  );
const cursor = vi.fn(async () => true);
function resolve(
  searchParams: Record<string, string | string[] | undefined>,
  prefix = "tarinat",
  segments = ["maisemat", "kuvamuistiinpanot"],
  trailing = false,
) {
  return resolveLocalePrefixRequest({
    config,
    trees,
    redirects,
    prefix,
    segments,
    searchParams,
    defaultLocaleRouteExists: () => false,
    articleSectionSelection: selection,
    articleEndGalleryCursorNamesASlice: cursor,
    pathHasTrailingSlash: trailing,
  });
}
describe("opted-in article sections across every canonicalization path", () => {
  it("carries canonical selection and normalizes aliases while preserving other query multiplicity", async () => {
    expect(await resolve({ section: "pinnat" })).toMatchObject({
      kind: "story",
      section: "pinnat",
    });
    expect(
      await resolve({ section: "all", cursor: "All-token", a: ["1", "2"] }),
    ).toEqual({
      kind: "redirect",
      location: "/tarinat/maisemat/kuvamuistiinpanot?cursor=All-token&a=1&a=2",
    });
    expect(cursor).toHaveBeenCalledWith("fi", FILTER_ARTICLE_ID, "All-token");
  });
  it.each([
    { raw: ["pinnat", "pinnat"] },
    { raw: "soft-light" },
    { raw: "missing" },
    { raw: "x/y" },
  ])(
    "refuses invalid/foreign selectors before cursor lookup and any redirect: %j",
    async ({ raw }) => {
      for (const [prefix, segments] of [
        ["fi", ["tarinat", "maisemat", "kuvamuistiinpanot"]],
        ["tarinat", ["MAISEMAT", "kuvamuistiinpanot"]],
        ["tarinat", ["notes", "old-image-notes"]],
      ] as const) {
        cursor.mockClear();
        expect(
          await resolve(
            { section: raw, cursor: "token" },
            prefix,
            [...segments],
            true,
          ),
        ).toEqual({ kind: "not-found" });
        expect(cursor).not.toHaveBeenCalled();
      }
    },
  );
  it("validates the selected token pair before redundant, case, retired and trailing-slash redirects", async () => {
    for (const [prefix, segments] of [
      ["fi", ["tarinat", "maisemat", "kuvamuistiinpanot"]],
      ["tarinat", ["MAISEMAT", "kuvamuistiinpanot"]],
      ["tarinat", ["notes", "old-image-notes"]],
    ] as const) {
      cursor.mockClear();
      expect(
        await resolve(
          { section: "pinnat", cursor: "selected-token" },
          prefix,
          [...segments],
          true,
        ),
      ).toEqual({
        kind: "redirect",
        location:
          "/tarinat/maisemat/kuvamuistiinpanot?section=pinnat&cursor=selected-token",
      });
      expect(cursor).toHaveBeenCalledWith(
        "fi",
        FILTER_ARTICLE_ID,
        "selected-token",
        "pinnat",
      );
    }
  });
  it("leaves incidental repeated section parameters on legacy articles alone", async () => {
    expect(
      await resolve({ section: ["x", "y"] }, "tarinat", [
        "maisemat",
        "rannikon-valon-lukeminen",
      ]),
    ).toMatchObject({ kind: "story" });
    expect(
      await resolve({ section: ["x", "y"] }, "fi", [
        "tarinat",
        "maisemat",
        "rannikon-valon-lukeminen",
      ]),
    ).toEqual({
      kind: "redirect",
      location:
        "/tarinat/maisemat/rannikon-valon-lukeminen?section=x&section=y",
    });
  });
});
