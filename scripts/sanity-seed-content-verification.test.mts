/**
 * The offline half of AB#84's "representative content queries pass"
 * acceptance criterion: does this story's own seed fixture, once read back,
 * actually project through this repository's real read adapters?
 *
 * This deliberately does **not** fake Sanity's HTTP/GROQ layer. A prior draft
 * of this file attempted that (a `client.query()` fake dispatching by tag,
 * mirroring `sanity-gallery.test.ts`'s own established technique) but doing
 * so honestly requires reproducing each adapter's GROQ projection shape —
 * which reference fields a query dereferences inline, which it leaves as
 * `{_ref}` — and a hand-guessed reproduction of that is itself a second,
 * unverified implementation of query behavior (the exact risk flagged in
 * this story's own Codex plan review). Calling each adapter's already-
 * exported pure projector function directly — `projectPublicMedia`,
 * `projectSiteSettings`, `projectHomeContent` — sidesteps that: it feeds the
 * *documented* raw-document shape those functions already declare
 * (`RawPublicMediaDocument`, `RawSiteSettingsDocument`, `RawHomePageDocument`)
 * built from this story's real fixture content, and proves only what it
 * actually tests: this fixture's data projects into a valid, correctly
 * language-keyed public type — no GROQ execution implied or claimed.
 *
 * This file can only import `src/lib` because Vitest aliases the `server-only`
 * marker those modules carry to a no-op stub (`vitest.config.mts`); a plain
 * `node scripts/…mts` invocation cannot do the same (verified against
 * `node_modules/server-only`'s own unconditional-throw default export), which
 * is why `scripts/seed-sanity-content.mts` itself never imports them and
 * instead runs its own small, hand-written GROQ existence/shape checks
 * against a real project in its post-write verification step.
 *
 * ## What this file does not cover
 *
 * The gallery, article, content-tree, and services adapters are not exercised
 * here — their projections resolve several more layers of reference and, for
 * the gallery, a keyset-paginated window, which would need the same kind of
 * query-shape reproduction this file exists to avoid. Their coverage is:
 * this story's own `validateSeedFixtures` (structural correctness — every
 * reference resolves, every identity is unique, the 400-item/two-section/
 * shared-media invariants hold); and the CLI's post-write verification step,
 * which queries a real Content Lake directly and is the actual live proof —
 * see `docs/sanity-seeding.md`.
 */

import { describe, expect, it } from "vitest";

import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import type { SanityConfig } from "@/lib/sanity-config";
import { projectHomeContent, type RawHomePageDocument } from "@/lib/sanity-home-content";
import { projectPublicMedia, type RawPublicMediaDocument } from "@/lib/sanity-media";
import { projectSiteSettings, type RawSiteSettingsDocument } from "@/lib/sanity-site-settings";

import {
  buildSeedFixtures,
  HOME_PAGE_TYPE_NAME,
  MEDIA_FIXTURES,
  MEDIA_TYPE_NAME,
  SITE_SETTINGS_TYPE_NAME,
} from "./sanity-seed-fixtures.mts";

