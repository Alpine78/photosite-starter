import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JsonLd } from "@/components/json-ld";
import type { DeploymentConfig } from "@/lib/deployment-config";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { projectPublicImageMedia } from "@/lib/media";
import type { Service } from "@/lib/services";
import type { SiteSettings } from "@/lib/site-settings";
import {
  buildArticleJsonLd,
  buildOrganizationJsonLd,
  buildServiceJsonLd,
  buildWebSiteJsonLd,
  serializeJsonLd,
  type JsonLdObject,
} from "@/lib/structured-data";
import type { ArticleContentPage } from "@/lib/content-page";

const deployment: DeploymentConfig = {
  stage: "production",
  contentSource: "mock",
  locale: "en-GB",
  localeRoutes: buildLocaleRouteConfig({
    locales: [{ locale: "en-GB", prefix: null, storyNamespace: "stories" }],
    reservedRootSegments: [],
    reservedLocaleRouteSegments: [],
  }),
  canonicalBaseUrl: new URL("https://studio.example"),
  defaultSocialImage: projectPublicImageMedia({
    mediaId: "deployment-default-social-image",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/default.1683eecb7e65.webp",
      version: "1683eecb7e65",
      width: 1536,
      height: 1024,
    },
    alt: "Rocky shoreline beside calm water",
  }),
  privateGallery: { store: "off", routePrefix: "private" },
};

const localCover = projectPublicImageMedia({
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

const cdnCover = projectPublicImageMedia({
  mediaId: "cdn-cover",
  publiclyRenderable: true,
  rendition: {
    sourceKind: "public-web-derivative",
    src: "https://cdn.sanity.io/images/p/d/abcdef012345-1200x800.webp",
    version: "abcdef012345",
    width: 1200,
    height: 800,
  },
  alt: "A remote public derivative",
});

const settings: SiteSettings = {
  siteName: "Studio Example",
  photographerName: "Jane Example",
  tagline: "Timeless photography",
  navigation: [],
  contact: {
    email: "hello@studio.example",
    privacyNotice: {
      collected: "Your name, email address, and message.",
      purpose: "Answering your enquiry.",
      recipient: "Studio Example, delivered by our email provider.",
      retention: "Kept in our mailbox for as long as answering you requires.",
    },
  },
  socialLinks: [
    {
      platform: "instagram",
      url: "https://instagram.com/studioexample",
      label: "Studio Example on Instagram",
    },
    {
      platform: "facebook",
      url: "https://facebook.com/studioexample",
      label: "Studio Example on Facebook",
    },
  ],
  footerLinks: [],
  copyrightHolder: "Studio Example",
  defaultSeo: {
    titleTemplate: "%s | Studio Example",
    description: "Professional photography services.",
  },
};

const service: Service = {
  slug: "weddings",
  name: "Weddings",
  shortDescription: "Full-day storytelling coverage.",
  description: ["Documentary-style coverage.", "Placeholder copy."],
  coverMedia: localCover,
  startingPrice: "From 1 400 €",
  pricing: [{ name: "Full day", price: "2 200 €", note: "Twelve hours." }],
};

const article: ArticleContentPage = {
  variant: "article",
  contentId: "article-reading-coastal-light",
  title: "Reading coastal light",
  summary: "How an overcast morning shapes a frame.",
  publishedAt: "2026-05-02",
  cover: localCover,
  tags: ["light", "landscape"],
  body: [{ type: "paragraph", text: "The morning was grey." }],
};

/** The single JSON-LD payload the JsonLd component rendered for `data`. */
function renderedPayloads(markup: string): unknown[] {
  const payloads: unknown[] = [];
  const pattern =
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  for (const match of markup.matchAll(pattern)) {
    payloads.push(JSON.parse(match[1]));
  }
  return payloads;
}

describe("serializeJsonLd", () => {
  it("round-trips every value through JSON.parse unchanged", () => {
    const value: JsonLdObject = {
      "@type": "Thing",
      name: "A & B <c> \u2028 line",
      nested: { list: ["x", "y"] },
    };
    expect(JSON.parse(serializeJsonLd(value))).toEqual(value);
  });

  it("escapes the characters that could terminate a <script> block", () => {
    const value: JsonLdObject = {
      name: "</script><script>alert(1)</ScRiPt>",
      note: "a & b > c",
      sep: "before\u2028after\u2029end",
    };
    const serialized = serializeJsonLd(value);

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(serialized).toContain("\\u003c/script\\u003e");
    // Still valid JSON that decodes to the original string.
    expect(JSON.parse(serialized).name).toBe(
      "</script><script>alert(1)</ScRiPt>",
    );
  });
});

describe("JsonLd component", () => {
  it("routes a single entity through serializeJsonLd, not a bare stringify", () => {
    const markup = renderToStaticMarkup(
      JsonLd({
        data: buildArticleJsonLd({
          page: {
            ...article,
            title: "</script><script>alert(1)</script>",
          },
          deployment,
          canonicalPath: "/stories/coast/reading-coastal-light",
          locale: "en-GB",
        }),
      }),
    );

    // Exactly one real closing tag; the payload's own "</script>" is escaped.
    expect(markup.match(/<\/script>/g)).toHaveLength(1);
    expect(markup).toContain("\\u003c/script\\u003e");
    expect(renderedPayloads(markup)[0]).toMatchObject({
      "@type": "Article",
      headline: "</script><script>alert(1)</script>",
    });
  });

  it("emits one block per entity for an array", () => {
    const markup = renderToStaticMarkup(
      JsonLd({
        data: [
          buildWebSiteJsonLd({ settings, deployment }),
          buildOrganizationJsonLd({ settings, deployment }),
        ],
      }),
    );
    const payloads = renderedPayloads(markup);
    expect(payloads.map((p) => (p as JsonLdObject)["@type"])).toEqual([
      "WebSite",
      "Organization",
    ]);
  });
});

describe("buildWebSiteJsonLd", () => {
  it("carries only modelled facts, with an origin-absolute url", () => {
    const jsonLd = buildWebSiteJsonLd({ settings, deployment });
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Studio Example",
      url: "https://studio.example/",
      inLanguage: "en-GB",
    });
    expect(new URL(jsonLd.url as string).origin).toBe(deployment.canonicalBaseUrl.origin);
  });
});

