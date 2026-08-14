import { describe, expect, it } from "vitest";

import { homePageType } from "../../sanity/schemas/home-page";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import {
  HOME_PAGE_DOCUMENT_TYPE,
  HOME_PAGE_PROJECTION,
  PROJECTED_HOME_PAGE_FIELDS,
  projectHomeContent,
  readSanityHomeContent,
  SanityHomeContentError,
  type RawHomePageDocument,
} from "@/lib/sanity-home-content";
import { PUBLIC_MEDIA_PROJECTION } from "@/lib/sanity-media";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";

const routeConfig = buildLocaleRouteConfig({
  locales: [
    { locale: "fi-FI", prefix: null, storyNamespace: "tarinat" },
    { locale: "en-GB", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services"],
  reservedLocaleRouteSegments: ["services"],
});

const sanityConfig: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

const localized = (fi: string, en: string) => [
  { language: "fi", value: fi },
  { language: "en", value: en },
];

const assetName = "Tb9Ew8CXIwaY6R1kjMvI0uRR";
const heroMedia = {
  mediaId: "home-hero",
  mediaType: "image",
  publiclyRenderable: true,
  alt: localized("Tyyni rantamaisema", "A calm coastal landscape"),
  caption: [],
  credit: "Example credit",
  asset: {
    url: `https://cdn.sanity.io/images/${sanityConfig.projectId}/${sanityConfig.dataset}/${assetName}-1600x1067.webp`,
    path: `images/${sanityConfig.projectId}/${sanityConfig.dataset}/${assetName}-1600x1067.webp`,
    extension: "webp",
    mimeType: "image/webp",
    width: 1600,
    height: 1067,
  },
};

function documentOf(overrides: Partial<RawHomePageDocument> = {}): RawHomePageDocument {
  return {
    heroMedia,
    heroAction: { label: localized("Katso työt", "View work"), target: "featured-gallery" },
    intro: localized("Lyhyt esittely.", "A short introduction."),
    sections: [
      {
        title: localized("Palvelut", "Services"),
        description: localized("Näin voimme työskennellä yhdessä.", "How we can work together."),
        target: "static",
        href: "/services",
      },
      {
        title: localized("Tarinat", "Stories"),
        description: localized("Kuvallisia tarinoita.", "Stories in photographs."),
        target: "story-root",
      },
      {
        title: localized("Työt", "Work"),
        description: localized("Valittuja töitä.", "Selected work."),
        target: "featured-gallery",
      },
    ],
    ...overrides,
  };
}

const project = (
  document: RawHomePageDocument,
  featuredGalleryHref: string | null = "/tarinat/tyot/valitut",
) =>
  projectHomeContent(document, {
    language: "fi-FI",
    fallbackLanguage: "fi-FI",
    locale: "fi-FI",
    routeConfig,
    sanityConfig,
    ...(featuredGalleryHref === null ? {} : { featuredGalleryHref }),
  });

function fakeClient(answer: unknown): {
  client: SanityClient;
  requests: SanityQueryRequest[];
} {
  const requests: SanityQueryRequest[] = [];
  return {
    requests,
    client: {
      async query(request) {
        requests.push(request);
        return answer;
      },
    },
  };
}

describe("projecting Sanity home content", () => {
  it("uses the shared public-media boundary and resolves semantic links", () => {
    const home = project(documentOf());

    expect(home.hero.media).toMatchObject({
      type: "image",
      mediaId: "home-hero",
      alt: "Tyyni rantamaisema",
      rendition: { width: 1600, height: 1067 },
    });
    expect(home.hero.action).toEqual({ label: "Katso työt", href: "/tarinat/tyot/valitut" });
    expect(home.sections.map((section) => section.href)).toEqual([
      "/services",
      "/tarinat",
      "/tarinat/tyot/valitut",
    ]);
  });

  it("drops links to an unresolved featured gallery instead of publishing a dead route", () => {
    const home = project(documentOf(), null);

    expect(home.hero.action).toBeUndefined();
    expect(home.sections.map((section) => section.href)).toEqual(["/services", "/tarinat"]);
  });

  it("refuses missing media, untranslated required prose, and repeated destinations", () => {
    expect(() => project(documentOf({ heroMedia: null }))).toThrow(SanityHomeContentError);
    expect(() => project(documentOf({ sections: [] }))).toThrow(SanityHomeContentError);
    expect(() => project(documentOf({ intro: [{ language: "en", value: "English" }] }))).toThrow(
      SanityHomeContentError,
    );
    expect(() =>
      project(documentOf({
        sections: [
          { title: localized("A", "A"), description: localized("A", "A"), target: "static", href: "/services" },
          { title: localized("B", "B"), description: localized("B", "B"), target: "static", href: "/services" },
        ],
      })),
    ).toThrow(SanityHomeContentError);
  });

  it("does not leak provider fields through the hero projection", () => {
    const serialized = JSON.stringify(
      project(documentOf({ heroMedia: { ...heroMedia, archiveLocator: "/private/master.raw", _id: "media-doc" } })),
    );
    expect(serialized).not.toContain("archiveLocator");
    expect(serialized).not.toContain("media-doc");
  });
});

describe("reading the published home singleton", () => {
  it("embeds the authoritative public media projection", async () => {
    const { client, requests } = fakeClient([documentOf()]);
    await readSanityHomeContent({
      language: "fi",
      fallbackLanguage: "fi",
      locale: "fi-FI",
      routeConfig,
      featuredGalleryHref: "/tarinat/tyot/valitut",
      client,
      sanityConfig,
    });

    expect(HOME_PAGE_PROJECTION).toContain(PUBLIC_MEDIA_PROJECTION);
    expect(requests).toEqual([
      { query: `*[_type == "${HOME_PAGE_DOCUMENT_TYPE}"]${HOME_PAGE_PROJECTION}`, tag: "home-page" },
    ]);
    const declared = new Set(homePageType.fields.map((field) => field.name));
    for (const field of PROJECTED_HOME_PAGE_FIELDS) {
      expect(declared.has(field)).toBe(true);
      expect(HOME_PAGE_PROJECTION).toContain(field);
    }
  });

  it.each([
    [[], "missing-document"],
    [[documentOf(), documentOf()], "ambiguous-document"],
    [{}, "malformed-result"],
  ])("fails loudly for an unusable singleton result", async (answer, rejection) => {
    const { client } = fakeClient(answer);
    await expect(
      readSanityHomeContent({
        language: "fi",
        fallbackLanguage: "fi",
        locale: "fi-FI",
        routeConfig,
        client,
        sanityConfig,
      }),
    ).rejects.toMatchObject({ rejection });
  });
});
