import { describe, expect, it } from "vitest";

import {
  FOUNDATION_WRITE_PLAN_VERSION,
  foundationDatasetIssues,
  foundationDocumentsDigest,
  parseArguments,
  validateFoundationWritePlan,
  type FoundationWritePlan,
  type SiteSettingsWriteDocument,
} from "./write-sanity-foundation.mts";

const text = (language: "fi" | "en", value: string) => ({
  _key: language,
  _type: "localizedText" as const,
  language,
  value,
});

const plan: FoundationWritePlan = {
  version: FOUNDATION_WRITE_PLAN_VERSION,
  documents: [
    {
      _id: "migrated--site-settings-production",
      _type: "siteSettings",
      siteName: "Example Photography",
      photographerName: "Example Photographer",
      tagline: [text("fi", "Kuvia."), text("en", "Photographs.")],
      featuredGalleryId: "rally-example",
      navigation: [{ _key: "stories", _type: "navigationItem", label: [text("fi", "Tarinat"), text("en", "Stories")], target: "story-root" }],
      contact: {
        _type: "object",
        email: "hello@example.test",
        privacyNotice: {
          _type: "object",
          collected: [text("fi", "Nimi"), text("en", "Name")],
          purpose: [text("fi", "Vastaaminen"), text("en", "Replying")],
          recipient: [text("fi", "Kuvaaja"), text("en", "Photographer")],
          retention: [text("fi", "Vuosi"), text("en", "One year")],
        },
      },
      socialLinks: [],
      footerLinks: [{ _key: "services", _type: "navigationItem", label: [text("fi", "Palvelut"), text("en", "Services")], target: "static", href: "/services" }],
      copyrightHolder: "Example Photographer",
      defaultSeo: {
        _type: "object",
        titleTemplate: [text("fi", "%s | Example"), text("en", "%s | Example Photography")],
        description: [text("fi", "Valokuvausta."), text("en", "Photography.")],
      },
    },
    {
      _id: "migrated--home-page-production",
      _type: "homePage",
      heroMedia: { _type: "reference", _ref: "migrated--media-rally-hero" },
      heroAction: { _key: "stories", _type: "homeAction", label: [text("fi", "Katso"), text("en", "Explore")], target: "story-root" },
      intro: [text("fi", "Tervetuloa."), text("en", "Welcome.")],
      sections: [{
        _key: "stories",
        _type: "homeSection",
        title: [text("fi", "Tarinat"), text("en", "Stories")],
        description: [text("fi", "Selaa."), text("en", "Browse.")],
        target: "story-root",
      }],
    },
  ],
};
const site = plan.documents.find((document): document is SiteSettingsWriteDocument => document._type === "siteSettings")!;

describe("foundation write plan validation", () => {
  it("accepts one strict site settings and home page pair", () => {
    const result = validateFoundationWritePlan(plan);
    expect(result.issues).toEqual([]);
    expect(result.plan?.documents).toHaveLength(2);
  });

  it("rejects unexpected fields and a malformed title template", () => {
    const result = validateFoundationWritePlan({
      ...plan,
      documents: [{ ...site, internalNote: "must not be written", defaultSeo: { ...site.defaultSeo, titleTemplate: [text("fi", "Example")] } }, plan.documents[1]],
    });
    expect(result.issues).toContain("documents[0] has unsupported field(s): internalNote");
    expect(result.issues).toContain("documents[0].defaultSeo.titleTemplate.fi must contain exactly one %s");
  });

  it("binds the approval digest to normalized singleton content", () => {
    expect(foundationDocumentsDigest([...plan.documents].reverse())).toBe(foundationDocumentsDigest(plan.documents));
    expect(foundationDocumentsDigest([{ ...site, siteName: "Changed" }, plan.documents.find((document) => document._type === "homePage")!])).not.toBe(foundationDocumentsDigest(plan.documents));
  });

  it("allows an exact rerun and rejects edits, drafts, and another singleton", () => {
    expect(foundationDatasetIssues(plan.documents, plan.documents)).toEqual([]);
    expect(foundationDatasetIssues([{ ...site, siteName: "Changed" }], plan.documents)).toContain(
      'planned document "migrated--site-settings-production" already exists with different content',
    );
    expect(foundationDatasetIssues([{ ...site, _id: "drafts.migrated--site-settings-production" }], plan.documents)).toContain(
      'planned document "migrated--site-settings-production" has an unpublished draft',
    );
    expect(foundationDatasetIssues([{ ...site, _id: "other-site-settings" }], plan.documents)).toContain(
      'another siteSettings singleton already exists: "other-site-settings"',
    );
  });
});

describe("foundation write CLI", () => {
  it("is offline by default and requires an explicit apply flag", () => {
    expect(parseArguments(["--plan", "plan.json"])).toEqual({ plan: "plan.json", apply: false });
    expect(parseArguments(["--plan", "plan.json", "--approved-digest", "a".repeat(64), "--yes"])).toEqual({
      plan: "plan.json", approvedDigest: "a".repeat(64), apply: true,
    });
  });
});
