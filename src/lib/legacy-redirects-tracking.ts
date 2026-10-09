/**
 * AB#19 completeness bookkeeping: every legacy URL the crawl inventory
 * (`legacy-redirects-inventory.json`) observed that this pass does NOT
 * resolve to a redirect or a 410, sorted into why not. `legacy-redirects-
 * data.test.ts` cross-checks these lists against the inventory so a legacy
 * path can never be silently forgotten — every distinct path is accounted
 * for by exactly one of: {@link LEGACY_REDIRECTS} (decided),
 * {@link ALREADY_LIVE_LEGACY_PATHS}, {@link EXCLUDED_LEGACY_PATHS}, or
 * {@link PENDING_LEGACY_PATHS}.
 *
 * Audit-only data: nothing in `src/proxy.ts` or the runtime request path
 * imports this file. A clone with no Joomla migration empties all three
 * lists below to `[]` — the same way it empties `legacy-redirects-data.ts`'s
 * `RETIRED_TAG_PATHS`, `STRUCTURAL_REDIRECT_ENTRIES`,
 * `PUBLISHED_SERVICE_REDIRECT_ENTRIES`, `PUBLISHED_CONTENT_REDIRECT_ENTRIES`, and
 * `legacy-redirects-inventory.json`'s `records` — rather than deleting this
 * file, which would break the completeness test and owner-run mapping report
 * that import it (`legacy-redirects-data.test.ts` and `verify:legacy-redirects`).
 *
 * This bookkeeping tracks per-*pathname* completeness only. A separate,
 * already-closed sub-decision of AB#19 is the numeric gallery lightbox
 * query-state policy the original crawl comment flagged as unresolved
 * (Joomla's own bare `?4738` query, layered on top of a page's pathname
 * rather than a distinct crawled route): `legacy-redirects.ts`'s
 * `legacyRedirectDestinationSearch` — never strip or translate such state
 * automatically, per ADR-0003 decision 9 — is that decision, and it applies
 * uniformly to every pathname below regardless of when each one's own
 * source-to-target decision is made. It does not wait on, and is not
 * counted among, {@link PENDING_LEGACY_PATHS}.
 */

/**
 * A legacy path that already resolves as a live, current route and needs no
 * legacy handling at all — a self-redirect would be rejected, a 410 would be
 * wrong, and "excluded" would misstate that this is not real content. Today
 * this is only the site root, which the crawl's own first record confirms
 * already serves the current homepage.
 */
export const ALREADY_LIVE_LEGACY_PATHS: readonly string[] = [
  "/",
];

/**
 * A legacy path that is not owed a redirect at all: Joomla's own generated
 * error page, discovered only because something linked to it. ADR-0003's
 * "a redirect is owed to a URL somebody can actually be holding" principle
 * does not cover a system's own error-page URL. Falls through to the site's
 * ordinary not-found handling, the same as any URL the crawl never saw.
 * `/fi/404` is the same page under Joomla's redundant Finnish-prefix
 * duplicate — not a second decision, the identical case under a different
 * spelling.
 */
export const EXCLUDED_LEGACY_PATHS: readonly string[] = [
  "/404",
  "/en/404",
  "/fi/404",
];

/**
 * Legacy paths whose exact same-language replacement or explicit ancestry
 * fallback is not yet recorded. The imported content/category rows verified
 * on 2026-10-09 now belong to PUBLISHED_CONTENT_REDIRECT_ENTRIES; this list
 * retains only undecided static/service and source-identity rows.
 *
 * Remaining system-shaped sources are not classified by their spelling:
 * Komento profile intent needs evidence; the Fujifilm focus-speed sitemap
 * alias is a different article from the camera review already mapped. English
 * static/service replacements, unpublished source pages and category ancestry
 * need their own source/target verification. No pending path is an implicit
 * 410, home redirect or accepted launch omission.
 *
 * The old /en/ locale-root claim predates localized static routes: recheck its
 * current exact /en target before recording the alias. The real Joomla
 * /portfolio page now maps to the imported portfolio; that does not change
 * the historical removal of the template's unpublished scaffold.
 */
export const PENDING_LEGACY_PATHS: readonly string[] = [
  "/blogi/370-fujifilm-x-pro2",
  "/component/komento/profile",
  "/component/komento/profile/138",
  "/en/",
  "/en/blog",
  "/en/component/komento/profile",
  "/en/gear",
  "/en/photography",
  "/en/photography/business",
  "/en/photography/event",
  "/en/photography/funeral",
  "/en/photography/graduation",
  "/en/photography/kid-family",
  "/en/photography/real-estate",
  "/en/photos",
  "/en/photos/misc",
  "/en/site",
  "/en/wedding-portfolio",
  "/en/wedding/ceremony",
  "/en/wedding/ceremony-portraits",
  "/en/wedding/from-morning",
  "/en/wedding/half-day",
  "/en/wedding/whole-day",
  "/fi/haakuvaus/aamusta-iltaan",
  "/fi/haakuvaus/vihkiseremonia",
  "/fi/kalusto",
  "/fi/sivusto",
  "/fi/valokuvat",
  "/fi/valokuvat/sekalaiset",
  "/fi/valokuvaus/asuntokuvaus",
  "/fi/valokuvaus/hautajaiskuvaus",
  "/fi/valokuvaus/juhlakuvaus",
  "/fi/valokuvaus/perhe-ja-lapsikuvaus",
  "/fi/valokuvaus/valmistujaiskuvaus",
  "/fi/valokuvaus/yrityskuvaus",
  "/haakuvaus/aamusta-iltaan",
  "/haakuvaus/vihkiseremonia",
  "/kalusto",
  "/sivusto",
  "/sivustokartta/fujifilm-x-pro2-tarkennusnopeus",
  "/valokuvat",
  "/valokuvat/sekalaiset",
  "/valokuvaus/asuntokuvaus",
  "/valokuvaus/hautajaiskuvaus",
  "/valokuvaus/juhlakuvaus",
  "/valokuvaus/perhe-ja-lapsikuvaus",
  "/valokuvaus/valmistujaiskuvaus",
  "/valokuvaus/yrityskuvaus",
];