describe("buildOrganizationJsonLd", () => {
  it("uses siteName as the name and social links as sameAs", () => {
    expect(buildOrganizationJsonLd({ settings, deployment })).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Studio Example",
      url: "https://studio.example/",
      sameAs: [
        "https://instagram.com/studioexample",
        "https://facebook.com/studioexample",
      ],
    });
  });

  it("omits sameAs entirely when no social links are configured", () => {
    const jsonLd = buildOrganizationJsonLd({
      settings: { ...settings, socialLinks: [] },
      deployment,
    });
    expect(jsonLd).not.toHaveProperty("sameAs");
  });

  it("never synthesizes a logo, contactPoint, or address entity", () => {
    const jsonLd = buildOrganizationJsonLd({ settings, deployment });
    expect(jsonLd).not.toHaveProperty("logo");
    expect(jsonLd).not.toHaveProperty("contactPoint");
    expect(jsonLd).not.toHaveProperty("address");
  });
});

describe("buildServiceJsonLd", () => {
  it("carries name, description, an origin-absolute url, and the cover image", () => {
    const jsonLd = buildServiceJsonLd({ service, deployment });
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Weddings",
      description: "Full-day storytelling coverage.",
      url: "https://studio.example/services/weddings",
      image: "https://studio.example/gallery/open-marsh.e679c408d1ee.webp",
    });
    expect(new URL(jsonLd.url as string).origin).toBe(
      deployment.canonicalBaseUrl.origin,
    );
  });

  it("preserves an already-absolute CDN rendition as the image", () => {
    const jsonLd = buildServiceJsonLd({
      service: { ...service, coverMedia: cdnCover },
      deployment,
    });
    expect(jsonLd.image).toBe(
      "https://cdn.sanity.io/images/p/d/abcdef012345-1200x800.webp",
    );
  });

  it("omits image when there is no cover, and never emits offers or provider", () => {
    const jsonLd = buildServiceJsonLd({
      service: { ...service, coverMedia: undefined },
      deployment,
    });
    expect(jsonLd).not.toHaveProperty("image");
    expect(jsonLd).not.toHaveProperty("offers");
    expect(jsonLd).not.toHaveProperty("provider");
  });
});

describe("buildArticleJsonLd", () => {
  const canonicalPath = "/stories/coast/reading-coastal-light";

  it("carries headline, date, language, mainEntityOfPage, lead, image, tags", () => {
    const jsonLd = buildArticleJsonLd({
      page: article,
      deployment,
      canonicalPath,
      locale: "en-GB",
    });
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Reading coastal light",
      datePublished: "2026-05-02",
      inLanguage: "en-GB",
      mainEntityOfPage:
        "https://studio.example/stories/coast/reading-coastal-light",
      description: "How an overcast morning shapes a frame.",
      image: "https://studio.example/gallery/open-marsh.e679c408d1ee.webp",
      keywords: "light, landscape",
    });
    expect(new URL(jsonLd.mainEntityOfPage as string).origin).toBe(
      deployment.canonicalBaseUrl.origin,
    );
  });

  it("omits lead, image, and keywords when the page has none", () => {
    const jsonLd = buildArticleJsonLd({
      page: {
        ...article,
        summary: undefined,
        cover: undefined,
        tags: undefined,
      },
      deployment,
      canonicalPath,
      locale: "en-GB",
    });
    expect(jsonLd).not.toHaveProperty("description");
    expect(jsonLd).not.toHaveProperty("image");
    expect(jsonLd).not.toHaveProperty("keywords");
  });

  it("omits an empty tag array, blank-only tags, and a blank lead", () => {
    for (const tags of [[], ["  ", ""]]) {
      const jsonLd = buildArticleJsonLd({
        page: { ...article, summary: "   ", tags },
        deployment,
        canonicalPath,
        locale: "en-GB",
      });
      expect(jsonLd).not.toHaveProperty("description");
      expect(jsonLd).not.toHaveProperty("keywords");
    }
  });

  it("keeps only the non-blank tags in keywords", () => {
    const jsonLd = buildArticleJsonLd({
      page: { ...article, tags: ["  ", "landscape", " light "] },
      deployment,
      canonicalPath,
      locale: "en-GB",
    });
    expect(jsonLd.keywords).toBe("landscape, light");
  });

  it("never synthesizes an author, publisher, or dateModified", () => {
    const jsonLd = buildArticleJsonLd({
      page: article,
      deployment,
      canonicalPath,
      locale: "en-GB",
    });
    expect(jsonLd).not.toHaveProperty("author");
    expect(jsonLd).not.toHaveProperty("publisher");
    expect(jsonLd).not.toHaveProperty("dateModified");
  });

  it("uses the route-space locale it is given, not the deployment default", () => {
    const jsonLd = buildArticleJsonLd({
      page: article,
      deployment,
      canonicalPath,
      locale: "fi",
    });
    expect(jsonLd.inLanguage).toBe("fi");
  });
});
