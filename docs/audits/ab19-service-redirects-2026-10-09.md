# AB#19: approved service redirect preparation, 2026-10-09

AB#19 remains **Active**. This slice prepares twelve direct permanent redirects for
ADR-0021's approved service mappings. It does not complete the legacy inventory or
approve a phased launch. The full work item, discussion, original crawl attachment and
relevant relations were read before implementation; AB#164 and ADR-0021 supply the
accepted service scope.

## Verified source and target identity

| Old source | Direct target |
| --- | --- |
| `/haakuvaus` and `/fi/haakuvaus` | `/palvelut/haakuvaus` |
| `/haakuvaus/miljoomuotokuvaus` and its `/fi` alias | `/palvelut/haakuvaus/miljoomuotokuvaus` |
| `/haakuvaus/vihkiseremonia-muotokuvaus` and its `/fi` alias | `/palvelut/haakuvaus/vihkiseremonia-ja-miljoomuotokuvat` |
| `/haakuvaus/puoli-paivaa` and its `/fi` alias (menu 831 / article 305) | `/palvelut/haakuvaus/puoli-paivaa` |
| `/haakuvaus/koko-paiva` and its `/fi` alias (menu 830 / article 304) | `/palvelut/haakuvaus/koko-paiva` |
| `/en/wedding` | `/en/services/wedding-photography` |
| `/en/wedding/portraits` | `/en/services/wedding-photography/portraits` |

Every source is in the committed inventory. The fresh Joomla SQL backup binds the
unprefixed source to an exact published, public menu entry with the same language.
The Finnish overview menu points to category 150 within the approved wedding-service
category 124; the English overview points to category 165. The portrait articles are
307 and 391, and the Finnish ceremony/portrait article is 342. The redundant Finnish
prefixes are the inventory's aliases of those same source identities.

Anonymous GETs to the activated renderer's stable Vercel alias returned `200` directly
for all seven targets, with the exact `https://www.ilkansivu.net` canonical and Finnish
or English document language. The observations are bound to the compatible Production
renderer `dpl_44SDGwpPtrcZDTFDAHLTBLvHBneU`, source revision
`8e3efe625d03726ff5db04e57da3b8a6b9e83bc7`. Private source and HTTP receipts are retained
outside Git; no customer gallery, backup content or credential is committed.

## Prepared behavior and remaining gates

The reusable redirect engine and Proxy are unchanged. Each row resolves directly to
its same-language canonical target, strips obsolete `cursor`/`section` state and keeps
unrelated query parameters under the existing policy. Clone owners clear the new
`PUBLISHED_SERVICE_REDIRECT_ENTRIES` list together with the other first-site lists.

The resulting offline mapping has 51 redirects, 174 justified tag-page `410` responses,
186 pending paths, three excluded error paths and one already-live root, totaling the
415 distinct inventoried paths. The remaining wedding-package URLs are not redirected
to a generic service or gallery merely because it is nearby. AB#137's original public content import and independent data/runtime audits have now passed; these four package sources were added only after their two distinct reviewed services were published and directly verified. Other content rows still require their own identity decisions.

These service redirect rows are local prepared changes, not deployed responses.
The owner-run complete check still cannot pass while pending paths remain. DNS is
unchanged; no custom-domain cutover or private gallery migration is claimed.

## Corrections to unresolved-source descriptions

The original crawl and fresh database corrected two misleading comments without
adding decisions: Komento paths describe unresolved profiles, not proven gallery
content, and the sitemap's Fujifilm focus-speed article (450) is distinct from the
camera review (370). The numeric camera-review path's observed 200 followed Joomla's
error page. Similar titles and raw status therefore cannot establish those mappings;
all affected paths remain pending.

## Validation

The four-row package follow-up passed lint, all 4,958 browser-free tests (210 files), the production build and 46 Chromium/WebKit legacy/fallback journeys. The independent literal source/target-pair guard catches a half/full swap; the offline report reconciles all 415 paths to 51/174/186/3/1. The two new targets also passed seven live public GET cases, including prices, listing, sitemap and contact prefills. The earlier eight-row slice passed the following checks:

Lint passed. The complete browser-free suite passed: 210 files / 4,957 tests. The
production build and 46 Chromium/WebKit journeys passed for the legacy redirect and
fallback suites, including every new service row. The offline report confirms the
415-path accounting above. The first restricted test run could not execute the CLI
fixtures normally; the same complete suite passed in the permitted execution environment.

Target availability above is live evidence, separate from the generic mock harness's
redirect-response checks. Claude review evidence is recorded separately; this audit
does not imply a reviewer pass.
