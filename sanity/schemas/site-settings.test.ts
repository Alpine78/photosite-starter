import { describe, expect, it } from "vitest";

import { HOME_PAGE_TYPE_NAME, homePageType } from "./home-page";
import { defineSchemaTypes } from "./index";
import { MEDIA_TYPE_NAME } from "./media";
import {
  SITE_SETTINGS_TYPE_NAME,
  defineSiteSettingsType,
  validateNavigationList,
  validateSocialLinks,
  validateTitleTemplates,
} from "./site-settings";
import {
  HOME_ACTION_TYPE_NAME,
  HOME_SECTION_TYPE_NAME,
  isStaticSitePath,
  NAVIGATION_ITEM_TYPE_NAME,
  SITE_LINK_TARGETS,
  validateSiteLinkTarget,
} from "./site-link";

const fieldNames = (type: { readonly fields: readonly { readonly name: string }[] }) =>
  type.fields.map((field) => field.name);

const schemaOptions = {
  datasetVisibility: "public" as const,
  storyRootPaths: ["/stories"],
};
const siteSettingsType = defineSiteSettingsType(schemaOptions);

describe("the site settings and home schemas", () => {
  it("registers both documents and their reusable object types", () => {
    const names = defineSchemaTypes(schemaOptions).map(
      (type) => type.name,
    );

    expect(names).toEqual(
      expect.arrayContaining([
        SITE_SETTINGS_TYPE_NAME,
        HOME_PAGE_TYPE_NAME,
        NAVIGATION_ITEM_TYPE_NAME,
        HOME_ACTION_TYPE_NAME,
        HOME_SECTION_TYPE_NAME,
      ]),
    );
  });

  it("covers the existing project-owned settings and home contracts", () => {
    expect(fieldNames(siteSettingsType)).toEqual([
      "siteName",
      "photographerName",
      "tagline",
      "servicesIntro",
      "featuredGalleryId",
      "navigation",
      "contact",
      "socialLinks",
      "footerLinks",
      "copyrightHolder",
      "defaultSeo",
    ]);
    expect(fieldNames(homePageType)).toEqual([
      "heroMedia",
      "heroAction",
      "intro",
      "sections",
    ]);
  });

  it("references shared media and stores no image URL, dimensions, crop, or master field", () => {
    const hero = homePageType.fields.find((field) => field.name === "heroMedia");

    expect(hero?.type).toBe("reference");
    expect(hero?.to).toEqual([{ type: MEDIA_TYPE_NAME }]);
    expect(fieldNames(homePageType)).not.toEqual(
      expect.arrayContaining(["imageUrl", "width", "height", "crop", "archiveLocator"]),
    );
  });

  it("offers only static, generated-story, and identity-resolved featured targets", () => {
    expect(SITE_LINK_TARGETS).toEqual([
      "static",
      "story-root",
      "featured-gallery",
    ]);
    expect(
      fieldNames(siteSettingsType),
    ).not.toEqual(expect.arrayContaining(["categories", "categoryTree", "contentNavigation"]));
  });

  it("validates static paths and forbids authored paths on generated targets", () => {
    expect(isStaticSitePath("/")).toBe(true);
    expect(isStaticSitePath("/services/portraits")).toBe(true);
    expect(isStaticSitePath("https://example.test/services")).toBe(false);
    expect(isStaticSitePath("/services?kind=portrait")).toBe(false);
    expect(isStaticSitePath("/services/")).toBe(false);

    expect(validateSiteLinkTarget({ target: "static", href: "/services" })).toBe(true);
    expect(validateSiteLinkTarget({ target: "story-root" })).toBe(true);
    expect(validateSiteLinkTarget({ target: "featured-gallery" })).toBe(true);
    expect(validateSiteLinkTarget({ target: "story-root", href: "/stories" })).toEqual(
      expect.any(String),
    );
    expect(validateSiteLinkTarget({ target: "category", href: "/stories/work" })).toEqual(
      expect.any(String),
    );
  });

  it("rejects a static link that repeats the configured generated story root", () => {
    expect(
      validateNavigationList(
        [
          { target: "story-root" },
          { target: "static", href: "/stories" },
        ],
        ["/stories"],
      ),
    ).toEqual(expect.any(String));
  });

  it("rejects a static link that repeats a non-default locale's story root", () => {
    // Mirrors README.md's bilingual production example
    // (SITE_LOCALE_ROUTES=fi||tarinat,en|en|stories): the default locale's
    // story root is /tarinat, but a static link to /en/stories still
    // collides with the story-root target once the site renders in en-GB.
    expect(
      validateNavigationList(
        [
          { target: "story-root" },
          { target: "static", href: "/en/stories" },
        ],
        ["/tarinat", "/en/stories"],
      ),
    ).toEqual(expect.any(String));
  });

  it("rejects two story-root entries regardless of the configured paths", () => {
    expect(
      validateNavigationList(
        [{ target: "story-root" }, { target: "story-root" }],
        ["/tarinat", "/en/stories"],
      ),
    ).toEqual(expect.any(String));
  });

  it("refuses an invalid configured story root when building the schema", () => {
    expect(() =>
      defineSiteSettingsType({ storyRootPaths: ["https://example.test/stories"] }),
    ).toThrow(TypeError);
    expect(() => defineSiteSettingsType({ storyRootPaths: ["/"] })).toThrow(TypeError);
    expect(() => defineSiteSettingsType({ storyRootPaths: [] })).toThrow(TypeError);
  });

  it("requires one page-title placeholder in every localized title template", () => {
    expect(validateTitleTemplates([{ value: "%s | Example" }])).toBe(true);
    expect(validateTitleTemplates([{ value: "Example" }])).toEqual(expect.any(String));
    expect(validateTitleTemplates([{ value: "%s | %s" }])).toEqual(expect.any(String));
  });

  it("rejects a social link list that repeats a platform", () => {
    expect(validateSocialLinks(undefined)).toBe(true);
    expect(validateSocialLinks([{ platform: "instagram" }])).toBe(true);
    expect(
      validateSocialLinks([{ platform: "instagram" }, { platform: "instagram" }]),
    ).toEqual(expect.any(String));
  });
});
