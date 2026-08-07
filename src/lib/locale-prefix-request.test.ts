import { describe, expect, it, vi } from "vitest";

import { buildContentRedirects } from "@/lib/content-redirects";
import { buildContentTree } from "@/lib/content-tree";
import { resolveLocalePrefixRequest } from "@/lib/locale-prefix-request";
import type { LocalizedContentRedirects } from "@/lib/locale-prefix-request";
import {
  buildLocaleRouteConfig,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";
import {
  mockContentRedirectInputs,
  mockContentTreeInputs,
} from "@/lib/mock-content-tree";

const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat" },
    { locale: "en", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services"],
  reservedLocaleRouteSegments: ["services"],
});

/** Both locales publish, so a branch resolves in either route space. */
const finnish = buildContentTree(mockContentTreeInputs.fi);
const english = buildContentTree(mockContentTreeInputs.en);

const trees: LocalizedContentTrees = new Map([
  ["fi", finnish],
  ["en", english],
]);

const redirects: LocalizedContentRedirects = new Map([
  ["fi", buildContentRedirects(finnish, mockContentRedirectInputs.fi)],
  ["en", buildContentRedirects(english, mockContentRedirectInputs.en)],
]);

/** A deployment whose content is still being authored. */
const noTrees: LocalizedContentTrees = new Map();

const missing = () => vi.fn().mockResolvedValue(false);

describe("resolveLocalePrefixRequest", () => {
  it("redirects a redundant default prefix only when the exact route exists", async () => {
    const defaultLocaleRouteExists = vi.fn().mockResolvedValue(true);

    await expect(
      resolveLocalePrefixRequest({
        config,
        trees,
        redirects,
        prefix: "fi",
        segments: ["services", "portraits"],
        searchParams: {},
        defaultLocaleRouteExists,
      }),
    ).resolves.toEqual({
      kind: "redirect",
      location: "/services/portraits",
    });
    expect(defaultLocaleRouteExists).toHaveBeenCalledWith(
      "/services/portraits",
    );
  });

  it("redirects a redundant default prefix on a category the tree owns", async () => {
    await expect(
      resolveLocalePrefixRequest({
        config,
        trees,
        redirects,
        prefix: "fi",
        segments: ["tarinat", "maisemat"],
        searchParams: {},
        defaultLocaleRouteExists: missing(),
      }),
    ).resolves.toEqual({ kind: "redirect", location: "/tarinat/maisemat" });
  });

  it("returns not-found when the unprefixed target does not exist", async () => {
    await expect(
      resolveLocalePrefixRequest({
        config,
        trees,
        redirects,
        prefix: "fi",
        segments: ["nothing-here"],
        searchParams: {},
        defaultLocaleRouteExists: missing(),
      }),
    ).resolves.toEqual({ kind: "not-found" });
  });

  it("never redirects an unknown prefix", async () => {
    const defaultLocaleRouteExists = vi.fn();

    await expect(
      resolveLocalePrefixRequest({
        config,
        trees,
        redirects,
        prefix: "sv",
        segments: ["berattelser"],
        searchParams: {},
        defaultLocaleRouteExists,
      }),
    ).resolves.toEqual({ kind: "not-found" });
    expect(defaultLocaleRouteExists).not.toHaveBeenCalled();
  });

  it.each([["/services"], ["\\services"], [".."], ["."]])(
    "rejects an unsafe canonical segment %j before route lookup",
    async (segment) => {
      const defaultLocaleRouteExists = vi.fn().mockResolvedValue(true);

      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "fi",
          segments: [segment],
          searchParams: {},
          defaultLocaleRouteExists,
        }),
      ).resolves.toEqual({ kind: "not-found" });
      expect(defaultLocaleRouteExists).not.toHaveBeenCalled();
    },
  );

  it("preserves repeated query values and encodes them as data", async () => {
    await expect(
      resolveLocalePrefixRequest({
        config,
        trees,
        redirects,
        prefix: "fi",
        searchParams: {
          tag: ["one", "two"],
          next: "/services?draft=true&mode=full",
          absent: undefined,
        },
        defaultLocaleRouteExists: vi.fn().mockResolvedValue(true),
      }),
    ).resolves.toEqual({
      kind: "redirect",
      location:
        "/?tag=one&tag=two&next=%2Fservices%3Fdraft%3Dtrue%26mode%3Dfull",
    });
  });

  describe("public content-tree branches", () => {
    it("resolves the story root in the unprefixed default space", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "story",
        locale: "fi",
        route: { kind: "story-root" },
      });
    });

    it("resolves a nested category in the unprefixed default space", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat", "rannikko"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "story",
        locale: "fi",
        route: { kind: "category", categoryId: "cat-coastal" },
      });
    });

    it("resolves a branch inside a configured locale prefix", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "en",
          segments: ["stories", "landscape"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "story",
        locale: "en",
        route: { kind: "category", categoryId: "cat-landscape" },
      });
    });

    it("404s a locale that publishes no tree instead of serving another one's", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees: noTrees,
          redirects,
          prefix: "en",
          segments: ["stories", "landscape"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it("404s an empty leaf, which owns no public route", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["arkisto"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it("404s an unknown branch rather than redirecting to its ancestor", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat", "ei-olemassa"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it("404s a canonical content path, whose route is not built yet", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat", "rannikko", "rannikon-aamut"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it.each([
      [
        "the unprefixed space",
        "tarinat",
        ["Maisemat", "RANNIKKO"],
        "/tarinat/maisemat/rannikko",
      ],
      [
        "a prefixed locale",
        "en",
        ["Stories", "Landscape"],
        "/en/stories/landscape",
      ],
    ])(
      "redirects a differently cased path to its canonical form in %s",
      async (_space, prefix, segments, location) => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix,
            segments,
            searchParams: { utm_source: "newsletter" },
            defaultLocaleRouteExists: missing(),
          }),
        ).resolves.toEqual({
          kind: "redirect",
          location: `${location}?utm_source=newsletter`,
        });
      },
    );

    it("ignores an unrecognized parameter instead of redirecting on it", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat"],
          searchParams: { utm_source: "newsletter" },
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "story",
        locale: "fi",
        route: { kind: "category", categoryId: "cat-landscape" },
      });
    });

    it("redirects a renamed category's previous path to its current one", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["tapahtuma"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/tarinat/tapahtumat",
      });
    });

    it("redirects a moved category to its new ancestry", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "en",
          segments: ["stories", "coastal"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/en/stories/landscape/coastal",
      });
    });

    it("normalizes casing on a retired path in one redirect", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["TAPAHTUMA"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/tarinat/tapahtumat",
      });
    });

    it.each([
      [
        "a live category",
        ["tarinat", "MAISEMAT"],
        "/tarinat/maisemat",
      ],
      ["a retired category", ["tarinat", "tapahtuma"], "/tarinat/tapahtumat"],
      ["a static route", ["SERVICES"], "/services"],
    ])(
      "resolves the redundant default prefix on %s in one hop",
      async (_case, segments, location) => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "fi",
            segments,
            searchParams: {},
            defaultLocaleRouteExists: vi.fn().mockResolvedValue(true),
          }),
        ).resolves.toEqual({ kind: "redirect", location });
      },
    );

    it("keeps a language's history inside that language", async () => {
      // `tapahtuma` is Finnish history; the English space has never served it.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "en",
          segments: ["stories", "tapahtuma"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it("404s a cursor, because no category cursor has been issued yet", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat"],
          searchParams: { cursor: "not-a-token-this-route-minted" },
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });
  });
});
