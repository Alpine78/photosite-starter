import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function configure(defaultLocale: "en-GB" | "fi") {
  const other = defaultLocale === "fi" ? "en-GB" : "fi";
  for (const [key, value] of Object.entries({
    SITE_LOCALE: defaultLocale,
    SITE_LOCALE_ROUTES: [defaultLocale, other].map((locale, index) =>
      `${locale}|${index === 0 ? "" : new Intl.Locale(locale).language}|${locale === "fi" ? "tarinat" : "stories"}|${locale === "fi" ? "palvelut" : "services"}`).join(","),
    SITE_CONTENT_SOURCE: "mock", SITE_DEPLOYMENT_STAGE: "development",
    SITE_CANONICAL_BASE_URL: "https://fixture.example.test",
    SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.1683eecb7e65.webp",
    SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536", SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024",
    SITE_DEFAULT_SOCIAL_IMAGE_ALT: "Synthetic full-frame photograph",
    PRIVATE_GALLERY_STORE: "off", SITE_MAINTENANCE_MODE: "off",
    SITE_IDENTITY_ALIAS_MODE: "legacy",
  })) vi.stubEnv(key, value);
}

async function enquiry(locale: string) {
  const { GalleryItemEnquiry } = await import("./gallery-item-enquiry");
  const { getBuiltInLabels } = await import("@/lib/deployment-config");
  return GalleryItemEnquiry({
    locale, contentId: "fixture-gallery", itemId: "fixture-placement",
    galleryTitle: "Synthetic gallery", galleryPath: "/synthetic-gallery",
    breadcrumbs: [], labels: getBuiltInLabels(locale),
  });
}

function markup(text: string) {
  return renderToStaticMarkup(createElement("span", null, text)).slice(6, -7);
}

beforeEach(() => { vi.resetModules(); configure("en-GB"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("gallery enquiry authored privacy locale", () => {
  for (const defaultLocale of ["en-GB", "fi"] as const) {
    for (const locale of ["en-GB", "fi"] as const) {
      it(`renders ${locale} privacy when the default is ${defaultLocale}`, async () => {
        configure(defaultLocale);
        const { getSiteSettings } = await import("@/lib/site-settings");
        const { getBuiltInLabels } = await import("@/lib/deployment-config");
        const expected = (await getSiteSettings(locale)).contact.privacyNotice;
        const opposite = (await getSiteSettings(locale === "fi" ? "en-GB" : "fi")).contact.privacyNotice;
        const html = renderToStaticMarkup(await enquiry(locale));
        for (const field of ["collected", "purpose", "recipient", "retention"] as const) {
          expect(expected[field]).not.toBe(opposite[field]);
          expect(html).toContain(`<dd>${markup(expected[field])}</dd>`);
          expect(html).not.toContain(`<dd>${markup(opposite[field])}</dd>`);
        }
        const labels = getBuiltInLabels(locale);
        for (const term of [labels.contact.privacyCollected, labels.contact.privacyPurpose,
          labels.contact.privacyRecipient, labels.contact.privacyRetention]) {
          expect(html).toContain(`${markup(term)}</dt>`);
        }
        expect(html).toContain(markup(labels.enquiry.pageTitle));
      });
    }
  }

  async function failSettings(rejection: "missing-translation" | "incomplete-document" | "transport") {
    vi.stubEnv("SITE_CONTENT_SOURCE", "sanity");
    const settings = await import("@/lib/site-settings");
    const { SanitySiteSettingsError } = await import("@/lib/sanity-site-settings");
    const failure = rejection === "transport" ? new Error("fixture provider unavailable")
      : new SanitySiteSettingsError(rejection, "fixture settings defect");
    vi.spyOn(settings, "getSiteSettings").mockRejectedValue(failure);
    return failure;
  }

  it("uses the existing contact unavailable policy for missing non-default privacy", async () => {
    await failSettings("missing-translation");
    await expect(enquiry("fi")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("does not hide a missing default-language notice", async () => {
    const failure = await failSettings("missing-translation");
    await expect(enquiry("en-GB")).rejects.toBe(failure);
  });

  it.each(["incomplete-document", "transport"] as const)("propagates unrelated %s settings failures", async (rejection) => {
    const failure = await failSettings(rejection);
    await expect(enquiry("fi")).rejects.toBe(failure);
  });
});
