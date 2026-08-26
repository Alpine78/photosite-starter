/**
 * AB#84 live integration verification.
 *
 * NOT part of `npm test` — this reaches a real Sanity Content Lake over the
 * network, which every other `src/**\/*.test.ts` file is required to avoid.
 * Run it explicitly: `npm run verify:sanity-live`. It exercises the real
 * `src/lib/sanity-*.ts` adapters this project ships — not hand-written GROQ,
 * and not the offline fake-store test in `scripts/sanity-seed-content-verification.test.mts`
 * — against whatever dataset the resolved env file names (see
 * `sanity-live-verification-config.ts`), asserting against the known values
 * `scripts/sanity-seed-fixtures.mts` seeded there. See
 * docs/sanity-seeding.md's "Production handoff" section.
 *
 * This remains a **fixture-verification suite, not a generic Sanity health
 * check** (AB#138): its assertions are the exact values AB#84's seed fixture
 * writes, unchanged by AB#138's env-file configurability. It will correctly
 * fail against any dataset that has not been seeded with that exact fixture
 * set — including a Production dataset seeded with different, owner-approved
 * launch content — by design; that is a distinct future need, not this
 * suite's job.
 *
 * By default this loads `.vercel/.env.preview.local`, unchanged from before
 * AB#138. Setting `SANITY_LIVE_VERIFICATION_ENV_FILE` points it at a
 * different env file instead — for example, once AB#137 seeds this exact
 * fixture set into a Production dataset for verification purposes, at
 * whatever local path that deployment's own `vercel env pull` writes to.
 * The selected file must itself define every target-identifying setting
 * (`REQUIRED_LIVE_VERIFICATION_TARGET_KEYS`); this suite refuses to
 * silently complete a partial file's target from the ambient shell
 * environment, and prints the resolved target before running so an operator
 * can confirm it before any query is issued.
 *
 * Never imported by route or component code, and never wired into CI: it is
 * an owner-run proof that the adapters this deployment will eventually read
 * through actually work against a real project, not a route-facing switch.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import {
  assertLiveVerificationTargetIsSelfContained,
  resolveLiveVerificationEnvFile,
} from "./sanity-live-verification-config";

import {
  ARCHIVE_GALLERY_CONTENT_ID,
  ARCHIVE_GALLERY_PLACEMENT_COUNT,
  ARTICLE_FIXTURES,
  CATEGORY_FIXTURES,
  FEATURED_GALLERY_CONTENT_ID,
  FEATURED_GALLERY_SECTION_SIZE,
  MEDIA_KEYS,
  SERVICE_FIXTURES,
} from "../../scripts/sanity-seed-fixtures.mts";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "@/lib/gallery-pagination";
import {
  createSanityClient,
  type SanityClient,
} from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import { toLanguageSubtag } from "@/lib/sanity-values";
import { readSanitySiteSettings } from "@/lib/sanity-site-settings";
import { readSanityHomeContent } from "@/lib/sanity-home-content";
import { readPublicServices } from "@/lib/sanity-services";
import {
  readPublicCategoryInputs,
  readPublicContentTree,
} from "@/lib/sanity-content-tree";
import {
  readPublicArticlePage,
  readPublicArticlePlacements,
} from "@/lib/sanity-article";
import {
  GALLERY_PAGE_SIZE,
  readPublicGalleryPlacements,
  readSanityCuratedGalleryPage,
} from "@/lib/sanity-gallery";

const ENV_FILE = resolveLiveVerificationEnvFile(process.env, process.cwd());

/**
 * Minimal parser for the `KEY="value"` lines `vercel env pull` writes —
 * this repository does not otherwise depend on a `.env` parsing library, and
 * this file's own values are simple enough not to need one either.
 */
function loadEnvFile(path: string): Record<string, string> {
  const text = readFileSync(path, "utf8");
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match === null) continue;
    const [, key, rawValue] = match;
    const unquoted =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue;
    values[key] = unquoted;
  }
  return values;
}

