import { describe, expect, it } from "vitest";

import {
  BRAND_DESCRIPTOR_POSITIONS as SCHEMA_BRAND_DESCRIPTOR_POSITIONS,
  CONTENT_ID as SCHEMA_CONTENT_ID,
  defineSiteSettingsType,
  EMAIL as SCHEMA_EMAIL,
} from "../../sanity/schemas/site-settings";
import {
  buildLocaleRouteConfig,
} from "@/lib/locale-routes";
import { EMAIL_SHAPE as CONTACT_EMAIL_SHAPE } from "@/lib/contact-message";
import {
  CONTENT_ID,
  EMAIL,
  PROJECTED_SITE_SETTINGS_FIELDS,
  projectSiteSettings,
  readSanitySiteSettings,
  readSanityServicesContactCallToAction,
  SanitySiteSettingsError,
  SITE_SETTINGS_DOCUMENT_TYPE,
  SITE_SETTINGS_PROJECTION,
  type RawSiteSettingsDocument,
} from "@/lib/sanity-site-settings";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import { BRAND_DESCRIPTOR_POSITIONS } from "@/lib/site-settings";

const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi-FI", prefix: null, storyNamespace: "tarinat" },
    { locale: "en-GB", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services", "contact"],
  reservedLocaleRouteSegments: ["services", "contact"],
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

function documentOf(
  overrides: Partial<RawSiteSettingsDocument> = {},
): RawSiteSettingsDocument {
  return {
    siteName: localized("Esimerkkistudio", "Example Studio"),
    photographerName: "Example Photographer",
    tagline: localized("Ajattomia kuvia", "Timeless photographs"),
    featuredGalleryId: "content-selected-work",
    navigation: [
      { label: localized("Etusivu", "Home"), target: "static", href: "/" },
      { label: localized("Tarinat", "Stories"), target: "story-root" },
      { label: localized("Työt", "Work"), target: "featured-gallery" },
    ],
    contact: {
      email: "hello@example.test",
      phone: "+358 40 000 0000",
      address: localized("Esimerkkikatu 1", "1 Example Street"),
      businessId: "0000000-0",
      privacyNotice: {
        collected: localized("Nimi, osoite ja viesti.", "Name, address, and message."),
        purpose: localized("Viestin vastaaminen.", "Answering the message."),
        recipient: localized("Esimerkkistudio.", "Example studio."),
        retention: localized("Vastauksen ajan.", "Until the reply is complete."),
      },
    },
    socialLinks: [
      {
        platform: "example-network",
        url: "https://social.example.test/example",
        label: localized("Studio verkostossa", "Studio on the network"),
      },
    ],
    footerLinks: [
      { label: localized("Tarinat", "Stories"), target: "story-root" },
      { label: localized("Työt", "Work"), target: "featured-gallery" },
    ],
    copyrightHolder: "Example Studio",
    defaultSeo: {
      titleTemplate: localized("%s | Esimerkkistudio", "%s | Example Studio"),
      description: localized("Esimerkkikuvaus.", "Example photography."),
    },
    ...overrides,
  };
}

const project = (document: RawSiteSettingsDocument, language = "fi-FI") =>
  projectSiteSettings(document, { language, locale: language, config, sanityConfig });

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

it("projects a public contact portrait without provider internals and rejects private or video media", () => {
  const portrait = {
    mediaId: "contact-portrait",
    mediaType: "image",
    publiclyRenderable: true,
    alt: localized("Kuvaaja", "Photographer"),
    caption: [],
    credit: "Example credit",
    archiveLocator: "/private/master.raw",
    asset: {
      url: `https://cdn.sanity.io/images/${sanityConfig.projectId}/${sanityConfig.dataset}/Tb9Ew8CXIwaY6R1kjMvI0uRR-1024x1536.webp`,
      path: `images/${sanityConfig.projectId}/${sanityConfig.dataset}/Tb9Ew8CXIwaY6R1kjMvI0uRR-1024x1536.webp`,
      extension: "webp",
      mimeType: "image/webp",
      width: 1024,
      height: 1536,
    },
  };
  const base = documentOf();
  const contact = base.contact as Record<string, unknown>;
  const projected = project(documentOf({ contact: { ...contact, portrait } }));
  expect(projected.contact.portrait?.type).toBe("image");
  expect(JSON.stringify(projected.contact.portrait)).not.toContain("archiveLocator");
  expect(() => project(documentOf({ contact: { ...contact, portrait: { ...portrait, privateOnly: true } } }))).toThrow();
  expect(() => project(documentOf({ contact: { ...contact, portrait: { ...portrait, mediaType: "video" } } }))).toThrow(/video/u);
});

describe("the per-language brand (AB#187)", () => {
  it("keeps every authored language of the site name and title template", () => {
    const settings = project(documentOf());

    expect(settings.defaultSeo.titleTemplates).toEqual({
      fi: "%s | Esimerkkistudio",
      en: "%s | Example Studio",
    });
  });

  it("reads a pre-AB#187 single-string site name as the default language's", () => {
    const settings = project(documentOf({ siteName: "  Legacy Studio " }));

    expect(settings.siteName).toBe("Legacy Studio");
    expect(settings.siteNames).toEqual({ fi: "Legacy Studio" });
  });

  it("drops a blank language entry and refuses a missing default-language name", () => {
    expect(project(documentOf({ siteName: localized("Esimerkkistudio", "  ") })).siteNames)
      .toEqual({ fi: "Esimerkkistudio" });
    for (const siteName of [[{ language: "en", value: "Example Studio" }], [], "   ", 12, null]) {
      expect(() => project(documentOf({ siteName }))).toThrow(SanitySiteSettingsError);
    }
  });

  it("refuses a title template without exactly one placeholder in any language", () => {
    const base = documentOf();
    const defaultSeo = base.defaultSeo as Record<string, unknown>;
    expect(() =>
      project(documentOf({
        defaultSeo: { ...defaultSeo, titleTemplate: localized("%s | Esimerkkistudio", "Example Studio") },
      })),
    ).toThrow(/language "en"/u);
  });
});

describe("the optional logo (AB#187)", () => {
  const mark = {
    mediaId: "site-mark",
    mediaType: "image",
    publiclyRenderable: true,
    alt: localized("Merkki", "Mark"),
    caption: [],
    archiveLocator: "/private/mark.ai",
    asset: {
      url: `https://cdn.sanity.io/images/${sanityConfig.projectId}/${sanityConfig.dataset}/Ab9Ew8CXIwaY6R1kjMvI0uRR-1308x1266.png`,
      path: `images/${sanityConfig.projectId}/${sanityConfig.dataset}/Ab9Ew8CXIwaY6R1kjMvI0uRR-1308x1266.png`,
      extension: "png",
      mimeType: "image/png",
      width: 1308,
      height: 1266,
    },
  };
  const withLogo = (overrides: Partial<RawSiteSettingsDocument> = {}) =>
    documentOf({ logoRef: "media-site-mark", logoType: "media", logo: mark, ...overrides });

  it("projects a public image's derivative and true dimensions only", () => {
    const { logo } = project(withLogo());

    expect(logo?.type).toBe("image");
    expect(logo?.rendition).toMatchObject({ width: 1308, height: 1266 });
    expect(JSON.stringify(logo)).not.toContain("archiveLocator");
  });

  it("leaves the logo out when none is set", () => {
    expect(project(documentOf())).not.toHaveProperty("logo");
    expect(project(documentOf({ logoRef: null, logoType: null, logo: null }))).not.toHaveProperty("logo");
  });

  it("refuses a reference that does not resolve rather than reading it as no logo", () => {
    expect(() => project(withLogo({ logoType: null, logo: null }))).toThrow(/not published/u);
  });

  it("projects a dark-theme variant only beside the logo it replaces", () => {
    const darkMark = { ...mark, mediaId: "site-mark-dark" };
    const dark = { logoDarkRef: "media-site-mark-dark", logoDarkType: "media", logoDark: darkMark };

    expect(project(withLogo(dark)).logoDark?.mediaId).toBe("site-mark-dark");
    expect(project(withLogo())).not.toHaveProperty("logoDark");
    expect(() => project(documentOf(dark))).toThrow(/without the logo/u);
    expect(() => project(withLogo({ ...dark, logoDark: null }))).toThrow(/logoDark references/u);
    expect(() => project(withLogo({ ...dark, logoDarkType: "gallery" }))).toThrow(/logoDark must/u);
  });

  it("refuses a reference to anything but a public image media document", () => {
    expect(() => project(withLogo({ logoType: "gallery" }))).toThrow(/media document/u);
    expect(() => project(withLogo({ logo: { ...mark, privateOnly: true } }))).toThrow();
    expect(() => project(withLogo({ logo: { ...mark, mediaType: "video" } }))).toThrow(/video/u);
    expect(() => project(withLogo({ logoRef: 12 }))).toThrow(/malformed/u);
    expect(() => project(documentOf({ logo: mark }))).toThrow(/without a reference/u);
  });
});

describe("the header brand descriptor (AB#187)", () => {
  it("keeps each language's descriptor with its own position", () => {
    const settings = project(documentOf({
      brandDescriptor: [
        { language: "fi", value: " Valokuvaaja ", position: "before" },
        { language: "en", value: "Photography", position: "after" },
      ],
    }));

    expect(settings.brandDescriptors).toEqual({
      fi: { text: "Valokuvaaja", position: "before" },
      en: { text: "Photography", position: "after" },
    });
  });

  it("is empty when none is authored", () => {
    expect(project(documentOf()).brandDescriptors).toEqual({});
    expect(project(documentOf({ brandDescriptor: null })).brandDescriptors).toEqual({});
  });

  it.each([
    ["an unknown position", [{ language: "fi", value: "Valokuvaaja", position: "above" }]],
    ["a blank text", [{ language: "fi", value: "  ", position: "before" }]],
    ["a malformed language", [{ language: "FI", value: "Valokuvaaja", position: "before" }]],
    ["a repeated language", [
      { language: "fi", value: "Valokuvaaja", position: "before" },
      { language: "fi", value: "Kuvaaja", position: "after" },
    ]],
    ["a non-list value", "Valokuvaaja"],
  ])("refuses %s", (_case, brandDescriptor) => {
    expect(() => project(documentOf({ brandDescriptor }))).toThrow(SanitySiteSettingsError);
  });

  it("allows the same positions as the Studio schema", () => {
    expect(BRAND_DESCRIPTOR_POSITIONS).toEqual(SCHEMA_BRAND_DESCRIPTOR_POSITIONS);
  });
});

it("projects optional presentation defaults and rejects malformed stored enums", () => {
  expect(project(documentOf())).not.toHaveProperty("galleryLayout");
  expect(project(documentOf({ galleryLayout: "masonry", galleryCaptionPlacement: "overlay" })))
    .toMatchObject({ galleryLayout: "masonry", galleryCaptionPlacement: "overlay" });
  for (const value of ["unknown", 12, {}, false]) {
    expect(() => project(documentOf({ galleryLayout: value }))).toThrow(SanitySiteSettingsError);
    expect(() => project(documentOf({ galleryCaptionPlacement: value }))).toThrow(SanitySiteSettingsError);
  }
});

describe("identity and format patterns", () => {
  it("stay equal to the Studio schema's own copies", () => {
    expect(CONTENT_ID.source).toBe(SCHEMA_CONTENT_ID.source);
    expect(CONTENT_ID.flags).toBe(SCHEMA_CONTENT_ID.flags);
    expect(EMAIL.source).toBe(SCHEMA_EMAIL.source);
    expect(EMAIL.flags).toBe(SCHEMA_EMAIL.flags);
  });

  it("stays equal to the contact form's independent email-shape copy", () => {
    expect(EMAIL.source).toBe(CONTACT_EMAIL_SHAPE.source);
    expect(EMAIL.flags).toBe(CONTACT_EMAIL_SHAPE.flags);
  });
});

describe("projecting Sanity site settings", () => {
  it("maps localized values and semantic navigation into SiteSettings", () => {
    const settings = project(documentOf());

    expect(settings.siteName).toBe("Esimerkkistudio");
    expect(settings.siteNames).toEqual({ fi: "Esimerkkistudio", en: "Example Studio" });
    expect(settings.tagline).toBe("Ajattomia kuvia");
    expect(settings.navigation).toEqual([
      { label: "Etusivu", href: "/" },
      { label: "Tarinat", href: "/tarinat" },
      { label: "Työt", featured: true },
    ]);
    expect(settings.footerLinks[0]).toEqual({ label: "Tarinat", href: "/tarinat" });
    expect(settings.contact.address).toBe("Esimerkkikatu 1");
    expect(settings.defaultSeo.titleTemplate).toBe("%s | Esimerkkistudio");
  });

  it("uses language subtags for every authored value, the site name included", () => {
    const settings = project(documentOf(), "en-GB");

    expect(settings.siteName).toBe("Example Studio");
    expect(settings.tagline).toBe("Timeless photographs");
    expect(settings.navigation[1]).toEqual({ label: "Stories", href: "/en/stories" });
  });

  it("maps an authored services intro, optional unlike tagline", () => {
    const settings = project(
      documentOf({
        servicesIntro: localized("Palveluistamme", "About our services"),
      }),
    );

    expect(settings.servicesIntro).toBe("Palveluistamme");
  });

  it("omits servicesIntro rather than inventing one when it was never authored", () => {
    const settings = project(documentOf());

    expect(settings.servicesIntro).toBeUndefined();
    expect(Object.keys(settings)).not.toContain("servicesIntro");
  });

  it("returns only the project-owned allow-list", () => {
    const serialized = JSON.stringify(
      project(documentOf({ _id: "settings", _type: "siteSettings", secret: "hidden" })),
    );

    expect(serialized).not.toContain("_id");
    expect(serialized).not.toContain("_type");
    expect(serialized).not.toContain("secret");
  });

  it("refuses malformed URLs, missing localized text, and invalid navigation", () => {
    expect(() =>
      project(documentOf({
        socialLinks: [{ platform: "network", url: "http://example.test", label: localized("Verkosto", "Network") }],
      })),
    ).toThrow(SanitySiteSettingsError);
    expect(() => project(documentOf({ tagline: [{ language: "en", value: "English only" }] }))).toThrow(
      SanitySiteSettingsError,
    );
    expect(() =>
      project(documentOf({
        navigation: [{ label: localized("Virhe", "Broken"), target: "static", href: "https://example.test" }],
      })),
    ).toThrow(SanitySiteSettingsError);
  });

  it("refuses an empty navigation list even though every entry (there are none) is well-formed", () => {
    expect(() => project(documentOf({ navigation: [] }))).toThrow(SanitySiteSettingsError);
  });

  it("refuses a static link that repeats the generated story root's own path", () => {
    expect(() =>
      project(documentOf({
        navigation: [
          { label: localized("Tarinat", "Stories"), target: "story-root" },
          { label: localized("Tarinat uudelleen", "Stories again"), target: "static", href: "/tarinat" },
        ],
      })),
    ).toThrow(SanitySiteSettingsError);
  });

  it("treats an optional contact field left as whitespace the same as one left empty", () => {
    const settings = project(documentOf({
      contact: {
        email: "hello@example.test",
        phone: "   ",
        address: localized("Esimerkkikatu 1", "1 Example Street"),
        businessId: "0000000-0",
        privacyNotice: {
          collected: localized("Nimi, osoite ja viesti.", "Name, address, and message."),
          purpose: localized("Viestin vastaaminen.", "Answering the message."),
          recipient: localized("Esimerkkistudio.", "Example studio."),
          retention: localized("Vastauksen ajan.", "Until the reply is complete."),
        },
      },
    }));
    expect(settings.contact.phone).toBeUndefined();
  });

  it("refuses a featured link without its stable content identity", () => {
    try {
      project(documentOf({ featuredGalleryId: undefined }));
    } catch (error) {
      expect(error).toBeInstanceOf(SanitySiteSettingsError);
      expect((error as SanitySiteSettingsError).rejection).toBe("invalid-navigation");
      return;
    }
    throw new Error("expected invalid navigation");
  });
});

describe("reading the published settings singleton", () => {
  it("queries the declared schema fields and projects one document", async () => {
    const { client, requests } = fakeClient([documentOf()]);
    await expect(
      readSanitySiteSettings({ language: "fi", locale: "fi-FI", config, client }),
    ).resolves.toMatchObject({ siteName: "Esimerkkistudio" });

    expect(requests).toEqual([
      { query: `*[_type == "${SITE_SETTINGS_DOCUMENT_TYPE}"]${SITE_SETTINGS_PROJECTION}`, tag: "site-settings" },
    ]);
    const declared = new Set(
      defineSiteSettingsType({ storyRootPaths: ["/tarinat", "/en/stories"] }).fields.map(
        (field) => field.name,
      ),
    );
    for (const field of PROJECTED_SITE_SETTINGS_FIELDS) {
      expect(declared.has(field)).toBe(true);
      expect(SITE_SETTINGS_PROJECTION).toContain(field);
    }
  });

  it.each([
    [[], "missing-document"],
    [[documentOf(), documentOf()], "ambiguous-document"],
    [{}, "malformed-result"],
  ])("fails loudly for an unusable singleton result", async (answer, rejection) => {
    const { client } = fakeClient(answer);
    await expect(
      readSanitySiteSettings({ language: "fi", locale: "fi-FI", config, client }),
    ).rejects.toMatchObject({ rejection });
  });
});

it("projects the services contact band independently and omits incomplete local copy", () => {
  expect(project(documentOf()).servicesContactCallToAction).toBeUndefined();
  const content = {
    heading: localized("Etkö löytänyt sopivaa?", "Looking for something else?"),
    text: localized("Kerro tarpeestasi.", "Tell me what you need."),
  };
  expect(project(documentOf({ servicesContactCallToAction: content })).servicesContactCallToAction).toEqual({
    heading: "Etkö löytänyt sopivaa?",
    text: "Kerro tarpeestasi.",
  });
  expect(project(documentOf({ servicesContactCallToAction: { text: content.text } })).servicesContactCallToAction).toBeUndefined();
  expect(project(documentOf({ servicesContactCallToAction: { heading: [{ language: "en", value: "Else?" }], text: content.text } })).servicesContactCallToAction).toBeUndefined();
  expect(() => project(documentOf({ servicesContactCallToAction: [] }))).toThrow(SanitySiteSettingsError);
});


it("reads a prefixed service CTA without requiring the rest of localized settings", async () => {
  const content = {
    heading: localized("Etkö löytänyt sopivaa?", "Looking for something else?"),
    text: localized("Kerro tarpeestasi.", "Tell me what you need."),
  };
  const { client, requests } = fakeClient([{ servicesContactCallToAction: content }]);
  await expect(readSanityServicesContactCallToAction("en", client)).resolves.toEqual({
    heading: "Looking for something else?",
    text: "Tell me what you need.",
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.query).toContain("servicesContactCallToAction");
  expect(requests[0]?.query).not.toContain("privacyNotice");
});
