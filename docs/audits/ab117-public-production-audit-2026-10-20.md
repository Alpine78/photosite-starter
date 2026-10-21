# Public Production read-only audit — 2026-10-20 (AB#117)

Evidence for the launch review. **Read-only:** anonymous GET requests at most two at a time,
and one headless Chromium at 1280×900. No form was submitted, no CMS or deployment setting
was read or changed, and nothing outside the public site was requested.

**Target:** the public Production domain, serving `dpl_ARuiTPxfvhAsn7D4foP2ajzfchVE`
(main `90543d5`, Next.js 16.4.2).

## What was checked

| Check | Method | Result |
| --- | --- | --- |
| Sitemap URLs | Every `<loc>` in `/sitemap.xml` (166), plain HTTPS GET without following redirects | 166 × 200; slowest response 0.63 s |
| Internal links | Every same-origin `a[href]` on those 166 pages (fragment removed): 451 distinct URLs, of which 285 are not in the sitemap | 285 × 200. All 285 are query variants (gallery sections, pagination, contact service choice) plus the two search pages, which the sitemap rightly omits |
| Document language | `<html lang>` on every page | Present on all 166 |
| One h1 per page | Count of `h1` | Exactly one on all 166 |
| Image alt attribute | `img` without an `alt` attribute | None |
| Heading levels | A heading more than one level deeper than the previous one | None |
| Duplicate ids | Repeated `id` values | None |
| Control names | Chromium's computed accessible names (DevTools `Accessibility.getFullAXTree`) for links and buttons | No link or button with an empty name. A first DOM-only heuristic reported unnamed buttons and links; both were false positives (names come from image alt text and card content), so only the computed names count |
| Page load | Navigation Timing `loadEventEnd` | Median 256 ms, 90th percentile 923 ms, max 1 174 ms (warm CDN, one client; not a field measurement) |

## Findings

- **No defect found** in the checks above.
- **Content, not code (AB#255):** on the English blog listing, the "New site launched" card
  shows an image whose alt text is Finnish ("Komponentit, moduulit, pluginit"). This is an
  instance of the shared-media language gap AB#255 already inventories (687 Finnish-only alt
  records, [inventory](ab255-shared-media-language-inventory-2026-10-12.md)); it needs the
  owner's English alt text, not a code change.

## Not covered

Keyboard-only journeys, colour contrast, screen-reader behaviour, scriptless rendering (see
AB#132), mobile viewports, the search API, the contact form, polls, and any authorized or
unlisted page. Automated checks like these do not establish WCAG 2.1 AA conformance; they
only rule out the listed defect classes on the listed pages at this time.
