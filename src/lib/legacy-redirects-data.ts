/**
 * First-site deployment data for AB#19: the legacy-URL rows this pass can
 * decide without guessing at a not-yet-migrated content target.
 *
 * A clone with no Joomla migration empties {@link RETIRED_TAG_PATHS},
 * {@link STRUCTURAL_REDIRECT_ENTRIES}, and
 * {@link PUBLISHED_CONTENT_REDIRECT_ENTRIES} to `[]` — the same way a clone edits
 * `mock-content-tree.ts`'s own fixture content to be its own, rather than
 * deleting that file — leaving {@link LEGACY_REDIRECTS} an empty map with
 * zero edits needed anywhere else, `src/proxy.ts`'s import included:
 * `buildLegacyRedirects([])` is a valid, fully exercised input (see
 * `legacy-redirects.ts`'s own tests), not a special case. Deleting this file
 * instead would break that import and every test that reads
 * {@link LEGACY_REDIRECTS} or {@link RETIRED_TAG_PATHS}, so emptying it in
 * place is the supported path. Its companions (`legacy-redirects-tracking.ts`,
 * `legacy-redirects-inventory.json`, and `legacy-redirects-data.test.ts`)
 * empty the same way — see each file's own comment. The reusable engine
 * (`legacy-redirects.ts`) stays either way; only this row data is
 * first-site-specific.
 *
 * Three kinds of decided row live here, kept in separate lists because their
 * evidence and validation differ:
 *
 * {@link RETIRED_TAG_PATHS} is every Joomla tag/keyword-browsing page
 * (`/component/tags/tag/<slug>` and `/en/component/tags/tag/<slug>`),
 * verified against the crawl inventory (`legacy-redirects-inventory.json`,
 * `ilkansivu-legacy-url-inventory-2026-07-30.json`, 2026-07-30): every one
 * answered HTTP 200 and none was already a redirect. ADR-0003 decision 9
 * redirects a Joomla system/tag/search/feed route only when a public
 * replacement shares the same visitor intent; the ADR's own "revisit" list
 * names a future tag/keyword-query story (not yet built — see AB#66) as the
 * only place such a replacement could come from, so today none exists and a
 * justified 410 Gone is decision 9's own prescribed answer.
 *
 * This list is pinned to the tag-shaped inventory paths deliberately (see
 * `legacy-redirects-data.test.ts`): a future inventory update that adds or
 * removes a tag-shaped path must fail that test until the change is
 * reviewed, rather than silently reclassifying an unreviewed row — the same
 * mistake this AB#19 pass caught and corrected for `component/komento/*`
 * (Komento Gallery, a real Joomla photo-gallery component, not a defunct
 * system route) and `sivustokartta/*` (real content reached through a
 * Joomla-minted alias, not a generic sitemap page). Both stay `pending` in
 * `legacy-redirects-tracking.ts`, not here.
 *
 * {@link STRUCTURAL_REDIRECT_ENTRIES} is redirect-kind data whose canonical target
 * does not depend on any not-yet-migrated content, decided instead of left
 * `pending`. `/fi/` is the Joomla-era Finnish locale-root alias the crawl
 * recorded as a real directory-style URL; it gets its own direct row —
 * rather than relying on this application's generic trailing-slash or
 * redundant-prefix normalization to reach the same destination — for the
 * same reason `isCanonicalLegacyPath`'s own comment gives a bare locale root
 * as its worked example: the legacy registry is checked before those generic
 * mechanisms specifically so a slash-bearing legacy source resolves in one
 * hop rather than depending on how the dynamic catch-all route matches a
 * trailing slash. Its target is `/`, not a second `/fi`-prefixed hop: the
 * crawled Finnish locale root and this site's own Finnish (default,
 * unprefixed) home page are the same page under two spellings, the same
 * "alias resolves directly to the final target" shape already used for the
 * Komento and sivustokartta aliases in `legacy-redirects-tracking.ts`, not
 * the "blanket locale-root redirect" ADR-0003 decision 9 forbids for
 * unrelated content with no real equivalent.
 *
 * `/en/`, the parallel English locale-root alias, was investigated and
 * deliberately left in `PENDING_LEGACY_PATHS` instead: measured against a
 * production build with this deployment's real locale configuration
 * (`SITE_LOCALE=fi`, `SITE_LOCALE_ROUTES=fi||tarinat,en|en|stories`), the
 * bare `/en` this row would target answers `404` — no English home page
 * exists yet (localized static routes remain later work; see
 * `docs/feature-status.md`) — and neither `/` (a cross-language redirect) nor
 * `/en/stories` (a story-root redirect) is an allowed substitute under
 * ADR-0003 decision 9's explicit "never use a blanket home, locale-root,
 * story-root, or cross-language redirect" rule. Revisit once a real English
 * home page exists. `/valokuvaus`
 * and `/fi/valokuvaus` (the bare Joomla services-category root, and its
 * redundant-prefixed duplicate) redirect to this site's own generic
 * `/services` listing — an owner-confirmed equivalence (2026-09-13), not an
 * inference from the source string, since both are top-level listing pages
 * for the same photography-services offering rather than migrated content
 * with its own slug. Each `/fi/`-prefixed source resolves directly to the
 * final target per ADR-0003 decision 9's "aliases resolve directly to the
 * final target, never through another legacy URL" — `/fi/valokuvaus` targets
 * `/services` itself, not `/valokuvaus`, so it never chains through that
 * other decided row.
 *
 * {@link PUBLISHED_CONTENT_REDIRECT_ENTRIES} holds a different class of
 * redirect: a source whose target is an imported, published content page.
 * Each row is added only once the corresponding Finnish and English page is
 * present in the Production content source and has been verified through the
 * protected deployment candidate. Keeping this list separate makes that
 * production-content evidence explicit and prevents a generic clone from
 * inheriting first-site gallery URLs by accident. Each Finnish Joomla source
 * and its redundant `/fi` alias point directly to the unprefixed Finnish
 * canonical route, while the English source points to its English equivalent.
 * `npm run verify:legacy-redirects -- check <origin> [<canonical-origin>]`
 * rechecks those responses and targets without relying on the static allowlist.
 *
 * {@link LEGACY_REDIRECTS} is built once, at module load, and `src/proxy.ts`
 * imports it directly — unlike every other value that file reads
 * (`getDeploymentConfig()`), which is resolved lazily inside the request
 * handler. A validation throw here would therefore fail Proxy's own module
 * evaluation rather than one request, which — because Proxy's matcher covers
 * nearly every route — would be a whole-site outage, not a legacy-URL-only
 * one, until reverted. `legacy-redirects-data.test.ts` is the primary guard
 * (it fails in CI before this could ever reach production), but
 * {@link buildSafely} is the second, defense-in-depth one: if invalid data
 * ever reaches this module anyway, the deployment keeps serving every
 * ordinary route with no legacy-URL handling, rather than serving nothing.
 */

