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

/**
 * The same history plus one retired *gallery* path.
 *
 * The shipped fixture records retired paths for categories and an article, and
 * a cursor means something different at each of the three — so a gallery that
 * has been renamed is the case the continuation rules actually turn on. It lives
 * here rather than in the mock because only this file needs it.
 */
const redirectsWithRetiredGallery: LocalizedContentRedirects = new Map([
  [
    "fi",
    buildContentRedirects(finnish, [
      ...mockContentRedirectInputs.fi,
      {
        kind: "content",
        id: "content-coastal-mornings",
        previousPath: ["maisemat", "rannikko", "rannikon-auringonnousut"],
      },
    ]),
  ],
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

    it("normalizes a configured locale prefix without leaving its language", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "EN",
          segments: ["stories", "landscape"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/en/stories/landscape",
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

    it("resolves a canonical content path in the unprefixed default space", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["tekniikka", "valotuskolmio-kaytannossa"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "story",
        locale: "fi",
        route: {
          kind: "content",
          contentId: "content-understanding-exposure-triangle",
          variant: "article",
        },
      });
    });

    it("resolves a gallery's canonical path, naming its variant", async () => {
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
      ).resolves.toEqual({
        kind: "story",
        locale: "fi",
        route: {
          kind: "content",
          contentId: "content-coastal-mornings",
          variant: "gallery",
        },
      });
    });

    it("redirects a differently cased gallery path to its canonical form", async () => {
      // A gallery earns the normalization redirects now that its route renders;
      // before it did, the same path answered 404 rather than teaching browsers
      // and crawlers a permanent redirect onto a dead address.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["Maisemat", "Rannikko", "Rannikon-Aamut"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/tarinat/maisemat/rannikko/rannikon-aamut",
      });
    });

    it("carries a gallery cursor through to the adapter", async () => {
      // A gallery owns a continuation contract and now issues tokens for it
      // (ADR-0003 decision 8), so this layer transports the value rather than
      // judging it. Only the adapter holds the signing key, so only the adapter
      // can tell a real slice boundary from a forgery.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat", "rannikko", "rannikon-aamut"],
          searchParams: { cursor: "AnOpaque-Token_v1" },
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "story",
        locale: "fi",
        route: {
          kind: "content",
          contentId: "content-coastal-mornings",
          variant: "gallery",
        },
        cursor: "AnOpaque-Token_v1",
      });
    });

    // Decision 8 splits two cases that look alike from the resolver: a good
    // token at an oddly spelled address still redirects, carrying its value
    // unchanged, while a token that names nothing answers 404 and creates no
    // redirect. Only the adapter can tell them apart, so it is injected.
    const validCursor = "AnOpaque-Token_v1";
    const namesASlice = () =>
      vi.fn(async (_locale: string, _contentId: string, cursor: string) =>
        cursor === validCursor,
      );

    const nonCanonicalGalleryPaths = [
      ["a casing variant", "tarinat", ["Maisemat", "Rannikko", "Rannikon-Aamut"]],
      [
        "a redundant default prefix",
        "fi",
        ["tarinat", "maisemat", "rannikko", "rannikon-aamut"],
      ],
      [
        "a retired gallery path",
        "tarinat",
        ["maisemat", "rannikko", "rannikon-auringonnousut"],
      ],
      [
        "a retired gallery path behind a redundant prefix",
        "fi",
        ["tarinat", "maisemat", "rannikko", "rannikon-auringonnousut"],
      ],
    ] as const;

    it.each(nonCanonicalGalleryPaths)(
      "redirects a valid gallery cursor reached through %s, keeping the token",
      async (_case, prefix, segments) => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects: redirectsWithRetiredGallery,
            prefix,
            segments,
            searchParams: { cursor: validCursor },
            defaultLocaleRouteExists: missing(),
            galleryCursorNamesASlice: namesASlice(),
          }),
        ).resolves.toEqual({
          kind: "redirect",
          location: `/tarinat/maisemat/rannikko/rannikon-aamut?cursor=${validCursor}`,
        });
      },
    );

    it.each(nonCanonicalGalleryPaths)(
      "404s an invalid gallery cursor reached through %s rather than redirecting",
      async (_case, prefix, segments) => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects: redirectsWithRetiredGallery,
            prefix,
            segments,
            searchParams: { cursor: "a-token-that-names-no-slice" },
            defaultLocaleRouteExists: missing(),
            galleryCursorNamesASlice: namesASlice(),
          }),
        ).resolves.toEqual({ kind: "not-found" });
      },
    );

    it("validates a cursor before removing a trailing slash", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat", "rannikko", "rannikon-aamut"],
          searchParams: { cursor: validCursor },
          defaultLocaleRouteExists: missing(),
          galleryCursorNamesASlice: namesASlice(),
          pathHasTrailingSlash: true,
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: `/tarinat/maisemat/rannikko/rannikon-aamut?cursor=${validCursor}`,
      });
    });

    it("404s an invalid cursor before removing a trailing slash", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat", "rannikko", "rannikon-aamut"],
          searchParams: { cursor: "a-token-that-names-no-slice" },
          defaultLocaleRouteExists: missing(),
          galleryCursorNamesASlice: namesASlice(),
          pathHasTrailingSlash: true,
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it("removes a trailing slash from a gallery with no cursor", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat", "rannikko", "rannikon-aamut"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
          pathHasTrailingSlash: true,
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/tarinat/maisemat/rannikko/rannikon-aamut",
      });
    });

    it("asks the adapter which gallery the token was presented for", async () => {
      const namesASliceSpy = namesASlice();

      await resolveLocalePrefixRequest({
        config,
        trees,
        redirects,
        prefix: "tarinat",
        segments: ["Maisemat", "Rannikko", "Rannikon-Aamut"],
        searchParams: { cursor: validCursor },
        defaultLocaleRouteExists: missing(),
        galleryCursorNamesASlice: namesASliceSpy,
      });

      expect(namesASliceSpy).toHaveBeenCalledWith(
        "fi",
        "content-coastal-mornings",
        validCursor,
        undefined,
      );
    });

    it("does not read a gallery to answer a canonical address", async () => {
      // The page validates the token while rendering, so validating here too
      // would read the same gallery twice on the common path.
      const namesASliceSpy = namesASlice();

      await resolveLocalePrefixRequest({
        config,
        trees,
        redirects,
        prefix: "tarinat",
        segments: ["maisemat", "rannikko", "rannikon-aamut"],
        searchParams: { cursor: validCursor },
        defaultLocaleRouteExists: missing(),
        galleryCursorNamesASlice: namesASliceSpy,
      });

      expect(namesASliceSpy).not.toHaveBeenCalled();
    });

    it("refuses rather than redirects when no validator is supplied", async () => {
      // Nothing has vouched for the token, so the strict answer is the safe one:
      // never emit a permanent redirect on trust.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["Maisemat", "Rannikko", "Rannikon-Aamut"],
          searchParams: { cursor: validCursor },
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it("redirects a non-canonical gallery path that carries no cursor", async () => {
      // The other half: refusing the token must not have made the path itself
      // unreachable through its variant spellings.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["Maisemat", "Rannikko", "Rannikon-Aamut"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/tarinat/maisemat/rannikko/rannikon-aamut",
      });
    });

    it("404s a repeated cursor on a gallery, which names no single slice", async () => {
      // A gallery continues from one bookmark. Two tokens name two positions,
      // so there is nothing to pass the adapter but a guess about which the
      // visitor meant — refused here, at the address requested.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat", "rannikko", "rannikon-aamut"],
          searchParams: { cursor: ["first-token", "second-token"] },
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    describe("gallery section filter", () => {
      // A section slug is valid only paired with the right cursor, so a mock
      // that ignores the section argument could not tell finding #3's
      // regression apart from correct behaviour: a cursor scoped to "early"
      // must be refused when checked against "late" or the unfiltered view.
      const sectionExists = () =>
        vi.fn(
          async (_locale: string, _contentId: string, section: string) =>
            section === "early" || section === "late",
        );
      const namesASliceForSection = () =>
        vi.fn(
          async (
            _locale: string,
            _contentId: string,
            cursor: string,
            section?: string,
          ) => cursor === "cursor-for-early" && section === "early",
        );

      it("ignores a section on a content page reached through a casing variant", async () => {
        // Mirrors the existing cursor case: `section` carries no meaning on an
        // article, so it neither blocks a redirect nor is ever validated.
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "tarinat",
            segments: ["Tekniikka", "Valotuskolmio-Kaytannossa"],
            searchParams: { section: "early" },
            defaultLocaleRouteExists: missing(),
            gallerySectionExists: sectionExists(),
          }),
        ).resolves.toEqual({
          kind: "redirect",
          location: "/tarinat/tekniikka/valotuskolmio-kaytannossa?section=early",
        });
      });

      it("carries a known section through to the adapter on the canonical path", async () => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "tarinat",
            segments: ["maisemat", "rannikko", "rannikon-aamut"],
            searchParams: { section: "early" },
            defaultLocaleRouteExists: missing(),
          }),
        ).resolves.toEqual({
          kind: "story",
          locale: "fi",
          route: {
            kind: "content",
            contentId: "content-coastal-mornings",
            variant: "gallery",
          },
          section: "early",
        });
      });

      it.each([["all"], [""]])(
        "redirects the redundant section alias %j to the parameter-free query",
        async (alias) => {
          await expect(
            resolveLocalePrefixRequest({
              config,
              trees,
              redirects,
              prefix: "tarinat",
              segments: ["maisemat", "rannikko", "rannikon-aamut"],
              searchParams: { section: alias },
              defaultLocaleRouteExists: missing(),
            }),
          ).resolves.toEqual({
            kind: "redirect",
            location: "/tarinat/maisemat/rannikko/rannikon-aamut",
          });
        },
      );

      it("strips a redundant section alias while keeping a valid cursor", async () => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "tarinat",
            segments: ["maisemat", "rannikko", "rannikon-aamut"],
            searchParams: { section: "all", cursor: validCursor },
            defaultLocaleRouteExists: missing(),
            galleryCursorNamesASlice: namesASlice(),
          }),
        ).resolves.toEqual({
          kind: "redirect",
          location: `/tarinat/maisemat/rannikko/rannikon-aamut?cursor=${validCursor}`,
        });
      });

      it("does not treat section=all as redundant on a non-gallery route", async () => {
        // The alias is meaningless there too, but decision 8 never redirects on
        // an unrecognized parameter — it is preserved like any other.
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "tarinat",
            segments: ["tekniikka", "valotuskolmio-kaytannossa"],
            searchParams: { section: "all" },
            defaultLocaleRouteExists: missing(),
          }),
        ).resolves.toEqual({
          kind: "story",
          locale: "fi",
          route: {
            kind: "content",
            contentId: "content-understanding-exposure-triangle",
            variant: "article",
          },
        });
      });

      it("404s an unknown section reached through a casing variant rather than redirecting", async () => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "tarinat",
            segments: ["Maisemat", "Rannikko", "Rannikon-Aamut"],
            searchParams: { section: "no-such-section" },
            defaultLocaleRouteExists: missing(),
            gallerySectionExists: sectionExists(),
          }),
        ).resolves.toEqual({ kind: "not-found" });
      });

      it("does not validate a section to answer an already-canonical address", async () => {
        // Mirrors the equivalent cursor behaviour: the page validates the
        // section while rendering, so nothing is read twice on the common path.
        const sectionExistsSpy = sectionExists();

        await resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat", "rannikko", "rannikon-aamut"],
          searchParams: { section: "early" },
          defaultLocaleRouteExists: missing(),
          gallerySectionExists: sectionExistsSpy,
        });

        expect(sectionExistsSpy).not.toHaveBeenCalled();
      });

      it("refuses an unvalidated section rather than redirecting on trust", async () => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "tarinat",
            segments: ["Maisemat", "Rannikko", "Rannikon-Aamut"],
            searchParams: { section: "early" },
            defaultLocaleRouteExists: missing(),
          }),
        ).resolves.toEqual({ kind: "not-found" });
      });

      it("404s a repeated section parameter on a canonical path, unconditionally", async () => {
        // Mirrors the existing repeated-cursor case exactly, including that
        // it is refused even though this path needs no other normalization:
        // two values name no single filter, so there is nothing to pass the
        // adapter but a guess about which the visitor meant. This is also
        // what keeps this layer agreeing with `/api/gallery`, which already
        // rejects a repeated `?section=` as an invalid request.
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "tarinat",
            segments: ["maisemat", "rannikko", "rannikon-aamut"],
            searchParams: { section: ["early", "late"] },
            defaultLocaleRouteExists: missing(),
            gallerySectionExists: sectionExists(),
          }),
        ).resolves.toEqual({ kind: "not-found" });
      });

      it("validates a cursor within its claimed section rather than the unfiltered view", async () => {
        // The regression this guards against: checking the cursor and the
        // section as two independent facts would validate "cursor-for-early"
        // against the unfiltered scope, find it wrong-scope, and 404 a request
        // that is actually valid.
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "tarinat",
            segments: ["Maisemat", "Rannikko", "Rannikon-Aamut"],
            searchParams: { section: "early", cursor: "cursor-for-early" },
            defaultLocaleRouteExists: missing(),
            galleryCursorNamesASlice: namesASliceForSection(),
            gallerySectionExists: sectionExists(),
          }),
        ).resolves.toEqual({
          kind: "redirect",
          location:
            "/tarinat/maisemat/rannikko/rannikon-aamut?section=early&cursor=cursor-for-early",
        });
      });

      it("404s a cursor scoped to a different section than the one requested", async () => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix: "tarinat",
            segments: ["Maisemat", "Rannikko", "Rannikon-Aamut"],
            searchParams: { section: "late", cursor: "cursor-for-early" },
            defaultLocaleRouteExists: missing(),
            galleryCursorNamesASlice: namesASliceForSection(),
            gallerySectionExists: sectionExists(),
          }),
        ).resolves.toEqual({ kind: "not-found" });
      });

      it("asks the adapter which section was presented for, on the same normalizing request", async () => {
        const sectionExistsSpy = sectionExists();

        await resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["Maisemat", "Rannikko", "Rannikon-Aamut"],
          searchParams: { section: "early" },
          defaultLocaleRouteExists: missing(),
          gallerySectionExists: sectionExistsSpy,
        });

        expect(sectionExistsSpy).toHaveBeenCalledWith(
          "fi",
          "content-coastal-mornings",
          "early",
        );
      });
    });

    it("resolves a canonical content path inside a locale prefix", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "en",
          segments: ["stories", "gear", "choosing-a-telephoto-lens"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "story",
        locale: "en",
        route: {
          kind: "content",
          contentId: "content-choosing-a-telephoto-lens",
          variant: "article",
        },
      });
    });

    it("redirects a differently cased content path to its canonical form", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "en",
          segments: ["stories", "Gear", "Choosing-A-Telephoto-Lens"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/en/stories/gear/choosing-a-telephoto-lens",
      });
    });

    it("404s a content slug beneath a category that only lists the page", async () => {
      // Only the canonical placement owns a detail route, so a secondary
      // listing's category has no page of that name to serve.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "en",
          segments: ["stories", "technique", "choosing-a-telephoto-lens"],
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

    it("redirects a renamed page's previous path to its current one", async () => {
      // The page kept its canonical category and changed only its own slug,
      // which is the third case ADR-0003 decision 7 records history for.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "en",
          segments: ["stories", "technique", "low-light-without-a-tripod"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/en/stories/technique/shooting-in-low-light",
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

    it("carries a category branch's cursor through on a canonical path (AB#140)", async () => {
      // The resolver transports the token; only the content adapter, which
      // holds the signing key, can tell a real slice from a forgery, so the
      // render layer validates it and 404s a bad one.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat"],
          searchParams: { cursor: "some-opaque-token" },
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "story",
        locale: "fi",
        route: { kind: "category", categoryId: "cat-landscape" },
        cursor: "some-opaque-token",
      });
    });

    it("404s a repeated category cursor, which names no single slice", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["maisemat"],
          searchParams: { cursor: ["a", "b"] },
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it("404s a category cursor at a casing variant when nothing vouches for it", async () => {
      // Normalizing, and no `categoryListingCursorNamesASlice` predicate: the
      // strict default refuses rather than redirect a token nothing validated.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["MAISEMAT"],
          searchParams: { cursor: "some-opaque-token" },
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it("redirects a category cursor at a casing variant, carrying the token, when it names a slice", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "tarinat",
          segments: ["MAISEMAT"],
          searchParams: { cursor: "some-opaque-token" },
          defaultLocaleRouteExists: missing(),
          categoryListingCursorNamesASlice: () => true,
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/tarinat/maisemat?cursor=some-opaque-token",
      });
    });

    it.each([
      ["a casing variant", "tarinat", ["MAISEMAT"]],
      ["a retired path", "tarinat", ["TAPAHTUMA"]],
      ["a locale-prefix variant", "EN", ["stories", "landscape"]],
      ["a redundant prefix", "fi", ["tarinat", "MAISEMAT"]],
    ])(
      "404s a cursor on %s without redirecting first",
      async (_case, prefix, segments) => {
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix,
            segments,
            searchParams: { cursor: "not-a-token-this-route-minted" },
            defaultLocaleRouteExists: missing(),
          }),
        ).resolves.toEqual({ kind: "not-found" });
      },
    );

    it.each([
      [
        "the canonical path",
        "tarinat",
        ["tekniikka", "valotuskolmio-kaytannossa"],
        undefined,
      ],
      [
        "a casing variant",
        "tarinat",
        ["Tekniikka", "Valotuskolmio-Kaytannossa"],
        "/tarinat/tekniikka/valotuskolmio-kaytannossa?cursor=utm-style-noise",
      ],
      [
        "a redundant default prefix",
        "fi",
        ["tarinat", "tekniikka", "valotuskolmio-kaytannossa"],
        "/tarinat/tekniikka/valotuskolmio-kaytannossa?cursor=utm-style-noise",
      ],
    ])(
      "ignores a cursor on a content page reached through %s",
      async (_case, prefix, segments, location) => {
        // A content page owns no continuation contract, so `cursor` is an
        // unrecognized parameter there: ADR-0003 decision 8 reads what it knows
        // and ignores the rest rather than turning a real page into a 404.
        await expect(
          resolveLocalePrefixRequest({
            config,
            trees,
            redirects,
            prefix,
            segments: segments as string[],
            searchParams: { cursor: "utm-style-noise" },
            defaultLocaleRouteExists: missing(),
          }),
        ).resolves.toEqual(
          location === undefined
            ? {
                kind: "story",
                locale: "fi",
                route: {
                  kind: "content",
                  contentId: "content-understanding-exposure-triangle",
                  variant: "article",
                },
              }
            : { kind: "redirect", location },
        );
      },
    );

    it("ignores a cursor on a retired content path, which redirects as usual", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "en",
          segments: ["stories", "technique", "low-light-without-a-tripod"],
          searchParams: { cursor: "utm-style-noise" },
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location:
          "/en/stories/technique/shooting-in-low-light?cursor=utm-style-noise",
      });
    });
  });

  describe("history whose current target has no route", () => {
    /**
     * A tree where a renamed category has since been emptied. ADR-0003 decision
     * 4 keeps an empty leaf out of the public route space, while history records
     * the rename regardless — so the route layer is the last thing standing
     * between a visitor and a permanent redirect onto a 404.
     */
    const emptiedTree = buildContentTree({
      categories: [
        {
          categoryId: "cat-series",
          parentId: null,
          slug: "series",
          label: "Series",
          order: 0,
        },
        {
          categoryId: "cat-emptied",
          parentId: null,
          slug: "gear",
          label: "Gear",
          order: 1,
        },
      ],
      placements: [
        {
          contentId: "content-series",
          variant: "gallery",
          slug: "current-series",
          published: true,
          canonicalCategoryId: "cat-series",
        },
      ],
    });

    const emptiedTrees: LocalizedContentTrees = new Map([["fi", emptiedTree]]);
    const emptiedRedirects: LocalizedContentRedirects = new Map([
      [
        "fi",
        buildContentRedirects(emptiedTree, [
          {
            kind: "category",
            id: "cat-emptied",
            previousPath: ["equipment"],
          },
        ]),
      ],
    ]);

    it("404s rather than redirecting permanently onto a branch that 404s", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees: emptiedTrees,
          redirects: emptiedRedirects,
          prefix: "tarinat",
          segments: ["equipment"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({ kind: "not-found" });
    });

    it("still resolves a retired path onto a gallery, now that galleries route", async () => {
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees: emptiedTrees,
          redirects: new Map([
            [
              "fi",
              buildContentRedirects(emptiedTree, [
                {
                  kind: "content",
                  id: "content-series",
                  previousPath: ["series", "retired-series"],
                },
              ]),
            ],
          ]),
          prefix: "tarinat",
          segments: ["series", "retired-series"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/tarinat/series/current-series",
      });
    });

    it("still redirects a retired path whose target does resolve", async () => {
      // The same history mechanism, differing only in whether the current
      // canonical target is a route this application serves.
      await expect(
        resolveLocalePrefixRequest({
          config,
          trees,
          redirects,
          prefix: "en",
          segments: ["stories", "technique", "low-light-without-a-tripod"],
          searchParams: {},
          defaultLocaleRouteExists: missing(),
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: "/en/stories/technique/shooting-in-low-light",
      });
    });
  });

  describe("gallery enquiry action state (?enquire=)", () => {
    // The canonical Finnish path of the `content-coastal-mornings` gallery.
    const GALLERY_SEGMENTS = ["maisemat", "rannikko", "rannikon-aamut"];
    const GALLERY_PATH = "/tarinat/maisemat/rannikko/rannikon-aamut";
    const ITEM = "coastal-mornings-coastal-landscape";

    const call = (
      segments: readonly string[],
      searchParams: Record<string, string | string[] | undefined>,
      prefix = "tarinat",
    ) =>
      resolveLocalePrefixRequest({
        config,
        trees,
        redirects,
        prefix,
        segments,
        searchParams,
        defaultLocaleRouteExists: missing(),
        galleryCursorNamesASlice: vi.fn().mockResolvedValue(true),
        gallerySectionExists: vi.fn().mockResolvedValue(true),
      });

    it("resolves an enquiry action state on a canonical gallery path", async () => {
      await expect(call(GALLERY_SEGMENTS, { enquire: ITEM })).resolves.toEqual({
        kind: "story",
        locale: "fi",
        route: {
          kind: "content",
          contentId: "content-coastal-mornings",
          variant: "gallery",
        },
        enquire: ITEM,
      });
    });

    it("carries ?enquire= through a casing-normalization redirect, unchanged", async () => {
      await expect(
        call(["Maisemat", "Rannikko", "Rannikon-Aamut"], { enquire: ITEM }),
      ).resolves.toEqual({
        kind: "redirect",
        location: `${GALLERY_PATH}?enquire=${ITEM}`,
      });
    });

    it("carries ?enquire= through a redundant-default-prefix redirect", async () => {
      await expect(
        call(
          ["tarinat", "maisemat", "rannikko", "rannikon-aamut"],
          { enquire: ITEM },
          "fi",
        ),
      ).resolves.toEqual({
        kind: "redirect",
        location: `${GALLERY_PATH}?enquire=${ITEM}`,
      });
    });

    it("preserves an unrelated unknown parameter alongside ?enquire= on a redirect", async () => {
      await expect(
        call(["Maisemat", "Rannikko", "Rannikon-Aamut"], {
          enquire: ITEM,
          utm_source: "newsletter",
        }),
      ).resolves.toEqual({
        kind: "redirect",
        location: `${GALLERY_PATH}?enquire=${ITEM}&utm_source=newsletter`,
      });
    });

    it.each([
      ["a cursor, on the canonical path", GALLERY_SEGMENTS, { enquire: ITEM, cursor: "AnOpaque-Token_v1" }],
      ["a section, on the canonical path", GALLERY_SEGMENTS, { enquire: ITEM, section: "early" }],
      ["a cursor, on a casing variant", ["Maisemat", "Rannikko", "Rannikon-Aamut"], { enquire: ITEM, cursor: "AnOpaque-Token_v1" }],
      ["a section, on a casing variant", ["Maisemat", "Rannikko", "Rannikon-Aamut"], { enquire: ITEM, section: "early" }],
    ] as const)("404s ?enquire= combined with %s, without a redirect", async (_label, segments, params) => {
      await expect(call(segments, params)).resolves.toEqual({ kind: "not-found" });
    });

    it("ignores a repeated ?enquire= as an unknown parameter (renders the gallery)", async () => {
      await expect(
        call(GALLERY_SEGMENTS, { enquire: ["a", "b"] }),
      ).resolves.toEqual({
        kind: "story",
        locale: "fi",
        route: {
          kind: "content",
          contentId: "content-coastal-mornings",
          variant: "gallery",
        },
      });
    });

    it.each(["Not_An_Id", "-leading", "trailing-", "double--hyphen", "a".repeat(300)])(
      "ignores a malformed ?enquire=%j as an unknown parameter",
      async (enquire) => {
        await expect(call(GALLERY_SEGMENTS, { enquire })).resolves.toMatchObject({
          kind: "story",
          route: { contentId: "content-coastal-mornings" },
        });
        await expect(
          call(GALLERY_SEGMENTS, { enquire }),
        ).resolves.not.toHaveProperty("enquire");
      },
    );

    it("does not recognize ?enquire= on an article route", async () => {
      await expect(
        call(["tekniikka", "valotuskolmio-kaytannossa"], { enquire: ITEM }),
      ).resolves.toMatchObject({
        kind: "story",
        route: { variant: "article" },
      });
      await expect(
        call(["tekniikka", "valotuskolmio-kaytannossa"], { enquire: ITEM }),
      ).resolves.not.toHaveProperty("enquire");
    });
  });
});