const routeConfig = buildLocaleRouteConfig({
  locales: [
    { locale: "fi-FI", prefix: null, storyNamespace: "tarinat" },
    { locale: "en-GB", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services", "contact"],
  reservedLocaleRouteSegments: ["services", "contact"],
});

/**
 * A synthetic, clearly-not-real asset envelope. Real dimensions and a real
 * delivery URL exist only after the CLI actually uploads a file to a real
 * project (`sanity-seed-http.mts#uploadSeedImageAsset`) — offline, this
 * stands in for "some in-policy asset was uploaded", which is all
 * `projectPublicMedia` needs to prove the rest of the projection works.
 */
function syntheticAsset(mediaId: string) {
  return {
    url: `https://cdn.sanity.io/images/test-project/test-dataset/${mediaId}-synthetic-1200x800.webp`,
    path: `images/test-project/test-dataset/${mediaId}-synthetic-1200x800.webp`,
    extension: "webp",
    mimeType: "image/webp",
    width: 1200,
    height: 800,
  };
}

const config: SanityConfig = {
  projectId: "test-project",
  dataset: "test-dataset",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

function rawMediaDocumentFor(mediaId: string): RawPublicMediaDocument {
  const { documents } = buildSeedFixtures();
  const doc = documents.find((item) => item._type === MEDIA_TYPE_NAME && item.mediaId === mediaId);
  if (doc === undefined) throw new Error(`no seed media fixture named "${mediaId}"`);
  return {
    mediaId: doc.mediaId,
    mediaType: doc.mediaType,
    publiclyRenderable: doc.publiclyRenderable,
    alt: doc.alt,
    caption: doc.caption,
    credit: doc.credit,
    asset: syntheticAsset(mediaId),
  };
}

describe("seed fixture media projects through the real media adapter", () => {
  for (const fixture of MEDIA_FIXTURES) {
    it(`projects "${fixture.mediaId}" in fi and en`, () => {
      const raw = rawMediaDocumentFor(fixture.mediaId);

      const fi = projectPublicMedia(raw, { language: "fi", fallbackLanguage: "fi", config });
      expect(fi.mediaId).toBe(fixture.mediaId);
      expect(fi.alt).toBe(fixture.altFi);
      expect(fi.credit).toBe(fixture.credit);

      const en = projectPublicMedia(raw, { language: "en", fallbackLanguage: "fi", config });
      expect(en.alt).toBe(fixture.altEn);
    });
  }
});

describe("seed fixture site settings project through the real site-settings adapter", () => {
  it("projects siteName, featuredGalleryId, and navigation", () => {
    const { documents } = buildSeedFixtures();
    const doc = documents.find((item) => item._type === SITE_SETTINGS_TYPE_NAME);
    expect(doc).toBeDefined();

    const settings = projectSiteSettings(doc as unknown as RawSiteSettingsDocument, {
      language: "fi",
      locale: "fi-FI",
      config: routeConfig,
    });

    expect(settings.siteName).toBe("Studio Example");
    expect(settings.featuredGalleryId).toBe("featured");
    expect(settings.navigation.length).toBeGreaterThan(0);
    expect(settings.contact.email).toBe("hello@example.com");
  });

  it("projects the same document in en without throwing", () => {
    const { documents } = buildSeedFixtures();
    const doc = documents.find((item) => item._type === SITE_SETTINGS_TYPE_NAME);
    const settings = projectSiteSettings(doc as unknown as RawSiteSettingsDocument, {
      language: "en",
      locale: "en-GB",
      config: routeConfig,
    });
    expect(settings.tagline).toBe("Coastal and forest photography");
  });
});

describe("seed fixture home page projects through the real home-content adapter", () => {
  it("projects the hero media, intro, and section links", () => {
    const { documents } = buildSeedFixtures();
    const doc = documents.find((item) => item._type === HOME_PAGE_TYPE_NAME);
    expect(doc).toBeDefined();

    const raw: RawHomePageDocument = {
      ...doc,
      heroMedia: rawMediaDocumentFor("coastal-landscape"),
    };

    const home = projectHomeContent(raw, {
      language: "fi",
      fallbackLanguage: "fi",
      locale: "fi-FI",
      routeConfig,
      sanityConfig: config,
      // The real featured-gallery route is resolved by
      // `getPublicContentRoute` at read time, outside this adapter's own
      // job; a home section pointing at "featured-gallery" with no resolved
      // href drops the entry rather than link to a 404 (documented, intended
      // behavior — see AGENTS.md's feature-status paragraph). Supplying a
      // synthetic href here proves the *rest* of the section projects
      // correctly; the CLI's live post-write check proves real resolution.
      featuredGalleryHref: "/tarinat/vuorovesialtaat/vuorovesialtaiden-valo",
    });

    expect(home.hero.media.mediaId).toBe("coastal-landscape");
    expect(home.intro).toBe("Rannikon ja metsän valokuvausta, kausien mukaan.");
    expect(home.sections.length).toBe(2);
  });
});
