/**
 * AB#137 content-agnostic adapter smoke verification.
 *
 * NOT part of `npm test` — this reaches a real Sanity Content Lake over the
 * network, like `sanity-live-verification.test.ts`. Run it explicitly:
 * `npm run verify:sanity-adapters`. See docs/sanity-seeding.md's "Adapter
 * smoke verification (AB#137)" section.
 *
 * `sanity-live-verification.test.ts` (AB#84/AB#138) proves the real
 * `src/lib/sanity-*.ts` adapters work — but only against a dataset seeded
 * with the exact AB#84 fixture, because every one of its assertions checks a
 * specific known value (`settings.siteName === "Studio Example"`, a specific
 * placement id, ...). It will correctly FAIL against real, owner-approved
 * Production launch content, which will not match that fixture. This suite
 * exists to close that gap: it makes **no assumption about which specific
 * content exists** — the same posture `scripts/sanity-audit.mts` (AB#138)
 * already takes for the separate "what is in this dataset" question — but,
 * unlike that tool, it calls the real route-facing adapters and exercises a
 * gallery's real cursor pagination, rather than raw GROQ document scanning.
 *
 * It deliberately does not re-validate what the adapters already validate
 * themselves (an empty title, an orphaned category, a malformed reference —
 * see `sanity-adapter-smoke.ts`'s own module comment for the full list of
 * what is out of scope here). What it adds is orchestration no adapter test
 * owns alone: for each configured locale, read the whole tree, sample one
 * deterministic article, and walk published galleries in deterministic
 * (ascending contentId) order — up to `MAX_GALLERIES_SEARCHED_PER_LOCALE` —
 * until one produces more than one page or the search is exhausted,
 * watching every walked gallery for a duplicate placement or a repeated
 * cursor across pages. Searching rather than sampling a single gallery
 * matters: a locale can have one small gallery sort first and a large,
 * multi-page one sort later, and stopping at the first would then report
 * AC4's pagination requirement as undemonstrated even though the dataset
 * does demonstrate it. AC4 ("representative route-facing adapter queries
 * and bounded gallery pagination succeed against Production content") is
 * only actually demonstrated if some gallery, in some configured locale,
 * is found to produce more than one page — a dataset where every searched
 * gallery fits on one page never exercises cursor continuation at all, so
 * the final describe block below fails loudly rather than reporting success
 * for pagination that was never exercised.
 *
 * By default this loads `.vercel/.env.preview.local`, the same default
 * `sanity-live-verification-config.ts` already resolves — set
 * `SANITY_LIVE_VERIFICATION_ENV_FILE` to point it at a Production env file
 * instead, once one exists. Unlike the sibling suite, a private dataset is
 * supported here (Production may be private where Preview is public): see
 * `assertPrivateDatasetHasUsableReadToken` below, which additionally refuses
 * to let a private run silently borrow an ambient `SANITY_READ_TOKEN` that
 * did not come from the selected file itself.
 *
 * The gallery cursor codec below uses a fresh, per-run random key, exactly
 * like the sibling suite — this proves cursor encode/decode, scope binding,
 * and keyset continuation logic, but it does NOT prove that a real
 * deployment's own `GALLERY_CURSOR_SIGNING_KEY` is configured or reachable
 * through the route-facing `gallery.ts` seam. Do not read a clean run of
 * this suite as evidence of that deployment secret's presence.
 *
 * This suite also assumes a quiet dataset — no concurrent authoring while it
 * runs, the same operational expectation `scripts/sanity-audit.mts` already
 * documents. `readSanityCuratedGalleryPage` recomputes `visibilityVersion`
 * from the most recently updated matching placement on every request, so an
 * edit landing between two page fetches can legitimately invalidate an
 * outstanding cursor mid-walk — a `GalleryCursorError` here is more likely a
 * concurrent edit than an adapter bug, but this run cannot tell the two
 * apart and reports it as a hard failure either way.
 *
 * Never imported by route or component code, and never wired into CI: an
 * owner-run proof, like its sibling suite.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import {
  assertPrivateDatasetHasUsableReadToken,
  assertRouteConfigIsSelfContained,
  selectRepresentativePlacement,
  selectRepresentativePlacements,
  walkGalleryPagination,
  type GalleryPaginationOutcome,
} from "./sanity-adapter-smoke";
import {
  assertLiveVerificationTargetIsSelfContained,
  resolveLiveVerificationEnvFile,
} from "./sanity-live-verification-config";

import { getDeploymentConfig } from "@/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "@/lib/gallery-pagination";
import { createSanityClient, type SanityClient } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import { toLanguageSubtag } from "@/lib/sanity-values";
import { readSanitySiteSettings } from "@/lib/sanity-site-settings";
import { readSanityHomeContent } from "@/lib/sanity-home-content";
import { readPublicServices } from "@/lib/sanity-services";
import { readPublicContentTree } from "@/lib/sanity-content-tree";
import {
  readPublicArticlePage,
  readPublicArticlePlacements,
} from "@/lib/sanity-article";
import {
  readPublicGalleryPage,
  readPublicGalleryPlacements,
  readSanityCuratedGalleryPage,
} from "@/lib/sanity-gallery";

/**
 * Generous but bounded: a real, legitimately large gallery should never come
 * close to this many pages, so hitting it is treated as a runaway-pagination
 * failure, not a plausible real gallery size (see `walkGalleryPagination`'s
 * own doc comment).
 */
