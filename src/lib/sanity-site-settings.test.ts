import { describe, expect, it } from "vitest";

import {
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
  SanitySiteSettingsError,
  SITE_SETTINGS_DOCUMENT_TYPE,
  SITE_SETTINGS_PROJECTION,
  type RawSiteSettingsDocument,
} from "@/lib/sanity-site-settings";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";

const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi-FI", prefix: null, storyNamespace: "tarinat" },
    { locale: "en-GB", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services", "contact"],
  reservedLocaleRouteSegments: ["services", "contact"],
});

const localized = (fi: string, en: string) => [
  { language: "fi", value: fi },
  { language: "en", value: en },
];

function documentOf(
  overrides: Partial<RawSiteSettingsDocument> = {},
): RawSiteSettingsDocument {
  return {
    siteName: "Example Studio",
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
  projectSiteSettings(document, { language, locale: language, config });

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

    expect(settings.siteName).toBe("Example Studio");
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

  it("uses language subtags while keeping language-neutral brand values", () => {
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
    ).resolves.toMatchObject({ siteName: "Example Studio" });

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
