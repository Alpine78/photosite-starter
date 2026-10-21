# Production checks, 2026-10-21 afternoon

Read-only evidence gathered after the morning audits
([headers](ab117-production-headers-2026-10-21.md),
[language alternates and links](ab255-hreflang-and-outbound-links-2026-10-21.md),
[mobile reflow](ab117-mobile-reflow-2026-10-21.md)). Anonymous requests to the public
Production domain `https://www.ilkansivu.net`, one at a time with a short pause. No CMS,
configuration, DNS or deployment changed. The serving deployment was not re-bound to its
source for these observations; they describe public behavior at the time stated.

## Legacy URL redirects (AB#19)

`npm run verify:legacy-redirects -- check https://www.ilkansivu.net`, 12:47–12:48 UTC.

| Mapping row type | Rows | Observed |
| --- | --- | --- |
| Redirect | 232 | `301` to a target answering `200` |
| Retired (`gone`) | 179 | `410` |
| Excluded | 3 | `404` |
| Already live | 1 | `200` |
| Pending | 0 | — |

Verification status `passed`; 415/415 rows without an issue. This repeats the
behavioral half of the [2026-10-18 verification](ab19-canonical-production-verification-2026-10-18.md)
against today's Production; unlike that record it does not bind the observation to the
deployment's provider source identity. AB#19 stays Active for its predecessor gate and
owner acceptance.

## Third parties, cookies and storage (AB#117)

All 166 sitemap pages in desktop Chromium and Pixel 7 emulation (332 loads), each
scrolled once from top to bottom. Every request went to the site's own host (images
reach Sanity's CDN through the site's own optimizer), no cookie was set, and
`localStorage` held no keys after any page. This matches the privacy-by-default goal
(no tracking, no third-party embeds, no cookie banner needed) for anonymous browsing;
pages that set a cookie only after an action (a poll vote) were not exercised.

## Layout shift (CLS, AB#117)

The crawl above also recorded `layout-shift` entries. Its scroll was a full viewport every
120 ms, far faster than reading, and on 70 gallery pages the footer moved while the
automatic continuation appended the next page, summing above 0.1. A realistic re-run on
the three worst pages (100 px real wheel steps every 100 ms, about 1000 px/s) measured:

| Page | Load | After scrolling (desktop / mobile) |
| --- | --- | --- |
| Rally Estonia 2023 | 0 | 0 / 0 |
| A wedding gallery | 0 | 0 / 0 |
| Italian Grand Prix 2008 | 0 | **0.12** / 0 |

Initial load shifted nothing anywhere. The one realistic finding: on the desktop Italian
GP page each append re-flowed the justified gallery's open last row while it was in view
(two shifts of about 0.05 each, sources the row's `li` items). Closed rows never move
(by design); the open tail row is allowed to gain photographs. Loading the next page
earlier, or rendering an open tail row only once it is final, would remove it at a
bandwidth or presentation cost; that is an owner decision and nothing was changed.

## Keyboard focus (WCAG 2.4.7, AB#117)

Tab through nine page types (home, story root, a gallery page, an article with an end
gallery, service listing and detail, FI/EN contact, search) in desktop Chromium and Pixel 7
emulation until focus returned to an element already visited: 9–127 stops per page.
Every focused element had a visible outline or box-shadow. One observation: on the
desktop gallery page the footer's X profile link was outside the viewport at the moment
of measurement, read immediately after the key press while the browser was still
scrolling it into view; not counted as a defect.

## UI copy completeness (AB#255)

The built-in Finnish and English label sets share one TypeScript shape
(`satisfies BuiltInLabels`), so a missing key fails the build. Comparing every leaf
string, only `pages.portfolio` ("Portfolio") and `media.video` ("Video") are identical
in both languages, and both are correct Finnish. No untranslated English copy remains in
the Finnish set. Authored CMS content is outside this check.

## Studio dependency exception (AB#160)

The one accepted advisory, GHSA-hp3w-g68c-fv3c (`sprintf-js` ≤1.1.3, Studio CLI chain),
expires on **2026-11-19**. On 2026-10-21 the advisory still lists no patched version,
`sprintf-js` 1.1.3 is still the latest release, and the latest `@sanity/cli` (8.22.0)
still pins `@vercel/frameworks` 3.29.0, whose `js-yaml` 3.x depends on `argparse` →
`sprintf-js`. No upgrade removes the path yet; the 2026-11-19 review remains the
decision point.

## Scriptless 404 HTML (AB#132 / AB#370)

[vercel/next.js#62228](https://github.com/vercel/next.js/issues/62228) and its fix PR
#98455 were both still open on 2026-10-21; 16.4.2 is the latest release. The CI journeys
keep the known gap as an expected failure. The risk-acceptance re-review stays due by
2026-12-19.
