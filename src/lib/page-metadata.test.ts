import { describe, expect, it } from "vitest";

import type { DeploymentConfig } from "@/lib/deployment-config";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { projectPublicImageMedia, type VideoMedia } from "@/lib/media";
import {
  buildLocaleShellMetadata,
  buildPageMetadata,
  buildSiteMetadata,
} from "@/lib/page-metadata";
import type { SiteSettings } from "@/lib/site-settings";

const settings: SiteSettings = {
  siteName: "Studio Example",
  photographerName: "Jane Example",
  tagline: "Timeless photography",
  navigation: [{ label: "Home", href: "/" }],
  contact: { email: "hello@studio-example.com" },
  socialLinks: [],
  footerLinks: [],
  copyrightHolder: "Studio Example",
  defaultSeo: {
    titleTemplate: "%s | Studio Example",
    description: "Professional photography services.",
  },
};

function buildDefaultSocialImage(alt: string) {
  return projectPublicImageMedia({
    mediaId: "deployment-default-social-image",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/default.1683eecb7e65.webp",
      version: "1683eecb7e65",
      width: 1536,
      height: 1024,
    },
    alt,
  });
}

const deployment: DeploymentConfig = {
  locale: "en-GB",
  localeRoutes: buildLocaleRouteConfig({
    locales: [{ locale: "en-GB", prefix: null, storyNamespace: "stories" }],
    reservedRootSegments: [],
    reservedLocaleRouteSegments: [],
  }),
  canonicalBaseUrl: new URL("https://example.com"),
  defaultSocialImage: buildDefaultSocialImage(
    "Rocky shoreline beside calm water",
  ),
};

const context = { settings, deployment };

const coverImage = projectPublicImageMedia({
  mediaId: "open-marsh",
  publiclyRenderable: true,
  rendition: {
    sourceKind: "public-web-derivative",
    src: "/gallery/open-marsh.e679c408d1ee.webp",
    version: "e679c408d1ee",
    width: 1200,
    height: 800,
  },
  alt: "Reflective water channel winding through an open marsh",
});

const coverVideo: VideoMedia = {
  type: "video",
  mediaId: "studio-tour",
  src: "https://example.com/media/studio-tour.mp4",
  title: "Studio tour",
  width: 1920,
  height: 1080,
};

/** Narrow view of the emitted Open Graph object used by the assertions. */
type EmittedOpenGraph = {
  readonly type?: string;
  readonly url?: string;
  readonly title?: unknown;
  readonly siteName?: string;
  readonly locale?: string;
  readonly description?: string;
  readonly publishedTime?: string;
  readonly images?: readonly {
    readonly url: string;
    readonly width?: number;
    readonly height?: number;
    readonly alt?: string;
  }[];
};

function openGraphOf(metadata: { openGraph?: unknown }): EmittedOpenGraph {
  return metadata.openGraph as EmittedOpenGraph;
}

describe("buildSiteMetadata", () => {
  it("composes site-wide defaults from settings and deployment values", () => {
    const metadata = buildSiteMetadata(context);

    expect(metadata.metadataBase?.href).toBe("https://example.com/");
    expect(metadata.title).toEqual({
      default: "Studio Example",
      template: "%s | Studio Example",
    });
    expect(metadata.description).toBe("Professional photography services.");
    expect(openGraphOf(metadata)).toMatchObject({
      type: "website",
      siteName: "Studio Example",
      locale: "en_GB",
      description: "Professional photography services.",
      images: [
        {
          url: "https://example.com/gallery/default.1683eecb7e65.webp",
          width: 1536,
          height: 1024,
          alt: "Rocky shoreline beside calm water",
        },
      ],
    });
  });

  it("claims no page identity that a route could inherit by accident", () => {
    const metadata = buildSiteMetadata(context);

    expect(metadata.alternates?.canonical).toBeUndefined();
    expect(openGraphOf(metadata).url).toBeUndefined();
  });
});

