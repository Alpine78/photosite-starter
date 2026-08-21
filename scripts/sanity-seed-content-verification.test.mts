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
 * this story's own Codex plan review). Calling the simple adapters' exported
 * pure projector functions directly — `projectPublicMedia`,
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
 * The gallery is the deliberate exception because AB#84 explicitly requires
 * its 400-placement seed fixture to exercise the paginated adapter. A narrow
 * fake store answers the two query tags the real adapter owns from the actual
 * seed documents; production `readSanityCuratedGalleryPage` code still
 * creates, scopes, decodes, and advances every cursor and projects every row.
 * The test walks the first through final page and proves all 400 placements
 * arrive once and in order.
 *
 * ## What this file does not cover
 *
 * The article, content-tree, and services adapters are not exercised here —
 * their projections resolve several more layers of reference. Their coverage is:
 * this story's own `validateSeedFixtures` (structural correctness — every
 * reference resolves, every identity is unique, the 400-item/two-section/
 * shared-media invariants hold); and the CLI's post-write verification step,
 * which queries a real Content Lake directly and is the actual live proof —
 * see `docs/sanity-seeding.md`.
 */

import { describe, expect, it, vi } from "vitest";

import { createHmacGalleryCursorCodec } from "@/lib/gallery-pagination";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import {
  GALLERY_PAGE_SIZE,
  readSanityCuratedGalleryPage,
} from "@/lib/sanity-gallery";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import { projectHomeContent, type RawHomePageDocument } from "@/lib/sanity-home-content";
import { projectPublicMedia, type RawPublicMediaDocument } from "@/lib/sanity-media";
import { projectSiteSettings, type RawSiteSettingsDocument } from "@/lib/sanity-site-settings";

import {
  buildSeedFixtures,
  ARCHIVE_GALLERY_CONTENT_ID,
  GALLERY_LANGUAGE,
  GALLERY_PLACEMENT_TYPE_NAME,
  GALLERY_TYPE_NAME,
  HOME_PAGE_TYPE_NAME,
  MEDIA_FIXTURES,
  MEDIA_TYPE_NAME,
  SITE_SETTINGS_TYPE_NAME,
} from "./sanity-seed-fixtures.mts";

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

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

describe("seed archive exercises the real paginated Sanity gallery adapter", () => {
  function referenceId(value: unknown): string | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const ref = (value as { readonly _ref?: unknown })._ref;
    return typeof ref === "string" ? ref : undefined;
  }

  function fixtureGalleryStore(): {
    readonly client: SanityClient;
    readonly requests: readonly SanityQueryRequest[];
  } {
    const { documents } = buildSeedFixtures();
    const gallery = documents.find(
      (doc) =>
        doc._type === GALLERY_TYPE_NAME &&
        doc.contentId === ARCHIVE_GALLERY_CONTENT_ID &&
        doc.language === GALLERY_LANGUAGE,
    );
    if (gallery === undefined) throw new Error("archive seed gallery is missing");

    const mediaIdByDocumentId = new Map(
      documents
        .filter((doc) => doc._type === MEDIA_TYPE_NAME)
        .map((doc) => [doc._id, doc.mediaId as string]),
    );
    const placements = documents.filter(
      (doc) =>
        doc._type === GALLERY_PLACEMENT_TYPE_NAME &&
        referenceId(doc.gallery) === gallery._id,
    );
    const requests: SanityQueryRequest[] = [];

    const toRow = (placement: (typeof placements)[number]) => {
      const mediaDocumentId = referenceId(placement.media);
      const mediaId =
        mediaDocumentId === undefined
          ? undefined
          : mediaIdByDocumentId.get(mediaDocumentId);
      if (mediaId === undefined) {
        throw new Error(`placement ${String(placement.placementId)} has no seed media`);
      }
      return {
        placementId: placement.placementId,
        order: placement.order,
        sectionId: placement.sectionId ?? null,
        visible: placement.visible,
        altOverride: placement.altOverride ?? null,
        captionOverride: placement.captionOverride ?? null,
        media: rawMediaDocumentFor(mediaId),
      };
    };

    const client: SanityClient = {
      async query(request) {
        requests.push(request);
        const params = (request.params ?? {}) as Record<string, unknown>;

        if (request.tag === "gallery.placements.basics") {
          if (
            params.contentId !== ARCHIVE_GALLERY_CONTENT_ID ||
            params.language !== GALLERY_LANGUAGE
          ) {
            return [];
          }
          return [
            {
              _id: gallery._id,
              orderingRule: gallery.orderingRule,
              sections: gallery.sections,
              latestPlacementUpdatedAt: "2026-01-01T00:00:00.000Z",
            },
          ];
        }

        if (request.tag === "gallery.placements.window") {
          const candidateLimit = params.candidateLimit as number;
          const sectionId = params.sectionId as string | undefined;
          const afterOrder = params.afterOrder as number | undefined;
          const afterPlacementId = params.afterPlacementId as string | undefined;
          const matching =
            params.galleryDocumentId !== gallery._id
              ? []
              : placements
                  .filter(
                    (placement) =>
                      placement.visible === true &&
                      (sectionId === undefined || placement.sectionId === sectionId),
                  )
                  .toSorted((left, right) => {
                    const orderDifference =
                      (left.order as number) - (right.order as number);
                    if (orderDifference !== 0) return orderDifference;
                    const leftId = String(left.placementId);
                    const rightId = String(right.placementId);
                    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
                  });

          if (afterPlacementId === undefined) {
            return matching.slice(0, candidateLimit).map(toRow);
          }

          const boundary = matching.find(
            (placement) => placement.placementId === afterPlacementId,
          );
          const candidates = matching
            .filter(
              (placement) =>
                (placement.order as number) > (afterOrder as number) ||
                (placement.order === afterOrder &&
                  String(placement.placementId) > afterPlacementId),
            )
            .slice(0, candidateLimit);
          return {
            boundary: boundary === undefined ? null : toRow(boundary),
            candidates: candidates.map(toRow),
          };
        }

        throw new Error(`no seed store behavior for tag "${request.tag}"`);
      },
    };

    return { client, requests };
  }

  it("walks all 400 seed placements through first, middle, and final cursor pages", async () => {
    const { client, requests } = fixtureGalleryStore();
    const cursorCodec = createHmacGalleryCursorCodec("s".repeat(32));
    const placementIds: string[] = [];
    let cursor: string | undefined;
    let pageCount = 0;

    for (;;) {
      const page = await readSanityCuratedGalleryPage(
        "fi-FI",
        ARCHIVE_GALLERY_CONTENT_ID,
        {
          client,
          config,
          cursorCodec,
          ...(cursor === undefined ? {} : { cursor }),
        },
      );
      expect(page).toBeDefined();
      if (page === undefined) break;

      placementIds.push(...page.items.map((item) => item.itemId));
      pageCount += 1;
      if (!page.page.hasNextPage) break;
      expect(page.page.endCursor).toBeTruthy();
      cursor = page.page.endCursor ?? undefined;
    }

    expect(pageCount).toBe(Math.ceil(400 / GALLERY_PAGE_SIZE));
    expect(placementIds).toHaveLength(400);
    expect(new Set(placementIds).size).toBe(400);
    expect(placementIds.at(0)).toBe("archive-0001");
    expect(placementIds.at(-1)).toBe("archive-0400");
    expect(
      requests.filter((request) => request.tag === "gallery.placements.window"),
    ).toHaveLength(pageCount);
    expect(
      requests.some(
        (request) =>
          request.tag === "gallery.placements.window" &&
          request.params?.afterPlacementId !== undefined,
      ),
    ).toBe(true);
  });
});
