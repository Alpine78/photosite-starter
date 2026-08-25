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
 * Test-only data: nothing in `src/proxy.ts` or the runtime request path
 * imports this file. A clone with no Joomla migration empties all three
 * lists below to `[]` — the same way it empties `legacy-redirects-data.ts`'s
 * `RETIRED_TAG_PATHS` and `legacy-redirects-inventory.json`'s `records` —
 * rather than deleting this file, which would break the test that imports
 * it (`legacy-redirects-data.test.ts`, itself emptied the same way; see its
 * own comment).
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
 */
export const EXCLUDED_LEGACY_PATHS: readonly string[] = [
  "/404",
  "/en/404",
];

/**
 * Every legacy path with real, live (HTTP 200) content and no current-site
 * target this pass can assign without guessing — ADR-0003 decision 9: "Exact
 * legacy targets cannot be authored safely from source strings alone because
 * their new paths depend on migrated locale identity and canonical category
 * placement," and no route reads real migrated content yet
 * (`SITE_CONTENT_SOURCE=mock`). Covers every gallery (`valokuvat/*`,
 * `en/photos/*`), article (`blogi/*`), service (`valokuvaus/*`,
 * `haakuvaus/*`), their `/fi`-prefixed locale-alias duplicates, and the
 * following, each verified against its real crawled title before being left
 * here rather than guessed at:
 *
 * - `component/komento/profile[/138]`, `en/component/komento/profile` — NOT
 *   a defunct system route: "Komento" is Komento Gallery, a real Joomla
 *   photo-gallery extension, and the titles match real gallery content.
 * - `sivustokartta/haaportfolio`, `sivustokartta/fujifilm-x-pro2-tarkennusnopeus`
 *   — NOT a generic HTML sitemap page: Joomla's sitemap/menu system minted
 *   these as alias URLs for real content that also has a primary URL
 *   elsewhere (a wedding portfolio; the same Fujifilm X-Pro2 post already
 *   reachable at `/blogi/fujifilm-x-pro2`). ADR-0003 decision 9's alias rule
 *   means that once resolved, each must point at the *same* target its
 *   primary URL gets, never a separate one.
 * - `kuvaaja`, `kalusto`, `sivusto`, `en/about`, `en/gear`, `en/site`,
 *   `en/blog`, `en/portfolio-en`, `en/wedding-portfolio`, and the unprefixed
 *   Finnish `/portfolio` — real, live, published Joomla pages with real
 *   editorial titles and no current equivalent route.
 * - The Finnish `/portfolio` record is itself worth flagging beyond this
 *   list: the crawl proves it was a real, live, published Joomla page,
 *   which is evidence against the assumption an earlier ADR-0003 amendment
 *   (AB#104/AB#124) relied on to remove *this template's own* pre-launch
 *   `/portfolio` scaffold without a redirect ("never deployed, published, or
 *   indexed") — that was about the template's dead route, not the
 *   production Joomla site's real one at the same path. Reconciling that is
 *   left for whoever resolves this row, once a real target exists.
 * - The two Monza F1 2008 gallery timeout records (`valokuvat/matkailu/f1/
 *   italia-monza-f1-2008` and its `/fi` alias) — per the site owner's own
 *   comment on AB#19, the gallery is real and intentionally large; its first
 *   uncached load is slow, not missing. Recheck with a longer cold-cache
 *   timeout when the mapping is otherwise ready, rather than treating the
 *   timeout as a 404/410 signal.
 */