let client: SanityClient;
let sanityConfig: SanityConfig;
let localeRoutes: ReturnType<typeof getDeploymentConfig>["localeRoutes"];
/** The two configured locales' bare language subtags, e.g. `["en", "fi"]`. */
let locales: readonly { readonly locale: string; readonly language: string }[];
let cursorCodec: ReturnType<typeof createHmacGalleryCursorCodec>;

beforeAll(() => {
  if (!existsSync(ENV_FILE)) {
    throw new Error(
      `[sanity-live-verification] Missing ${ENV_FILE}. This test needs the real ` +
        "Preview deployment settings locally (project id, dataset, locale routes, " +
        "etc.) — see docs/sanity-setup.md and docs/deployment.md for how this " +
        "gitignored file is provisioned. It is never committed.",
    );
  }

  const parsed = loadEnvFile(ENV_FILE);
  assertLiveVerificationTargetIsSelfContained(parsed, ENV_FILE);
  // Operator-facing: names the exact target before any query runs, so a
  // wrong SANITY_LIVE_VERIFICATION_ENV_FILE is caught before it matters.
  // Project id, dataset, and API version are not secret (docs/sanity-setup.md);
  // the token itself is never printed.
  console.log(
    `[sanity-live-verification] target: project=${parsed.SANITY_PROJECT_ID} dataset=${parsed.SANITY_DATASET} apiVersion=${parsed.SANITY_API_VERSION} (from ${ENV_FILE})`,
  );
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }

  // `getDeploymentConfig()` is cached and reads `process.env` directly, so it
  // must see the values above before anything below first calls it (several
  // adapters call it internally, e.g. for fallback-language resolution).
  const deploymentConfig = getDeploymentConfig();
  localeRoutes = deploymentConfig.localeRoutes;
  locales = localeRoutes.locales.map((route) => ({
    locale: route.locale,
    language: toLanguageSubtag(route.locale),
  }));

  // Built directly rather than through `getSanityClient()`, which refuses
  // unless this deployment declared `SITE_CONTENT_SOURCE=sanity` — a route-
  // facing switch this story deliberately does not flip (see the module
  // comment). `getSanityConfig()` carries no such gate.
  sanityConfig = getSanityConfig();
  client = createSanityClient({ config: sanityConfig });

  // Required whenever a gallery result actually paginates (the 400-item
  // archive does); a single-page result never touches it. `.vercel/.env.preview.local`
  // carries only Vercel's redacted `[SENSITIVE]` placeholder for
  // GALLERY_CURSOR_SIGNING_KEY, not the real deployed value — the same
  // reason `getSanityConfig()` needs no read token here (the dataset is
  // public) applies in spirit: this run only needs a key it can encode and
  // decode with itself, never one a real deployed instance also holds, so a
  // fresh random key generated for this one run satisfies
  // `createHmacGalleryCursorCodec`'s own validation without needing the
  // production secret at all.
  cursorCodec = createHmacGalleryCursorCodec(randomBytes(32).toString("hex"));
});

function localeFor(language: "fi" | "en") {
  const found = locales.find((entry) => entry.language === language);
  if (found === undefined) {
    throw new Error(
      `[sanity-live-verification] No configured locale route has language "${language}"`,
    );
  }
  return found;
}

describe("AB#84 live integration: settings", () => {
  it("reads the seeded site settings singleton with known values", async () => {
    const fi = localeFor("fi");
    const settings = await readSanitySiteSettings({
      language: fi.language,
      locale: fi.locale,
      config: localeRoutes,
      client,
    });
    expect(settings.siteName).toBe("Studio Example");
    expect(settings.contact.email).toBe("hello@example.com");
  });
});