const GALLERY_PAGINATION_HARD_CAP_PAGES = 500;

/**
 * Per locale, how many published galleries (deterministic ascending-contentId
 * order) this suite is willing to walk while searching for a multi-page
 * pagination witness before giving up on that locale. A real photography
 * site is expected to author far fewer galleries than this; the cap exists
 * so a locale with an unusually large gallery catalog cannot turn this smoke
 * test into an unbounded walk of every gallery it owns.
 */
const MAX_GALLERIES_SEARCHED_PER_LOCALE = 20;

const ENV_FILE = resolveLiveVerificationEnvFile(process.env, process.cwd());

/** Mirrors `sanity-live-verification.test.ts`'s own minimal `.env` parser. */
function loadEnvFile(path: string): Record<string, string> {
  const text = readFileSync(path, "utf8");
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match === null) continue;
    const [, key, rawValue] = match;
    const unquoted =
      rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;
    values[key] = unquoted;
  }
  return values;
}

let client: SanityClient;
let sanityConfig: SanityConfig;
let localeRoutes: ReturnType<typeof getDeploymentConfig>["localeRoutes"];
let defaultLocale: { readonly locale: string; readonly language: string };
let locales: readonly { readonly locale: string; readonly language: string }[];
let cursorCodec: ReturnType<typeof createHmacGalleryCursorCodec>;

/** One locale's coverage, collected during the run and asserted on at the end. */
type LocaleCoverage = {
  readonly locale: string;
  readonly articleSampled: string | undefined;
  readonly gallerySampled: string | undefined;
  readonly galleryOutcome: GalleryPaginationOutcome | undefined;
};
const coverage: LocaleCoverage[] = [];

beforeAll(() => {
  if (!existsSync(ENV_FILE)) {
    throw new Error(
      `[sanity-adapter-smoke-verification] Missing ${ENV_FILE}. This suite needs real deployment ` +
        "settings locally (project id, dataset, locale routes, etc.) — see docs/sanity-setup.md and " +
        "docs/deployment.md for how this gitignored file is provisioned. It is never committed.",
    );
  }

  const parsed = loadEnvFile(ENV_FILE);
  assertLiveVerificationTargetIsSelfContained(parsed, ENV_FILE);
  assertRouteConfigIsSelfContained(parsed, ENV_FILE);
  assertPrivateDatasetHasUsableReadToken(
    parsed,
    parsed.SANITY_DATASET_VISIBILITY === "private" ? "private" : "public",
    ENV_FILE,
  );

  console.log(
    `[sanity-adapter-smoke-verification] target: project=${parsed.SANITY_PROJECT_ID} dataset=${parsed.SANITY_DATASET} apiVersion=${parsed.SANITY_API_VERSION} (from ${ENV_FILE})`,
  );
  // Cleared unconditionally, then re-set below only if the selected file
  // itself defines one: otherwise a public target whose file omits
  // SANITY_READ_TOKEN could silently inherit an ambient token left over from
  // other work in the same shell (getSanityConfig() reads process.env
  // directly), attaching an unrelated credential to every query this run
  // issues — exactly the "two different sources" combination
  // assertPrivateDatasetHasUsableReadToken already refuses for a private
  // target, extended here to a public one too.
  delete process.env.SANITY_READ_TOKEN;
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }

  const deploymentConfig = getDeploymentConfig();
  localeRoutes = deploymentConfig.localeRoutes;
  locales = localeRoutes.locales.map((route) => ({
    locale: route.locale,
    language: toLanguageSubtag(route.locale),
  }));
  defaultLocale = {
    locale: localeRoutes.defaultLocale,
    language: toLanguageSubtag(localeRoutes.defaultLocale),
  };

  sanityConfig = getSanityConfig();
  client = createSanityClient({ config: sanityConfig });

  // Fresh per-run key — see this module's own doc comment on what that does
  // and does not prove.
  cursorCodec = createHmacGalleryCursorCodec(randomBytes(32).toString("hex"));
});