export const PENDING_LEGACY_PATHS: readonly string[] = [
  "/blogi",
  "/blogi/2016-suuri-makkaravertailu",
  "/blogi/370-fujifilm-x-pro2",
  "/blogi/canon-eos-1d-x",
  "/blogi/canon-powershot-sx610-hs",
  "/blogi/fujifilm-fujinon-xf100-400mmf45-56-r-lm-ois-wr",
  "/blogi/fujifilm-fujinon-xf18-135mmf3-5-5-6-r-lm-ois-wr",
  "/blogi/fujifilm-fujinon-xf35mmf2-r-wr",
  "/blogi/fujifilm-fujinon-xf50-140mm-f2-8-r-lm-ois-wr",
  "/blogi/fujifilm-fujinon-xf56mm-f1-2-r",
  "/blogi/fujifilm-x-pro2",
  "/blogi/fujifilm-x-t1",
  "/blogi/fujifilm-x-t10",
  "/blogi/garmin-vivoactive",
  "/blogi/nettisivujen-ulkoasu-uudistus-2017",
  "/blogi/nikon-d4s",
  "/blogi/nikon-df",
  "/blogi/pentax-645z",
  "/blogi/polar-m600-suunto-spartan-ultra",
  "/blogi/uudet-sivut-avattu",
  "/component/komento/profile",
  "/component/komento/profile/138",
  "/en/",
  "/en/about",
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
  "/en/photos/misc/examination-portfolio",
  "/en/photos/misc/examination-portfolio/commercial-skills",
  "/en/photos/misc/examination-portfolio/digital-workflow",
  "/en/photos/misc/examination-portfolio/on-location-photography",
  "/en/photos/misc/examination-portfolio/studio-photography",
  "/en/photos/motorsport",
  "/en/photos/motorsport/formula-1",
  "/en/photos/motorsport/formula-1/austrian-grand-prix-2021-en",
  "/en/photos/motorsport/other-motorsport",
  "/en/photos/motorsport/other-motorsport/racewknd-kuopio-2020",
  "/en/photos/motorsport/wrc",
  "/en/photos/motorsport/wrc/neste-rally-finland-2017",
  "/en/photos/motorsport/wrc/neste-rally-finland-2018",
  "/en/photos/motorsport/wrc/neste-rally-finland-2019",
  "/en/photos/motorsport/wrc/rally-estonia-2023",
  "/en/photos/motorsport/wrc/rally-finland-2001-2019",
  "/en/photos/motorsport/wrc/rally-finland-2016",
  "/en/photos/motorsport/wrc/secto-rally-finland-2021",
  "/en/photos/motorsport/wrc/secto-rally-finland-2022",
  "/en/photos/motorsport/wrc/secto-rally-finland-2023",
  "/en/photos/motorsport/wrc/tet-rally-latvia-2024",
  "/en/photos/travel",
  "/en/photos/travel/alpine-trips",
  "/en/photos/travel/alpine-trips/chamonix-ski-2006",
  "/en/photos/travel/f1",
  "/en/photos/travel/f1/italy-round-trip-monza-f1-2008",
  "/en/photos/travel/f1/monza-f1-gp-2007",
  "/en/photos/travel/norway",
  "/en/photos/travel/norway/lapland-roundtrip-2010",
  "/en/photos/wedding",
  "/en/photos/wedding/annika-and-johannes",
  "/en/photos/wedding/elisa-joni",
  "/en/photos/wedding/elsku-and-janne",
  "/en/photos/wedding/emilia-and-jussi",
  "/en/photos/wedding/hanna-and-heikki",
  "/en/photos/wedding/jenni-tomi",
  "/en/photos/wedding/johanna-and-jani",
  "/en/photos/wedding/kristiina-and-sampo",
  "/en/photos/wedding/laurabrett",
  "/en/photos/wedding/laurajukka",
  "/en/photos/wedding/marianna-and-mikko",
  "/en/photos/wedding/marittalassi",
  "/en/photos/wedding/minnamikko",
  "/en/photos/wedding/mirja-matti",
  "/en/photos/wedding/olga-and-vesa",
  "/en/photos/wedding/paula-and-ville",
  "/en/photos/wedding/pirjo-and-ville",
  "/en/photos/wedding/salla-and-vesa",
  "/en/photos/wedding/tiia-maria-and-jouni",
  "/en/portfolio-en",
  "/en/site",
  "/en/wedding",
  "/en/wedding-portfolio",
  "/en/wedding/ceremony",
  "/en/wedding/ceremony-portraits",
  "/en/wedding/from-morning",
  "/en/wedding/half-day",
  "/en/wedding/portraits",
  "/en/wedding/whole-day",
  "/fi/",
  "/fi/404",
  "/fi/blogi",
  "/fi/blogi/canon-powershot-sx610-hs",
  "/fi/haakuvaus",
  "/fi/haakuvaus/aamusta-iltaan",
  "/fi/haakuvaus/koko-paiva",
  "/fi/haakuvaus/miljoomuotokuvaus",
  "/fi/haakuvaus/puoli-paivaa",
  "/fi/haakuvaus/vihkiseremonia",
  "/fi/haakuvaus/vihkiseremonia-muotokuvaus",
  "/fi/kalusto",
  "/fi/kuvaaja",
  "/fi/portfolio",
  "/fi/sivusto",
  "/fi/valokuvat",
  "/fi/valokuvat/haakuvat",
  "/fi/valokuvat/haakuvat/annika-johannes",
  "/fi/valokuvat/haakuvat/elisa-joni",
  "/fi/valokuvat/haakuvat/elsku-janne",
  "/fi/valokuvat/haakuvat/emilia-jussi",
  "/fi/valokuvat/haakuvat/hanna-heikki",
  "/fi/valokuvat/haakuvat/jenni-tomi",
  "/fi/valokuvat/haakuvat/johanna-jani",
  "/fi/valokuvat/haakuvat/kristiina-sampo",
  "/fi/valokuvat/haakuvat/laura-brett",
  "/fi/valokuvat/haakuvat/laura-jukka",
  "/fi/valokuvat/haakuvat/marianna-mikko",
  "/fi/valokuvat/haakuvat/maritta-lassi",
  "/fi/valokuvat/haakuvat/minna-mikko",
  "/fi/valokuvat/haakuvat/mirja-matti",
  "/fi/valokuvat/haakuvat/olga-vesa",
  "/fi/valokuvat/haakuvat/paula-ville",
  "/fi/valokuvat/haakuvat/pirjo-ville",
  "/fi/valokuvat/haakuvat/salla-vesa",
  "/fi/valokuvat/haakuvat/tiia-maria-jouni",
  "/fi/valokuvat/matkailu",
  "/fi/valokuvat/matkailu/alppireissut",
  "/fi/valokuvat/matkailu/alppireissut/chamonix-2006",
  "/fi/valokuvat/matkailu/f1",
  "/fi/valokuvat/matkailu/f1/italia-monza-f1-2008",
  "/fi/valokuvat/matkailu/f1/monza-f1-2007",
  "/fi/valokuvat/matkailu/norja",
  "/fi/valokuvat/matkailu/norja/lapin-kierros-2010",
  "/fi/valokuvat/moottoriurheilu",
  "/fi/valokuvat/moottoriurheilu/f1/austrian-grand-prix-2021",
  "/fi/valokuvat/moottoriurheilu/mm-ralli",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2016",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2017",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2018",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2019",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/rally-estonia-2023",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/rally-finland-2001-2019",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2021",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2022",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2023",
  "/fi/valokuvat/moottoriurheilu/mm-ralli/tet-rally-latvia-2024",
  "/fi/valokuvat/moottoriurheilu/muu-moottoriurheilu",
  "/fi/valokuvat/moottoriurheilu/muu-moottoriurheilu/racewknd-kuopio-2020",
  "/fi/valokuvat/sekalaiset",
  "/fi/valokuvat/sekalaiset/vat-portfolio",
  "/fi/valokuvat/sekalaiset/vat-portfolio/digitaalinen-tyonkulku",
  "/fi/valokuvat/sekalaiset/vat-portfolio/kaupallinen",
  "/fi/valokuvat/sekalaiset/vat-portfolio/miljoo",
  "/fi/valokuvat/sekalaiset/vat-portfolio/studio",
  "/fi/valokuvaus",
  "/fi/valokuvaus/asuntokuvaus",
  "/fi/valokuvaus/hautajaiskuvaus",
  "/fi/valokuvaus/juhlakuvaus",
  "/fi/valokuvaus/perhe-ja-lapsikuvaus",
  "/fi/valokuvaus/valmistujaiskuvaus",
  "/fi/valokuvaus/yrityskuvaus",
  "/haakuvaus",
  "/haakuvaus/aamusta-iltaan",
  "/haakuvaus/koko-paiva",
  "/haakuvaus/miljoomuotokuvaus",
  "/haakuvaus/puoli-paivaa",
  "/haakuvaus/vihkiseremonia",
  "/haakuvaus/vihkiseremonia-muotokuvaus",
  "/kalusto",
  "/kuvaaja",
  "/portfolio",
  "/sivusto",
  "/sivustokartta/fujifilm-x-pro2-tarkennusnopeus",
  "/sivustokartta/haaportfolio",
  "/valokuvat",
  "/valokuvat/haakuvat",
  "/valokuvat/haakuvat/annika-johannes",
  "/valokuvat/haakuvat/elisa-joni",
  "/valokuvat/haakuvat/elsku-janne",
  "/valokuvat/haakuvat/emilia-jussi",
  "/valokuvat/haakuvat/hanna-heikki",
  "/valokuvat/haakuvat/jenni-tomi",
  "/valokuvat/haakuvat/johanna-jani",
  "/valokuvat/haakuvat/kristiina-sampo",
  "/valokuvat/haakuvat/laura-brett",
  "/valokuvat/haakuvat/laura-jukka",
  "/valokuvat/haakuvat/marianna-mikko",
  "/valokuvat/haakuvat/maritta-lassi",
  "/valokuvat/haakuvat/minna-mikko",
  "/valokuvat/haakuvat/mirja-matti",
  "/valokuvat/haakuvat/olga-vesa",
  "/valokuvat/haakuvat/paula-ville",
  "/valokuvat/haakuvat/pirjo-ville",
  "/valokuvat/haakuvat/salla-vesa",
  "/valokuvat/haakuvat/tiia-maria-jouni",
  "/valokuvat/matkailu",
  "/valokuvat/matkailu/alppireissut",
  "/valokuvat/matkailu/alppireissut/chamonix-2006",
  "/valokuvat/matkailu/f1",
  "/valokuvat/matkailu/f1/italia-monza-f1-2008",
  "/valokuvat/matkailu/f1/monza-f1-2007",
  "/valokuvat/matkailu/norja",
  "/valokuvat/matkailu/norja/lapin-kierros-2010",
  "/valokuvat/moottoriurheilu",
  "/valokuvat/moottoriurheilu/f1",
  "/valokuvat/moottoriurheilu/f1/austrian-grand-prix-2021",
  "/valokuvat/moottoriurheilu/mm-ralli",
  "/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2016",
  "/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2017",
  "/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2018",
  "/valokuvat/moottoriurheilu/mm-ralli/neste-rally-finland-2019",
  "/valokuvat/moottoriurheilu/mm-ralli/rally-estonia-2023",
  "/valokuvat/moottoriurheilu/mm-ralli/rally-finland-2001-2019",
  "/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2021",
  "/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2022",
  "/valokuvat/moottoriurheilu/mm-ralli/secto-rally-finland-2023",
  "/valokuvat/moottoriurheilu/mm-ralli/tet-rally-latvia-2024",
  "/valokuvat/moottoriurheilu/muu-moottoriurheilu",
  "/valokuvat/moottoriurheilu/muu-moottoriurheilu/racewknd-kuopio-2020",
  "/valokuvat/sekalaiset",
  "/valokuvat/sekalaiset/vat-portfolio",
  "/valokuvat/sekalaiset/vat-portfolio/digitaalinen-tyonkulku",
  "/valokuvat/sekalaiset/vat-portfolio/kaupallinen",
  "/valokuvat/sekalaiset/vat-portfolio/miljoo",
  "/valokuvat/sekalaiset/vat-portfolio/studio",
  "/valokuvaus",
  "/valokuvaus/asuntokuvaus",
  "/valokuvaus/hautajaiskuvaus",
  "/valokuvaus/juhlakuvaus",
  "/valokuvaus/perhe-ja-lapsikuvaus",
  "/valokuvaus/valmistujaiskuvaus",
  "/valokuvaus/yrityskuvaus",
];