describe("AB#84 live integration: home content", () => {
  it("reads the seeded home page singleton with its known hero media", async () => {
    const fi = localeFor("fi");
    const home = await readSanityHomeContent({
      language: fi.language,
      fallbackLanguage: fi.language,
      locale: fi.locale,
      routeConfig: localeRoutes,
      sanityConfig,
      client,
    });
    expect(home.hero.media.mediaId).toBe("coastal-landscape");
    expect(home.intro.length).toBeGreaterThan(0);
  });
});

describe("AB#84 live integration: services", () => {
  it("reads all seeded services in their declared order", async () => {
    const fi = localeFor("fi");
    const services = await readPublicServices({
      language: fi.language,
      client,
      config: sanityConfig,
    });
    const expectedSlugsInOrder = [...SERVICE_FIXTURES]
      .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
      .map((fixture) => fixture.slug);
    expect(services.map((service) => service.slug)).toEqual(expectedSlugsInOrder);
    expect(services).toHaveLength(SERVICE_FIXTURES.length);
  });
});

describe("AB#84 live integration: categories and content tree", () => {
  it("reads the full category tree and resolves known placements, in order", async () => {
    const fi = localeFor("fi");
    const categories = await readPublicCategoryInputs({ language: fi.language, client });
    expect(categories).toHaveLength(CATEGORY_FIXTURES.length);

    const [articlePlacements, galleryPlacements] = await Promise.all([
      readPublicArticlePlacements({ language: fi.language, client }),
      readPublicGalleryPlacements({ language: fi.language, client }),
    ]);

    const tree = await readPublicContentTree({
      language: fi.language,
      client,
      placements: [...articlePlacements, ...galleryPlacements],
    });

    expect(tree.categories.size).toBe(CATEGORY_FIXTURES.length);

    // Sibling order, per CATEGORY_FIXTURES' own authored `order` fields.
    expect(tree.childCategoryIds.get(null)).toEqual(["landscapes", "journal"]);
    expect(tree.childCategoryIds.get("landscapes")).toEqual(["coastal", "forest"]);
    expect(tree.childCategoryIds.get("coastal")).toEqual(["tidal-pools"]);
    expect(tree.childCategoryIds.get("journal")).toEqual(["field-notes"]);

    // Known placements, both articles and both galleries.
    expect(tree.placements.get("coastal-light")?.canonicalCategoryId).toBe("field-notes");
    expect(tree.placements.get("tidal-pools-notes")?.canonicalCategoryId).toBe("tidal-pools");
    expect(tree.placements.get(FEATURED_GALLERY_CONTENT_ID)?.canonicalCategoryId).toBe(
      "tidal-pools",
    );
    const archivePlacement = tree.placements.get(ARCHIVE_GALLERY_CONTENT_ID);
    expect(archivePlacement?.canonicalCategoryId).toBe("forest");
    expect(archivePlacement?.secondaryCategoryIds).toContain("coastal");
  });
});

describe("AB#84 live integration: articles", () => {
  it("reads every seeded article back exactly in the languages it was published, with known titles and tags", async () => {
    for (const fixture of ARTICLE_FIXTURES) {
      const publishedLanguages = new Set(fixture.languages.map((entry) => entry.language));
      for (const language of ["fi", "en"] as const) {
        const page = await readPublicArticlePage(fixture.contentId, {
          language,
          client,
          config: sanityConfig,
        });
        const authored = fixture.languages.find((entry) => entry.language === language);
        if (authored === undefined) {
          // Not published in this language: the normal bilingual state
          // (ADR-0003 decision 7), not an error.
          expect(publishedLanguages.has(language)).toBe(false);
          expect(page).toBeUndefined();
          continue;
        }
        expect(page?.title).toBe(authored.title);
        expect(page?.tags).toEqual(fixture.tags);
      }
    }
  });
});

