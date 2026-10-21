# Production checks, 2026-10-21 evening

Read-only evidence, continuing the [afternoon checks](production-checks-2026-10-21-afternoon.md).
Anonymous requests to `https://www.ilkansivu.net`, one page at a time. No CMS,
configuration, DNS or deployment changed. Production still served the morning release, so
fixes merged since (#579's description-list correction among them) are not yet live.

## Accessibility in the dark theme (AB#117)

axe-core 4.10.3 (WCAG 2.0/2.1 A and AA rules) over all 166 sitemap pages in desktop
Chromium with `prefers-color-scheme: dark` (confirmed on every page). The only findings
were the 14 service pages' description-list structure (`dlitem`, `definition-list`),
already fixed by AB#384 / #579 and awaiting a release. No dark-theme contrast issue.

## Accessibility of interactive states (AB#117, AB#387)

axe with the gallery lightbox open, the header menu open, the contact form's validation
errors shown, and search results listed — light and dark, desktop and Pixel 7 (16 runs).
All passed except the search result group count in the light theme (4.07:1), fixed under
AB#387 / #584.

## Structured data (AB#86)

| Type | Pages | Fields present |
| --- | --- | --- |
| `Article` | 56 | `headline`, `datePublished`, `inLanguage`, `mainEntityOfPage`, `description`, `image` |
| `Service` | 16 | — |
| `WebSite`, `Organization` | home | — |

Every block parses. Galleries, category pages, listings and contact emit none, as the
AB#86 scope in `src/lib/structured-data.ts` decides. `Article` has no `author`,
`publisher` or `dateModified`. The optional per-article author field now exists (the
AB#150 byline), and the feature status records adding it to `Article` as a separate
future decision; nothing is inferred here.

## Error pages (AB#132)

`/tama-ei-ole-olemassa`, `/en/this-does-not-exist`, `/tarinat/ei-ole` and
`/en/stories/nope` return `404` with `noindex` and a localized title, but their initial
HTML has no `lang` attribute and no `h1`: the known empty error shell of
[vercel/next.js#62228](https://github.com/vercel/next.js/issues/62228), filled in by
script. Nothing new; AB#132 / AB#370 keep the accepted risk under review.

## Reduced motion (WCAG 2.3.3)

Every motion transition in components is `motion-safe` or switched off under
`prefers-reduced-motion` (story-card hover zoom and arrow, section controls, the reading
layout), and PhotoSwipe 5.4.4 disables its own open/close and zoom animations for that
preference. The site-menu chevron's default 150 ms rotation is the one non-gated motion;
it is not essential and WCAG 2.3.3 is AAA, so it is recorded, not changed. The remaining
transitions are opacity fades, not motion.

## JavaScript per page

Mobile Chromium, seven page types: 535–610 kB uncompressed JavaScript per page. The
PhotoSwipe launcher chunk (22.5 kB, 7.4 kB compressed) loads on most pages, including
ones without a viewer; the 54 kB PhotoSwipe core loads only when a viewer opens. Moving
the launcher would save at most about 7 kB compressed per page; not pursued.

## Caching and fonts

| Resource | `Cache-Control` |
| --- | --- |
| HTML | `private, no-cache, no-store` (dynamic routes, explained in the [headers audit](ab117-production-headers-2026-10-21.md)) |
| `/_next/static/*` CSS, JS, fonts | `public, max-age=31536000, immutable` |
| `/_next/image` | `public, max-age=2678400, must-revalidate` (31 days) |
| `/sitemap.xml`, `/robots.txt` | `public, max-age=0, must-revalidate` |
| `/favicon.ico` | `307` to the CMS logo rendition, `no-store` (follows a logo change) |

The two `next/font` faces are self-hosted `woff2` under `/_next/static/media` and are not
preloaded. The page `<link rel="icon">` and the favicon redirect point at
`cdn.sanity.io` directly; that browser-side CMS media request is the documented processor
relationship in the [security and privacy review](../security-privacy-review.md)
(Sanity asset CDN, public renditions only), not a new third party.

## Indexing of variant URLs (ADR-0003)

| URL form | `robots` | Canonical |
| --- | --- | --- |
| Gallery continuation `?cursor=` | indexable | itself (ADR-0003: an unfiltered continuation is a real page) |
| Article-end section `?section=` | `noindex, follow` | the parameter-free article |
| Search `/haku?q=` | `noindex, follow` | none |
| Tracking parameter `?utm_source=` | indexable | the parameter-free page |

All match ADR-0003's decisions.
