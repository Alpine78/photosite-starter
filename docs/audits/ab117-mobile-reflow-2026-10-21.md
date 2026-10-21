# Mobile reflow on Production — 2026-10-21 (AB#117, AB#382)

Read-only check of WCAG 2.1 SC 1.4.10 (Reflow) on the public Production domain
(`dpl_ARuiTPxfvhAsn7D4foP2ajzfchVE`): every page in `/sitemap.xml` (166) loaded in headless
Chromium as a mobile, touch-enabled viewport at 320 × 740 and 375 × 740 CSS px (device scale
factor 2), one page at a time.

| Check | Result |
| --- | --- |
| Document wider than the viewport (`scrollWidth − clientWidth > 1`) | 1 page at 320 px, none at 375 px |
| `img` inside `<main>` without `width` and `height` attributes | none |

**Finding:** `/palvelut/haakuvaus/miljoomuotokuvaus` was 11 px too wide at 320 px. Its h1
"Miljöömuotokuvaus" is one 17-letter word at the 36 px title size in a 288 px content box.
Fixed in AB#382 (#572) with a base `overflow-wrap: break-word` rule for headings plus
`min-w-0` on the service-detail grid items, guarded by `e2e/page-title-reflow.spec.ts`.

Not covered: text enlarged by the user (the existing `content-text-reflow` and
`header-reflow` journeys cover that on the fixture build), landscape phones, pages outside
the sitemap and authorized pages.