import {
  buildLegacyRedirects,
  type LegacyRedirectEntry,
  type LegacyRedirects,
} from "./legacy-redirects.ts";

const GONE_REASON =
  "Joomla tag/keyword browsing page with no current-site replacement (ADR-0003 decision 9; a future replacement is AB#66's, not yet built).";

function buildSafely(entries: readonly LegacyRedirectEntry[]): LegacyRedirects {
  try {
    return buildLegacyRedirects(entries);
  } catch (error) {
    console.error(
      "[legacy-redirects-data] invalid first-site legacy redirect data; serving no legacy redirects until this is fixed",
      error,
    );
    return new Map();
  }
}

/**
 * Every `component/tags/tag/<slug>` and `en/component/tags/tag/<slug>` path
 * the crawl observed, sorted for a stable diff. Kept as a plain committed
 * list rather than filtered from the inventory JSON at import time, so
 * `src/proxy.ts` (which imports {@link LEGACY_REDIRECTS} below) never pulls
 * the full 415-row audit inventory into the request-time bundle.
 * `legacy-redirects-data.test.ts` is what keeps this list and the inventory
 * from silently drifting apart.
 */
export const RETIRED_TAG_PATHS: readonly string[] = [
  "/component/tags/tag/aanekoski",
  "/component/tags/tag/aanekoski-valtra",
  "/component/tags/tag/aktiivisuusranneke",
  "/component/tags/tag/alpit",
  "/component/tags/tag/alykello",
  "/component/tags/tag/assamaki",
  "/component/tags/tag/automatkailu",
  "/component/tags/tag/brikettigrilli",
  "/component/tags/tag/canon",
  "/component/tags/tag/canon-eos-1d-x",
  "/component/tags/tag/chamonix",
  "/component/tags/tag/courmayeur",
  "/component/tags/tag/elamysmatkat",
  "/component/tags/tag/formula-1",
  "/component/tags/tag/formulamatkailu",
  "/component/tags/tag/fujifilm",
  "/component/tags/tag/fujifilm-x-pro2",
  "/component/tags/tag/fujifilm-x-t1",
  "/component/tags/tag/fujinon",
  "/component/tags/tag/gardajarvi",
  "/component/tags/tag/garmin",
  "/component/tags/tag/graafinen-suunnittelu",
  "/component/tags/tag/grillaus",
  "/component/tags/tag/haajuhla",
  "/component/tags/tag/haakuvaus",
  "/component/tags/tag/haat",
  "/component/tags/tag/halttula",
  "/component/tags/tag/harju",
  "/component/tags/tag/himos",
  "/component/tags/tag/italia",
  "/component/tags/tag/jarjestelmakamera",
  "/component/tags/tag/joomla",
  "/component/tags/tag/julkaisujarjestelma",
  "/component/tags/tag/junior-wrc",
  "/component/tags/tag/kakaristo",
  "/component/tags/tag/kamera",
  "/component/tags/tag/kesahaat",
  "/component/tags/tag/keskikoon-digi",
  "/component/tags/tag/kestotesti",
  "/component/tags/tag/kevathaat",
  "/component/tags/tag/kiinteapolttovalinen-objektiivi",
  "/component/tags/tag/kokeilu",
  "/component/tags/tag/kuntoilu",
  "/component/tags/tag/laaja-kokeilu",
  "/component/tags/tag/lankamaa",
  "/component/tags/tag/lappi",
  "/component/tags/tag/laskettelu",
  "/component/tags/tag/laukaa",
  "/component/tags/tag/leustu",
  "/component/tags/tag/m600",
  "/component/tags/tag/makkara",
  "/component/tags/tag/maranello",
  "/component/tags/tag/matkailu",
  "/component/tags/tag/matkakertomus",
  "/component/tags/tag/mikrojarjestelmakamera",
  "/component/tags/tag/milano",
  "/component/tags/tag/miljoomuotokuvaus",
  "/component/tags/tag/mokkipera",
  "/component/tags/tag/moksi",
  "/component/tags/tag/monza",
  "/component/tags/tag/moottoriurheilu",
  "/component/tags/tag/nakki",
  "/component/tags/tag/neste-rally-finland",
  "/component/tags/tag/nikkor",
  "/component/tags/tag/nikon",
  "/component/tags/tag/nikon-d4s",
  "/component/tags/tag/nikon-df",
  "/component/tags/tag/norja",
  "/component/tags/tag/normaaliobjektiivi",
  "/component/tags/tag/objektiivi",
  "/component/tags/tag/oittila",
  "/component/tags/tag/omatoimimatka",
  "/component/tags/tag/opiskelu",
  "/component/tags/tag/paijala",
  "/component/tags/tag/pakettimatka",
  "/component/tags/tag/parin-paivan-pikakokeilu",
  "/component/tags/tag/pentax",
  "/component/tags/tag/pentax-645z",
  "/component/tags/tag/pihlajakoski",
  "/component/tags/tag/pokkari",
  "/component/tags/tag/polar",
  "/component/tags/tag/powershot",
  "/component/tags/tag/ralli",
  "/component/tags/tag/ranska",
  "/component/tags/tag/rapsula",
  "/component/tags/tag/ratamoottoriveneily",
  "/component/tags/tag/ruuhimaki",
  "/component/tags/tag/saalahti",
  "/component/tags/tag/sahloinen-moksi",
  "/component/tags/tag/slr",
  "/component/tags/tag/spartan-ultra",
  "/component/tags/tag/studio",
  "/component/tags/tag/superzoom",
  "/component/tags/tag/surkee",
  "/component/tags/tag/suunto",
  "/component/tags/tag/sx610-hs",
  "/component/tags/tag/sykemittari",
  "/component/tags/tag/syyshaat",
  "/component/tags/tag/talvihaat",
  "/component/tags/tag/teleobjektiivi",
  "/component/tags/tag/telezoom",
  "/component/tags/tag/telttailu",
  "/component/tags/tag/urheilu",
  "/component/tags/tag/urria",
  "/component/tags/tag/v-voactive",
  "/component/tags/tag/valokuvaajan-ammattitutkinto",
  "/component/tags/tag/vat-portfolio",
  "/component/tags/tag/vertailu",
  "/component/tags/tag/vetomiehet",
  "/component/tags/tag/vihkiseremonia",
  "/component/tags/tag/websuunnittelu",
  "/component/tags/tag/wordpress",
  "/component/tags/tag/wrc",
  "/component/tags/tag/wrc2",
  "/component/tags/tag/x-t10",
  "/en/component/tags/tag/aanekoski-en",
  "/en/component/tags/tag/alps",
  "/en/component/tags/tag/assamaki",
  "/en/component/tags/tag/camping",
  "/en/component/tags/tag/chamonix-en",
  "/en/component/tags/tag/commercial-skills",
  "/en/component/tags/tag/courmayeur-en",
  "/en/component/tags/tag/digital-workflow",
  "/en/component/tags/tag/examination-portfolio",
  "/en/component/tags/tag/formula-1-en",
  "/en/component/tags/tag/france",
  "/en/component/tags/tag/halttula",
  "/en/component/tags/tag/harju",
  "/en/component/tags/tag/himos",
  "/en/component/tags/tag/home-studio",
  "/en/component/tags/tag/independent-travel",
  "/en/component/tags/tag/italy",
  "/en/component/tags/tag/junior-wrc-en",
  "/en/component/tags/tag/kakaristo-en",
  "/en/component/tags/tag/lake-garda",
  "/en/component/tags/tag/lankamaa",
  "/en/component/tags/tag/lankamaa-en",
  "/en/component/tags/tag/lapland",
  "/en/component/tags/tag/laukaa",
  "/en/component/tags/tag/leustu-en",
  "/en/component/tags/tag/maranello-en",
  "/en/component/tags/tag/milan",
  "/en/component/tags/tag/moksi-en",
  "/en/component/tags/tag/monza-en",
  "/en/component/tags/tag/motorsport",
  "/en/component/tags/tag/norway",
  "/en/component/tags/tag/on-location-photography",
  "/en/component/tags/tag/photography",
  "/en/component/tags/tag/powershot",
  "/en/component/tags/tag/rally",
  "/en/component/tags/tag/rally-finland",
  "/en/component/tags/tag/rapsula-en",
  "/en/component/tags/tag/roadtrip",
  "/en/component/tags/tag/ruuhimaki-en",
  "/en/component/tags/tag/sahloinen-moksi-en",
  "/en/component/tags/tag/skiing",
  "/en/component/tags/tag/sport",
  "/en/component/tags/tag/ss-aanekoski-valtra",
  "/en/component/tags/tag/ss-harju",
  "/en/component/tags/tag/ss-mokkipera",
  "/en/component/tags/tag/ss-oittila",
  "/en/component/tags/tag/ss-paijala",
  "/en/component/tags/tag/ss-pihlajakoski",
  "/en/component/tags/tag/ss-saalahti",
  "/en/component/tags/tag/ss-surkee",
  "/en/component/tags/tag/ss-urria",
  "/en/component/tags/tag/studio",
  "/en/component/tags/tag/travel",
  "/en/component/tags/tag/wedding-ceremony",
  "/en/component/tags/tag/wedding-photography",
  "/en/component/tags/tag/wedding-portrait",
  "/en/component/tags/tag/wedding-reception",
  "/en/component/tags/tag/wrc-en",
  "/en/component/tags/tag/wrc2-en",
];