describe("AB#84 live integration: gallery sections and media projection", () => {
  it("reads each named section of the featured gallery with its own placements", async () => {
    for (const [sectionSlug, placementPrefix] of [
      ["nousuvesi", "featured-high-tide-"],
      ["laskuvesi", "featured-low-tide-"],
    ] as const) {
      const page = await readSanityCuratedGalleryPage("fi", FEATURED_GALLERY_CONTENT_ID, {
        sectionSlug,
        client,
        config: sanityConfig,
        cursorCodec,
      });
      expect(page).toBeDefined();
      expect(page?.items).toHaveLength(FEATURED_GALLERY_SECTION_SIZE);
      expect(page?.page.hasNextPage).toBe(false);
      for (const item of page?.items ?? []) {
        expect(item.placementId.startsWith(placementPrefix)).toBe(true);
        expect(MEDIA_KEYS).toContain(item.mediaId);
        expect(item.media.type).toBe("image");
        if (item.media.type === "image") {
          expect(item.media.rendition.width).toBeGreaterThan(0);
          expect(item.media.rendition.height).toBeGreaterThan(0);
          expect(item.media.rendition.src).toContain("cdn.sanity.io");
        }
      }
    }
  });
});

describe("AB#84 live integration: the full 400-item archive gallery", () => {
  it("walks every cursor page in order, with no duplicate or missing placement, honoring the page-size limit", async () => {
    const items: { placementId: string; mediaId: string }[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    const seenSizes: number[] = [];

    do {
      const page = await readSanityCuratedGalleryPage("fi", ARCHIVE_GALLERY_CONTENT_ID, {
        ...(cursor === undefined ? {} : { cursor }),
        client,
        config: sanityConfig,
        cursorCodec,
      });
      expect(page).toBeDefined();
      if (page === undefined) break;

      pageCount += 1;
      // `page.page.size` is the *requested* upper bound (always
      // GALLERY_PAGE_SIZE) — the actual per-page count, which the final page
      // is expected to fall short of, is `items.length`.
      seenSizes.push(page.items.length);
      for (const item of page.items) {
        items.push({ placementId: item.placementId, mediaId: item.mediaId });
      }

      if (page.page.hasNextPage) {
        cursor = page.page.endCursor;
      } else {
        cursor = undefined;
        break;
      }
    } while (pageCount < ARCHIVE_GALLERY_PLACEMENT_COUNT); // hard stop against an infinite loop

    // Page-size limit: every page but the last is exactly GALLERY_PAGE_SIZE;
    // the last is the remainder, never zero and never over the limit.
    const fullPages = Math.floor(ARCHIVE_GALLERY_PLACEMENT_COUNT / GALLERY_PAGE_SIZE);
    const remainder = ARCHIVE_GALLERY_PLACEMENT_COUNT % GALLERY_PAGE_SIZE;
    const expectedSizes =
      remainder === 0
        ? Array.from({ length: fullPages }, () => GALLERY_PAGE_SIZE)
        : [...Array.from({ length: fullPages }, () => GALLERY_PAGE_SIZE), remainder];
    expect(seenSizes).toEqual(expectedSizes);
    for (const size of seenSizes) {
      expect(size).toBeLessThanOrEqual(GALLERY_PAGE_SIZE);
    }

    // Ordering + completeness: every placement, exactly once, in ascending order.
    expect(items).toHaveLength(ARCHIVE_GALLERY_PLACEMENT_COUNT);
    const expectedPlacementIds = Array.from(
      { length: ARCHIVE_GALLERY_PLACEMENT_COUNT },
      (_unused, index) => `archive-${String(index + 1).padStart(4, "0")}`,
    );
    expect(items.map((item) => item.placementId)).toEqual(expectedPlacementIds);

    // Media projection: every item's media identity is one of the six seeded
    // photographs, cycling the same way the seed fixture assigned them.
    const expectedMediaIds = Array.from(
      { length: ARCHIVE_GALLERY_PLACEMENT_COUNT },
      (_unused, index) => MEDIA_KEYS[index % MEDIA_KEYS.length],
    );
    expect(items.map((item) => item.mediaId)).toEqual(expectedMediaIds);
  });
});