describe("AB#137 adapter smoke: settings, home, services (default locale)", () => {
  it("reads all three without throwing", async () => {
    const settings = await readSanitySiteSettings({
      language: defaultLocale.language,
      locale: defaultLocale.locale,
      config: localeRoutes,
      client,
    });
    expect(settings.siteName.length).toBeGreaterThan(0);

    const home = await readSanityHomeContent({
      language: defaultLocale.language,
      fallbackLanguage: defaultLocale.language,
      locale: defaultLocale.locale,
      routeConfig: localeRoutes,
      sanityConfig,
      client,
    });
    if (home.hero.media.type === "image") {
      expect(home.hero.media.rendition.width).toBeGreaterThan(0);
      expect(home.hero.media.rendition.height).toBeGreaterThan(0);
    }

    const services = await readPublicServices({
      language: defaultLocale.language,
      client,
      config: sanityConfig,
    });
    for (const service of services) {
      expect(service.slug.length).toBeGreaterThan(0);
    }
  });
});

describe("AB#137 adapter smoke: per-locale content tree and representative reads", () => {
  it("builds every configured locale's tree and samples one article and one gallery from each", async () => {
    for (const { locale, language } of locales) {
      const [articlePlacements, galleryPlacements] = await Promise.all([
        readPublicArticlePlacements({ language, client }),
        readPublicGalleryPlacements({ language, client }),
      ]);

      // Adapter-owned validation (acyclic tree, resolved references, no
      // orphaned parent) runs inside this call — a throw here is this
      // suite's own failure to report, not something re-checked above.
      // `readPublicContentTree` already reads categories itself
      // (`readPublicCategoryInputs`), so nothing here calls that separately.
      await readPublicContentTree({
        language,
        client,
        placements: [...articlePlacements, ...galleryPlacements],
      });

      const article = selectRepresentativePlacement(articlePlacements);
      if (article !== undefined) {
        const page = await readPublicArticlePage(article.contentId, {
          language,
          client,
          config: sanityConfig,
        });
        expect(page, `article "${article.contentId}" vanished between listing and detail read`).toBeDefined();
      }

      // Searches published galleries in deterministic order for one that
      // actually spans more than one page, rather than trusting the single
      // lexicographically-smallest gallery to be representative of the
      // whole locale — a locale can easily have one small gallery sorted
      // first and a large, multi-page one sorted later, and picking only
      // the first would then report AC4's pagination requirement as
      // undemonstrated even though the dataset does demonstrate it.
      const candidateGalleries = selectRepresentativePlacements(galleryPlacements).slice(
        0,
        MAX_GALLERIES_SEARCHED_PER_LOCALE,
      );
      let gallerySampled: string | undefined;
      let galleryOutcome: GalleryPaginationOutcome | undefined;
      for (const candidate of candidateGalleries) {
        const outcome = await walkGalleryPagination(
          async (cursor) => {
            const page = await readSanityCuratedGalleryPage(locale, candidate.contentId, {
              ...(cursor === undefined ? {} : { cursor }),
              client,
              config: sanityConfig,
              cursorCodec,
            });
            if (page === undefined) return undefined;
            return { items: page.items, hasNextPage: page.page.hasNextPage, endCursor: page.page.endCursor };
          },
          { maxPages: GALLERY_PAGINATION_HARD_CAP_PAGES },
        );

        // Every gallery actually walked must complete cleanly — a duplicate
        // placement, a repeated cursor, a hard-cap, or a vanished gallery is
        // a real defect no matter which candidate exposed it, not something
        // to shrug off while searching for a witness.
        expect(
          outcome.status,
          `gallery "${candidate.contentId}" (${locale}) pagination outcome: ${JSON.stringify(outcome)}`,
        ).toBe("completed");

        if (gallerySampled === undefined) {
          gallerySampled = candidate.contentId;
          galleryOutcome = outcome;
        }
        if (outcome.status === "completed" && outcome.sawMultiPage) {
          gallerySampled = candidate.contentId;
          galleryOutcome = outcome;
          break;
        }
      }

      if (gallerySampled !== undefined) {
        const detail = await readPublicGalleryPage(gallerySampled, {
          language,
          client,
          config: sanityConfig,
        });
        expect(detail, `gallery "${gallerySampled}" vanished between listing and detail read`).toBeDefined();
      }

      coverage.push({
        locale,
        articleSampled: article?.contentId,
        gallerySampled,
        galleryOutcome,
      });
    }

    console.log(
      "[sanity-adapter-smoke-verification] coverage:",
      JSON.stringify(coverage, null, 2),
    );
  });
});

describe("AB#137 adapter smoke: bounded pagination is actually demonstrated", () => {
  it("shows at least one sampled gallery, in some configured locale, spanning more than one page", () => {
    const multiPageWitness = coverage.some(
      (entry) => entry.galleryOutcome?.status === "completed" && entry.galleryOutcome.sawMultiPage,
    );
    expect(
      multiPageWitness,
      "No configured locale's sampled gallery produced a second page, so AC4's 'bounded gallery " +
        "pagination succeeds' requirement was never actually exercised — cursor encode/decode, " +
        "keyset advancement, and continuation all went untested this run. Point this run at a " +
        "dataset containing a gallery with more than one page, or accept that this criterion is not " +
        "yet demonstrated. See the coverage log above for what was sampled.",
    ).toBe(true);
  });
});