/**
 * Every source and target here is verified against the crawl inventory and
 * this application's own real routes — never a guessed migrated-content
 * path. `legacy-redirects-data.test.ts` resolves each row and checks its
 * outcome; `e2e/legacy-redirects.spec.ts` proves the redirect against a real
 * production build.
 */
export const STRUCTURAL_REDIRECT_ENTRIES: readonly LegacyRedirectEntry[] = [
  {
    source: "/fi/",
    outcome: {
      kind: "redirect" as const,
      target: "/",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvaus",
    outcome: {
      kind: "redirect" as const,
      target: "/services",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvaus",
    outcome: {
      kind: "redirect" as const,
      target: "/services",
      reservedQueryParams: "strip" as const,
    },
  },
];

/**
 * First-site content redirects whose direct, same-language target has been
 * published to the Production content source and verified on the staged
 * deployment candidate. The six category rows preserve Joomla's two-level
 * Motorsport → WRC branch: Finnish unprefixed and `/fi`-prefixed spellings
 * are aliases of one canonical Finnish route, and each English source lands
 * on the matching English branch. The gallery, article and further category rows follow the same
 * language-preserving rule. No row redirects through another legacy source
 * or across languages.
 */
export const PUBLISHED_CONTENT_REDIRECT_ENTRIES: readonly LegacyRedirectEntry[] = [
  {
    source: "/valokuvat/moottoriurheilu",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/tet-rally-latvia-2024",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/tet-rally-latvia-2024",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/tet-rally-latvia-2024",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/tet-rally-latvia-2024",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/tet-rally-latvia-2024",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/tet-rally-latvia-2024",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2023",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/secto-rally-finland-2023",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2023",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/secto-rally-finland-2023",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/secto-rally-finland-2023",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/secto-rally-finland-2023",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2016",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2016",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2016",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2016",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/rally-finland-2016",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/rally-finland-2016",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2017",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2017",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2017",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2017",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/neste-rally-finland-2017",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/neste-rally-finland-2017",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2018",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2018",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2018",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2018",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/neste-rally-finland-2018",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/neste-rally-finland-2018",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2019",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2019",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2019",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2019",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/neste-rally-finland-2019",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/neste-rally-finland-2019",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/rally-finland-2001-2019",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/rally-finland-2001-2019",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/rally-finland-2001-2019",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/rally-finland-2001-2019",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/rally-finland-2001-2019",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/rally-finland-2001-2019",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2021",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/secto-rally-finland-2021",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2021",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/secto-rally-finland-2021",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/secto-rally-finland-2021",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/secto-rally-finland-2021",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2022",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/secto-rally-finland-2022",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2022",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/secto-rally-finland-2022",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/secto-rally-finland-2022",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/secto-rally-finland-2022",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/mm-ralli/rally-estonia-2023",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/rally-estonia-2023",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/mm-ralli/rally-estonia-2023",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/wrc/rally-estonia-2023",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/wrc/rally-estonia-2023",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/wrc/rally-estonia-2023",
      reservedQueryParams: "strip" as const,
    },
  },

  // AB#19: exact imported content/category identities; live target evidence
  // is recorded in docs/audits/ab19-content-redirects-2026-10-09.md.
  {
    source: "/blogi",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/2016-suuri-makkaravertailu",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/2016-suuri-makkaravertailu",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/canon-eos-1d-x",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/canon-eos-1d-x",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/canon-powershot-sx610-hs",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/canon-powershot-sx610-hs",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/fujifilm-fujinon-xf100-400mmf45-56-r-lm-ois-wr",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/fujifilm-fujinon-xf100-400mmf45-56-r-lm-ois-wr",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/fujifilm-fujinon-xf18-135mmf3-5-5-6-r-lm-ois-wr",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/fujifilm-fujinon-xf18-135mmf3-5-5-6-r-lm-ois-wr",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/fujifilm-fujinon-xf35mmf2-r-wr",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/fujifilm-fujinon-xf35mmf2-r-wr",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/fujifilm-fujinon-xf50-140mm-f2-8-r-lm-ois-wr",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/fujifilm-fujinon-xf50-140mm-f2-8-r-lm-ois-wr",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/fujifilm-fujinon-xf56mm-f1-2-r",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/fujifilm-fujinon-xf56mm-f1-2-r",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/fujifilm-x-pro2",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/fujifilm-x-pro2",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/fujifilm-x-t1",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/fujifilm-x-t1",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/fujifilm-x-t10",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/fujifilm-x-t10",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/garmin-vivoactive",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/garmin-vivoactive",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/nettisivujen-ulkoasu-uudistus-2017",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/nettisivujen-ulkoasu-uudistus-2017",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/nikon-d4s",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/nikon-d4s",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/nikon-df",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/nikon-df",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/pentax-645z",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/pentax-645z",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/polar-m600-suunto-spartan-ultra",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/polar-m600-suunto-spartan-ultra",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/blogi/uudet-sivut-avattu",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/uudet-sivut-avattu",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/about",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/common/ilkka-rytkonen-photographer",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/misc/examination-portfolio",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/vat-portfolio",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/misc/examination-portfolio/commercial-skills",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/vat-portfolio/commercial-skills",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/misc/examination-portfolio/digital-workflow",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/vat-portfolio/digital-workflow",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/misc/examination-portfolio/on-location-photography",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/vat-portfolio/on-location-photography",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/misc/examination-portfolio/studio-photography",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/vat-portfolio/studio-photography",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/formula-1",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/formula-1",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/formula-1/austrian-grand-prix-2021-en",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/formula-1/austrian-grand-prix-2021",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/other-motorsport",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/other-motorsport",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/motorsport/other-motorsport/racewknd-kuopio-2020",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/motorsport/other-motorsport/racewknd-kuopio-2020",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/travel",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/travel-photos",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/travel/alpine-trips",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/travel-photos/alpine-trips",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/travel/alpine-trips/chamonix-ski-2006",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/travel-photos/alpine-trips/chamonix-ski-2006",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/travel/f1",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/travel-photos/f1-trips",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/travel/f1/italy-round-trip-monza-f1-2008",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/travel-photos/f1-trips/italian-grand-prix-2008",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/travel/f1/monza-f1-gp-2007",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/travel-photos/f1-trips/italian-grand-prix-2007",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/travel/norway",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/travel-photos/norway-and-lapland",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/travel/norway/lapland-roundtrip-2010",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/travel-photos/norway-and-lapland/lapland-roundtrip-2010",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/annika-and-johannes",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/annika-and-johannes",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/elisa-joni",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/elisa-joni",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/elsku-and-janne",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/elsku-and-janne",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/emilia-and-jussi",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/emilia-and-jussi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/hanna-and-heikki",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/hanna-and-heikki",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/jenni-tomi",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/jenni-tomi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/johanna-and-jani",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/johanna-and-jani",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/kristiina-and-sampo",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/kristiina-and-sampo",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/laurabrett",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/laurabrett",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/laurajukka",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/laura-jukka",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/marianna-and-mikko",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/marianna-and-mikko",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/marittalassi",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/marittalassi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/minnamikko",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/minnamikko",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/mirja-matti",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/mirja-matti",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/olga-and-vesa",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/olga-and-vesa",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/paula-and-ville",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/paula-and-ville",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/pirjo-and-ville",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/pirjo-and-ville",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/salla-and-vesa",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/salla-and-vesa",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/photos/wedding/tiia-maria-and-jouni",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/wedding-photos/tiia-maria-and-jouni",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/en/portfolio-en",
    outcome: {
      kind: "redirect" as const,
      target: "/en/stories/portfolio",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/blogi",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/blogi/canon-powershot-sx610-hs",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/blogi/canon-powershot-sx610-hs",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/kuvaaja",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/yleinen/valokuvaaja-ilkka-rytkonen",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/portfolio",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/portfolio",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/annika-johannes",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/annika-johannes",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/elisa-joni",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/elisa-joni",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/elsku-janne",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/elsku-janne",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/emilia-jussi",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/emilia-jussi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/hanna-heikki",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/hanna-heikki",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/jenni-tomi",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/jenni-tomi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/johanna-jani",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/johanna-jani",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/kristiina-sampo",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/kristiina-sampo",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/laura-brett",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/laura-brett",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/laura-jukka",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/laura-jukka",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/marianna-mikko",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/marianna-mikko",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/maritta-lassi",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/maritta-lassi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/minna-mikko",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/minna-mikko",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/mirja-matti",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/mirja-matti",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/olga-vesa",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/olga-vesa",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/paula-ville",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/paula-ville",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/pirjo-ville",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/pirjo-ville",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/salla-vesa",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/salla-vesa",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/haakuvat/tiia-maria-jouni",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/tiia-maria-jouni",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/matkailu",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/matkailu/alppireissut",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/alppimatkat",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/matkailu/alppireissut/chamonix-2006",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/alppimatkat/chamonix-2006",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/matkailu/f1",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/formulamatkat",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/matkailu/f1/italia-monza-f1-2008",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/formulamatkat/italian-grand-prix-2008",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/matkailu/f1/monza-f1-2007",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/formulamatkat/italian-grand-prix-2007",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/matkailu/norja",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/norja-ja-lappi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/matkailu/norja/lapin-kierros-2010",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/norja-ja-lappi/lapin-kierros-2010",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/f1/austrian-grand-prix-2021",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/f1/austrian-grand-prix-2021",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/muu-moottoriurheilu",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/muu-moottoriurheilu",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/moottoriurheilu/muu-moottoriurheilu/racewknd-kuopio-2020",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/muu-moottoriurheilu/racewknd-kuopio-2020",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/sekalaiset/vat-portfolio",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/sekalaiset/vat-portfolio/digitaalinen-tyonkulku",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio/digitaalinen-tyonkulku",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/sekalaiset/vat-portfolio/kaupallinen",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio/kaupallinen",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/sekalaiset/vat-portfolio/miljoo",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio/miljoo",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/fi/valokuvat/sekalaiset/vat-portfolio/studio",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio/studio",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/kuvaaja",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/yleinen/valokuvaaja-ilkka-rytkonen",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/portfolio",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/portfolio",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/sivustokartta/haaportfolio",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haaportfolio",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/annika-johannes",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/annika-johannes",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/elisa-joni",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/elisa-joni",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/elsku-janne",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/elsku-janne",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/emilia-jussi",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/emilia-jussi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/hanna-heikki",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/hanna-heikki",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/jenni-tomi",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/jenni-tomi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/johanna-jani",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/johanna-jani",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/kristiina-sampo",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/kristiina-sampo",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/laura-brett",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/laura-brett",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/laura-jukka",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/laura-jukka",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/marianna-mikko",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/marianna-mikko",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/maritta-lassi",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/maritta-lassi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/minna-mikko",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/minna-mikko",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/mirja-matti",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/mirja-matti",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/olga-vesa",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/olga-vesa",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/paula-ville",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/paula-ville",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/pirjo-ville",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/pirjo-ville",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/salla-vesa",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/salla-vesa",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/haakuvat/tiia-maria-jouni",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/haakuvat/tiia-maria-jouni",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/matkailu",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/matkailu/alppireissut",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/alppimatkat",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/matkailu/alppireissut/chamonix-2006",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/alppimatkat/chamonix-2006",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/matkailu/f1",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/formulamatkat",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/matkailu/f1/italia-monza-f1-2008",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/formulamatkat/italian-grand-prix-2008",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/matkailu/f1/monza-f1-2007",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/formulamatkat/italian-grand-prix-2007",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/matkailu/norja",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/norja-ja-lappi",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/matkailu/norja/lapin-kierros-2010",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/matkailu/norja-ja-lappi/lapin-kierros-2010",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/f1",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/f1",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/f1/austrian-grand-prix-2021",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/f1/austrian-grand-prix-2021",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/muu-moottoriurheilu",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/muu-moottoriurheilu",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/moottoriurheilu/muu-moottoriurheilu/racewknd-kuopio-2020",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/moottoriurheilu/muu-moottoriurheilu/racewknd-kuopio-2020",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/sekalaiset/vat-portfolio",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/sekalaiset/vat-portfolio/digitaalinen-tyonkulku",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio/digitaalinen-tyonkulku",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/sekalaiset/vat-portfolio/kaupallinen",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio/kaupallinen",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/sekalaiset/vat-portfolio/miljoo",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio/miljoo",
      reservedQueryParams: "strip" as const,
    },
  },
  {
    source: "/valokuvat/sekalaiset/vat-portfolio/studio",
    outcome: {
      kind: "redirect" as const,
      target: "/tarinat/vat-portfolio/studio",
      reservedQueryParams: "strip" as const,
    },
  },
];

/** Raw configuration lets owner-run verification fail on invalid rows. */
export const LEGACY_REDIRECT_ENTRIES: readonly LegacyRedirectEntry[] = [
  ...RETIRED_TAG_PATHS.map((source) => ({
    source,
    outcome: { kind: "gone" as const, reason: GONE_REASON },
  })),
  ...STRUCTURAL_REDIRECT_ENTRIES,
  ...PUBLISHED_CONTENT_REDIRECT_ENTRIES,
];

export const LEGACY_REDIRECTS: LegacyRedirects = buildSafely(LEGACY_REDIRECT_ENTRIES);