describe("buildPageMetadata canonical URLs", () => {
  it("resolves a route path against the configured canonical base URL", () => {
    const metadata = buildPageMetadata(
      { path: "/services/weddings", title: "Weddings" },
      context,
    );

    expect(metadata.alternates?.canonical).toBe(
      "https://example.com/services/weddings",
    );
    expect(openGraphOf(metadata).url).toBe(
      "https://example.com/services/weddings",
    );
  });

  it("keeps the site root as the one path carrying a trailing slash", () => {
    expect(buildPageMetadata({ path: "/" }, context).alternates?.canonical).toBe(
      "https://example.com/",
    );
    expect(
      buildPageMetadata({ path: "/services/" }, context).alternates?.canonical,
    ).toBe("https://example.com/services");
  });

  it("canonicalizes a filtered listing view to the path it is given", () => {
    // The blog route passes its unfiltered path for every category filter.
    const metadata = buildPageMetadata(
      { path: "/blog", title: "Blog" },
      context,
    );

    expect(metadata.alternates?.canonical).toBe("https://example.com/blog");
  });

  it("emits no robots directive by default", () => {
    const metadata = buildPageMetadata({ path: "/blog" }, context);

    expect(metadata.robots).toBeUndefined();
  });

  it("marks a page noindex, still follow, when asked to", () => {
    // ADR-0003 decision 8: a named gallery section view is `noindex` even
    // though its canonical points elsewhere — canonicalizing alone is not
    // sufficient, since a crawler may still index a non-canonical URL.
    const metadata = buildPageMetadata(
      { path: "/blog", noindex: true },
      context,
    );

    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("omits the robots directive when noindex is explicitly false", () => {
    const metadata = buildPageMetadata(
      { path: "/blog", noindex: false },
      context,
    );

    expect(metadata.robots).toBeUndefined();
  });
});

describe("buildPageMetadata titles and descriptions", () => {
  it("sets no title of its own when the page has none", () => {
    // The site root keeps the SiteSettings site name through the root default.
    const metadata = buildPageMetadata({ path: "/" }, context);

    expect(metadata.title).toBeUndefined();
  });

  it("leaves the Open Graph title to the resolved page title", () => {
    const metadata = buildPageMetadata(
      { path: "/blog/a-post", title: "A post" },
      context,
    );

    expect(metadata.title).toBe("A post");
    expect(openGraphOf(metadata).title).toBeUndefined();
  });

  it("falls back to the site description when the page has none", () => {
    const metadata = buildPageMetadata({ path: "/portfolio" }, context);

    expect(metadata.description).toBe("Professional photography services.");
    expect(openGraphOf(metadata).description).toBe(
      "Professional photography services.",
    );
  });

  it("prefers the page's own description", () => {
    const metadata = buildPageMetadata(
      { path: "/blog", description: "Notes on gear and technique." },
      context,
    );

    expect(metadata.description).toBe("Notes on gear and technique.");
    expect(openGraphOf(metadata).description).toBe(
      "Notes on gear and technique.",
    );
  });
});

describe("buildPageMetadata Open Graph images", () => {
  it("uses the page's own image with its true rendition dimensions", () => {
    const metadata = buildPageMetadata(
      { path: "/blog/a-post", title: "A post", image: coverImage },
      context,
    );

    expect(openGraphOf(metadata).images).toEqual([
      {
        url: "https://example.com/gallery/open-marsh.e679c408d1ee.webp",
        width: 1200,
        height: 800,
        alt: "Reflective water channel winding through an open marsh",
      },
    ]);
  });

  it("falls back to the deployment default when the page has no image", () => {
    const metadata = buildPageMetadata({ path: "/services" }, context);

    expect(openGraphOf(metadata).images).toEqual([
      {
        url: "https://example.com/gallery/default.1683eecb7e65.webp",
        width: 1536,
        height: 1024,
        alt: "Rocky shoreline beside calm water",
      },
    ]);
  });

  it("falls back to the deployment default for video media", () => {
    // Video posters are not modeled, so no still frame is invented for one.
    const metadata = buildPageMetadata(
      { path: "/services/video", image: coverVideo },
      context,
    );

    expect(openGraphOf(metadata).images?.[0]?.url).toBe(
      "https://example.com/gallery/default.1683eecb7e65.webp",
    );
  });

  it("omits alt text for a decorative image", () => {
    const decorative = projectPublicImageMedia({
      mediaId: "decorative",
      publiclyRenderable: true,
      rendition: {
        sourceKind: "public-web-derivative",
        src: "/gallery/lichen-stones.013e44e81dda.webp",
        version: "013e44e81dda",
        width: 1254,
        height: 1254,
      },
      alt: "",
    });

    const metadata = buildPageMetadata(
      { path: "/portfolio", image: decorative },
      context,
    );

    expect(openGraphOf(metadata).images?.[0]).not.toHaveProperty("alt");
  });

  it("omits alt text when the deployment declares none", () => {
    const metadata = buildPageMetadata(
      { path: "/services" },
      {
        settings,
        deployment: {
          ...deployment,
          defaultSocialImage: buildDefaultSocialImage(""),
        },
      },
    );

    expect(openGraphOf(metadata).images?.[0]).not.toHaveProperty("alt");
  });
});

describe("buildPageMetadata Open Graph locale and type", () => {
  it("converts the BCP 47 deployment locale to the Open Graph form", () => {
    expect(openGraphOf(buildPageMetadata({ path: "/" }, context)).locale).toBe(
      "en_GB",
    );
  });

  it("omits the locale when the deployment configures no territory", () => {
    const metadata = buildPageMetadata(
      { path: "/" },
      { settings, deployment: { ...deployment, locale: "fi" } },
    );

    expect(openGraphOf(metadata)).not.toHaveProperty("locale");
  });

  it("marks a page as a website unless it carries a publication date", () => {
    expect(openGraphOf(buildPageMetadata({ path: "/blog" }, context))).toMatchObject(
      { type: "website" },
    );
    expect(openGraphOf(buildPageMetadata({ path: "/blog" }, context))).not.toHaveProperty(
      "publishedTime",
    );
  });

  it("marks a dated page as an article", () => {
    const metadata = buildPageMetadata(
      {
        path: "/blog/a-post",
        title: "A post",
        publishedTime: "2024-09-12",
      },
      context,
    );

    expect(openGraphOf(metadata)).toMatchObject({
      type: "article",
      publishedTime: "2024-09-12",
    });
  });
});

/**
 * A bilingual deployment: unprefixed Finnish alongside English beneath `/en`,
 * which is the first production deployment's shape.
 */
const bilingualDeployment: DeploymentConfig = {
  ...deployment,
  locale: "fi-FI",
  localeRoutes: buildLocaleRouteConfig({
    locales: [
      { locale: "fi-FI", prefix: null, storyNamespace: "tarinat" },
      { locale: "en-GB", prefix: "en", storyNamespace: "stories" },
    ],
    reservedRootSegments: [],
    reservedLocaleRouteSegments: [],
  }),
};

const bilingualContext = { settings, deployment: bilingualDeployment };

const finnishVersion = {
  locale: "fi-FI",
  path: "/tarinat/maisemat/rannikon-aamut",
};
const englishVersion = {
  locale: "en-GB",
  path: "/en/stories/landscape/coastal-mornings",
};

describe("buildPageMetadata alternate-language links", () => {
  it("emits none for a page that names no locale versions", () => {
    const metadata = buildPageMetadata({ path: "/blog" }, bilingualContext);

    expect(metadata.alternates?.canonical).toBe("https://example.com/blog");
    expect(metadata.alternates).not.toHaveProperty("languages");
  });

  it("names every published version and points x-default at the default locale", () => {
    const metadata = buildPageMetadata(
      {
        path: finnishVersion.path,
        title: "Rannikon aamut",
        locale: "fi-FI",
        localeVersions: [finnishVersion, englishVersion],
      },
      bilingualContext,
    );

    expect(metadata.alternates?.canonical).toBe(
      "https://example.com/tarinat/maisemat/rannikon-aamut",
    );
    expect(metadata.alternates?.languages).toEqual({
      "fi-FI": "https://example.com/tarinat/maisemat/rannikon-aamut",
      "en-GB": "https://example.com/en/stories/landscape/coastal-mornings",
      "x-default": "https://example.com/tarinat/maisemat/rannikon-aamut",
    });
  });

  it("self-references the localized page it is emitted on", () => {
    const metadata = buildPageMetadata(
      {
        path: englishVersion.path,
        title: "Coastal mornings",
        locale: "en-GB",
        localeVersions: [finnishVersion, englishVersion],
      },
      bilingualContext,
    );

    expect(metadata.alternates?.canonical).toBe(
      "https://example.com/en/stories/landscape/coastal-mornings",
    );
    expect(metadata.alternates?.languages).toMatchObject({
      "en-GB": "https://example.com/en/stories/landscape/coastal-mornings",
    });
  });

  // Pointing x-default at another language would claim a translation that was
  // never published.
  it("omits x-default when the default locale publishes no version", () => {
    const metadata = buildPageMetadata(
      {
        path: englishVersion.path,
        title: "Coastal mornings",
        locale: "en-GB",
        localeVersions: [englishVersion],
      },
      bilingualContext,
    );

    expect(metadata.alternates?.languages).toEqual({
      "en-GB": "https://example.com/en/stories/landscape/coastal-mornings",
    });
  });

  it("takes the Open Graph locale from the page, not the deployment default", () => {
    const metadata = buildPageMetadata(
      { path: englishVersion.path, title: "Coastal mornings", locale: "en-GB" },
      bilingualContext,
    );

    expect(openGraphOf(metadata).locale).toBe("en_GB");
    expect(openGraphOf(buildPageMetadata({ path: "/" }, bilingualContext)).locale).toBe(
      "fi_FI",
    );
  });

  // The SiteSettings description is authored once, in the default locale. A
  // translated title above an untranslated description is what a search result
  // and a shared link would actually show, so the page says nothing instead.
  it("emits no description in a locale the site description is not written in", () => {
    const metadata = buildPageMetadata(
      { path: englishVersion.path, title: "Coastal mornings", locale: "en-GB" },
      bilingualContext,
    );

    expect(metadata.description).toBeUndefined();
    expect(openGraphOf(metadata).description).toBeUndefined();
  });

  it("omits the default image alt in a locale it was not authored in", () => {
    const metadata = buildPageMetadata(
      { path: englishVersion.path, title: "Coastal mornings", locale: "en-GB" },
      bilingualContext,
    );

    expect(openGraphOf(metadata).images?.[0]).toMatchObject({
      url: "https://example.com/gallery/default.1683eecb7e65.webp",
      width: 1536,
      height: 1024,
    });
    expect(openGraphOf(metadata).images?.[0]).not.toHaveProperty("alt");
  });

  it("keeps a localized page image alt supplied by that page", () => {
    const metadata = buildPageMetadata(
      {
        path: englishVersion.path,
        title: "Coastal mornings",
        locale: "en-GB",
        image: coverImage,
      },
      bilingualContext,
    );

    expect(openGraphOf(metadata).images?.[0]?.alt).toBe(
      "Reflective water channel winding through an open marsh",
    );
  });

  it("keeps the site description on a page in the locale it was authored in", () => {
    const metadata = buildPageMetadata({ path: "/tarinat" }, bilingualContext);

    expect(metadata.description).toBe("Professional photography services.");
    expect(openGraphOf(metadata).description).toBe(
      "Professional photography services.",
    );
  });

  it("keeps a description a localized page supplies itself", () => {
    const metadata = buildPageMetadata(
      {
        path: englishVersion.path,
        locale: "en-GB",
        description: "Photo stories.",
      },
      bilingualContext,
    );

    expect(metadata.description).toBe("Photo stories.");
    expect(openGraphOf(metadata).description).toBe("Photo stories.");
  });

  it("rejects a locale the deployment does not configure", () => {
    expect(() =>
      buildPageMetadata(
        { path: "/sv/berattelser", locale: "sv" },
        bilingualContext,
      ),
    ).toThrow('locale "sv" is not configured');
  });
});

describe("buildLocaleShellMetadata", () => {
  it("uses the prefixed route locale without copying default-locale text", () => {
    const metadata = buildLocaleShellMetadata(bilingualContext, "en-GB");

    expect(openGraphOf(metadata).locale).toBe("en_GB");
    expect(metadata.description).toBeUndefined();
    expect(openGraphOf(metadata)).not.toHaveProperty("description");
    expect(openGraphOf(metadata)).not.toHaveProperty("images");
  });

  it("rejects a route locale the deployment does not configure", () => {
    expect(() => buildLocaleShellMetadata(bilingualContext, "sv")).toThrow(
      'locale "sv" is not configured',
    );
  });
});
